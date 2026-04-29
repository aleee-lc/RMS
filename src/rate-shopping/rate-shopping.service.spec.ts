import { RateShoppingNormalizer } from './rate-shopping.normalizer';
import { RateShoppingService } from './rate-shopping.service';
import { RateShoppingScraper } from './scrapers/rate-shopping-scraper.interface';

describe('RateShoppingService', () => {
  const prisma = {
    hotel: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    competitor: {
      findMany: jest.fn(),
      upsert: jest.fn()
    },
    rateShopSnapshot: {
      createMany: jest.fn(),
      findMany: jest.fn()
    },
    marketRates: {
      upsert: jest.fn()
    },
    competitorMarketRates: {
      upsert: jest.fn()
    }
  } as any;

  const scraper: RateShoppingScraper = {
    name: 'fake-scraper',
    scrape: jest.fn(async (input) => {
      if (input.targetHotelName === 'My Hotel') {
        return [
          {
            hotelName: input.targetHotelName,
            source: 'Direct',
            price: 120,
            currency: 'USD',
            availability: true,
            occupancyAdults: 2,
            priceMode: 'per_night' as const,
            rawText: 'USD 120 per night',
            scrapedAt: new Date('2026-04-24T00:00:00.000Z')
          }
        ];
      }

      return [
        {
          hotelName: input.targetHotelName,
          source: 'Booking',
          price: 100,
          currency: 'USD',
          availability: true,
          occupancyAdults: 2,
          priceMode: 'per_night' as const,
          rawText: 'USD 100 per night',
          scrapedAt: new Date('2026-04-24T00:00:00.000Z')
        }
      ];
    })
  };

  let service: RateShoppingService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.hotel.findUnique.mockResolvedValue({
      id: 1,
      name: 'My Hotel',
      currency: 'USD'
    });
    prisma.competitor.findMany.mockResolvedValue([{ name: 'Competitor A' }]);
    prisma.rateShopSnapshot.createMany.mockResolvedValue({ count: 2 });
    prisma.marketRates.upsert.mockResolvedValue({ id: 300 });
    prisma.competitor.upsert.mockResolvedValue({ id: 501 });
    prisma.competitorMarketRates.upsert.mockResolvedValue({ id: 700 });

    service = new RateShoppingService(prisma, new RateShoppingNormalizer(), [scraper]);
  });

  it('runs rate shopping and syncs market rates', async () => {
    const result = await service.runForHotel({
      hotelId: 1,
      city: 'Los Mochis',
      checkInDate: new Date('2026-06-10T00:00:00.000Z'),
      checkOutDate: new Date('2026-06-11T00:00:00.000Z'),
      adults: 2
    });

    expect(prisma.rateShopSnapshot.createMany).toHaveBeenCalled();
    expect(prisma.marketRates.upsert).toHaveBeenCalled();
    expect(prisma.competitorMarketRates.upsert).toHaveBeenCalled();

    expect(result.summary.yourPrice).toBe(120);
    expect(result.summary.marketAverage).toBe(100);
    expect(result.summary.marketRateId).toBe(300);
  });
});
