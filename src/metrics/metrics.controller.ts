import { Controller, Get, Query } from '@nestjs/common';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';
import { HotelContextService } from '../common/hotel-context.service';
import { parseIsoDate, toUtcDateOnly } from '../common/utils/date.util';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Get()
  async getMetrics(@Query() query: DateRangeQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);

    const endDate = parseIsoDate(query.endDate) ?? toUtcDateOnly(new Date());
    const startDate =
      parseIsoDate(query.startDate) ??
      (() => {
        const start = new Date(endDate);
        start.setUTCDate(endDate.getUTCDate() - 29);
        return start;
      })();

    const metrics = await this.metricsService.getMetrics(hotel.id, startDate, endDate);

    return {
      hotel,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      count: metrics.length,
      items: metrics.map((m) => ({
        date: m.date.toISOString().slice(0, 10),
        occupancy: Number(m.occupancy),
        adr: Number(m.adr),
        revenue: Number(m.revenue),
        booked_rooms: m.bookedRooms
      }))
    };
  }
}
