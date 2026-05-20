import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
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
  async getRevenueCalendar(@Query() query: BiQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
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
  async getExecutiveSummary(@Query() query: BiQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getExecutiveSummary(hotel, range.startDate, range.endDate);
  }

  @Get('pickup')
  async getPickup(@Query() query: BiQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getPickupIntelligence(hotel, range.startDate, range.endDate);
  }

  @Get('forecast')
  async getForecast(@Query() query: BiQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getForecastIntelligence(hotel, range.startDate, range.endDate);
  }

  @Get('comp-set')
  async getCompSet(@Query() query: BiQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveRange(query);
    return this.biService.getCompSetIntelligence(hotel, range.startDate, range.endDate);
  }

  @Get('export/csv')
  async exportCsv(
    @Query() query: BiQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveExportRange(query);
    const file = await this.biService.exportRevenueCalendarCsv(
      hotel,
      range.startDate,
      range.endDate
    );

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }

  @Get('export/pdf')
  async exportPdf(
    @Query() query: BiQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const range = this.resolveExportRange(query);
    const file = await this.biService.exportRevenueCalendarPdf(
      hotel,
      range.startDate,
      range.endDate
    );

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
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

  private resolveExportRange(query: BiQueryDto): { startDate: Date; endDate: Date } {
    const range = this.resolveRange(query);

    if (range.endDate < range.startDate) {
      throw new BadRequestException(
        'El rango de fechas es invalido: endDate debe ser mayor o igual a startDate.'
      );
    }

    return range;
  }
}
