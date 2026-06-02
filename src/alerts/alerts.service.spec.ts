import { NotFoundException } from '@nestjs/common';
import { AlertSeverity, RecommendationAction } from '@prisma/client';
import { AlertsService } from './alerts.service';

describe('AlertsService', () => {
  let prisma: any;
  let service: AlertsService;

  beforeEach(() => {
    prisma = {
      recommendationSettings: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      dailyMetrics: {
        findMany: jest.fn()
      },
      marketRates: {
        findMany: jest.fn()
      },
      alerts: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn()
      }
    };
    service = new AlertsService(prisma);
  });

  it('marks an alert as resolved', async () => {
    prisma.alerts.findFirst.mockResolvedValue({
      id: 10,
      hotelId: 1,
      resolved: false
    });
    prisma.alerts.update.mockResolvedValue({
      id: 10,
      hotelId: 1,
      resolved: true
    });

    const result = await service.setResolvedState(1, 10, true);

    expect(prisma.alerts.findFirst).toHaveBeenCalledWith({
      where: {
        id: 10,
        hotelId: 1
      }
    });
    expect(prisma.alerts.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { resolved: true }
    });
    expect(result.resolved).toBe(true);
  });

  it('re-opens an alert', async () => {
    prisma.alerts.findFirst.mockResolvedValue({
      id: 11,
      hotelId: 1,
      resolved: true
    });
    prisma.alerts.update.mockResolvedValue({
      id: 11,
      hotelId: 1,
      resolved: false
    });

    const result = await service.setResolvedState(1, 11, false);
    expect(result.resolved).toBe(false);
  });

  it('throws when alert is not found for hotel', async () => {
    prisma.alerts.findFirst.mockResolvedValue(null);

    await expect(service.setResolvedState(1, 999, true)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.alerts.update).not.toHaveBeenCalled();
  });

  it('creates recommendation alerts as pricing opportunities', async () => {
    const date = new Date('2026-05-10T00:00:00.000Z');

    await service.syncFromRecommendations(1, [
      {
        id: 501,
        hotelId: 1,
        date,
        action: RecommendationAction.DECREASE,
        explanation: 'Price is above market.',
        occupancy: null
      } as any
    ]);

    expect(prisma.alerts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hotelId_date_type: {
            hotelId: 1,
            date,
            type: 'pricing-opportunity'
          }
        },
        create: expect.objectContaining({
          recommendationId: 501,
          type: 'pricing-opportunity',
          resolved: false
        })
      })
    );
  });

  it('keeps competitive-set alerts separate from pricing opportunities', async () => {
    const date = new Date('2026-05-10T00:00:00.000Z');
    prisma.marketRates.findMany.mockResolvedValue([
      {
        hotelId: 1,
        date,
        yourPrice: 130,
        marketAverage: 100
      }
    ]);

    await service.syncCompetitiveSetAlerts(1, date, date);

    expect(prisma.alerts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hotelId_date_type: {
            hotelId: 1,
            date,
            type: 'competitive-set'
          }
        },
        update: expect.objectContaining({
          recommendationId: null,
          severity: AlertSeverity.HIGH,
          resolved: false
        }),
        create: expect.objectContaining({
          type: 'competitive-set',
          severity: AlertSeverity.HIGH,
          resolved: false
        })
      })
    );
  });

  it('generates competitive-set alerts from competitor prices when market average is missing', async () => {
    const date = new Date('2026-05-11T00:00:00.000Z');
    prisma.marketRates.findMany.mockResolvedValue([
      {
        hotelId: 1,
        date,
        yourPrice: 130,
        marketAverage: null,
        competitorRates: [{ price: 100 }, { price: 110 }, { price: 90 }]
      }
    ]);

    await service.syncCompetitiveSetAlerts(1, date, date);

    expect(prisma.marketRates.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          competitorRates: true
        }
      })
    );
    expect(prisma.alerts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hotelId_date_type: {
            hotelId: 1,
            date,
            type: 'competitive-set'
          }
        },
        create: expect.objectContaining({
          title: 'Precio por encima del comp set',
          message: expect.stringContaining('30.0% por encima del promedio del comp set (100.00)')
        })
      })
    );
  });

  it('shows small competitive-set differences as low severity', async () => {
    const date = new Date('2026-05-12T00:00:00.000Z');
    prisma.marketRates.findMany.mockResolvedValue([
      {
        hotelId: 1,
        date,
        yourPrice: 104,
        marketAverage: 100,
        competitorRates: []
      }
    ]);

    await service.syncCompetitiveSetAlerts(1, date, date);

    expect(prisma.alerts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: 'competitive-set',
          severity: AlertSeverity.LOW,
          title: 'Precio por encima del comp set',
          message: expect.stringContaining('4.0% por encima del promedio del comp set')
        })
      })
    );
  });
});
