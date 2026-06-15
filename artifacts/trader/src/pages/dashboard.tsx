import { useGetTraderDashboard, getGetTraderDashboardQueryKey, useGetTraderSweep } from "@workspace/api-client-react";
import { GoldPriceTicker, OrderBookCard, GoldSummaryCard, TickTape } from "@/components/gold-market";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatPercent, formatPrice, formatTimeAbsolute, formatUnits } from "@/lib/format";
import { PnlDisplay, DirectionBadge, StatusBadge } from "@/components/ui-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { AlertCircle, ArrowUpRight, TrendingUp, AlertTriangle, Target, Cpu, Brain, Activity, Eye, ShieldCheck, CheckCircle2, XCircle, RefreshCw, PlayCircle, Plus, Trash2, Zap, Shield, Clock, Droplets, BarChart2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion, type Variants } from "framer-motion";
import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { ease: "easeOut", duration: 0.3 } }
};

const AGENT_ICONS: Record<string, typeof Activity> = {
  platform_analyzer: Target,
  orderflow: Activity,
  trap_engine: ShieldCheck,
  macro: TrendingUp,
  vision: Eye,
  llm_ensemble: Brain,
};

const AGENT_LABELS: Record<string, string> = {
  platform_analyzer: "محلل المنصة",
  orderflow: "تدفق الأوامر",
  trap_engine: "كشف الفخ",
  macro: "العوامل الكلية",
  vision: "رؤية الهيت ماب",
  llm_ensemble: "نماذج LLM (Plan 0)",
};

// ── Bookmap YouTube helpers ────────────────────────────────────────────────
const BOOKMAP_STORAGE_KEY = "bookmap_youtube_urls";

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes("youtube.com")) {
      // live?v=ID or watch?v=ID
      return u.searchParams.get("v");
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split("?")[0] || null;
    }
  } catch {/* invalid URL */}
  return null;
}

function loadBookmapUrls(): string[] {
  try {
    const raw = localStorage.getItem(BOOKMAP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

// ── Sweep Panel ────────────────────────────────────────────────────────────
function SweepPanel() {
  const { data: sweep, isLoading, refetch, isFetching } = useGetTraderSweep(
    {},
    { query: { refetchInterval: 30000, queryKey: ["trader-sweep"] } }
  );

  if (isLoading) {
    return (
      <Card className="border border-border">
        <CardContent className="p-6">
          <Skeleton className="h-6 w-48 mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!sweep) return null;

  const probPct = Math.round(sweep.sweepProbability * 100);
  const isHigh = sweep.sweepProbability > 0.70;
  const isMid  = sweep.sweepProbability > 0.40 && !isHigh;

  const probColor = isHigh ? "text-destructive" : isMid ? "text-yellow-400" : "text-emerald-400";
  const borderColor = !sweep.entryAllowed
    ? "border-destructive/60"
    : sweep.trapZone.active
      ? "border-yellow-500/40"
      : "border-emerald-500/30";

  return (
    <Card className={`border-2 transition-colors duration-500 ${borderColor}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            كاشف فخ السيولة — Liquidity Trap Detector v2
          </div>
          <div className="flex items-center gap-2">
            {!sweep.entryAllowed && (
              <Badge className="bg-destructive text-white text-xs px-2 py-0.5">
                الدخول ممنوع
              </Badge>
            )}
            {sweep.entryAllowed && (
              <Badge className="bg-emerald-600 text-white text-xs px-2 py-0.5">
                الدخول مسموح
              </Badge>
            )}
            {sweep.trapZone.active && (
              <Badge variant="outline" className="text-yellow-400 border-yellow-400/40 text-xs">
                فخ سيولة نشط
              </Badge>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              تحديث
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Block reason */}
        {!sweep.entryAllowed && sweep.blockReason && (
          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{sweep.blockReason}</span>
          </div>
        )}

        {/* Main metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Sweep Probability */}
          <div className={`p-4 rounded-lg border text-center ${isHigh ? "border-destructive/40 bg-destructive/5" : isMid ? "border-yellow-500/30 bg-yellow-500/5" : "border-emerald-500/20 bg-emerald-500/5"}`}>
            <BarChart2 className={`h-4 w-4 mx-auto mb-1 ${probColor}`} />
            <div className={`text-2xl font-bold font-mono ${probColor}`}>{probPct}%</div>
            <div className="text-xs text-muted-foreground mt-1">احتمال سحب السيولة</div>
            <div className="text-[10px] font-mono mt-0.5 opacity-50">{isHigh ? "مرتفع" : isMid ? "متوسط" : "منخفض"}</div>
          </div>

          {/* Expected Sweep Depth */}
          <div className="p-4 rounded-lg border border-border text-center">
            <Droplets className="h-4 w-4 mx-auto mb-1 text-primary" />
            <div className="text-2xl font-bold font-mono text-primary">
              {sweep.expectedSweepDepthLow.toFixed(1)}–{sweep.expectedSweepDepthHigh.toFixed(1)}$
            </div>
            <div className="text-xs text-muted-foreground mt-1">عمق السحب المتوقع</div>
            {sweep.historicalAvgDepth != null && (
              <div className="text-[10px] font-mono mt-0.5 opacity-50">متوسط تاريخي: {sweep.historicalAvgDepth.toFixed(1)}$</div>
            )}
          </div>

          {/* Trap Zone */}
          <div className={`p-4 rounded-lg border text-center ${sweep.trapZone.active ? "border-yellow-500/40 bg-yellow-500/5" : "border-border"}`}>
            <ShieldCheck className={`h-4 w-4 mx-auto mb-1 ${sweep.trapZone.active ? "text-yellow-400" : "text-muted-foreground"}`} />
            <div className={`text-lg font-bold font-mono ${sweep.trapZone.active ? "text-yellow-400" : "text-muted-foreground"}`}>
              {sweep.trapZone.active ? "نشطة" : "هادئة"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">منطقة التصفية</div>
            {sweep.trapZone.active && sweep.trapZone.low != null && sweep.trapZone.high != null && (
              <div className="text-[10px] font-mono mt-0.5 opacity-60 dir-ltr text-left mx-auto w-fit">
                {sweep.trapZone.low.toFixed(2)} – {sweep.trapZone.high.toFixed(2)}
              </div>
            )}
            {sweep.trapZone.nearestLevel && (
              <div className="text-[10px] mt-0.5 opacity-50">{sweep.trapZone.nearestLevel}</div>
            )}
          </div>

          {/* Recommended Entry */}
          <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 text-center">
            <Target className="h-4 w-4 mx-auto mb-1 text-primary" />
            <div className="text-2xl font-bold font-mono text-primary">
              {sweep.recommendedEntry.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">دخول ذكي (بعد السحب)</div>
          </div>
        </div>

        {/* Liquidity Pools */}
        {sweep.allPools.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
              <Droplets className="h-3 w-3" />
              أقرب مناطق السيولة
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {sweep.allPools.slice(0, 4).map((pool, i) => (
                <div key={i} className={`p-2 rounded border text-center text-xs ${pool.side === "below" ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/20 bg-destructive/5"}`}>
                  <div className="font-mono font-bold">{pool.price.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{pool.label}</div>
                  <div className="text-[10px] mt-0.5 opacity-60">
                    {pool.side === "below" ? "↓" : "↑"} {pool.distance.toFixed(2)}$ · قوة {(pool.pullStrength * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data, isLoading, error } = useGetTraderDashboard({
    query: { queryKey: getGetTraderDashboardQueryKey(), refetchInterval: 8000 }
  });

  // ── SSE Streaming Decision State ─────────────────────────────────────────
  type StreamPhase = "idle" | "snapshot" | "analyzing" | "done" | "error";
  type AgentStatus = {
    state: "waiting" | "running" | "done";
    vote?: string;
    confidence?: number;
    elapsedMs?: number;
    entryZone?: unknown | null;
  };

  const [streamPhase, setStreamPhase] = useState<StreamPhase>("idle");
  const [streamMsg, setStreamMsg] = useState("");
  const [agentStatus, setAgentStatus] = useState<Record<string, AgentStatus>>({});
  const [streamSnapshot, setStreamSnapshot] = useState<{ spot: number; direction: string; confidence: number } | null>(null);
  const [decisionData, setDecisionData] = useState<Record<string, unknown> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const AGENT_ORDER = ["platform_analyzer", "orderflow", "trap_engine", "macro", "vision", "llm_ensemble"];

  function runStreamingDecision() {
    // Close any existing stream
    esRef.current?.close();
    setStreamPhase("snapshot");
    setStreamMsg("جارٍ جلب بيانات السوق الحية من المصدر...");
    setAgentStatus({});
    setStreamSnapshot(null);
    setDecisionData(null);

    const es = new EventSource("/api/trader/decision/stream");
    esRef.current = es;

    es.addEventListener("status", (e) => {
      const d = JSON.parse(e.data) as { messageAr?: string };
      setStreamMsg(d.messageAr ?? "");
    });

    es.addEventListener("snapshot", (e) => {
      const d = JSON.parse(e.data) as { spot: number; direction: string; confidence: number };
      setStreamSnapshot(d);
      setStreamPhase("analyzing");
      setStreamMsg("جارٍ تشغيل الوكلاء الستة بالتوازي...");
      // Initialise all agents as waiting
      const init: Record<string, AgentStatus> = {};
      AGENT_ORDER.forEach(id => { init[id] = { state: "waiting" }; });
      setAgentStatus(init);
    });

    es.addEventListener("agent_start", (e) => {
      const d = JSON.parse(e.data) as { agentId: string };
      setAgentStatus(prev => ({ ...prev, [d.agentId]: { ...prev[d.agentId], state: "running" } }));
    });

    es.addEventListener("agent_done", (e) => {
      const d = JSON.parse(e.data) as { agentId: string; vote: string; confidence: number; elapsedMs: number; entryZone: unknown };
      setAgentStatus(prev => ({
        ...prev,
        [d.agentId]: { state: "done", vote: d.vote, confidence: d.confidence, elapsedMs: d.elapsedMs, entryZone: d.entryZone },
      }));
    });

    es.addEventListener("verdict", (e) => {
      const d = JSON.parse(e.data) as Record<string, unknown>;
      setDecisionData(d);
      setStreamPhase("done");
      setStreamMsg("");
      es.close();
    });

    es.addEventListener("error", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { message: string };
        setStreamMsg(d.message);
      } catch { setStreamMsg("حدث خطأ في التحليل"); }
      setStreamPhase("error");
      es.close();
    });

    es.onerror = () => {
      if (streamPhase !== "done") {
        setStreamPhase("error");
        setStreamMsg("انقطع الاتصال بمحرك التحليل");
      }
      es.close();
    };
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  const decisionFetching = streamPhase === "snapshot" || streamPhase === "analyzing";

  // Bookmap YouTube state
  const [bookmapUrls, setBookmapUrls] = useState<string[]>(loadBookmapUrls);
  const [newUrl, setNewUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const newUrlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(BOOKMAP_STORAGE_KEY, JSON.stringify(bookmapUrls));
  }, [bookmapUrls]);

  function addBookmapUrl() {
    const id = extractYouTubeId(newUrl);
    if (!id) { setUrlError("رابط YouTube غير صالح"); return; }
    if (bookmapUrls.includes(newUrl.trim())) { setUrlError("الرابط مضاف بالفعل"); return; }
    setBookmapUrls(prev => [...prev, newUrl.trim()]);
    setNewUrl("");
    setUrlError("");
  }

  function removeBookmapUrl(url: string) {
    setBookmapUrls(prev => prev.filter(u => u !== url));
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-bold mb-2">حدث خطأ في تحميل البيانات</h2>
        <p className="text-muted-foreground">{error?.message || "تعذر الاتصال بالخادم"}</p>
      </div>
    );
  }

  const { account, snapshot, equityCurve, recentSignals, openPositions, lastCycleAt, nextCycleAt, cycleRunning } = data;

  return (
    <motion.div 
      className="space-y-6 pb-12"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* ── Live Gold Market Strip ─────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <Card className="border-primary/30 bg-card/80">
          <CardContent className="py-3 px-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <GoldPriceTicker />
                <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">XAU/USD</span>
              </div>
              <TickTape />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {snapshot?.sourceStatus !== "LIVE" && (
        <motion.div variants={itemVariants} className="bg-destructive/20 border border-destructive text-destructive px-4 py-3 rounded-md flex items-center gap-3">
          <AlertTriangle className="h-5 w-5" />
          <div>
            <p className="font-bold">حالة المصدر غير نشطة (DEGRADED)</p>
            <p className="text-sm opacity-90">بيانات السوق قد تكون غير دقيقة أو متأخرة.</p>
          </div>
        </motion.div>
      )}

      {/* KPI Grid */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4" /> الرصيد
            </p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-3xl font-bold font-mono text-primary">{formatMoney(account.balance)}</h3>
            </div>
            <div className="mt-2 text-sm flex gap-4">
              <div>
                <span className="text-muted-foreground">صافي اليوم: </span>
                <PnlDisplay value={account.dailyPnl} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> حقوق الملكية
            </p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-3xl font-bold font-mono">{formatMoney(account.equity)}</h3>
            </div>
            <div className="mt-2 text-sm flex gap-4">
              <div>
                <span className="text-muted-foreground">تراجع رأس المال: </span>
                <span className="font-mono text-destructive">{formatPercent(account.currentDrawdownPct)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
              <Shield className="h-4 w-4" /> الصفقات
            </p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-3xl font-bold font-mono">{account.openPositions} <span className="text-lg text-muted-foreground font-sans font-normal">مفتوحة</span></h3>
            </div>
            <div className="mt-2 text-sm flex gap-4">
              <div>
                <span className="text-muted-foreground">اليوم: </span>
                <span className="font-mono">{account.tradesToday}</span>
              </div>
              <div>
                <span className="text-muted-foreground">نسبة الفوز: </span>
                <span className="font-mono text-primary">{formatPercent(account.winRate)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
              <Clock className="h-4 w-4" /> الدورة
            </p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-xl font-bold truncate">
                {cycleRunning ? (
                  <span className="text-primary flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-primary animate-pulse" /> قيد التشغيل</span>
                ) : nextCycleAt ? formatTimeAbsolute(nextCycleAt).split(" ")[1] : "—"}
              </h3>
            </div>
            <div className="mt-2 text-sm flex gap-4">
              <div>
                <span className="text-muted-foreground">آخر دورة: </span>
                <span className="font-mono">{lastCycleAt ? formatTimeAbsolute(lastCycleAt).split(" ")[1] : "—"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Order Book + Market Summary ──────────────────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OrderBookCard />
        <GoldSummaryCard />
      </motion.div>

      {/* ── Liquidity Trap Detector v2 ───────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <SweepPanel />
      </motion.div>

      {/* ── Consensus Engine Live Panel ──────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <Card className={`border-2 transition-colors duration-500 ${
          streamPhase === "done" && decisionData
            ? (decisionData.verdict as string) === "ALLOW"
              ? "border-emerald-500/50"
              : "border-destructive/50"
            : streamPhase === "error"
              ? "border-destructive/30"
              : "border-border"
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Cpu className={`h-5 w-5 text-primary ${decisionFetching ? "animate-pulse" : ""}`} />
                محرك الإجماع متعدد الوكلاء — 6 وكلاء + نماذج كمية
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {streamPhase === "done" && decisionData && (
                  <Badge className={(decisionData.verdict as string) === "ALLOW"
                    ? "bg-emerald-600 text-white text-sm px-3 py-1"
                    : "bg-destructive text-white text-sm px-3 py-1"}>
                    {(decisionData.verdict as string) === "ALLOW" ? "مسموح بالتداول" : "محظور"}
                  </Badge>
                )}
                {streamSnapshot && decisionFetching && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {streamSnapshot.spot.toFixed(2)} · {streamSnapshot.direction} · {(streamSnapshot.confidence * 100).toFixed(0)}%
                  </Badge>
                )}
                <Button
                  variant={streamPhase === "idle" ? "default" : "outline"}
                  size="sm"
                  onClick={runStreamingDecision}
                  disabled={decisionFetching}
                  className="h-8 text-xs gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${decisionFetching ? "animate-spin" : ""}`} />
                  {decisionFetching
                    ? streamPhase === "snapshot"
                      ? "جلب البيانات..."
                      : "التحليل جارٍ..."
                    : streamPhase === "done"
                      ? "إعادة التحليل"
                      : "تشغيل تحليل الإجماع"}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* IDLE — call to action */}
            {streamPhase === "idle" && (
              <div className="text-center py-10 text-muted-foreground border border-dashed border-border rounded-lg">
                <Cpu className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">اضغط "تشغيل تحليل الإجماع"</p>
                <p className="text-xs mt-1 opacity-60">6 وكلاء تحليليون + 3 نماذج كمية داخلية يعملون بالتوازي في الوقت الفعلي</p>
                <div className="flex justify-center gap-4 mt-4 text-[10px] opacity-50">
                  <span>فيبوناتشي</span><span>•</span>
                  <span>محاور السعر</span><span>•</span>
                  <span>تدفق الأوامر</span><span>•</span>
                  <span>COT</span><span>•</span>
                  <span>كشف الفخ</span><span>•</span>
                  <span>هيت ماب السيولة</span>
                </div>
              </div>
            )}

            {/* SNAPSHOT — fetching data */}
            {streamPhase === "snapshot" && (
              <div className="text-center py-6">
                <div className="flex items-center justify-center gap-2 text-primary mb-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm font-medium">{streamMsg}</span>
                </div>
                <p className="text-xs text-muted-foreground">جارٍ الاتصال بمصدر البيانات الحي...</p>
              </div>
            )}

            {/* ANALYZING — live agent grid */}
            {(streamPhase === "analyzing" || streamPhase === "done") && (
              <>
                {/* Per-agent live cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  {AGENT_ORDER.map((agentId) => {
                    const Icon = AGENT_ICONS[agentId] ?? Activity;
                    const label = AGENT_LABELS[agentId] ?? agentId;
                    const ag = agentStatus[agentId];
                    const finalDir = decisionData?.direction as string | null | undefined;

                    // After verdict is received, use the full guard data
                    const guardedAgent = streamPhase === "done" && decisionData
                      ? (decisionData.agents as Array<{output:{agentId:string;vote:string;confidence:number};guard:{passed:boolean;adjustedConfidence:number}}>)
                          ?.find(a => a.output.agentId === agentId)
                      : null;

                    const vote = guardedAgent?.output.vote ?? ag?.vote;
                    const conf = guardedAgent ? guardedAgent.guard.adjustedConfidence : ag?.confidence;
                    const passed = guardedAgent ? guardedAgent.guard.passed : ag?.state === "done";
                    const isAgree = vote === finalDir;

                    const voteColor = vote === "BUY" ? "text-emerald-400"
                      : vote === "SELL" ? "text-destructive"
                      : "text-muted-foreground";

                    const borderClass = !ag || ag.state === "waiting"
                      ? "border-border/40 bg-muted/5 opacity-40"
                      : ag.state === "running"
                        ? "border-primary/50 bg-primary/5 animate-pulse"
                        : isAgree && passed
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : !passed
                            ? "border-border/30 bg-muted/10 opacity-50"
                            : "border-border bg-card";

                    return (
                      <div key={agentId} className={`p-3 rounded-lg border text-center transition-all duration-300 ${borderClass}`}>
                        <Icon className={`w-4 h-4 mx-auto mb-1 ${ag?.state === "running" ? "animate-pulse text-primary" : "text-primary"}`} />
                        {ag?.state === "running" ? (
                          <div className="text-[10px] text-primary font-mono animate-pulse mt-1">يُحلّل...</div>
                        ) : ag?.state === "done" || guardedAgent ? (
                          <>
                            <div className={`text-sm font-bold font-mono ${voteColor}`}>{vote ?? "—"}</div>
                            <div className="text-[10px] font-mono opacity-70 mt-0.5">{conf !== undefined ? `${(conf * 100).toFixed(0)}%` : ""}</div>
                            {ag?.elapsedMs && <div className="text-[10px] opacity-40 font-mono">{ag.elapsedMs}ms</div>}
                            {passed && isAgree && <CheckCircle2 className="w-3 h-3 text-emerald-400 mx-auto mt-1" />}
                            {!passed && guardedAgent && <XCircle className="w-3 h-3 text-destructive mx-auto mt-1" />}
                          </>
                        ) : (
                          <div className="text-[10px] text-muted-foreground mt-1 opacity-40">انتظار</div>
                        )}
                        <div className="text-[10px] text-muted-foreground truncate mt-1 leading-tight">{label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Status message during analysis */}
                {streamPhase === "analyzing" && streamMsg && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                    <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                    <span>{streamMsg}</span>
                  </div>
                )}
              </>
            )}

            {/* ERROR */}
            {streamPhase === "error" && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded p-3 font-mono">
                {streamMsg || "حدث خطأ في محرك التحليل"}
              </div>
            )}

            {/* DONE — verdict details */}
            {streamPhase === "done" && decisionData && (() => {
              const d = decisionData as Record<string, unknown> & {
                globalConfidence: number; trapScore: number; dataCompleteness: number;
                deterministicAgreeCount: number; llmAgreeCount: number;
                thresholds?: Record<string, number>;
                blockReason?: string | null;
                entryZone?: { direction: string; entry: number; stopLoss: number; takeProfit: number; slPips: number; tpPips: number; riskReward: number; levelType: string; confidence: number; source: string } | null;
              };
              return (
                <div className="space-y-4 border-t border-border pt-4">
                  {/* Threshold gauges */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "الثقة العالمية", value: d.globalConfidence, threshold: d.thresholds?.minGlobalConfidence ?? 0.6, fmt: (v: number) => `${(v*100).toFixed(0)}%`, inverted: false },
                      { label: "نقاط الفخ", value: d.trapScore, threshold: d.thresholds?.maxTrapScore ?? 0.3, fmt: (v: number) => `${(v*100).toFixed(0)}%`, inverted: true },
                      { label: "اكتمال البيانات", value: d.dataCompleteness, threshold: d.thresholds?.minDataCompleteness ?? 0.7, fmt: (v: number) => `${(v*100).toFixed(0)}%`, inverted: false },
                      { label: "توافق الوكلاء", value: d.deterministicAgreeCount, threshold: d.thresholds?.minDeterministicAgents ?? 3, fmt: (v: number) => `${v}`, inverted: false },
                      { label: "توافق النماذج", value: d.llmAgreeCount, threshold: d.thresholds?.minLlmAgents ?? 2, fmt: (v: number) => `${v}`, inverted: false },
                    ].map((m) => {
                      const passing = m.inverted ? m.value <= m.threshold : m.value >= m.threshold;
                      return (
                        <div key={m.label} className={`p-3 rounded-lg border text-center ${passing ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`}>
                          <div className={`text-xl font-bold font-mono ${passing ? "text-emerald-400" : "text-destructive"}`}>{m.fmt(m.value)}</div>
                          <div className="text-xs text-muted-foreground mt-1">{m.label}</div>
                          <div className="text-[10px] font-mono mt-0.5 opacity-60">{m.inverted ? "<=" : ">="} {m.fmt(m.threshold)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Entry Zone */}
                  {d.entryZone && (() => {
                    const ez = d.entryZone!;
                    const isBuy = ez.direction === "BUY";
                    return (
                      <div className={`rounded-lg border-2 p-4 ${isBuy ? "border-emerald-500/50 bg-emerald-500/5" : "border-destructive/50 bg-destructive/5"}`}>
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Target className={`h-4 w-4 ${isBuy ? "text-emerald-400" : "text-destructive"}`} />
                            <span className="text-sm font-semibold">منطقة الدخول المثلى</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={isBuy ? "bg-emerald-600 text-white" : "bg-destructive text-white"}>
                              {isBuy ? "شراء" : "بيع"}
                            </Badge>
                            <Badge variant="outline" className="font-mono text-xs">{ez.levelType}</Badge>
                            <Badge variant="outline" className="font-mono text-xs text-primary">R:R {ez.riskReward}:1</Badge>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="text-center p-3 rounded-lg bg-background/60 border border-border">
                            <div className="text-[10px] text-muted-foreground mb-1">دخول عند المستوى</div>
                            <div className="text-lg font-bold font-mono">{ez.entry.toFixed(2)}</div>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-background/60 border border-destructive/30">
                            <div className="text-[10px] text-muted-foreground mb-1">وقف الخسارة (${ez.slPips})</div>
                            <div className="text-lg font-bold font-mono text-destructive">{ez.stopLoss.toFixed(2)}</div>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-background/60 border border-emerald-500/30">
                            <div className="text-[10px] text-muted-foreground mb-1">الهدف (${ez.tpPips})</div>
                            <div className="text-lg font-bold font-mono text-emerald-400">{ez.takeProfit.toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-[10px] text-muted-foreground font-mono text-center opacity-70">
                          {ez.source} · ثقة المستوى {(ez.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    );
                  })()}

                  {/* Block reasons */}
                  {d.blockReason && (
                    <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 font-mono leading-relaxed space-y-1">
                      {d.blockReason.split(";").map((r, i) => (
                        <div key={i} className="flex gap-1.5"><span className="opacity-40 shrink-0">—</span><span>{r.trim()}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </motion.div>

      {/* Snapshot & Chart Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle>حقوق الملكية</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-[300px]">
              {equityCurve && equityCurve.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityCurve} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="t" 
                      tickFormatter={(val) => val.split("T")[1]?.substring(0, 5) || val} 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, fontFamily: "var(--app-font-mono)" }}
                      minTickGap={50}
                    />
                    <YAxis 
                      domain={['auto', 'auto']}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12, fontFamily: "var(--app-font-mono)" }}
                      tickFormatter={(val) => `$${val}`}
                    />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "0.5rem" }}
                      labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "0.25rem" }}
                      itemStyle={{ color: "hsl(var(--primary))", fontWeight: "bold", fontFamily: "var(--app-font-mono)" }}
                      formatter={(val: number) => [formatMoney(val), "حقوق الملكية"]}
                      labelFormatter={(label) => formatTimeAbsolute(label as string)}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="equity" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorEquity)" 
                      animationDuration={500}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">لا توجد بيانات كافية للرسم البياني</div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" /> السوق (XAU/USD)
                </CardTitle>
                <div className="text-right">
                  <div className="text-2xl font-bold font-mono tracking-tight">{formatPrice(snapshot?.spot)}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {snapshot ? (
                <>
                  <div className="flex justify-between items-center pb-2 border-b border-border/50">
                    <span className="text-muted-foreground">الاتجاه (النموذج)</span>
                    <DirectionBadge direction={snapshot.signalDirection} />
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-border/50">
                    <span className="text-muted-foreground">الثقة</span>
                    <span className="font-mono">{formatPercent(snapshot.signalConfidence * 100)}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-border/50">
                    <span className="text-muted-foreground">مدى التذبذب (ATR)</span>
                    <span className="font-mono">{formatPrice(snapshot.atrAbs)} <span className="text-muted-foreground text-xs">({formatPercent(snapshot.atrPct)})</span></span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-border/50">
                    <span className="text-muted-foreground">حالة التوقيت</span>
                    <span className="font-medium">{snapshot.timingState || "—"}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-border/50">
                    <span className="text-muted-foreground">ضغط التوقيت</span>
                    <span className="font-mono">{snapshot.timingPressure ? formatPercent(snapshot.timingPressure * 100) : "—"}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-border/50">
                    <span className="text-muted-foreground">أخبار عالية الأثر</span>
                    <span className={`font-mono font-bold ${snapshot.newsHighImpactCount > 0 ? "text-destructive" : ""}`}>{snapshot.newsHighImpactCount}</span>
                  </div>
                  
                  {snapshot.drivers && snapshot.drivers.length > 0 && (
                    <div className="pt-2">
                      <span className="text-sm text-muted-foreground block mb-2">المحركات الأساسية:</span>
                      <div className="flex flex-wrap gap-2">
                        {snapshot.drivers.map((d, i) => (
                          <Badge key={i} variant="secondary" className="text-xs bg-secondary/50 font-normal">{d}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">لا تتوفر بيانات السوق</div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Bookmap YouTube Streams ─────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <Card className="border border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlayCircle className="h-5 w-5 text-primary" />
                بث Bookmap المباشر (YouTube)
              </div>
              <span className="text-xs text-muted-foreground font-normal">
                {bookmapUrls.length === 0 ? "أضف رابط بث Bookmap لمتابعة هيت ماب السيولة" : `${bookmapUrls.length} بث مُضاف`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* URL input row */}
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <Input
                  ref={newUrlRef}
                  value={newUrl}
                  onChange={e => { setNewUrl(e.target.value); setUrlError(""); }}
                  onKeyDown={e => e.key === "Enter" && addBookmapUrl()}
                  placeholder="https://www.youtube.com/watch?v=...  أو  https://youtu.be/..."
                  className={`font-mono text-sm direction-ltr text-left ${urlError ? "border-destructive" : ""}`}
                  dir="ltr"
                />
                {urlError && <p className="text-xs text-destructive mt-1">{urlError}</p>}
              </div>
              <Button onClick={addBookmapUrl} size="sm" className="gap-1 shrink-0">
                <Plus className="w-4 h-4" />
                إضافة
              </Button>
            </div>

            {bookmapUrls.length === 0 && (
              <div className="text-center py-8 border border-dashed border-border rounded-lg">
                <PlayCircle className="h-10 w-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm text-muted-foreground">لا توجد بثوث مُضافة</p>
                <p className="text-xs text-muted-foreground mt-1 opacity-60">الصق رابط بث Bookmap على YouTube في الحقل أعلاه</p>
              </div>
            )}

            {/* Video grid */}
            {bookmapUrls.length > 0 && (
              <div className={`grid gap-4 ${bookmapUrls.length === 1 ? "grid-cols-1" : bookmapUrls.length === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"}`}>
                {bookmapUrls.map((url) => {
                  const videoId = extractYouTubeId(url);
                  return (
                    <div key={url} className="relative group">
                      <div className="aspect-video rounded-lg overflow-hidden bg-black border border-border">
                        {videoId ? (
                          <iframe
                            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&rel=0&modestbranding=1`}
                            className="w-full h-full"
                            allowFullScreen
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            title={`Bookmap Stream ${videoId}`}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">رابط غير صالح</div>
                        )}
                      </div>
                      <div className="mt-1 flex items-center justify-between px-1">
                        <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[80%]" dir="ltr">{videoId}</span>
                        <button
                          onClick={() => removeBookmapUrl(url)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Signals & Positions Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>الإشارات الأخيرة</CardTitle>
              <Link href="/signals" className="text-sm text-primary hover:underline flex items-center gap-1">
                عرض الكل <ArrowUpRight className="h-4 w-4" />
              </Link>
            </CardHeader>
            <CardContent>
              {recentSignals && recentSignals.length > 0 ? (
                <div className="space-y-3">
                  {recentSignals.slice(0, 5).map(signal => (
                    <Link key={signal.id} href={`/signals/${signal.id}`}>
                      <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <DirectionBadge direction={signal.direction} />
                          <div>
                            <div className="font-medium group-hover:text-primary transition-colors">
                              {formatPrice(signal.entry)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 font-mono">
                              {formatTimeAbsolute(signal.createdAt).split(" ")[1]}
                            </div>
                          </div>
                        </div>
                        <div className="text-left flex flex-col items-end">
                          <StatusBadge status={signal.status} />
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="font-mono">{(signal.confidence * 100).toFixed(0)}%</span>
                            <span>ثقة</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 border rounded-lg border-dashed border-border bg-muted/20">
                  <p className="text-muted-foreground">لا توجد إشارات بعد</p>
                  <p className="text-xs text-muted-foreground mt-1">اضغط تشغيل دورة الآن لتوليد إشارة جديدة</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>الصفقات المفتوحة</CardTitle>
              <Link href="/positions" className="text-sm text-primary hover:underline flex items-center gap-1">
                عرض الكل <ArrowUpRight className="h-4 w-4" />
              </Link>
            </CardHeader>
            <CardContent>
              {openPositions && openPositions.length > 0 ? (
                <div className="space-y-3">
                  {openPositions.slice(0, 5).map(pos => (
                    <div key={pos.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                      <div className="flex items-center gap-3">
                        <DirectionBadge direction={pos.side} />
                        <div>
                          <div className="font-medium">
                            <span className="text-muted-foreground text-xs ml-1">@</span>
                            {formatPrice(pos.entry)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 font-mono">
                            حجم: {formatUnits(pos.sizeUnits)}
                          </div>
                        </div>
                      </div>
                      <div className="text-left flex flex-col items-end">
                        <PnlDisplay value={pos.unrealizedPnl} />
                        <div className="text-xs mt-1 font-mono">
                          الحالي: {formatPrice(pos.currentPrice)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 border rounded-lg border-dashed border-border bg-muted/20">
                  <p className="text-muted-foreground">لا توجد صفقات مفتوحة</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
