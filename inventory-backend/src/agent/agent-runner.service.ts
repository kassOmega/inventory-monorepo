// src/agent/agent-runner.service.ts
// Scheduled / on-demand evaluation loop for the Autonomous Owner Agent.
// For every organization in AUTONOMOUS mode it collects business context and
// lets Gemini take safe actions via function calling. All actions are gated by
// the org's maxAutoSpend and written to AgentActionLog.
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActionStatus, AgentMode, BusinessType, Prisma } from '@prisma/client';
import { GeminiService } from '../ai/gemini.service';
import { getVerticalLabels } from '../common/verticals';
import { PrismaService } from '../prisma/prisma.service';
import { AgentToolsService } from './agent-tools.service';

const AGENT_SYSTEM_INSTRUCTION = [
  "You are the Autonomous Operations Agent for this business, acting on the owner's authority in AUTONOMOUS mode.",
  'You monitor inventory, restock requests, cash floats and recent sales.',
  'Rules:',
  '- Use getBusinessContext to inspect the current state before acting.',
  '- approveInventoryRestock: call with a REAL pending request id from the context. The system enforces the maxAutoSpend budget automatically — over-budget restocks are staged for the owner instead of being executed.',
  '- flagFinancialDiscrepancy: only use when the context indicates a real cash variance.',
  '- stageHighRiskAction: use for any proposal that spends money above budget, changes permissions, or is destructive. Never attempt to bypass the budget.',
  '- Never invent request ids or user ids that are not present in the context.',
  '- End with a short plain-text summary of what you did or recommend.',
].join('\n');

const AGENT_TOOLS: Record<string, unknown>[] = [
  {
    name: 'getBusinessContext',
    description: 'Get the current business context: pending restock requests (with ids and estimated costs), low stock count, recent sales, cash floats, and the maxAutoSpend budget.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'approveInventoryRestock',
    description: 'Approve a pending inventory restock request by id. Auto-executes only when the estimated cost is within the maxAutoSpend budget; otherwise it is staged for owner approval.',
    parameters: {
      type: 'OBJECT',
      properties: {
        requestId: { type: 'INTEGER', description: 'The stock request id to approve' },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'flagFinancialDiscrepancy',
    description: 'Log a cash variance found at a cashier station and alert the owner.',
    parameters: {
      type: 'OBJECT',
      properties: {
        cashierUserId: { type: 'INTEGER', description: 'The user id of the cashier' },
        missingAmount: { type: 'NUMBER', description: 'The missing cash amount' },
        notes: { type: 'STRING', description: 'Optional notes' },
      },
      required: ['cashierUserId', 'missingAmount'],
    },
  },
  {
    name: 'stageHighRiskAction',
    description: 'Stage a high-risk action (e.g. a purchase, expense, or permission change) for explicit owner approval. Never executes automatically.',
    parameters: {
      type: 'OBJECT',
      properties: {
        actionType: { type: 'STRING', description: 'The type of high-risk action' },
        details: { type: 'STRING', description: 'Description of the proposed action' },
        requiredApproval: { type: 'STRING', description: 'Who must approve (default OWNER)' },
      },
      required: ['actionType', 'details'],
    },
  },
];

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: AgentToolsService,
    private readonly gemini: GeminiService,
  ) {}

  @Cron('*/30 * * * *')
  async scheduledRun() {
    if (process.env.AI_AGENT_CRON_ENABLED !== 'true') return;
    const orgs = await this.prisma.organizationAgentConfig.findMany({
      where: { mode: AgentMode.AUTONOMOUS },
      select: { organizationId: true },
    });
    this.logger.log(`Autonomous agent sweep: ${orgs.length} org(s) in AUTONOMOUS mode`);
    for (const org of orgs) {
      try {
        await this.runForOrganization(org.organizationId);
      } catch (err) {
        this.logger.warn(`Agent run failed for org ${org.organizationId}: ${(err as Error).message}`);
      }
    }
  }

  async runForOrganization(orgId: number) {
    const config = await this.prisma.organizationAgentConfig.findUnique({
      where: { organizationId: orgId },
    });
    if (!config || config.mode !== AgentMode.AUTONOMOUS) {
      return { skipped: true, reason: 'agent not in AUTONOMOUS mode' };
    }

    const context = await this.tools.getBusinessContext(orgId);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { businessType: true },
    });
    const labels = getVerticalLabels(org?.businessType ?? BusinessType.HOSPITALITY);
    const terminology = Object.entries(labels)
      .map(([key, value]) => `- The business calls a "${key}" a "${value}".`)
      .join('\n');
    const result = await this.gemini.runToolLoop({
      systemInstruction: `${AGENT_SYSTEM_INSTRUCTION}\nBusiness terminology:\n${terminology}`,
      prompt: `Business context (currency ${context.currency ?? 'ETB'}):\n${JSON.stringify(context)}`,
      functionDeclarations: AGENT_TOOLS,
      executeTool: (name, args) => this.executeTool(orgId, name, args),
      maxIterations: 5,
    });

    if (result.finalText.trim()) {
      await this.prisma.agentActionLog.create({
        data: {
          organizationId: orgId,
          actionType: 'AGENT_SUMMARY',
          targetEntity: null,
          description: result.finalText.trim().slice(0, 2000),
          status: ActionStatus.EXECUTED,
          payload: {} as Prisma.InputJsonValue,
        },
      });
    }

    this.logger.log(
      `Agent run for org ${orgId}: ${result.toolCalls.length} tool call(s), summary=${result.finalText.length} chars`,
    );
    return { ran: true, toolCalls: result.toolCalls.length, summary: result.finalText };
  }

  private async executeTool(
    orgId: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'getBusinessContext':
        return this.tools.getBusinessContext(orgId);
      case 'approveInventoryRestock':
        return this.tools.approveInventoryRestock(orgId, Number(args.requestId));
      case 'flagFinancialDiscrepancy':
        return this.tools.flagFinancialDiscrepancy(
          orgId,
          Number(args.cashierUserId),
          Number(args.missingAmount),
          args.notes ? String(args.notes) : undefined,
        );
      case 'stageHighRiskAction':
        return this.tools.stageHighRiskAction(
          orgId,
          String(args.actionType),
          String(args.details),
          args.requiredApproval ? String(args.requiredApproval) : 'OWNER',
        );
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  }
}

