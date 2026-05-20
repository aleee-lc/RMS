import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecommendationSettings, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
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

  async createForUser(user: AuthenticatedUser, input: CreateHotelDto) {
    const hotel = await this.create(input);
    if (user.role !== UserRole.ADMIN) {
      await this.prisma.hotelMembership.create({
        data: {
          userId: user.id,
          hotelId: hotel.id,
          role: 'OWNER',
          isDefault: false
        }
      });
    }
    return hotel;
  }

  async list(user?: AuthenticatedUser) {
    if (!user || user.role === UserRole.ADMIN) {
      return this.prisma.hotel.findMany({
        orderBy: [{ name: 'asc' }]
      });
    }

    const memberships = await this.prisma.hotelMembership.findMany({
      where: { userId: user.id },
      include: { hotel: true },
      orderBy: [{ isDefault: 'desc' }, { hotel: { name: 'asc' } }]
    });

    return memberships.map((membership) => membership.hotel);
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

    let persisted: RecommendationSettings | null = null;
    try {
      persisted = await this.prisma.recommendationSettings.findUnique({
        where: { hotelId }
      });
    } catch (error) {
      if (!this.isRecommendationSettingsTableMissing(error)) {
        throw error;
      }
    }

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

    const persisted = await this.upsertRecommendationSettings(hotelId, merged);

    return this.toRecommendationSettingsConfig(persisted);
  }

  private async upsertRecommendationSettings(
    hotelId: number,
    merged: RecommendationSettingsConfig
  ): Promise<RecommendationSettings> {
    const writePayload = {
      highOccupancyThreshold: merged.highOccupancyThreshold,
      lowOccupancyThreshold: merged.lowOccupancyThreshold,
      significantDiffPct: merged.significantDiffPct,
      demandWeight: merged.demandWeight,
      marketWeight: merged.marketWeight,
      maxAdjustmentPct: merged.maxAdjustmentPct,
      minActionStepPct: merged.minActionStepPct
    };

    try {
      return await this.prisma.recommendationSettings.upsert({
        where: { hotelId },
        update: writePayload,
        create: {
          hotelId,
          ...writePayload
        }
      });
    } catch (error) {
      if (!this.isRecommendationSettingsTableMissing(error)) {
        throw error;
      }

      await this.ensureRecommendationSettingsStorage();
      return this.prisma.recommendationSettings.upsert({
        where: { hotelId },
        update: writePayload,
        create: {
          hotelId,
          ...writePayload
        }
      });
    }
  }

  private isRecommendationSettingsTableMissing(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2021' || error.code === 'P2022')
    );
  }

  private async ensureRecommendationSettingsStorage(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RecommendationSettings" (
        "id" SERIAL NOT NULL,
        "hotelId" INTEGER NOT NULL,
        "highOccupancyThreshold" DECIMAL(5,2) NOT NULL,
        "lowOccupancyThreshold" DECIMAL(5,2) NOT NULL,
        "significantDiffPct" DECIMAL(6,2) NOT NULL,
        "demandWeight" DECIMAL(6,4) NOT NULL,
        "marketWeight" DECIMAL(6,4) NOT NULL,
        "maxAdjustmentPct" DECIMAL(6,2) NOT NULL,
        "minActionStepPct" DECIMAL(6,2) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "RecommendationSettings_pkey" PRIMARY KEY ("id")
      );
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "RecommendationSettings_hotelId_key"
      ON "RecommendationSettings"("hotelId");
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "RecommendationSettings_hotelId_updatedAt_idx"
      ON "RecommendationSettings"("hotelId", "updatedAt");
    `);

    await this.prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'RecommendationSettings_hotelId_fkey'
        ) THEN
          ALTER TABLE "RecommendationSettings"
          ADD CONSTRAINT "RecommendationSettings_hotelId_fkey"
          FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$;
    `);
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
