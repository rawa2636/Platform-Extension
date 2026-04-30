import { logger } from "../logger";

const GITHUB_API_REPO = "https://api.github.com/repos/zebbern/no-cost-ai";
const GITHUB_API_CONTENTS = `${GITHUB_API_REPO}/contents`;
const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/zebbern/no-cost-ai/main";

export type DiscoveredEndpoint = {
  url: string;
  sourceFile: string;
  provider: string;
  name: string;
  type:
    | "chat"
    | "embedding"
    | "completion"
    | "image"
    | "audio"
    | "unknown";
  notes?: string;
};

const URL_REGEX = /https?:\/\/[^\s)`"'<>]+/g;

const NON_PROVIDER_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
  "avatars.githubusercontent.com",
  "gist.github.com",
  "api.github.com",
  "img.shields.io",
  "shields.io",
  "badge.fury.io",
  "deepwiki.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "facebook.com",
  "wikipedia.org",
  "en.wikipedia.org",
  "medium.com",
  "stackoverflow.com",
  "discord.gg",
  "discord.com",
  "t.me",
  "reddit.com",
  "huggingface.co",
  "docs.python.org",
  "pypi.org",
  "npmjs.com",
  "nodejs.org",
  "developer.mozilla.org",
  "tools.ietf.org",
  "creativecommons.org",
  "opensource.org",
]);

const SKIP_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".css",
];

function inferType(url: string, context: string): DiscoveredEndpoint["type"] {
  const lc = (url + " " + context).toLowerCase();
  if (lc.includes("/embed") || lc.includes("embedding")) return "embedding";
  if (
    lc.includes("/image") ||
    lc.includes("dall-e") ||
    lc.includes("stable-diffusion") ||
    lc.includes("midjourney") ||
    lc.includes("/sdxl")
  )
    return "image";
  if (
    lc.includes("/audio") ||
    lc.includes("/speech") ||
    lc.includes("whisper") ||
    lc.includes("tts") ||
    lc.includes("stt")
  )
    return "audio";
  if (
    lc.includes("/chat") ||
    lc.includes("/messages") ||
    lc.includes("chat/completions") ||
    lc.includes("gpt-") ||
    lc.includes("claude") ||
    lc.includes("llama") ||
    lc.includes("gemini") ||
    lc.includes("mistral") ||
    lc.includes("qwen") ||
    lc.includes("deepseek")
  )
    return "chat";
  if (
    lc.includes("/completion") ||
    lc.includes("/generate") ||
    lc.includes("/v1/text")
  )
    return "completion";
  return "unknown";
}

function deriveProvider(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length >= 2) {
      return parts[parts.length - 2] ?? host;
    }
    return host;
  } catch {
    return "unknown";
  }
}

function deriveName(url: string, context: string): string {
  const provider = deriveProvider(url);
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1] ?? "";
    if (
      last &&
      !["v1", "v2", "api", "openai", "chat", "completions"].includes(last)
    ) {
      return `${provider}/${last}`;
    }
  } catch {
    // ignore
  }
  // Try to find a model name in the surrounding context
  const modelHint = context.match(
    /\b(gpt-[0-9.]+\w*|claude-[\w.]+|llama-?[\w.]+|mistral[\w.-]*|qwen[\w.-]*|gemini[\w.-]*|deepseek[\w.-]*|grok[\w.-]*)\b/i,
  );
  if (modelHint) return `${provider}/${modelHint[0].toLowerCase()}`;
  return provider;
}

function shouldSkipUrl(url: string): boolean {
  let lower: string;
  try {
    const u = new URL(url);
    lower = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (NON_PROVIDER_HOSTS.has(lower)) return true;
    if (SKIP_EXTENSIONS.some((ext) => path.endsWith(ext))) return true;
    if (lower.endsWith(".github.io")) return true;
    if (lower.includes("readme")) return true;
  } catch {
    return true;
  }
  return false;
}

function looksLikeApiEndpoint(url: string, context: string): boolean {
  const lc = (url + " " + context).toLowerCase();
  if (
    lc.includes("/v1/") ||
    lc.includes("/v2/") ||
    lc.includes("/api/") ||
    lc.includes("/chat") ||
    lc.includes("/completion") ||
    lc.includes("/generate") ||
    lc.includes("/embed") ||
    lc.includes("/messages") ||
    lc.includes("/inference") ||
    lc.includes("api.")
  ) {
    return true;
  }
  return false;
}

async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": "model-orchestrator/0.1",
    Accept: "application/vnd.github+json",
  };
  if (process.env["GITHUB_TOKEN"]) {
    headers["Authorization"] = `Bearer ${process.env["GITHUB_TOKEN"]}`;
  }
  return fetch(url, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
}

export async function fetchSourceCommit(): Promise<string | null> {
  try {
    const r = await ghFetch(`${GITHUB_API_REPO}/commits/main`);
    if (!r.ok) return null;
    const data = (await r.json()) as { sha?: string };
    return data.sha ?? null;
  } catch (err) {
    logger.warn({ err }, "failed to fetch source commit");
    return null;
  }
}

type GhContentEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
};

async function listMarkdownAndCodeFiles(): Promise<string[]> {
  const queue: string[] = [""];
  const files: string[] = [];
  const allowedExts = [
    ".md",
    ".markdown",
    ".txt",
    ".py",
    ".js",
    ".ts",
    ".json",
    ".yaml",
    ".yml",
  ];
  let visited = 0;
  const maxDirs = 30;

  while (queue.length > 0 && visited < maxDirs) {
    const dir = queue.shift()!;
    visited += 1;
    const url = dir
      ? `${GITHUB_API_CONTENTS}/${dir}?ref=main`
      : `${GITHUB_API_CONTENTS}?ref=main`;
    try {
      const r = await ghFetch(url);
      if (!r.ok) {
        logger.warn(
          { status: r.status, dir },
          "github contents listing failed",
        );
        continue;
      }
      const entries = (await r.json()) as GhContentEntry[];
      for (const entry of entries) {
        if (entry.type === "dir") {
          queue.push(entry.path);
        } else if (entry.type === "file") {
          const lower = entry.name.toLowerCase();
          if (allowedExts.some((e) => lower.endsWith(e))) {
            files.push(entry.path);
          }
        }
      }
    } catch (err) {
      logger.warn({ err, dir }, "github listing error");
    }
  }

  return files;
}

async function fetchRawFile(path: string): Promise<string> {
  const url = `${GITHUB_RAW_BASE}/${path}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`raw fetch ${url} -> ${r.status}`);
  return r.text();
}

function dedupeKeepFirst(
  items: DiscoveredEndpoint[],
): DiscoveredEndpoint[] {
  const seen = new Set<string>();
  const out: DiscoveredEndpoint[] = [];
  for (const e of items) {
    const key = e.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export async function discoverEndpoints(): Promise<DiscoveredEndpoint[]> {
  const files = await listMarkdownAndCodeFiles();
  logger.info({ count: files.length }, "discovered repo files");

  const results: DiscoveredEndpoint[] = [];

  for (const path of files) {
    try {
      const text = await fetchRawFile(path);
      const matches = text.matchAll(URL_REGEX);
      for (const m of matches) {
        const rawUrl = m[0].replace(/[).,;:'"`>\]]+$/, "");
        if (shouldSkipUrl(rawUrl)) continue;
        const idx = m.index ?? 0;
        const ctxStart = Math.max(0, idx - 120);
        const ctxEnd = Math.min(text.length, idx + 240);
        const context = text.slice(ctxStart, ctxEnd);
        if (!looksLikeApiEndpoint(rawUrl, context)) continue;
        results.push({
          url: rawUrl,
          sourceFile: path,
          provider: deriveProvider(rawUrl),
          name: deriveName(rawUrl, context),
          type: inferType(rawUrl, context),
        });
      }
    } catch (err) {
      logger.warn({ err, path }, "failed to fetch repo file");
    }
  }

  return dedupeKeepFirst(results);
}
