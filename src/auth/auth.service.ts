import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { signJwt, verifyJwt } from './jwt.util';
import { verifyPassword } from './password.util';

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
      throw new Error('JWT_SECRET must be set and contain at least 32 characters');
    }
    return secret;
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
