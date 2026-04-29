import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HotelsService } from './hotels.service';

describe('HotelsService', () => {
  const prisma = {
    hotel: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    }
  } as any;

  let service: HotelsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HotelsService(prisma);
  });

  it('creates a hotel', async () => {
    prisma.hotel.create.mockResolvedValue({
      id: 1,
      code: 'WGLM',
      name: 'Wyndham',
      totalRooms: 100,
      currency: 'MXN',
      timezone: 'America/Chihuahua'
    });

    const result = await service.create({
      code: 'wglm',
      name: 'Wyndham',
      totalRooms: 100
    });

    expect(prisma.hotel.create).toHaveBeenCalled();
    expect(result.code).toBe('WGLM');
  });

  it('maps unique violations to conflict', async () => {
    prisma.hotel.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '5.20.0'
      })
    );

    await expect(
      service.create({
        code: 'WGLM',
        name: 'Duplicate',
        totalRooms: 100
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates a hotel', async () => {
    prisma.hotel.findUnique.mockResolvedValue({
      id: 1,
      code: 'WGLM',
      name: 'Wyndham',
      totalRooms: 100,
      currency: 'MXN',
      timezone: 'America/Chihuahua'
    });
    prisma.hotel.update.mockResolvedValue({
      id: 1,
      code: 'WGLM',
      name: 'Wyndham Updated',
      totalRooms: 110,
      currency: 'MXN',
      timezone: 'America/Chihuahua'
    });

    const result = await service.update(1, {
      name: 'Wyndham Updated',
      totalRooms: 110
    });

    expect(result.totalRooms).toBe(110);
  });

  it('throws not found when updating unknown hotel', async () => {
    prisma.hotel.findUnique.mockResolvedValue(null);

    await expect(service.update(999, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.hotel.update).not.toHaveBeenCalled();
  });
});
