import { NotFoundException } from '@nestjs/common';
import { CompetitorsService } from './competitors.service';

describe('CompetitorsService', () => {
  const prisma = {
    hotel: {
      findUnique: jest.fn()
    },
    competitor: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
  } as any;

  let service: CompetitorsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CompetitorsService(prisma);
  });

  it('creates competitor for an existing hotel', async () => {
    prisma.hotel.findUnique.mockResolvedValue({ id: 1 });
    prisma.competitor.create.mockResolvedValue({
      id: 2,
      hotelId: 1,
      name: 'City Express'
    });

    const result = await service.createForHotel(1, { name: 'City Express' });
    expect(result.name).toBe('City Express');
  });

  it('lists competitors by hotel', async () => {
    prisma.hotel.findUnique.mockResolvedValue({ id: 1 });
    prisma.competitor.findMany.mockResolvedValue([
      { id: 2, hotelId: 1, name: 'A' },
      { id: 3, hotelId: 1, name: 'B' }
    ]);

    const result = await service.listForHotel(1);
    expect(result).toHaveLength(2);
  });

  it('updates competitor name', async () => {
    prisma.competitor.findUnique.mockResolvedValue({ id: 2, hotelId: 1, name: 'Old Name' });
    prisma.competitor.update.mockResolvedValue({ id: 2, hotelId: 1, name: 'New Name' });

    const result = await service.update(2, { name: 'New Name' });
    expect(result.name).toBe('New Name');
  });

  it('deletes competitor', async () => {
    prisma.competitor.findUnique.mockResolvedValue({ id: 2, hotelId: 1, name: 'A' });
    prisma.competitor.delete.mockResolvedValue({ id: 2 });

    await service.remove(2);
    expect(prisma.competitor.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it('throws when hotel is missing', async () => {
    prisma.hotel.findUnique.mockResolvedValue(null);

    await expect(service.createForHotel(999, { name: 'Any' })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
