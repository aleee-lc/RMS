import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertSeverity, RecommendationAction, Recommendations } from '@prisma/client';
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
    for (const recommendation of recommendations) {
      if (recommendation.action === RecommendationAction.HOLD) {
        await this.prisma.alerts.updateMany({
          where: {
            hotelId,
            date: recommendation.date,
            type: 'pricing-opportunity'
          },
          data: { resolved: true }
        });
        continue;
      }

      const occupancy = recommendation.occupancy === null ? null : Number(recommendation.occupancy);
      const severity = this.pickSeverity(recommendation.action, occupancy);

      await this.prisma.alerts.upsert({
        where: {
          hotelId_date_type: {
            hotelId,
            date: recommendation.date,
            type: 'pricing-opportunity'
          }
        },
        update: {
          recommendationId: recommendation.id,
          severity,
          title: `${recommendation.action.toLowerCase()} pricing opportunity`,
          message: recommendation.explanation,
          resolved: false
        },
        create: {
          hotelId,
          recommendationId: recommendation.id,
          date: recommendation.date,
          type: 'pricing-opportunity',
          severity,
          title: `${recommendation.action.toLowerCase()} pricing opportunity`,
          message: recommendation.explanation,
          resolved: false
        }
      });
    }
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

    for (const metric of metrics) {
      const occupancy = Number(metric.occupancy ?? 0);
      const occupancyText = occupancy.toFixed(1);

      if (occupancy >= settings.highOccupancyThreshold) {
        const severity =
          occupancy >= settings.highOccupancyThreshold + 10
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;
        await this.prisma.alerts.upsert({
          where: {
            hotelId_date_type: {
              hotelId,
              date: metric.date,
              type: 'occupancy'
            }
          },
          update: {
            recommendationId: null,
            severity,
            title: 'High occupancy detected',
            message: `Occupancy at ${occupancyText}% is above threshold ${settings.highOccupancyThreshold.toFixed(1)}%.`,
            resolved: false
          },
          create: {
            hotelId,
            date: metric.date,
            type: 'occupancy',
            severity,
            title: 'High occupancy detected',
            message: `Occupancy at ${occupancyText}% is above threshold ${settings.highOccupancyThreshold.toFixed(1)}%.`,
            resolved: false
          }
        });
        continue;
      }

      if (occupancy <= settings.lowOccupancyThreshold) {
        const severity =
          occupancy <= settings.lowOccupancyThreshold - 10
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;
        await this.prisma.alerts.upsert({
          where: {
            hotelId_date_type: {
              hotelId,
              date: metric.date,
              type: 'occupancy'
            }
          },
          update: {
            recommendationId: null,
            severity,
            title: 'Low occupancy detected',
            message: `Occupancy at ${occupancyText}% is below threshold ${settings.lowOccupancyThreshold.toFixed(1)}%.`,
            resolved: false
          },
          create: {
            hotelId,
            date: metric.date,
            type: 'occupancy',
            severity,
            title: 'Low occupancy detected',
            message: `Occupancy at ${occupancyText}% is below threshold ${settings.lowOccupancyThreshold.toFixed(1)}%.`,
            resolved: false
          }
        });
        continue;
      }

      await this.prisma.alerts.updateMany({
        where: {
          hotelId,
          date: metric.date,
          type: 'occupancy'
        },
        data: { resolved: true }
      });
    }
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

    for (const rate of marketRates) {
      const yourPrice = Number(rate.yourPrice ?? 0);
      const competitorAverage = this.average(
        (rate.competitorRates ?? [])
          .map((entry) => Number(entry.price ?? 0))
          .filter((value) => value > 0)
      );
      const marketAverage = Number(rate.marketAverage ?? 0) || competitorAverage;

      if (!(yourPrice > 0) || !(marketAverage > 0)) {
        await this.prisma.alerts.updateMany({
          where: {
            hotelId,
            date: rate.date,
            type: 'competitive-set'
          },
          data: { resolved: true }
        });
        continue;
      }

      const diffPct = ((yourPrice - marketAverage) / marketAverage) * 100;
      const absDiff = Math.abs(diffPct);

      if (absDiff === 0) {
        await this.prisma.alerts.updateMany({
          where: {
            hotelId,
            date: rate.date,
            type: 'competitive-set'
          },
          data: { resolved: true }
        });
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

      await this.prisma.alerts.upsert({
        where: {
          hotelId_date_type: {
            hotelId,
            date: rate.date,
            type: 'competitive-set'
          }
        },
        update: {
          recommendationId: null,
          severity,
          title,
          message,
          resolved: false
        },
        create: {
          hotelId,
          date: rate.date,
          type: 'competitive-set',
          severity,
          title,
          message,
          resolved: false
        }
      });
      activeAlerts += 1;
    }

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
}
