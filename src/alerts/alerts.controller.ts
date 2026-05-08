import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Query
} from '@nestjs/common';
import { AlertsQueryDto } from '../common/dto/alerts-query.dto';
import { HotelQueryDto } from '../common/dto/hotel-query.dto';
import { HotelContextService } from '../common/hotel-context.service';
import { parseIsoDate, toUtcDateOnly } from '../common/utils/date.util';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Get()
  async getAlerts(@Query() query: AlertsQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);

    const endDate = parseIsoDate(query.endDate) ?? toUtcDateOnly(new Date());
    const startDate =
      parseIsoDate(query.startDate) ??
      (() => {
        const start = new Date(endDate);
        start.setUTCDate(start.getUTCDate() - 29);
        return start;
      })();

    const resolved = query.resolved ? query.resolved === 'true' : undefined;

    const alerts = await this.alertsService.getAlerts(hotel.id, startDate, endDate, resolved);

    return {
      hotel,
      count: alerts.length,
      items: alerts.map((alert) => ({
        id: alert.id,
        date: alert.date.toISOString().slice(0, 10),
        type: alert.type,
        severity: alert.severity.toLowerCase(),
        title: alert.title,
        message: alert.message,
        resolved: alert.resolved
      }))
    };
  }

  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveAlert(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: HotelQueryDto
  ) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const alert = await this.alertsService.setResolvedState(hotel.id, id, true);
    return {
      hotel,
      item: {
        id: alert.id,
        date: alert.date.toISOString().slice(0, 10),
        type: alert.type,
        severity: alert.severity.toLowerCase(),
        title: alert.title,
        message: alert.message,
        resolved: alert.resolved
      }
    };
  }

  @Patch(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activateAlert(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: HotelQueryDto
  ) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);
    const alert = await this.alertsService.setResolvedState(hotel.id, id, false);
    return {
      hotel,
      item: {
        id: alert.id,
        date: alert.date.toISOString().slice(0, 10),
        type: alert.type,
        severity: alert.severity.toLowerCase(),
        title: alert.title,
        message: alert.message,
        resolved: alert.resolved
      }
    };
  }
}
