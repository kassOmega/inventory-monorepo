import { Controller, Get, Param, ParseIntPipe, Patch, Req, Sse } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { NotificationsService } from './notifications.service';

// Notifications must stay reachable while an account is pending verification.
@Controller('notifications')
@AllowUnverified()
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Sse('stream')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  stream(): Observable<{ data: string }> {
    return this.service.getStream();
  }

  @Get()
  findAll(@Req() req: RequestWithUser) {
    return this.service.findAll(req.user);
  }

  @Get('unread-count')
  getUnreadCount(@Req() req: RequestWithUser) {
    return this.service.getUnreadCount(req.user);
  }

  @Patch(':id/read')
  markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithUser,
  ) {
    return this.service.markAsRead(id, req.user);
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: RequestWithUser) {
    return this.service.markAllAsRead(req.user);
  }
}
