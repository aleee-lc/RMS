import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { HotelContextService } from '../common/hotel-context.service';
import { parseIsoDate } from '../common/utils/date.util';
import { RateShopSnapshotsQueryDto } from './dto/rate-shop-snapshots-query.dto';
import { RateShopSummaryQueryDto } from './dto/rate-shop-summary-query.dto';
import { RunRateShoppingDto } from './dto/run-rate-shopping.dto';
import { RateShoppingService } from './rate-shopping.service';

@Controller('rate-shopping')
export class RateShoppingController {
  constructor(
    private readonly rateShoppingService: RateShoppingService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Post('run')
  async run(@Body() body: RunRateShoppingDto, @CurrentUser() user: AuthenticatedUser) {
    const checkInDate = parseIsoDate(body.checkInDate);
    const checkOutDate = parseIsoDate(body.checkOutDate);

    if (!checkInDate || !checkOutDate) {
      throw new BadRequestException('Invalid checkInDate/checkOutDate format. Use ISO date.');
    }
    if (checkInDate >= checkOutDate) {
      throw new BadRequestException('checkOutDate must be greater than checkInDate.');
    }

    const hotel = await this.hotelContextService.resolveHotelForUser(user, body.hotelId);

    const result = await this.rateShoppingService.runForHotel({
      hotelId: hotel.id,
      city: body.city.trim(),
      checkInDate,
      checkOutDate,
      adults: body.adults ?? 2,
      includeHotelSelf: body.includeHotelSelf ?? true,
      competitorNames: body.competitorNames
    });

    return {
      hotel,
      ...result
    };
  }

  @Get('snapshots')
  async getSnapshots(
    @Query() query: RateShopSnapshotsQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);

    const startDate = parseIsoDate(query.startDate);
    const endDate = parseIsoDate(query.endDate);
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException('startDate must be before or equal to endDate.');
    }

    const snapshots = await this.rateShoppingService.listSnapshots({
      hotelId: hotel.id,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      competitorName: query.competitorName,
      limit: query.limit
    });

    return {
      hotel,
      count: snapshots.length,
      items: snapshots.map((item) => ({
        id: item.id,
        competitorName: item.competitorName,
        source: item.source,
        checkInDate: item.checkInDate.toISOString().slice(0, 10),
        checkOutDate: item.checkOutDate.toISOString().slice(0, 10),
        adults: item.adults,
        price: Number(item.price),
        currency: item.currency,
        available: item.available,
        scrapedAt: item.scrapedAt.toISOString()
      }))
    };
  }

  @Get('summary')
  async getSummary(
    @Query() query: RateShopSummaryQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const hotel = await this.hotelContextService.resolveHotelForUser(user, query.hotelId);
    const startDate = parseIsoDate(query.startDate);
    const endDate = parseIsoDate(query.endDate);

    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException('startDate must be before or equal to endDate.');
    }

    const summary = await this.rateShoppingService.getSummary({
      hotelId: hotel.id,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      city: query.city?.trim() || null
    });

    return {
      hotel,
      ...summary
    };
  }
}
