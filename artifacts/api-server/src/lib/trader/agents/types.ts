export type AgentVote = "BUY" | "SELL" | "NEUTRAL" | "ABSTAIN";
export type AgentId =
  | "platform_analyzer"
  | "orderflow"
  | "trap_engine"
  | "macro"
  | "vision"
  | "llm_ensemble";

export interface AgentEvidence {
  sources: string[];
  features_used: string[];
  timestamp: string;
}

export interface AgentOutput {
  agentId: AgentId;
  agentName: string;
  vote: AgentVote;
  confidence: number;
  evidence: AgentEvidence;
  reasoning: string;
  signals: Record<string, unknown>;
  latencyMs: number;
}

export interface GuardResult {
  agentId: AgentId;
  passed: boolean;
  reasons: string[];
  penaltyScore: number;
  adjustedConfidence: number;
}

export interface GuardedAgent {
  output: AgentOutput;
  guard: GuardResult;
}

export interface ConsensusVerdict {
  verdict: "ALLOW" | "BLOCK";
  direction: "BUY" | "SELL" | null;
  globalConfidence: number;
  trapScore: number;
  dataCompleteness: number;
  deterministicAgreeCount: number;
  llmAgreeCount: number;
  agents: GuardedAgent[];
  blockReason: string | null;
  thresholds: {
    minDeterministicAgents: number;
    minLlmAgents: number;
    minGlobalConfidence: number;
    maxTrapScore: number;
    minDataCompleteness: number;
  };
  computedAt: string;
}
