import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { HotelContextService } from '../common/hotel-context.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateRecommendationSettingsDto } from './dto/update-recommendation-settings.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelsService } from './hotels.service';

@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Post()
  async createHotel(@Body() body: CreateHotelDto, @CurrentUser() user: AuthenticatedUser) {
    const hotel = await this.hotelsService.createForUser(user, body);
    return {
      item: this.toResponse(hotel)
    };
  }

  @Get()
  async getHotels(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.hotelsService.list(user);
    return {
      count: items.length,
      items: items.map((item) => this.toResponse(item))
    };
  }

  @Get(':id')
  async getHotelById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, id);
    const hotel = await this.hotelsService.getById(id);
    return {
      item: this.toResponse(hotel)
    };
  }

  @Patch(':id')
  async updateHotel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateHotelDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, id);
    const hotel = await this.hotelsService.update(id, body);
    return {
      item: this.toResponse(hotel)
    };
  }

  @Get(':id/recommendation-settings')
  async getRecommendationSettings(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, id);
    const result = await this.hotelsService.getRecommendationSettings(id);
    return {
      isDefault: result.isDefault,
      item: result.settings
    };
  }

  @Patch(':id/recommendation-settings')
  async updateRecommendationSettings(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRecommendationSettingsDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, id);
    const settings = await this.hotelsService.updateRecommendationSettings(id, body);
    return {
      item: settings
    };
  }

  private toResponse(hotel: {
    id: number;
    code: string;
    name: string;
    totalRooms: number;
    currency: string;
    timezone: string;
  }) {
    return {
      id: hotel.id,
      code: hotel.code,
      name: hotel.name,
      totalRooms: hotel.totalRooms,
      currency: hotel.currency,
      timezone: hotel.timezone
    };
  }
}
