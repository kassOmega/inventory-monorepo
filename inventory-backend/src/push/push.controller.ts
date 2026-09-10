import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { PushService } from './push.service';

// Push subscription must work while an account is pending verification.
@Controller('push')
@AllowUnverified()
export class PushController {
  constructor(private readonly svc: PushService) {}

  @Post('subscribe')
  subscribe(
    @Req() req: RequestWithUser,
    @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    return this.svc.subscribe(req.user.sub, body);
  }

  // Diagnostic helper (owner only): confirm browsers have stored subscriptions.
  @Get('subscriptions/count')
  async subscriptionCount(@Req() req: RequestWithUser) {
    if (!req.user?.isSuperuser) {
      throw new ForbiddenException(
        'Only the owner can view push subscription counts',
      );
    }
    return { count: await this.svc.countSubscriptions() };
  }

  // Owner-only: wipe all stored subscriptions (e.g. after rotating VAPID keys,
  // because existing subscriptions are bound to the old key).
  @Post('subscriptions/purge')
  async purgeSubscriptions(@Req() req: RequestWithUser) {
    if (!req.user?.isSuperuser) {
      throw new ForbiddenException(
        'Only the owner can purge push subscriptions',
      );
    }
    return { deleted: await this.svc.purgeSubscriptions() };
  }
}
