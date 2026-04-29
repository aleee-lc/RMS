import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post
} from '@nestjs/common';
import { CompetitorsService } from './competitors.service';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';

@Controller()
export class CompetitorsController {
  constructor(private readonly competitorsService: CompetitorsService) {}

  @Post('hotels/:hotelId/competitors')
  async createCompetitor(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Body() body: CreateCompetitorDto
  ) {
    const item = await this.competitorsService.createForHotel(hotelId, body);
    return {
      item: this.toResponse(item)
    };
  }

  @Get('hotels/:hotelId/competitors')
  async getCompetitorsByHotel(@Param('hotelId', ParseIntPipe) hotelId: number) {
    const items = await this.competitorsService.listForHotel(hotelId);
    return {
      count: items.length,
      items: items.map((item) => this.toResponse(item))
    };
  }

  @Patch('competitors/:id')
  async updateCompetitor(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCompetitorDto
  ) {
    const item = await this.competitorsService.update(id, body);
    return {
      item: this.toResponse(item)
    };
  }

  @Delete('competitors/:id')
  async deleteCompetitor(@Param('id', ParseIntPipe) id: number) {
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
