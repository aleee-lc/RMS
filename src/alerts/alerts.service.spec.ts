import { NotFoundException } from '@nestjs/common';
import { AlertsService } from './alerts.service';

describe('AlertsService', () => {
  const prisma = {
    alerts: {
      findFirst: jest.fn(),
      update: jest.fn()
    }
  } as any;

  let service: AlertsService;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
