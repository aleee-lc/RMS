import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertSeverity, Prisma, RecommendationAction, Recommendations } from '@prisma/client';
import { toUtcDateOnly } from '../common/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_RECOMMENDATION_SETTINGS,
  RecommendationSettingsConfig,
  normalizeRecommendationSettings
} from '../recommendation/recommendation-settings';

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async syncFromRecommendations(
    hotelId: number,
    recommendations: Recommendations[]
  ): Promise<void> {
    const alertsToUpsert: AlertUpsertInput[] = [];
    const datesToResolve: Date[] = [];

    for (const recommendation of recommendations) {
      if (recommendation.action === RecommendationAction.HOLD) {
        datesToResolve.push(recommendation.date);
        continue;
      }

      const occupancy = recommendation.occupancy === null ? null : Number(recommendation.occupancy);
      const severity = this.pickSeverity(recommendation.action, occupancy);

      alertsToUpsert.push({
        hotelId,
        recommendationId: recommendation.id,
        date: recommendation.date,
        type: 'pricing-opportunity',
        severity,
        title: `${recommendation.action.toLowerCase()} pricing opportunity`,
        message: recommendation.explanation,
        resolved: false
      });
    }

    await this.resolveAlertsByDates(hotelId, 'pricing-opportunity', datesToResolve);
    await this.upsertAlerts(alertsToUpsert);
  }

  async syncOccupancyAlerts(hotelId: number, startDate: Date, endDate: Date): Promise<void> {
    const settings = await this.resolveSettings(hotelId);
    const metrics = await this.prisma.dailyMetrics.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        }
      }
    });

    const alertsToUpsert: AlertUpsertInput[] = [];
    const datesToResolve: Date[] = [];

    for (const metric of metrics) {
      const occupancy = Number(metric.occupancy ?? 0);
      const occupancyText = occupancy.toFixed(1);

      if (occupancy >= settings.highOccupancyThreshold) {
        const severity =
          occupancy >= settings.highOccupancyThreshold + 10
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;
        alertsToUpsert.push({
          hotelId,
          recommendationId: null,
          date: metric.date,
          type: 'occupancy',
          severity,
          title: 'High occupancy detected',
          message: `Occupancy at ${occupancyText}% is above threshold ${settings.highOccupancyThreshold.toFixed(1)}%.`,
          resolved: false
        });
        continue;
      }

      if (occupancy <= settings.lowOccupancyThreshold) {
        const severity =
          occupancy <= settings.lowOccupancyThreshold - 10
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;
        alertsToUpsert.push({
          hotelId,
          recommendationId: null,
          date: metric.date,
          type: 'occupancy',
          severity,
          title: 'Low occupancy detected',
          message: `Occupancy at ${occupancyText}% is below threshold ${settings.lowOccupancyThreshold.toFixed(1)}%.`,
          resolved: false
        });
        continue;
      }

      datesToResolve.push(metric.date);
    }

    await this.resolveAlertsByDates(hotelId, 'occupancy', datesToResolve);
    await this.upsertAlerts(alertsToUpsert);
  }

  async syncCompetitiveSetAlerts(hotelId: number, startDate: Date, endDate: Date): Promise<number> {
    const settings = await this.resolveSettings(hotelId);
    const marketRates = await this.prisma.marketRates.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        }
      },
      include: {
        competitorRates: true
      }
    });

    let activeAlerts = 0;
    const alertsToUpsert: AlertUpsertInput[] = [];
    const datesToResolve: Date[] = [];

    for (const rate of marketRates) {
      const yourPrice = Number(rate.yourPrice ?? 0);
      const competitorAverage = this.average(
        (rate.competitorRates ?? [])
          .map((entry) => Number(entry.price ?? 0))
          .filter((value) => value > 0)
      );
      const marketAverage = Number(rate.marketAverage ?? 0) || competitorAverage;

      if (!(yourPrice > 0) || !(marketAverage > 0)) {
        datesToResolve.push(rate.date);
        continue;
      }

      const diffPct = ((yourPrice - marketAverage) / marketAverage) * 100;
      const absDiff = Math.abs(diffPct);

      if (absDiff === 0) {
        datesToResolve.push(rate.date);
        continue;
      }

      const aboveMarket = diffPct > 0;
      const severity =
        absDiff >= settings.significantDiffPct * 2
          ? AlertSeverity.HIGH
          : absDiff >= settings.significantDiffPct
            ? AlertSeverity.MEDIUM
            : AlertSeverity.LOW;
      const title = aboveMarket ? 'Price above comp set' : 'Price below comp set';
      const message = aboveMarket
        ? `Your price (${yourPrice.toFixed(2)}) is ${absDiff.toFixed(1)}% above comp set average (${marketAverage.toFixed(2)}). Threshold for medium severity is ${settings.significantDiffPct.toFixed(1)}%.`
        : `Your price (${yourPrice.toFixed(2)}) is ${absDiff.toFixed(1)}% below comp set average (${marketAverage.toFixed(2)}). Threshold for medium severity is ${settings.significantDiffPct.toFixed(1)}%.`;

      alertsToUpsert.push({
        hotelId,
        recommendationId: null,
        date: rate.date,
        type: 'competitive-set',
        severity,
        title,
        message,
        resolved: false
      });
      activeAlerts += 1;
    }

    await this.resolveAlertsByDates(hotelId, 'competitive-set', datesToResolve);
    await this.upsertAlerts(alertsToUpsert);

    return activeAlerts;
  }

  async getAlerts(hotelId: number, startDate: Date, endDate: Date, resolved?: boolean) {
    return this.prisma.alerts.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        },
        type: {
          in: ['occupancy', 'competitive-set', 'pricing-opportunity']
        },
        resolved
      },
      orderBy: [{ resolved: 'asc' }, { severity: 'desc' }, { date: 'asc' }]
    });
  }

  async setResolvedState(hotelId: number, alertId: number, resolved: boolean) {
    const alert = await this.prisma.alerts.findFirst({
      where: {
        id: alertId,
        hotelId
      }
    });

    if (!alert) {
      throw new NotFoundException(`Alert ${alertId} not found for hotel ${hotelId}`);
    }

    return this.prisma.alerts.update({
      where: { id: alertId },
      data: { resolved }
    });
  }

  private pickSeverity(action: RecommendationAction, occupancy: number | null): AlertSeverity {
    if (occupancy === null) {
      return AlertSeverity.MEDIUM;
    }

    if (action === RecommendationAction.INCREASE && occupancy > 80) {
      return AlertSeverity.HIGH;
    }

    if (action === RecommendationAction.DECREASE && occupancy < 20) {
      return AlertSeverity.HIGH;
    }

    return AlertSeverity.MEDIUM;
  }

  private async resolveSettings(hotelId: number): Promise<RecommendationSettingsConfig> {
    try {
      const persisted = await this.prisma.recommendationSettings.findUnique({
        where: { hotelId }
      });

      if (!persisted) {
        return normalizeRecommendationSettings();
      }

      return normalizeRecommendationSettings({
        highOccupancyThreshold: Number(persisted.highOccupancyThreshold),
        lowOccupancyThreshold: Number(persisted.lowOccupancyThreshold),
        significantDiffPct: Number(persisted.significantDiffPct),
        demandWeight: Number(persisted.demandWeight),
        marketWeight: Number(persisted.marketWeight),
        maxAdjustmentPct: Number(persisted.maxAdjustmentPct),
        minActionStepPct: Number(persisted.minActionStepPct)
      });
    } catch {
      return { ...DEFAULT_RECOMMENDATION_SETTINGS };
    }
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private async resolveAlertsByDates(hotelId: number, type: string, dates: Date[]): Promise<void> {
    if (dates.length === 0) {
      return;
    }

    await this.prisma.alerts.updateMany({
      where: {
        hotelId,
        date: {
          in: dates
        },
        type
      },
      data: { resolved: true }
    });
  }

  private async upsertAlerts(alerts: AlertUpsertInput[]): Promise<void> {
    if (alerts.length === 0) {
      return;
    }

    if (typeof (this.prisma as any).$executeRaw === 'function') {
      const values = Prisma.join(
        alerts.map(
          (alert) =>
            Prisma.sql`(
            ${alert.hotelId},
            ${alert.recommendationId},
            ${alert.date},
            ${alert.type},
            ${alert.severity}::"AlertSeverity",
            ${alert.title},
            ${alert.message},
            ${alert.resolved},
            NOW()
          )`
        )
      );

      await this.prisma.$executeRaw`
        INSERT INTO "Alerts" (
          "hotelId",
          "recommendationId",
          "date",
          "type",
          "severity",
          "title",
          "message",
          "resolved",
          "updatedAt"
        )
        VALUES ${values}
        ON CONFLICT ("hotelId", "date", "type") DO UPDATE SET
          "recommendationId" = EXCLUDED."recommendationId",
          "severity" = EXCLUDED."severity",
          "title" = EXCLUDED."title",
          "message" = EXCLUDED."message",
          "resolved" = EXCLUDED."resolved",
          "updatedAt" = NOW()
      `;
      return;
    }

    for (const alert of alerts) {
      await this.prisma.alerts.upsert({
        where: {
          hotelId_date_type: {
            hotelId: alert.hotelId,
            date: alert.date,
            type: alert.type
          }
        },
        update: {
          recommendationId: alert.recommendationId,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          resolved: alert.resolved
        },
        create: alert
      });
    }
  }
}

interface AlertUpsertInput {
  hotelId: number;
  recommendationId: number | null;
  date: Date;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  resolved: boolean;
}
