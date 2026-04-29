import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';

@Injectable()
export class CompetitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForHotel(hotelId: number, input: CreateCompetitorDto) {
    await this.assertHotelExists(hotelId);
    try {
      return await this.prisma.competitor.create({
        data: {
          hotelId,
          name: input.name.trim()
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Competitor "${input.name}" already exists for hotel ${hotelId}`);
      }
      throw error;
    }
  }

  async listForHotel(hotelId: number) {
    await this.assertHotelExists(hotelId);
    return this.prisma.competitor.findMany({
      where: { hotelId },
      orderBy: [{ name: 'asc' }]
    });
  }

  async update(id: number, input: UpdateCompetitorDto) {
    const competitor = await this.prisma.competitor.findUnique({
      where: { id }
    });
    if (!competitor) {
      throw new NotFoundException(`Competitor ${id} not found`);
    }

    try {
      return await this.prisma.competitor.update({
        where: { id },
        data: {
          name: input.name?.trim()
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Competitor "${input.name}" already exists for this hotel`);
      }
      throw error;
    }
  }

  async remove(id: number) {
    const competitor = await this.prisma.competitor.findUnique({
      where: { id }
    });
    if (!competitor) {
      throw new NotFoundException(`Competitor ${id} not found`);
    }

    await this.prisma.competitor.delete({
      where: { id }
    });
  }

  private async assertHotelExists(hotelId: number): Promise<void> {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { id: true }
    });
    if (!hotel) {
      throw new NotFoundException(`Hotel ${hotelId} not found`);
    }
  }
}
