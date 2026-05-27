import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Prisma, RecommendationSettings, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeRecommendationSettings,
  RecommendationSettingsConfig
} from '../recommendation/recommendation-settings';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateInviteCodeDto } from './dto/create-invite-code.dto';
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

  // ── Invite codes ─────────────────────────────────────────────────────────────

  async createInviteCode(user: AuthenticatedUser, hotelId: number, input: CreateInviteCodeDto) {
    await this.requireRole(user, hotelId, ['OWNER', 'MANAGER']);

    const hotel = await this.getById(hotelId);

    let code: string;
    let attempts = 0;
    do {
      const suffix = randomBytes(3).toString('hex').toUpperCase();
      code = `${hotel.code}-${suffix}`;
      attempts++;
      if (attempts > 20) throw new Error('Failed to generate unique invite code');
    } while (await this.prisma.hotelInviteCode.findUnique({ where: { code } }));

    const inviteCode = await this.prisma.hotelInviteCode.create({
      data: {
        hotelId,
        code,
        role: input.role,
        label: input.label?.trim() || null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        maxUses: input.maxUses ?? null,
        createdByUserId: user.id
      }
    });

    return this.toInviteCodeResponse(inviteCode);
  }

  async listInviteCodes(user: AuthenticatedUser, hotelId: number) {
    await this.requireRole(user, hotelId, ['OWNER', 'MANAGER']);

    const codes = await this.prisma.hotelInviteCode.findMany({
      where: { hotelId, active: true },
      orderBy: { createdAt: 'desc' }
    });

    return codes.map((c) => this.toInviteCodeResponse(c));
  }

  async deactivateInviteCode(user: AuthenticatedUser, hotelId: number, codeId: number) {
    await this.requireRole(user, hotelId, ['OWNER', 'MANAGER']);

    const code = await this.prisma.hotelInviteCode.findFirst({
      where: { id: codeId, hotelId }
    });
    if (!code) {
      throw new NotFoundException('Invite code not found');
    }

    const updated = await this.prisma.hotelInviteCode.update({
      where: { id: codeId },
      data: { active: false }
    });

    return this.toInviteCodeResponse(updated);
  }

  // ── Join with code ────────────────────────────────────────────────────────────

  async joinWithCode(user: AuthenticatedUser, code: string) {
    const inviteCode = await this.prisma.hotelInviteCode.findUnique({
      where: { code: code.trim().toUpperCase() },
      include: { hotel: true }
    });

    if (!inviteCode || !inviteCode.active) {
      throw new NotFoundException('Invalid or inactive invite code');
    }

    if (inviteCode.expiresAt && inviteCode.expiresAt < new Date()) {
      throw new BadRequestException('This invite code has expired');
    }

    if (inviteCode.maxUses !== null && inviteCode.uses >= inviteCode.maxUses) {
      throw new BadRequestException('This invite code has reached its maximum usage limit');
    }

    const existing = await this.prisma.hotelMembership.findUnique({
      where: { userId_hotelId: { userId: user.id, hotelId: inviteCode.hotelId } }
    });
    if (existing) {
      throw new ConflictException('You are already a member of this hotel');
    }

    const membershipCount = await this.prisma.hotelMembership.count({
      where: { userId: user.id }
    });

    const membership = await this.prisma.hotelMembership.create({
      data: {
        userId: user.id,
        hotelId: inviteCode.hotelId,
        role: inviteCode.role,
        isDefault: membershipCount === 0
      }
    });

    await this.prisma.hotelInviteCode.update({
      where: { id: inviteCode.id },
      data: { uses: { increment: 1 } }
    });

    return {
      hotel: {
        id: inviteCode.hotel.id,
        code: inviteCode.hotel.code,
        name: inviteCode.hotel.name,
        totalRooms: inviteCode.hotel.totalRooms,
        currency: inviteCode.hotel.currency,
        timezone: inviteCode.hotel.timezone
      },
      membership: {
        role: membership.role,
        isDefault: membership.isDefault
      }
    };
  }

  // ── Member management ─────────────────────────────────────────────────────────

  async listMembers(user: AuthenticatedUser, hotelId: number) {
    await this.requireRole(user, hotelId, ['OWNER', 'MANAGER']);

    const memberships = await this.prisma.hotelMembership.findMany({
      where: { hotelId },
      include: {
        user: { select: { id: true, email: true, name: true, emailVerified: true } }
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }]
    });

    return memberships.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      emailVerified: m.user.emailVerified,
      role: m.role,
      isDefault: m.isDefault,
      memberSince: m.createdAt.toISOString()
    }));
  }

  async updateMemberRole(
    requester: AuthenticatedUser,
    hotelId: number,
    targetUserId: number,
    role: 'MANAGER' | 'ANALYST' | 'VIEWER'
  ) {
    await this.requireRole(requester, hotelId, ['OWNER']);

    if (requester.id === targetUserId) {
      throw new BadRequestException('Cannot change your own role');
    }

    const membership = await this.prisma.hotelMembership.findUnique({
      where: { userId_hotelId: { userId: targetUserId, hotelId } }
    });
    if (!membership) {
      throw new NotFoundException('Member not found in this hotel');
    }

    if (membership.role === 'OWNER' && requester.role !== UserRole.ADMIN) {
      throw new ForbiddenException("Only system admins can change an owner's role");
    }

    const updated = await this.prisma.hotelMembership.update({
      where: { userId_hotelId: { userId: targetUserId, hotelId } },
      data: { role }
    });

    return { userId: targetUserId, hotelId, role: updated.role };
  }

  async removeMember(requester: AuthenticatedUser, hotelId: number, targetUserId: number) {
    await this.requireRole(requester, hotelId, ['OWNER']);

    if (requester.id === targetUserId && requester.role !== UserRole.ADMIN) {
      throw new BadRequestException('Cannot remove yourself. Transfer ownership first.');
    }

    const membership = await this.prisma.hotelMembership.findUnique({
      where: { userId_hotelId: { userId: targetUserId, hotelId } }
    });
    if (!membership) {
      throw new NotFoundException('Member not found in this hotel');
    }

    if (membership.role === 'OWNER') {
      const ownerCount = await this.prisma.hotelMembership.count({
        where: { hotelId, role: 'OWNER' }
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot remove the last owner of a hotel');
      }
    }

    await this.prisma.hotelMembership.delete({
      where: { userId_hotelId: { userId: targetUserId, hotelId } }
    });

    return { removed: true, userId: targetUserId };
  }

  // ── Recommendation settings ───────────────────────────────────────────────────

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

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async requireRole(
    user: AuthenticatedUser,
    hotelId: number,
    allowedRoles: string[]
  ): Promise<void> {
    if (user.role === UserRole.ADMIN) return;

    const membership = await this.prisma.hotelMembership.findUnique({
      where: { userId_hotelId: { userId: user.id, hotelId } }
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient permissions for this action');
    }
  }

  private toInviteCodeResponse(code: {
    id: number;
    code: string;
    role: string;
    label: string | null;
    active: boolean;
    expiresAt: Date | null;
    uses: number;
    maxUses: number | null;
    createdAt: Date;
  }) {
    return {
      id: code.id,
      code: code.code,
      role: code.role,
      label: code.label,
      active: code.active,
      expiresAt: code.expiresAt?.toISOString() ?? null,
      uses: code.uses,
      maxUses: code.maxUses,
      createdAt: code.createdAt.toISOString()
    };
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
