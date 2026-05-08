import { Controller, Get, Query } from '@nestjs/common';
import { HotelContextService } from '../common/hotel-context.service';
import { parseIsoDate, toUtcDateOnly } from '../common/utils/date.util';
import { BiService } from './bi.service';
import { BiQueryDto } from './dto/bi-query.dto';

@Controller('bi')
export class BiController {
  constructor(
    private readonly biService: BiService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Get('revenue-calendar')
  async getRevenueCalendar(@Query() query: BiQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const range = this.resolveRange(query);
    const rows = await this.biService.getRevenueCalendar(hotel, range.startDate, range.endDate);

    return {
      hotel,
      date_range: {
        start: range.startDate.toISOString().slice(0, 10),
        end: range.endDate.toISOString().slice(0, 10)
      },
      count: rows.length,
      items: rows
    };
  }

  @Get('executive-summary')
  async getExecutiveSummary(@Query() query: BiQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getExecutiveSummary(hotel, range.startDate, range.endDate);
  }

  @Get('pickup')
  async getPickup(@Query() query: BiQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getPickupIntelligence(hotel, range.startDate, range.endDate);
  }

  @Get('forecast')
  async getForecast(@Query() query: BiQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getForecastIntelligence(hotel, range.startDate, range.endDate);
  }

  @Get('comp-set')
  async getCompSet(@Query() query: BiQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getCompSetIntelligence(hotel, range.startDate, range.endDate);
  }

  private resolveRange(query: BiQueryDto): { startDate: Date; endDate: Date } {
    const today = toUtcDateOnly(new Date());
    const startDate = parseIsoDate(query.startDate) ?? today;
    const endDate =
      parseIsoDate(query.endDate) ??
      (() => {
        const end = new Date(startDate);
        end.setUTCDate(end.getUTCDate() + 89);
        return end;
      })();

    return { startDate, endDate };
  }
}
