import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HotelContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveHotel(hotelId?: number): Promise<{ id: number; name: string; totalRooms: number }> {
    if (hotelId) {
      const hotel = await this.prisma.hotel.findUnique({ where: { id: hotelId } });
      if (!hotel) {
        throw new NotFoundException(`Hotel ${hotelId} not found`);
      }

      return { id: hotel.id, name: hotel.name, totalRooms: hotel.totalRooms };
    }

    const code = process.env.DEFAULT_HOTEL_CODE ?? 'WGLM';
    const name = process.env.DEFAULT_HOTEL_NAME ?? 'Wyndham Garden Los Mochis Plaza Inn';
    const totalRooms = Number(process.env.DEFAULT_HOTEL_TOTAL_ROOMS ?? 100);

    const hotel = await this.prisma.hotel.upsert({
      where: { code },
      update: { name, totalRooms },
      create: {
        code,
        name,
        totalRooms,
        currency: 'MXN',
        timezone: process.env.TZ ?? 'America/Chihuahua'
      }
    });

    return { id: hotel.id, name: hotel.name, totalRooms: hotel.totalRooms };
  }
}
