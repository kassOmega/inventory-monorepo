import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '@prisma/client';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { buildUserPayload } from '../../common/user-payload.util';
import { PrismaService } from '../../prisma/prisma.service';

const VALIDATION_TTL_MS = 10_000;

export const AUTH_COOKIE_NAME = 'access_token';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly cache = new Map<
    number,
    { promise: Promise<JwtPayload>; timestamp: number }
  >();

  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // HttpOnly cookie set at login (browser transport).
        (req: any) => req?.cookies?.[AUTH_COOKIE_NAME] ?? null,
        // Bearer header kept for non-browser API clients.
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const now = Date.now();
    const entry = this.cache.get(payload.sub);
    if (entry && now - entry.timestamp < VALIDATION_TTL_MS) {
      return entry.promise;
    }

    const promise = this.loadUser(payload.sub);
    this.cache.set(payload.sub, { promise, timestamp: now });
    return promise;
  }

  private async loadUser(sub: number): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      include: {
        role: {
          include: { permissions: { include: { permission: true } } },
        },
        location: true,
        memberships: {
          include: {
            organization: true,
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException();

    if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('Account is inactive');
    }

    return buildUserPayload(user);
  }
}
