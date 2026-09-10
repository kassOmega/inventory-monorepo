// src/agent/agent.service.ts
// Owner-facing agent management: configuration, action history, approval
// decisions and the daily executive briefing.
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActionStatus, AgentMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentRunnerService } from './agent-runner.service';
import { UpdateAgentConfigDto } from './dto/agent.dto';
import {
  AgentBriefing,
  AgentConfig,
  ActionStatusValue,
} from './entities/agent.entity';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: AgentToolsService,
    private readonly runner: AgentRunnerService,
  ) {}

  async getConfig(orgId: number): Promise<AgentConfig> {
    const config = await this.prisma.organizationAgentConfig.findUnique({
      where: { organizationId: orgId },
    });
    if (!config) {
      const created = await this.prisma.organizationAgentConfig.create({
        data: { organizationId: orgId, mode: AgentMode.ADVISORY },
      });
      return this.toConfig(created);
    }
    return this.toConfig(config);
  }

  async updateConfig(
    orgId: number,
    dto: UpdateAgentConfigDto,
  ): Promise<AgentConfig> {
    const config = await this.prisma.organizationAgentConfig.upsert({
      where: { organizationId: orgId },
      update: {
        ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
        ...(dto.maxAutoSpend !== undefined
          ? { maxAutoSpend: dto.maxAutoSpend }
          : {}),
      },
      create: {
        organizationId: orgId,
        mode: dto.mode ?? AgentMode.ADVISORY,
        maxAutoSpend: dto.maxAutoSpend ?? 0,
      },
    });
    this.logger.log(
      `Agent config updated for org ${orgId}: mode=${config.mode}, maxAutoSpend=${config.maxAutoSpend}`,
    );
    return this.toConfig(config);
  }

  async listActions(orgId: number, status?: string) {
    const where: Prisma.AgentActionLogWhereInput = { organizationId: orgId };
    if (status) {
      const valid = Object.values(ActionStatus).includes(
        status as ActionStatus,
      );
      if (!valid) throw new BadRequestException('Invalid action status');
      where.status = status as ActionStatus;
    }
    return this.prisma.agentActionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async approveAction(orgId: number, actionId: string) {
    const action = await this.prisma.agentActionLog.findFirst({
      where: {
        id: actionId,
        organizationId: orgId,
        status: ActionStatus.PENDING_APPROVAL,
      },
    });
    if (!action) throw new NotFoundException('Pending action not found');
    await this.tools.executeApprovedAction(orgId, action.id);
    return { ok: true, id: action.id, status: ActionStatus.EXECUTED };
  }

  async rejectAction(orgId: number, actionId: string) {
    const result = await this.prisma.agentActionLog.updateMany({
      where: {
        id: actionId,
        organizationId: orgId,
        status: ActionStatus.PENDING_APPROVAL,
      },
      data: { status: ActionStatus.REJECTED },
    });
    if (result.count === 0) throw new NotFoundException('Pending action not found');
    return { ok: true, id: actionId, status: ActionStatus.REJECTED };
  }

  async getBriefing(orgId: number): Promise<AgentBriefing> {
    const config = await this.getConfig(orgId);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [actionsToday, flagged, pending, recent, expensesToday] =
      await Promise.all([
        this.prisma.agentActionLog.findMany({
          where: { organizationId: orgId, createdAt: { gte: todayStart } },
          select: { status: true },
        }),
        this.prisma.agentActionLog.findMany({
          where: { organizationId: orgId, actionType: 'FLAG_DISCREPANCY' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { description: true, createdAt: true },
        }),
        this.prisma.agentActionLog.findMany({
          where: { organizationId: orgId, status: ActionStatus.PENDING_APPROVAL },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            actionType: true,
            description: true,
            targetEntity: true,
            payload: true,
            createdAt: true,
          },
        }),
        this.prisma.agentActionLog.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            actionType: true,
            description: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.expense.aggregate({
          where: { tenantId: orgId, expenseDate: { gte: todayStart } },
          _sum: { amount: true },
        }),
      ]);

    const byStatus: Record<string, number> = {};
    for (const a of actionsToday) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    }

    return {
      date: todayStart.toISOString().slice(0, 10),
      mode: config.mode,
      maxAutoSpend: config.maxAutoSpend,
      actionsToday: { byStatus, total: actionsToday.length },
      financial: {
        flaggedDiscrepancies: flagged.map((f) => ({
          description: f.description,
          createdAt: f.createdAt.toISOString(),
        })),
        expensesToday: expensesToday._sum.amount ?? 0,
      },
      pendingReviews: pending.map((p) => ({
        id: p.id,
        actionType: p.actionType,
        description: p.description,
        targetEntity: p.targetEntity,
        payload: p.payload,
        createdAt: p.createdAt.toISOString(),
      })),
      recentActions: recent.map((r) => ({
        id: r.id,
        actionType: r.actionType,
        description: r.description,
        status: r.status as ActionStatusValue,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Trigger an agent run on demand (owner-driven). */
  async runNow(orgId: number) {
    return this.runner.runForOrganization(orgId);
  }

  private toConfig(config: {
    organizationId: number;
    mode: AgentMode;
    maxAutoSpend: number;
    updatedAt: Date;
  }): AgentConfig {
    return {
      organizationId: config.organizationId,
      mode: config.mode as AgentConfig['mode'],
      maxAutoSpend: config.maxAutoSpend,
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}

