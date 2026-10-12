import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Liveness probe for Render / the Docker HEALTHCHECK. Returning 200 here means
   * the Nest server is bound and accepting connections, independent of the DB or
   * any upstream AI service.
   */
  @Get('health')
  getHealth(): { ok: boolean; uptime: number } {
    return { ok: true, uptime: process.uptime() };
  }
}
