import { BiService } from './bi.service';

describe('BiService', () => {
  const hotel = {
    id: 1,
    code: 'HOTEL',
    name: 'Hotel Demo',
    totalRooms: 100,
    currency: 'MXN',
    timezone: 'America/Mexico_City',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const prisma = {
    dailyMetrics: {
      findMany: jest.fn()
    },
    reservationRaw: {
      findMany: jest.fn()
    },
    marketRates: {
      findMany: jest.fn()
    },
    alerts: {
      count: jest.fn()
    }
  } as any;

  let service: BiService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BiService(prisma);
    prisma.alerts.count.mockResolvedValue(0);
  });

  it('recommends increasing price when demand is high and price is below comp set', async () => {
    const stayDate = new Date('2026-05-20T00:00:00.000Z');

    prisma.dailyMetrics.findMany.mockResolvedValue([
      {
        hotelId: 1,
        date: stayDate,
        bookedRooms: 82,
        occupancy: 82,
        adr: 2100,
        revenue: 172200
      }
    ]);
    prisma.reservationRaw.findMany.mockResolvedValue([
      {
        arrivalDate: stayDate,
        bookingDate: new Date('2026-05-07T00:00:00.000Z'),
        noOfRooms: 5,
        nights: 1,
        roomRate: 2100
      }
    ]);
    prisma.marketRates.findMany.mockResolvedValue([
      {
        hotelId: 1,
        date: stayDate,
        yourPrice: 2100,
        marketAverage: 2450,
        competitorRates: [
          {
            competitorId: 1,
            price: 2500,
            competitor: { name: 'Comp A' }
          },
          {
            competitorId: 2,
            price: 2400,
            competitor: { name: 'Comp B' }
          }
        ]
      }
    ]);

    const rows = await service.getRevenueCalendar(
      hotel,
      stayDate,
      stayDate,
      new Date('2026-05-07T00:00:00.000Z')
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].market.position).toBe('below');
    expect(rows[0].suggestedAction).toBe('increase-slightly');
    expect(rows[0].signals.map((signal) => signal.type)).toContain('high-demand-low-price');
    expect(rows[0].opportunityScore).toBeGreaterThan(rows[0].riskScore);
  });

  it('recommends commercial action when occupancy is low and there is no recent pickup', async () => {
    const stayDate = new Date('2026-05-12T00:00:00.000Z');

    prisma.dailyMetrics.findMany.mockResolvedValue([
      {
        hotelId: 1,
        date: stayDate,
        bookedRooms: 12,
        occupancy: 12,
        adr: 1800,
        revenue: 21600
      }
    ]);
    prisma.reservationRaw.findMany.mockResolvedValue([]);
    prisma.marketRates.findMany.mockResolvedValue([
      {
        hotelId: 1,
        date: stayDate,
        yourPrice: 1900,
        marketAverage: 1700,
        competitorRates: []
      }
    ]);

    const rows = await service.getRevenueCalendar(
      hotel,
      stayDate,
      stayDate,
      new Date('2026-05-07T00:00:00.000Z')
    );

    expect(rows[0].riskScore).toBeGreaterThan(60);
    expect(rows[0].suggestedAction).toBe('decrease-moderately');
    expect(rows[0].signals.map((signal) => signal.type)).toEqual(
      expect.arrayContaining(['extremely-low-demand', 'low-demand-high-price'])
    );
  });
});
