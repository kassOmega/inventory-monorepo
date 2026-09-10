// src/agent/entities/agent.entity.ts
// Shared response types for the Autonomous Owner Agent module.

export type AgentModeValue = 'ADVISORY' | 'AUTONOMOUS';
export type ActionStatusValue =
  | 'EXECUTED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'FAILED';

export interface AgentConfig {
  organizationId: number;
  mode: AgentModeValue;
  maxAutoSpend: number;
  updatedAt: string | null;
}

export interface PendingReview {
  id: string;
  actionType: string;
  description: string;
  targetEntity: string | null;
  payload: unknown;
  createdAt: string;
}

export interface AgentBriefing {
  date: string;
  mode: AgentModeValue;
  maxAutoSpend: number;
  actionsToday: { byStatus: Record<string, number>; total: number };
  financial: {
    flaggedDiscrepancies: Array<{
      description: string;
      createdAt: string;
    }>;
    expensesToday: number;
  };
  pendingReviews: PendingReview[];
  recentActions: Array<{
    id: string;
    actionType: string;
    description: string;
    status: string;
    createdAt: string;
  }>;
}
