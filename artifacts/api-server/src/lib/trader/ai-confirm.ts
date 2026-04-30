import { and, desc, eq } from "drizzle-orm";
import { db, modelsTable } from "@workspace/db";
import { logger } from "../logger.js";
import type {
  AiVote,
  Direction,
  NormalizedSnapshot,
} from "./types.js";

const AI_TIMEOUT_MS = 12_000;

function buildPrompt(snapshot: NormalizedSnapshot): string {
  const drivers = snapshot.drivers.slice(0, 6).map((d) => `- ${d}`).join("\n");
  const macro = JSON.stringify(snapshot.macroSummary);
  return `You are an institutional gold (XAU/USD) trading committee member.\nYou must vote on the next position direction using ONLY the structured data below.\nDo not invent facts. If data is insufficient, vote NEUTRAL.\n\nMARKET\n- spot: ${snapshot.spot}\n- atr_pct: ${snapshot.atrPct}\n- timing_state: ${snapshot.timingState ?? "n/a"}\n- timing_pressure: ${snapshot.timingPressure ?? 0}\n\nUPSTREAM SIGNAL\n- direction: ${snapshot.signalDirection}\n- confidence: ${snapshot.signalConfidence}\n- score: ${snapshot.signalScore}\n\nMACRO\n${macro}\n\nCOT speculator tilt: ${snapshot.cotTilt ?? "n/a"}\nHigh-impact news count: ${snapshot.newsHighImpactCount}\n\nDRIVERS\n${drivers}\n\nRespond with ONLY a single JSON object on one line, no prose, no markdown fences:\n{"vote":"BUY|SELL|NEUTRAL","reason":"<<= 140 chars"}`;
}

interface RawAi {
  vote?: string;
  reason?: string;
}

function parseVote(text: string): RawAi | null {
  const cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as RawAi;
    if (typeof obj.vote !== "string") return null;
    return obj;
  } catch {
    return null;
  }
}

interface ChatModel {
  id: string;
  name: string;
  endpoint: string;
}

async function pickActiveChatModels(n: number): Promise<ChatModel[]> {
  const rows = await db
    .select({
      id: modelsTable.id,
      name: modelsTable.name,
      endpoint: modelsTable.endpoint,
    })
    .from(modelsTable)
    .where(
      and(eq(modelsTable.status, "ACTIVE"), eq(modelsTable.type, "chat")),
    )
    .orderBy(desc(modelsTable.score))
    .limit(n);
  return rows;
}

async function callChatModel(
  model: ChatModel,
  prompt: string,
): Promise<{ text: string | null; latencyMs: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  const start = Date.now();
  try {
    const body = {
      model: "auto",
      messages: [
        {
          role: "system",
          content:
            "You are a deterministic JSON-only assistant. Respond with one JSON object exactly.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 120,
    };
    const res = await fetch(model.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { text: null, latencyMs };
    const data = (await res.json()) as Record<string, unknown>;
    const choices = data.choices as
      | Array<{ message?: { content?: string }; text?: string }>
      | undefined;
    let content: string | null = null;
    if (Array.isArray(choices) && choices.length > 0) {
      const c = choices[0]!;
      content = c.message?.content ?? c.text ?? null;
    } else if (typeof data.response === "string") {
      content = data.response;
    } else if (typeof data.output === "string") {
      content = data.output;
    }
    return { text: content, latencyMs };
  } catch (err) {
    return { text: null, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

export interface AiConfirmResult {
  votes: AiVote[];
  agreeCount: number;
  votersCount: number;
  passed: boolean;
}

export async function aiConfirm(
  snapshot: NormalizedSnapshot,
  ruleDirection: Direction,
  requiredAgreements: number,
): Promise<AiConfirmResult> {
  const desired = Math.max(requiredAgreements, 1);
  const models = await pickActiveChatModels(Math.max(desired, 2));
  if (models.length === 0) {
    return { votes: [], agreeCount: 0, votersCount: 0, passed: false };
  }

  const prompt = buildPrompt(snapshot);
  const calls = models.map(async (m) => {
    const { text, latencyMs } = await callChatModel(m, prompt);
    let direction: AiVote["direction"] = "ABSTAIN";
    let rationale: string | null = null;
    if (text) {
      const parsed = parseVote(text);
      if (parsed) {
        const v = parsed.vote!.toUpperCase();
        if (v === "BUY" || v === "SELL" || v === "NEUTRAL") direction = v;
        rationale =
          typeof parsed.reason === "string" ? parsed.reason.slice(0, 160) : null;
      }
    }
    const agreed = direction === ruleDirection;
    const vote: AiVote = {
      modelId: m.id,
      modelName: m.name,
      direction,
      rationale,
      latencyMs,
      agreed,
    };
    return vote;
  });

  const votes = await Promise.all(calls);
  const agreeCount = votes.filter((v) => v.agreed).length;
  logger.info(
    {
      ruleDirection,
      voters: votes.length,
      agree: agreeCount,
      required: desired,
    },
    "trader.ai_confirm",
  );
  return {
    votes,
    agreeCount,
    votersCount: votes.length,
    passed: agreeCount >= desired,
  };
}
