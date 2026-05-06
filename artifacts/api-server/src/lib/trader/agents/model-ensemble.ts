import { and, desc, eq } from "drizzle-orm";
import { db, modelsTable } from "@workspace/db";
import { logger } from "../../logger.js";
import type { NormalizedSnapshot } from "../types.js";
import type { AgentOutput, AgentEvidence } from "./types.js";

const LLM_TIMEOUT_MS = 14_000;
const MAX_MODELS_TO_QUERY = 5;
const EVIDENCE_REQUIRED_KEYS = ["sources", "features_used", "timestamp"] as const;

interface LlmRawResponse {
  vote?: string;
  confidence?: number;
  reason?: string;
  evidence?: Partial<AgentEvidence>;
}

interface LlmModelRow {
  id: string;
  name: string;
  endpoint: string;
}

async function pickTopChatModels(n: number): Promise<LlmModelRow[]> {
  return db
    .select({ id: modelsTable.id, name: modelsTable.name, endpoint: modelsTable.endpoint })
    .from(modelsTable)
    .where(and(eq(modelsTable.status, "ACTIVE"), eq(modelsTable.type, "chat")))
    .orderBy(desc(modelsTable.score))
    .limit(n);
}

function buildEnsemblePrompt(s: NormalizedSnapshot): string {
  const macro = s.macroSummary as Record<string, unknown>;
  const drivers = s.drivers.slice(0, 5).map((d) => `- ${d}`).join("\n");

  return [
    "You are an institutional XAU/USD quantitative analyst voting in a multi-agent trading consensus system.",
    "Analyze the structured market data below and vote on the next position direction.",
    "Your evidence will be validated — do NOT invent data. If uncertain, vote NEUTRAL.",
    "",
    "MARKET SNAPSHOT",
    `  spot: ${s.spot}`,
    `  atr_pct: ${s.atrPct ?? "n/a"}`,
    `  timing_state: ${s.timingState ?? "n/a"}`,
    `  timing_pressure: ${s.timingPressure ?? 0}`,
    "",
    "PLATFORM SIGNAL",
    `  direction: ${s.signalDirection}`,
    `  confidence: ${s.signalConfidence}`,
    `  score: ${s.signalScore}`,
    "",
    "MACRO",
    `  DXY: ${macro.dxy ?? "n/a"}`,
    `  10Y_yield: ${macro.yield_10y ?? "n/a"}`,
    `  VIX: ${macro.vix ?? "n/a"}`,
    "",
    `COT speculator tilt: ${s.cotTilt ?? "n/a"}`,
    `High-impact news count: ${s.newsHighImpactCount}`,
    "",
    "DRIVERS",
    drivers,
    "",
    'Respond with ONLY one JSON object on a single line — no prose, no markdown fences:',
    '{"vote":"BUY|SELL|NEUTRAL","confidence":0.75,"reason":"<= 160 chars","evidence":{"sources":["<data_source_1>","<data_source_2>"],"features_used":["<feature_1>","<feature_2>"],"timestamp":"' + s.fetchedAt + '"}}',
  ].join("\n");
}

async function callModel(
  model: LlmModelRow,
  prompt: string,
): Promise<{ raw: LlmRawResponse | null; latencyMs: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(model.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        messages: [
          {
            role: "system",
            content:
              "You are a deterministic JSON-only assistant. Always respond with exactly one JSON object and nothing else. Include structured evidence in every response.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: ctrl.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { raw: null, latencyMs };

    const data = (await res.json()) as Record<string, unknown>;
    const choices = data.choices as Array<{ message?: { content?: string }; text?: string }> | undefined;
    let content: string | null = null;
    if (Array.isArray(choices) && choices.length > 0) {
      const c = choices[0]!;
      content = c.message?.content ?? c.text ?? null;
    } else if (typeof data.response === "string") {
      content = data.response;
    } else if (typeof data.output === "string") {
      content = data.output;
    }

    if (!content) return { raw: null, latencyMs };

    const match = content.trim().match(/\{[\s\S]*\}/);
    if (!match) return { raw: null, latencyMs };

    const parsed = JSON.parse(match[0]) as LlmRawResponse;
    return { raw: parsed, latencyMs };
  } catch {
    return { raw: null, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

function hasValidEvidence(evidence: Partial<AgentEvidence> | undefined): evidence is AgentEvidence {
  if (!evidence) return false;
  for (const key of EVIDENCE_REQUIRED_KEYS) {
    const val = evidence[key];
    if (!val) return false;
    if (key !== "timestamp" && (!Array.isArray(val) || (val as unknown[]).length === 0)) return false;
  }
  return true;
}

export interface EnsembleMemberVote {
  modelId: string;
  modelName: string;
  vote: AgentOutput["vote"];
  confidence: number;
  reason: string | null;
  evidence: AgentEvidence | null;
  hadEvidence: boolean;
  latencyMs: number;
}

export async function runModelEnsembleAgent(
  snapshot: NormalizedSnapshot,
): Promise<AgentOutput & { memberVotes: EnsembleMemberVote[] }> {
  const t0 = Date.now();

  const models = await pickTopChatModels(MAX_MODELS_TO_QUERY);
  if (models.length === 0) {
    logger.warn("trader.ensemble: no active chat models in Plan 0 registry");
    return {
      agentId: "llm_ensemble",
      agentName: "LLM Ensemble (Plan 0)",
      vote: "ABSTAIN",
      confidence: 0,
      evidence: {
        sources: [],
        features_used: [],
        timestamp: snapshot.fetchedAt,
      },
      reasoning: "No active chat models found in Plan 0 registry. Run a harvest cycle first.",
      signals: { modelCount: 0, validVotes: 0 },
      memberVotes: [],
      latencyMs: Date.now() - t0,
    };
  }

  const prompt = buildEnsemblePrompt(snapshot);

  const memberVotes: EnsembleMemberVote[] = await Promise.all(
    models.map(async (m): Promise<EnsembleMemberVote> => {
      const { raw, latencyMs } = await callModel(m, prompt);

      if (!raw) {
        return { modelId: m.id, modelName: m.name, vote: "ABSTAIN", confidence: 0, reason: null, evidence: null, hadEvidence: false, latencyMs };
      }

      const v = (raw.vote ?? "").toUpperCase();
      const vote: AgentOutput["vote"] =
        v === "BUY" || v === "SELL" || v === "NEUTRAL" ? v : "ABSTAIN";
      const confidence = typeof raw.confidence === "number"
        ? Math.min(Math.max(raw.confidence, 0), 1)
        : 0.5;
      const evidence = hasValidEvidence(raw.evidence) ? raw.evidence : null;

      return {
        modelId: m.id,
        modelName: m.name,
        vote,
        confidence,
        reason: typeof raw.reason === "string" ? raw.reason.slice(0, 200) : null,
        evidence,
        hadEvidence: evidence !== null,
        latencyMs,
      };
    }),
  );

  // Only count members who provided valid evidence
  const validMembers = memberVotes.filter((v) => v.hadEvidence && v.vote !== "ABSTAIN");
  const totalConf = validMembers.reduce((s, v) => s + v.confidence, 0);
  const avgConf = validMembers.length > 0 ? totalConf / validMembers.length : 0;

  // Ensemble vote = majority of valid members
  const buys = validMembers.filter((v) => v.vote === "BUY").length;
  const sells = validMembers.filter((v) => v.vote === "SELL").length;
  const ensembleVote: AgentOutput["vote"] =
    validMembers.length === 0 ? "ABSTAIN"
    : buys > sells ? "BUY"
    : sells > buys ? "SELL"
    : "NEUTRAL";

  logger.info(
    { totalModels: models.length, validMembers: validMembers.length, buys, sells, ensembleVote },
    "trader.ensemble.result",
  );

  // Merged evidence from valid members
  const allSources = [...new Set(validMembers.flatMap((v) => v.evidence?.sources ?? []))];
  const allFeatures = [...new Set(validMembers.flatMap((v) => v.evidence?.features_used ?? []))];

  return {
    agentId: "llm_ensemble",
    agentName: "LLM Ensemble (Plan 0)",
    vote: ensembleVote,
    confidence: Math.round(avgConf * 1000) / 1000,
    evidence: {
      sources: allSources.length > 0 ? allSources : ["plan0_model_registry"],
      features_used: allFeatures.length > 0 ? allFeatures : ["market_snapshot"],
      timestamp: snapshot.fetchedAt,
    },
    reasoning: buildReasoning(memberVotes, validMembers.length, ensembleVote, models.length),
    signals: {
      totalModelsQueried: models.length,
      validMembersWithEvidence: validMembers.length,
      buyVotes: buys,
      sellVotes: sells,
      neutralVotes: validMembers.length - buys - sells,
      abstainVotes: memberVotes.length - validMembers.length,
      avgConfidence: avgConf,
      modelNames: models.map((m) => m.name),
    },
    memberVotes,
    latencyMs: Date.now() - t0,
  };
}

function buildReasoning(
  members: EnsembleMemberVote[],
  validCount: number,
  vote: string,
  totalQueried: number,
): string {
  const parts: string[] = [];
  parts.push(`Queried ${totalQueried} Plan 0 chat models, ${validCount} provided valid evidence`);
  const withEvidence = members.filter((m) => m.hadEvidence);
  if (withEvidence.length > 0) {
    const summary = withEvidence.map((m) => `${m.modelName}→${m.vote}(${m.confidence.toFixed(2)})`).join(", ");
    parts.push(`Valid votes: ${summary}`);
  }
  parts.push(`Ensemble majority vote: ${vote}`);
  return parts.join(". ");
}
