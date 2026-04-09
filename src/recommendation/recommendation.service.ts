import { Injectable } from '@nestjs/common';
import { RecommendationAction, Recommendations } from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import { dateKey, enumerateDateRange, toUtcDateOnly } from '../common/utils/date.util';
import { clamp, round2 } from '../common/utils/number.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecommendationService {
  private readonly highOccupancyThreshold = 70;
  private readonly lowOccupancyThreshold = 30;
  private readonly significantDiffPct = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alertsService: AlertsService
  ) {}

  async generateAndPersistRecommendations(
    hotelId: number,
    startDate: Date,
    endDate: Date
  ): Promise<Recommendations[]> {
    const normalizedStart = toUtcDateOnly(startDate);
    const normalizedEnd = toUtcDateOnly(endDate);

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

    const output: Recommendations[] = [];

    for (const date of enumerateDateRange(normalizedStart, normalizedEnd)) {
      const key = dateKey(date);
      const metric = metricByDate.get(key);
      const market = marketByDate.get(key);

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

      const highDemand = occupancy > this.highOccupancyThreshold;
      const lowDemand = occupancy < this.lowOccupancyThreshold;
      const underpriced = priceDiffPct < -this.significantDiffPct;
      const overpriced = priceDiffPct > this.significantDiffPct;

      let action: RecommendationAction = RecommendationAction.HOLD;
      if (highDemand && underpriced) {
        action = RecommendationAction.INCREASE;
      } else if (lowDemand && overpriced) {
        action = RecommendationAction.DECREASE;
      }

      const demandFactor = clamp((occupancy - 50) / 100, -0.3, 0.3);
      const marketPositioningFactor =
        marketAverage > 0 ? clamp((marketAverage - yourPrice) / marketAverage, -0.2, 0.2) : 0;

      const basePrice = yourPrice || marketAverage || adr;
      let suggestedPrice = round2(
        basePrice * (1 + clamp(demandFactor * 0.5 + marketPositioningFactor * 0.6, -0.2, 0.2))
      );

      if (action === RecommendationAction.INCREASE && suggestedPrice <= basePrice) {
        suggestedPrice = round2(basePrice * 1.05);
      }
      if (action === RecommendationAction.DECREASE && suggestedPrice >= basePrice) {
        suggestedPrice = round2(basePrice * 0.95);
      }

      const explanation = this.buildExplanation({
        occupancy,
        yourPrice,
        marketAverage,
        priceDiffPct,
        action,
        suggestedPrice
      });

      const recommendation = await this.prisma.recommendations.upsert({
        where: {
          hotelId_date: {
            hotelId,
            date
          }
        },
        update: {
          marketRateId: market?.id,
          action,
          suggestedPrice,
          explanation,
          occupancy: round2(occupancy),
          yourPrice: round2(yourPrice),
          marketAverage: round2(marketAverage),
          priceDiffPct: round2(priceDiffPct),
          demandFactor: round2(demandFactor)
        },
        create: {
          hotelId,
          marketRateId: market?.id,
          date,
          action,
          suggestedPrice,
          explanation,
          occupancy: round2(occupancy),
          yourPrice: round2(yourPrice),
          marketAverage: round2(marketAverage),
          priceDiffPct: round2(priceDiffPct),
          demandFactor: round2(demandFactor)
        }
      });

      output.push(recommendation);
    }

    await this.alertsService.syncFromRecommendations(hotelId, output);

    return output.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private buildExplanation(input: {
    occupancy: number;
    yourPrice: number;
    marketAverage: number;
    priceDiffPct: number;
    action: RecommendationAction;
    suggestedPrice: number;
  }): string {
    const occupancyText = `${input.occupancy.toFixed(1)}%`;
    const gapText = `${input.priceDiffPct.toFixed(1)}%`;

    if (input.action === RecommendationAction.INCREASE) {
      return `High demand (${occupancyText} occupancy > ${this.highOccupancyThreshold}%) and underpricing (${gapText} vs market) support an increase to ${input.suggestedPrice.toFixed(2)}.`;
    }

    if (input.action === RecommendationAction.DECREASE) {
      return `Low demand (${occupancyText} occupancy < ${this.lowOccupancyThreshold}%) and overpricing (${gapText} vs market) support a decrease to ${input.suggestedPrice.toFixed(2)}.`;
    }

    return `Current demand (${occupancyText}) and price position (${gapText} vs market) do not exceed thresholds; hold at ${input.suggestedPrice.toFixed(2)}.`;
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}
