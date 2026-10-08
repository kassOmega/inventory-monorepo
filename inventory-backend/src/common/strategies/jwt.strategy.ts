import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '@prisma/client';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { buildUserPayload } from '../../common/user-payload.util';
import { PrismaService } from '../../prisma/prisma.service';
import { tr } from '../../i18n/i18n.service';

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
    // Only `sub` is trusted from the token — every other field is reloaded from
    // the database below. The signed token itself is intentionally minimal
    // (see `buildTokenClaims`), so `payload` is a subset of `JwtPayload` here.
    if (payload?.sub == null) {
      throw new UnauthorizedException(tr('errors.unauthorized'));
    }
    const now = Date.now();
    const entry = this.cache.get(payload.sub);
    if (entry && now - entry.timestamp < VALIDATION_TTL_MS) {
      return entry.promise;
    }

    const promise = this.loadUser(payload.sub).catch((err) => {
      // Never cache a rejected lookup: a transient DB error would otherwise
      // pin the failure for the whole TTL and keep every request for this user
      // failing until the cache expires.
      this.cache.delete(payload.sub);
      throw err;
    });
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
    if (!user) throw new UnauthorizedException(tr('errors.unauthorized'));

    if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException(tr('errors.accountInactive'));
    }

    return buildUserPayload(user);
  }
}
