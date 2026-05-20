import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { HotelContextService } from '../common/hotel-context.service';
import { CompetitorsService } from './competitors.service';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';

@Controller()
export class CompetitorsController {
  constructor(
    private readonly competitorsService: CompetitorsService,
    private readonly hotelContextService: HotelContextService
  ) {}

  @Post('hotels/:hotelId/competitors')
  async createCompetitor(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Body() body: CreateCompetitorDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, hotelId);
    const item = await this.competitorsService.createForHotel(hotelId, body);
    return {
      item: this.toResponse(item)
    };
  }

  @Get('hotels/:hotelId/competitors')
  async getCompetitorsByHotel(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @CurrentUser() user: AuthenticatedUser
  ) {
    await this.hotelContextService.resolveHotelForUser(user, hotelId);
    const items = await this.competitorsService.listForHotel(hotelId);
    return {
      count: items.length,
      items: items.map((item) => this.toResponse(item))
    };
  }

  @Patch('competitors/:id')
  async updateCompetitor(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCompetitorDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const existing = await this.competitorsService.getById(id);
    await this.hotelContextService.resolveHotelForUser(user, existing.hotelId);
    const item = await this.competitorsService.update(id, body);
    return {
      item: this.toResponse(item)
    };
  }

  @Delete('competitors/:id')
  async deleteCompetitor(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const existing = await this.competitorsService.getById(id);
    await this.hotelContextService.resolveHotelForUser(user, existing.hotelId);
    await this.competitorsService.remove(id);
    return {
      deleted: true,
      id
    };
  }

  private toResponse(item: { id: number; hotelId: number; name: string }) {
    return {
      id: item.id,
      hotelId: item.hotelId,
      name: item.name
    };
  }
}
