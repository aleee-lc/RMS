import { Injectable } from '@nestjs/common';
import { Prisma, RecommendationAction, Recommendations } from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import { dateKey, enumerateDateRange, toUtcDateOnly } from '../common/utils/date.util';
import { clamp, round2 } from '../common/utils/number.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeRecommendationSettings,
  RecommendationSettingsConfig
} from './recommendation-settings';

export interface RecommendationGenerationOptions {
  highOccupancyThreshold?: number;
  lowOccupancyThreshold?: number;
  significantDiffPct?: number;
  demandWeight?: number;
  marketWeight?: number;
  maxAdjustmentPct?: number;
  minActionStepPct?: number;
}

@Injectable()
export class RecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alertsService: AlertsService
  ) {}

  async getRecommendations(
    hotelId: number,
    startDate: Date,
    endDate: Date
  ): Promise<Recommendations[]> {
    return this.prisma.recommendations.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        }
      },
      orderBy: { date: 'asc' }
    });
  }

  async generateAndPersistRecommendations(
    hotelId: number,
    startDate: Date,
    endDate: Date,
    options?: RecommendationGenerationOptions
  ): Promise<Recommendations[]> {
    const normalizedStart = toUtcDateOnly(startDate);
    const normalizedEnd = toUtcDateOnly(endDate);
    const config = await this.resolveGenerationConfig(hotelId, options);

    const [metrics, marketRates] = await Promise.all([
      this.prisma.dailyMetrics.findMany({
        where: {
          hotelId,
          date: {
            gte: normalizedStart,
            lte: normalizedEnd
          }
        }
      }),
      this.prisma.marketRates.findMany({
        where: {
          hotelId,
          date: {
            gte: normalizedStart,
            lte: normalizedEnd
          }
        },
        include: {
          competitorRates: true
        }
      })
    ]);

    const metricByDate = new Map(metrics.map((m) => [dateKey(m.date), m]));
    const marketByDate = new Map(marketRates.map((m) => [dateKey(m.date), m]));

    const recommendationInputs: Omit<Recommendations, 'id' | 'createdAt' | 'updatedAt'>[] = [];

    for (const date of enumerateDateRange(normalizedStart, normalizedEnd)) {
      const key = dateKey(date);
      const metric = metricByDate.get(key);
      const market = marketByDate.get(key);

      const hasDemandSignal = Boolean(metric);
      const occupancy = Number(metric?.occupancy ?? 0);
      const adr = Number(metric?.adr ?? 0);

      const yourPrice = Number(market?.yourPrice ?? 0) || adr;
      const competitorAverage = this.average(
        (market?.competitorRates ?? [])
          .map((entry) => Number(entry.price ?? 0))
          .filter((value) => value > 0)
      );
      const marketAverage = Number(market?.marketAverage ?? 0) || competitorAverage || yourPrice;

      const priceDiffPct =
        marketAverage > 0 ? ((yourPrice - marketAverage) / marketAverage) * 100 : 0;

      const highDemand = hasDemandSignal && occupancy > config.highOccupancyThreshold;
      const lowDemand = hasDemandSignal && occupancy < config.lowOccupancyThreshold;
      const underpriced = priceDiffPct < -config.significantDiffPct;
      const overpriced = priceDiffPct > config.significantDiffPct;

      let action: RecommendationAction = RecommendationAction.HOLD;
      if (hasDemandSignal) {
        if (highDemand && underpriced) {
          action = RecommendationAction.INCREASE;
        } else if (lowDemand && overpriced) {
          action = RecommendationAction.DECREASE;
        }
      } else if (underpriced) {
        action = RecommendationAction.INCREASE;
      } else if (overpriced) {
        action = RecommendationAction.DECREASE;
      }

      const demandFactor = hasDemandSignal ? clamp((occupancy - 50) / 100, -0.3, 0.3) : 0;
      const marketPositioningFactor =
        marketAverage > 0 ? clamp((marketAverage - yourPrice) / marketAverage, -0.2, 0.2) : 0;

      const basePrice = yourPrice || marketAverage || adr;
      const adjustmentFactor = clamp(
        demandFactor * config.demandWeight + marketPositioningFactor * config.marketWeight,
        -(config.maxAdjustmentPct / 100),
        config.maxAdjustmentPct / 100
      );
      let suggestedPrice = round2(basePrice * (1 + adjustmentFactor));

      const minimumStepFactor = config.minActionStepPct / 100;
      if (action === RecommendationAction.INCREASE && suggestedPrice <= basePrice) {
        suggestedPrice = round2(basePrice * (1 + minimumStepFactor));
      }
      if (action === RecommendationAction.DECREASE && suggestedPrice >= basePrice) {
        suggestedPrice = round2(basePrice * (1 - minimumStepFactor));
      }

      const explanation = this.buildExplanation({
        occupancy,
        yourPrice,
        marketAverage,
        priceDiffPct,
        action,
        suggestedPrice,
        config,
        hasDemandSignal
      });

      recommendationInputs.push({
        hotelId,
        marketRateId: market?.id ?? null,
        date,
        action,
        suggestedPrice: suggestedPrice as any,
        explanation,
        occupancy: (hasDemandSignal ? round2(occupancy) : null) as any,
        yourPrice: round2(yourPrice) as any,
        marketAverage: round2(marketAverage) as any,
        priceDiffPct: round2(priceDiffPct) as any,
        demandFactor: round2(demandFactor) as any
      });
    }

    const output = await this.upsertRecommendations(recommendationInputs);
    await this.alertsService.syncFromRecommendations(hotelId, output);

    return output.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private async upsertRecommendations(
    recommendations: Omit<Recommendations, 'id' | 'createdAt' | 'updatedAt'>[]
  ): Promise<Recommendations[]> {
    if (recommendations.length === 0) {
      return [];
    }

    if (typeof (this.prisma as any).$queryRaw === 'function') {
      const values = Prisma.join(
        recommendations.map(
          (recommendation) =>
            Prisma.sql`(
            ${recommendation.hotelId},
            ${recommendation.marketRateId},
            ${recommendation.date},
            ${recommendation.action}::"RecommendationAction",
            ${recommendation.suggestedPrice},
            ${recommendation.explanation},
            ${recommendation.occupancy},
            ${recommendation.yourPrice},
            ${recommendation.marketAverage},
            ${recommendation.priceDiffPct},
            ${recommendation.demandFactor}
          )`
        )
      );

      return this.prisma.$queryRaw<Recommendations[]>`
        INSERT INTO "Recommendations" (
          "hotelId",
          "marketRateId",
          "date",
          "action",
          "suggestedPrice",
          "explanation",
          "occupancy",
          "yourPrice",
          "marketAverage",
          "priceDiffPct",
          "demandFactor"
        )
        VALUES ${values}
        ON CONFLICT ("hotelId", "date") DO UPDATE SET
          "marketRateId" = EXCLUDED."marketRateId",
          "action" = EXCLUDED."action",
          "suggestedPrice" = EXCLUDED."suggestedPrice",
          "explanation" = EXCLUDED."explanation",
          "occupancy" = EXCLUDED."occupancy",
          "yourPrice" = EXCLUDED."yourPrice",
          "marketAverage" = EXCLUDED."marketAverage",
          "priceDiffPct" = EXCLUDED."priceDiffPct",
          "demandFactor" = EXCLUDED."demandFactor",
          "updatedAt" = NOW()
        RETURNING *
      `;
    }

    const output: Recommendations[] = [];
    for (const recommendation of recommendations) {
      output.push(
        await this.prisma.recommendations.upsert({
          where: {
            hotelId_date: {
              hotelId: recommendation.hotelId,
              date: recommendation.date
            }
          },
          update: {
            marketRateId: recommendation.marketRateId,
            action: recommendation.action,
            suggestedPrice: recommendation.suggestedPrice,
            explanation: recommendation.explanation,
            occupancy: recommendation.occupancy,
            yourPrice: recommendation.yourPrice,
            marketAverage: recommendation.marketAverage,
            priceDiffPct: recommendation.priceDiffPct,
            demandFactor: recommendation.demandFactor
          },
          create: recommendation
        })
      );
    }

    return output;
  }

  private buildExplanation(input: {
    occupancy: number;
    yourPrice: number;
    marketAverage: number;
    priceDiffPct: number;
    action: RecommendationAction;
    suggestedPrice: number;
    config: RecommendationSettingsConfig;
    hasDemandSignal: boolean;
  }): string {
    const gapText = `${input.priceDiffPct.toFixed(1)}%`;

    if (!input.hasDemandSignal) {
      if (input.action === RecommendationAction.INCREASE) {
        return `No demand metric available; market gap (${gapText} below comp set threshold ${input.config.significantDiffPct}%) supports an increase to ${input.suggestedPrice.toFixed(2)}.`;
      }

      if (input.action === RecommendationAction.DECREASE) {
        return `No demand metric available; market gap (${gapText} above comp set threshold ${input.config.significantDiffPct}%) supports a decrease to ${input.suggestedPrice.toFixed(2)}.`;
      }

      return `No demand metric available and price position (${gapText} vs market) is within configured threshold; hold at ${input.suggestedPrice.toFixed(2)}.`;
    }

    const occupancyText = `${input.occupancy.toFixed(1)}%`;

    if (input.action === RecommendationAction.INCREASE) {
      return `High demand (${occupancyText} occupancy > ${input.config.highOccupancyThreshold}%) and underpricing (${gapText} vs market threshold ${input.config.significantDiffPct}%) support an increase to ${input.suggestedPrice.toFixed(2)}.`;
    }

    if (input.action === RecommendationAction.DECREASE) {
      return `Low demand (${occupancyText} occupancy < ${input.config.lowOccupancyThreshold}%) and overpricing (${gapText} vs market threshold ${input.config.significantDiffPct}%) support a decrease to ${input.suggestedPrice.toFixed(2)}.`;
    }

    return `Current demand (${occupancyText}) and price position (${gapText} vs market) do not exceed configured thresholds; hold at ${input.suggestedPrice.toFixed(2)}.`;
  }

  private async resolveGenerationConfig(
    hotelId: number,
    options?: RecommendationGenerationOptions
  ): Promise<RecommendationSettingsConfig> {
    const persisted = await this.prisma.recommendationSettings.findUnique({
      where: { hotelId }
    });

    return normalizeRecommendationSettings({
      ...(persisted
        ? {
            highOccupancyThreshold: Number(persisted.highOccupancyThreshold),
            lowOccupancyThreshold: Number(persisted.lowOccupancyThreshold),
            significantDiffPct: Number(persisted.significantDiffPct),
            demandWeight: Number(persisted.demandWeight),
            marketWeight: Number(persisted.marketWeight),
            maxAdjustmentPct: Number(persisted.maxAdjustmentPct),
            minActionStepPct: Number(persisted.minActionStepPct)
          }
        : {}),
      ...(options ?? {})
    });
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}
