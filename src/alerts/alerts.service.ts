import { Injectable } from '@nestjs/common';
import { AlertSeverity, RecommendationAction, Recommendations } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toUtcDateOnly } from '../common/utils/date.util';

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

      const occupancy = Number(recommendation.occupancy ?? 0);
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

  async getAlerts(hotelId: number, startDate: Date, endDate: Date, resolved?: boolean) {
    return this.prisma.alerts.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        },
        resolved
      },
      orderBy: [{ resolved: 'asc' }, { severity: 'desc' }, { date: 'asc' }]
    });
  }

  private pickSeverity(action: RecommendationAction, occupancy: number): AlertSeverity {
    if (action === RecommendationAction.INCREASE && occupancy > 80) {
      return AlertSeverity.HIGH;
    }

    if (action === RecommendationAction.DECREASE && occupancy < 20) {
      return AlertSeverity.HIGH;
    }

    return AlertSeverity.MEDIUM;
  }
}
