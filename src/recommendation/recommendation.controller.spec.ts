import { RecommendationAction } from '@prisma/client';
import { RecommendationController } from './recommendation.controller';

describe('RecommendationController', () => {
  const recommendationService = {
    getRecommendations: jest.fn(),
    generateAndPersistRecommendations: jest.fn()
  } as any;

  const hotelContextService = {
    resolveHotel: jest.fn()
  } as any;

  let controller: RecommendationController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RecommendationController(recommendationService, hotelContextService);
    hotelContextService.resolveHotel.mockResolvedValue({
      id: 1,
      name: 'Hotel',
      totalRooms: 100
    });
  });

  it('GET /recommendations only reads persisted items', async () => {
    recommendationService.getRecommendations.mockResolvedValue([
      {
        id: 1,
        hotelId: 1,
        date: new Date('2026-04-24T00:00:00.000Z'),
        action: RecommendationAction.HOLD,
        suggestedPrice: 1200,
        explanation: 'hold',
        occupancy: 65,
        yourPrice: 1200,
        marketAverage: 1190
      }
    ]);

    const result = await controller.getRecommendations({
      hotelId: 1,
      startDate: '2026-04-24',
      endDate: '2026-04-24'
    });

    expect(recommendationService.getRecommendations).toHaveBeenCalledTimes(1);
    expect(recommendationService.generateAndPersistRecommendations).not.toHaveBeenCalled();
    expect(result.count).toBe(1);
  });

  it('POST /recommendations/generate triggers generation', async () => {
    recommendationService.generateAndPersistRecommendations.mockResolvedValue([
      {
        id: 1,
        hotelId: 1,
        date: new Date('2026-04-24T00:00:00.000Z'),
        action: RecommendationAction.INCREASE,
        suggestedPrice: 1300,
        explanation: 'increase',
        occupancy: 78,
        yourPrice: 1200,
        marketAverage: 1350
      }
    ]);

    const result = await controller.generateRecommendations(
      {
        hotelId: 1,
        startDate: '2026-04-24',
        endDate: '2026-04-24'
      },
      {
        highOccupancyThreshold: 75,
        significantDiffPct: 8
      }
    );

    expect(recommendationService.generateAndPersistRecommendations).toHaveBeenCalledTimes(1);
    expect(recommendationService.generateAndPersistRecommendations).toHaveBeenCalledWith(
      1,
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({
        highOccupancyThreshold: 75,
        significantDiffPct: 8
      })
    );
    expect(result.items[0].action).toBe('increase');
  });
});
