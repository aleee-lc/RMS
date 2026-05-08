import { RecommendationAction } from '@prisma/client';
import { RecommendationService } from './recommendation.service';

describe('RecommendationService', () => {
  const prisma = {
    recommendationSettings: {
      findUnique: jest.fn()
    },
    dailyMetrics: {
      findMany: jest.fn()
    },
    marketRates: {
      findMany: jest.fn()
    },
    recommendations: {
      upsert: jest.fn()
    }
  } as any;

  const alertsService = {
    syncFromRecommendations: jest.fn()
  } as any;

  let service: RecommendationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecommendationService(prisma, alertsService);
  });

  it('generates market-only decrease alerts when demand metric is missing and price is above market', async () => {
    const date = new Date('2026-05-10T00:00:00.000Z');

    prisma.recommendationSettings.findUnique.mockResolvedValue(null);
    prisma.dailyMetrics.findMany.mockResolvedValue([]);
    prisma.marketRates.findMany.mockResolvedValue([
      {
        id: 88,
        hotelId: 1,
        date,
        yourPrice: 130,
        marketAverage: 100,
        competitorRates: []
      }
    ]);

    prisma.recommendations.upsert.mockImplementation(async ({ create }: any) => ({
      id: 501,
      hotelId: create.hotelId,
      marketRateId: create.marketRateId,
      date: create.date,
      action: create.action,
      suggestedPrice: create.suggestedPrice,
      explanation: create.explanation,
      occupancy: create.occupancy,
      yourPrice: create.yourPrice,
      marketAverage: create.marketAverage,
      priceDiffPct: create.priceDiffPct,
      demandFactor: create.demandFactor
    }));

    const results = await service.generateAndPersistRecommendations(1, date, date);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe(RecommendationAction.DECREASE);
    expect(results[0].occupancy).toBeNull();
    expect(results[0].explanation).toContain('No demand metric available');
    expect(alertsService.syncFromRecommendations).toHaveBeenCalledTimes(1);
  });
});
