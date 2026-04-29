import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { DateRangeQueryDto } from '../common/dto/date-range-query.dto';
import { HotelContextService } from '../common/hotel-context.service';
import { enumerateDateRange, parseIsoDate, toUtcDateOnly } from '../common/utils/date.util';
import { GenerateRecommendationsOptionsDto } from './dto/generate-recommendations-options.dto';
import { RecommendationService } from './recommendation.service';

@Controller('recommendations')
export class RecommendationController {
  constructor(
    private readonly recommendationService: RecommendationService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Get()
  async getRecommendations(@Query() query: DateRangeQueryDto) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);

    const startDate = parseIsoDate(query.startDate) ?? toUtcDateOnly(new Date());
    const endDate =
      parseIsoDate(query.endDate) ??
      (() => {
        const end = new Date(startDate);
        end.setUTCDate(startDate.getUTCDate() + 13);
        return end;
      })();

    const items = await this.recommendationService.getRecommendations(hotel.id, startDate, endDate);

    return {
      hotel,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      horizon_days: enumerateDateRange(startDate, endDate).length,
      count: items.length,
      items: items.map((item) => ({
        date: item.date.toISOString().slice(0, 10),
        action: item.action.toLowerCase(),
        suggested_price: Number(item.suggestedPrice),
        explanation: item.explanation,
        occupancy: Number(item.occupancy ?? 0),
        your_price: Number(item.yourPrice ?? 0),
        market_average: Number(item.marketAverage ?? 0)
      }))
    };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateRecommendations(
    @Query() query: DateRangeQueryDto,
    @Body() options: GenerateRecommendationsOptionsDto = {}
  ) {
    const hotel = await this.hotelContextService.resolveHotel(query.hotelId);

    const startDate = parseIsoDate(query.startDate) ?? toUtcDateOnly(new Date());
    const endDate =
      parseIsoDate(query.endDate) ??
      (() => {
        const end = new Date(startDate);
        end.setUTCDate(startDate.getUTCDate() + 13);
        return end;
      })();

    const items = await this.recommendationService.generateAndPersistRecommendations(
      hotel.id,
      startDate,
      endDate,
      options
    );

    return {
      hotel,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      horizon_days: enumerateDateRange(startDate, endDate).length,
      count: items.length,
      items: items.map((item) => ({
        date: item.date.toISOString().slice(0, 10),
        action: item.action.toLowerCase(),
        suggested_price: Number(item.suggestedPrice),
        explanation: item.explanation,
        occupancy: Number(item.occupancy ?? 0),
        your_price: Number(item.yourPrice ?? 0),
        market_average: Number(item.marketAverage ?? 0)
      }))
    };
  }
}
