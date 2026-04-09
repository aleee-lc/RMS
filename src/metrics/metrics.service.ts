import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dateKey, enumerateDateRange, toUtcDateOnly } from '../common/utils/date.util';
import { round2 } from '../common/utils/number.util';

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async recomputeDailyMetrics(hotelId: number, startDate: Date, endDate: Date): Promise<number> {
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } });

    const reservations = await this.prisma.reservationRaw.findMany({
      where: {
        hotelId,
        arrivalDate: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        }
      },
      orderBy: { arrivalDate: 'asc' }
    });

    const daily = new Map<string, { bookedRooms: number; revenue: number }>();

    for (const reservation of reservations) {
      const status = (reservation.sourceStatus ?? '').toUpperCase();
      if (status.includes('NO SHOW') || status.includes('CANCEL')) {
        continue;
      }

      const key = dateKey(reservation.arrivalDate);
      const current = daily.get(key) ?? { bookedRooms: 0, revenue: 0 };
      const rooms = reservation.noOfRooms || 1;
      const roomRate = Number(reservation.roomRate ?? 0);

      current.bookedRooms += rooms;
      current.revenue += roomRate * rooms;
      daily.set(key, current);
    }

    const days = enumerateDateRange(startDate, endDate);

    await this.prisma.dailyMetrics.deleteMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        }
      }
    });

    if (days.length === 0) {
      return 0;
    }

    await this.prisma.dailyMetrics.createMany({
      data: days.map((date) => {
        const key = dateKey(date);
        const record = daily.get(key) ?? { bookedRooms: 0, revenue: 0 };
        const occupancy = hotel.totalRooms > 0 ? (record.bookedRooms / hotel.totalRooms) * 100 : 0;
        const adr = record.bookedRooms > 0 ? record.revenue / record.bookedRooms : 0;

        return {
          hotelId,
          date,
          bookedRooms: record.bookedRooms,
          occupancy: round2(occupancy),
          adr: round2(adr),
          revenue: round2(record.revenue)
        };
      })
    });

    return days.length;
  }

  async recomputeFromAllReservations(hotelId: number): Promise<number> {
    const bounds = await this.prisma.reservationRaw.aggregate({
      where: { hotelId },
      _min: { arrivalDate: true },
      _max: { arrivalDate: true }
    });

    if (!bounds._min.arrivalDate || !bounds._max.arrivalDate) {
      return 0;
    }

    return this.recomputeDailyMetrics(hotelId, bounds._min.arrivalDate, bounds._max.arrivalDate);
  }

  async getMetrics(hotelId: number, startDate: Date, endDate: Date) {
    return this.prisma.dailyMetrics.findMany({
      where: {
        hotelId,
        date: {
          gte: toUtcDateOnly(startDate),
          lte: toUtcDateOnly(endDate)
        }
      },
      orderBy: { date: 'asc' }
    });
  }
}
