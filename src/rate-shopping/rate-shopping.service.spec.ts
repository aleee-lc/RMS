import { RateShoppingNormalizer } from './rate-shopping.normalizer';
import { RateShoppingService } from './rate-shopping.service';
import { MakCorpsHotelApiProvider } from './scrapers/makcorps-hotel-api.provider';
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
            price: 1220,
            currency: 'USD',
            availability: true,
            occupancyAdults: 2,
            priceMode: 'per_night' as const,
            rawText: 'USD 1220 per night',
            scrapedAt: new Date('2026-04-24T00:00:00.000Z')
          }
        ];
      }

      return [
        {
          hotelName: input.targetHotelName,
          source: 'Booking',
          price: 1000,
          currency: 'USD',
          availability: true,
          occupancyAdults: 2,
          priceMode: 'per_night' as const,
          rawText: 'USD 1000 per night',
          scrapedAt: new Date('2026-04-24T00:00:00.000Z')
        }
      ];
    })
  };

    const makCorpsProvider = {
      scrape: jest.fn(async (input) => [
      {
        hotelName: input.targetHotelName,
        source: 'Expedia.com',
        price: 1500,
        currency: 'USD',
        availability: true,
        occupancyAdults: 2,
        priceMode: 'total_stay' as const,
        rawText: 'Expedia.com $1500',
        scrapedAt: new Date('2026-04-24T00:00:00.000Z')
      }
    ]),
    searchMapping: jest.fn(async () => [])
  } as unknown as MakCorpsHotelApiProvider;

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

    service = new RateShoppingService(prisma, new RateShoppingNormalizer(), [scraper], makCorpsProvider);
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

    expect(result.summary.yourPrice).toBe(1220);
    expect(result.summary.marketAverage).toBe(1000);
    expect(result.summary.marketRateId).toBe(300);
  });

  it('builds a summary from latest public snapshots', async () => {
    prisma.rateShopSnapshot.findMany.mockResolvedValue([
      {
        id: 1,
        competitorName: 'My Hotel',
        source: 'Direct',
        checkInDate: new Date('2026-06-10T00:00:00.000Z'),
        checkOutDate: new Date('2026-06-11T00:00:00.000Z'),
        adults: 2,
        price: 1220,
        currency: 'USD',
        available: true,
        scrapedAt: new Date('2026-04-24T10:00:00.000Z')
      },
      {
        id: 2,
        competitorName: 'Competitor A',
        source: 'Booking',
        checkInDate: new Date('2026-06-10T00:00:00.000Z'),
        checkOutDate: new Date('2026-06-11T00:00:00.000Z'),
        adults: 2,
        price: 1000,
        currency: 'USD',
        available: true,
        scrapedAt: new Date('2026-04-24T10:00:00.000Z')
      }
    ]);

    const result = await service.getSummary({
      hotelId: 1,
      startDate: new Date('2026-06-10T00:00:00.000Z'),
      endDate: new Date('2026-06-10T00:00:00.000Z')
    });

    expect(result.items).toHaveLength(1);
    expect(result.spotlight?.marketAverage).toBe(1000);
    expect(result.spotlight?.yourPrice).toBe(1220);
    expect(result.spotlight?.competitorsBelowYou).toBe(1);
  });

  it('runs MakCorps provider separately from existing scrapers', async () => {
    const result = await service.runMakCorpsForHotel({
      hotelId: 1,
      city: 'Los Mochis',
      checkInDate: new Date('2026-06-10T00:00:00.000Z'),
      checkOutDate: new Date('2026-06-11T00:00:00.000Z'),
      adults: 2
    });

    expect((makCorpsProvider.scrape as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect(result.summary.snapshotsPersisted).toBeGreaterThan(0);
  });
});
