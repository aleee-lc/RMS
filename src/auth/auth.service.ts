import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { signJwt, verifyJwt } from './jwt.util';
import { hashPassword, verifyPassword } from './password.util';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        memberships: {
          include: { hotel: true },
          orderBy: [{ isDefault: 'desc' }, { hotelId: 'asc' }]
        }
      }
    });

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      accessToken: this.signAccessToken(user.id, user.email),
      user: this.toAuthUser(user),
      hotels: user.memberships.map((membership) => ({
        id: membership.hotel.id,
        code: membership.hotel.code,
        name: membership.hotel.name,
        totalRooms: membership.hotel.totalRooms,
        currency: membership.hotel.currency,
        timezone: membership.hotel.timezone,
        role: membership.role,
        isDefault: membership.isDefault
      }))
    };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          include: { hotel: true },
          orderBy: [{ isDefault: 'desc' }, { hotelId: 'asc' }]
        }
      }
    });

    return {
      user: this.toAuthUser(user),
      hotels: user.memberships.map((membership) => ({
        id: membership.hotel.id,
        code: membership.hotel.code,
        name: membership.hotel.name,
        totalRooms: membership.hotel.totalRooms,
        currency: membership.hotel.currency,
        timezone: membership.hotel.timezone,
        role: membership.role,
        isDefault: membership.isDefault
      }))
    };
  }

  async bootstrapAdmin(input: { token: string; email: string; password: string; name?: string }) {
    const expectedToken = process.env.BOOTSTRAP_TOKEN;
    if (!expectedToken || expectedToken.length < 24 || input.token !== expectedToken) {
      throw new ForbiddenException('Invalid bootstrap token');
    }

    const hotel = await this.ensureDefaultHotel();
    const admin = await this.prisma.user.upsert({
      where: { email: input.email.trim().toLowerCase() },
      update: {
        name: input.name?.trim() || 'RevSight Admin',
        passwordHash: hashPassword(input.password),
        role: 'ADMIN',
        active: true
      },
      create: {
        email: input.email.trim().toLowerCase(),
        name: input.name?.trim() || 'RevSight Admin',
        passwordHash: hashPassword(input.password),
        role: 'ADMIN',
        active: true
      }
    });

    await this.prisma.hotelMembership.upsert({
      where: { userId_hotelId: { userId: admin.id, hotelId: hotel.id } },
      update: { role: 'OWNER', isDefault: true },
      create: {
        userId: admin.id,
        hotelId: hotel.id,
        role: 'OWNER',
        isDefault: true
      }
    });

    return {
      user: this.toAuthUser(admin),
      hotel: {
        id: hotel.id,
        code: hotel.code,
        name: hotel.name,
        totalRooms: hotel.totalRooms
      }
    };
  }

  async authenticateToken(token: string) {
    const payload = verifyJwt(token, this.jwtSecret());
    if (!payload) {
      return null;
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      return null;
    }

    return this.toAuthUser(user);
  }

  private signAccessToken(userId: number, email: string): string {
    const ttl = Number(process.env.JWT_TTL_SECONDS ?? 60 * 60 * 8);
    return signJwt({ sub: userId, email }, this.jwtSecret(), ttl);
  }

  private jwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException(
        'JWT_SECRET must be set and contain at least 32 characters'
      );
    }
    return secret;
  }

  private ensureDefaultHotel() {
    const code = process.env.DEFAULT_HOTEL_CODE ?? 'WGLM';
    const name = process.env.DEFAULT_HOTEL_NAME ?? 'Wyndham Garden Los Mochis Plaza Inn';
    const totalRooms = Number(process.env.DEFAULT_HOTEL_TOTAL_ROOMS ?? 100);

    return this.prisma.hotel.upsert({
      where: { code },
      update: { name, totalRooms },
      create: {
        code,
        name,
        totalRooms,
        currency: 'MXN',
        timezone: process.env.TZ ?? 'America/Chihuahua'
      }
    });
  }

  private toAuthUser(user: { id: number; email: string; name: string; role: 'ADMIN' | 'USER' }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };
  }
}
