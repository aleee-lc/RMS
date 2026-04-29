import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecommendationSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeRecommendationSettings,
  RecommendationSettingsConfig
} from '../recommendation/recommendation-settings';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateRecommendationSettingsDto } from './dto/update-recommendation-settings.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';

@Injectable()
export class HotelsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateHotelDto) {
    try {
      return await this.prisma.hotel.create({
        data: {
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          totalRooms: input.totalRooms,
          currency: (input.currency ?? 'MXN').trim().toUpperCase(),
          timezone: input.timezone?.trim() ?? 'America/Chihuahua'
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Hotel code "${input.code}" already exists`);
      }
      throw error;
    }
  }

  async list() {
    return this.prisma.hotel.findMany({
      orderBy: [{ name: 'asc' }]
    });
  }

  async getById(id: number) {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id }
    });
    if (!hotel) {
      throw new NotFoundException(`Hotel ${id} not found`);
    }
    return hotel;
  }

  async update(id: number, input: UpdateHotelDto) {
    await this.getById(id);

    try {
      return await this.prisma.hotel.update({
        where: { id },
        data: {
          code: input.code?.trim().toUpperCase(),
          name: input.name?.trim(),
          totalRooms: input.totalRooms,
          currency: input.currency?.trim().toUpperCase(),
          timezone: input.timezone?.trim()
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Hotel code "${input.code}" already exists`);
      }
      throw error;
    }
  }

  async getRecommendationSettings(hotelId: number): Promise<{
    settings: RecommendationSettingsConfig;
    isDefault: boolean;
  }> {
    await this.getById(hotelId);

    const persisted = await this.prisma.recommendationSettings.findUnique({
      where: { hotelId }
    });

    if (!persisted) {
      return {
        settings: normalizeRecommendationSettings(),
        isDefault: true
      };
    }

    return {
      settings: this.toRecommendationSettingsConfig(persisted),
      isDefault: false
    };
  }

  async updateRecommendationSettings(
    hotelId: number,
    input: UpdateRecommendationSettingsDto
  ): Promise<RecommendationSettingsConfig> {
    await this.getById(hotelId);

    const current = await this.getRecommendationSettings(hotelId);
    const merged = normalizeRecommendationSettings({
      ...current.settings,
      ...input
    });

    const persisted = await this.prisma.recommendationSettings.upsert({
      where: { hotelId },
      update: {
        highOccupancyThreshold: merged.highOccupancyThreshold,
        lowOccupancyThreshold: merged.lowOccupancyThreshold,
        significantDiffPct: merged.significantDiffPct,
        demandWeight: merged.demandWeight,
        marketWeight: merged.marketWeight,
        maxAdjustmentPct: merged.maxAdjustmentPct,
        minActionStepPct: merged.minActionStepPct
      },
      create: {
        hotelId,
        highOccupancyThreshold: merged.highOccupancyThreshold,
        lowOccupancyThreshold: merged.lowOccupancyThreshold,
        significantDiffPct: merged.significantDiffPct,
        demandWeight: merged.demandWeight,
        marketWeight: merged.marketWeight,
        maxAdjustmentPct: merged.maxAdjustmentPct,
        minActionStepPct: merged.minActionStepPct
      }
    });

    return this.toRecommendationSettingsConfig(persisted);
  }

  private toRecommendationSettingsConfig(
    settings: RecommendationSettings
  ): RecommendationSettingsConfig {
    return {
      highOccupancyThreshold: Number(settings.highOccupancyThreshold),
      lowOccupancyThreshold: Number(settings.lowOccupancyThreshold),
      significantDiffPct: Number(settings.significantDiffPct),
      demandWeight: Number(settings.demandWeight),
      marketWeight: Number(settings.marketWeight),
      maxAdjustmentPct: Number(settings.maxAdjustmentPct),
      minActionStepPct: Number(settings.minActionStepPct)
    };
  }
}
