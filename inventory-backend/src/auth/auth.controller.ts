import { Body, Controller, Get, Post, Put, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { AUTH_COOKIE_NAME } from '../common/strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

interface RequestWithIp extends RequestWithUser {
  ip?: string;
}

const AUTH_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function authCookieOptions(maxAge = AUTH_COOKIE_MAX_AGE_MS): CookieOptions {
  const raw = process.env.COOKIE_SAME_SITE ?? 'lax';
  const sameSite =
    raw === 'none' || raw === 'strict' || raw === 'lax' ? raw : 'lax';
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production' ||
    sameSite === 'none';
  return { httpOnly: true, secure, sameSite, path: '/', maxAge };
}

// Profile + session endpoints must stay reachable while an account is pending
// verification (the verification page relies on them).
@Controller('auth')
@AllowUnverified()
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: RequestWithIp,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, req.ip);
    res.cookie(AUTH_COOKIE_NAME, result.access_token, authCookieOptions());
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions(0));
    return { message: 'Logged out' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Permissions('users.manage')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('register')
  register(@Req() req: RequestWithUser, @Body() dto: RegisterDto) {
    return this.authService.register(dto, req.user);
  }

  @Get('profile')
  getProfile(@Req() req: RequestWithUser) {
    return this.authService.getProfile(req.user.sub);
  }

  @Get('me')
  getMe(@Req() req: RequestWithUser) {
    return this.authService.getMe(req.user.sub);
  }

  @Put('profile')
  updateProfile(@Req() req: RequestWithUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.sub, dto);
  }

  @Put('profile/password')
  changePassword(@Req() req: RequestWithUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
