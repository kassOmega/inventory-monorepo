// src/agent/agent.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { AgentService } from './agent.service';
import { UpdateAgentConfigDto } from './dto/agent.dto';

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  private resolveOrgId(req: RequestWithUser): number {
    const orgId = req.tenantId ?? req.user.organizationId;
    if (orgId == null) {
      throw new BadRequestException('No active organization selected');
    }
    return orgId;
  }

  /** Current agent mode + auto-spend budget for the active organization. */
  @Get('config')
  @Permissions('agent.view', 'agent.manage')
  getConfig(@Req() req: RequestWithUser) {
    return this.agent.getConfig(this.resolveOrgId(req));
  }

  /** Toggle Advisory/Autonomous mode or update the auto-spend budget. */
  @Patch('config')
  @Permissions('agent.manage')
  updateConfig(@Req() req: RequestWithUser, @Body() dto: UpdateAgentConfigDto) {
    return this.agent.updateConfig(this.resolveOrgId(req), dto);
  }

  /** Agent action history, optionally filtered by status. */
  @Get('actions')
  @Permissions('agent.view', 'agent.manage')
  listActions(
    @Req() req: RequestWithUser,
    @Query('status') status?: string,
  ) {
    return this.agent.listActions(this.resolveOrgId(req), status);
  }

  /** Approve a staged high-risk action. */
  @Post('actions/:id/approve')
  @Permissions('agent.manage')
  approve(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.agent.approveAction(this.resolveOrgId(req), id);
  }

  /** Reject a staged high-risk action. */
  @Post('actions/:id/reject')
  @Permissions('agent.manage')
  reject(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.agent.rejectAction(this.resolveOrgId(req), id);
  }

  /** Daily executive briefing for the owner. */
  @Get('briefing')
  @Permissions('agent.view', 'agent.manage')
  briefing(@Req() req: RequestWithUser) {
    return this.agent.getBriefing(this.resolveOrgId(req));
  }

  /** Trigger an agent run now (owner-driven, on demand). */
  @Post('run')
  @Permissions('agent.manage')
  runNow(@Req() req: RequestWithUser) {
    return this.agent.runNow(this.resolveOrgId(req));
  }
}
