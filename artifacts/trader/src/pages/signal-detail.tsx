import { useGetTraderSignal, useApproveTraderSignal, useRejectTraderSignal, getGetTraderSignalQueryKey } from "@workspace/api-client-react";
import { useRoute, useLocation } from "wouter";
import { formatTimeAbsolute, formatPrice, formatPercent, formatNumber } from "@/lib/format";
import { DirectionBadge, StatusBadge } from "@/components/ui-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowRight, CheckCircle2, XCircle, Clock, ShieldCheck, Brain, Server, DollarSign, Target, Activity, Eye, BarChart2, TrendingUp, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { motion, type Variants } from "framer-motion";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: { opacity: 1, x: 0, transition: { ease: "easeOut", duration: 0.3 } }
};

interface AgentOutput {
  agentId: string;
  agentName: string;
  vote: string;
  confidence: number;
  reasoning: string;
  latencyMs: number;
  evidence?: { sources: string[]; features_used: string[]; timestamp: string };
  signals?: Record<string, unknown>;
}

interface GuardResult {
  agentId: string;
  passed: boolean;
  reasons: string[];
  penaltyScore: number;
  adjustedConfidence: number;
}

interface GuardedAgent {
  output: AgentOutput;
  guard: GuardResult;
}

interface ConsensusData {
  verdict: "ALLOW" | "BLOCK";
  direction: string | null;
  globalConfidence: number;
  trapScore: number;
  dataCompleteness: number;
  deterministicAgreeCount: number;
  llmAgreeCount: number;
  blockReason: string | null;
  computedAt: string;
  thresholds: {
    minDeterministicAgents: number;
    minLlmAgents: number;
    minGlobalConfidence: number;
    maxTrapScore: number;
    minDataCompleteness: number;
  };
  agents: GuardedAgent[];
}

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
  llm_ensemble: "مجموعة النماذج (Plan 0)",
};

function VoteChip({ vote, direction }: { vote: string; direction?: string | null }) {
  const isAgree = direction ? vote === direction : null;
  const cls =
    vote === "BUY" ? "bg-emerald-600/15 text-emerald-400 border-emerald-500/30"
    : vote === "SELL" ? "bg-destructive/15 text-destructive border-destructive/30"
    : vote === "NEUTRAL" ? "bg-muted text-muted-foreground border-border"
    : "bg-muted/40 text-muted-foreground/60 border-border/40";
  return (
    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${cls}`}>
      {vote}
      {isAgree !== null && (
        <span className="mr-1">{isAgree ? " ✓" : " ✗"}</span>
      )}
    </span>
  );
}

function ThresholdBar({
  label,
  value,
  threshold,
  inverted = false,
  formatFn = (v: number) => v.toFixed(3),
}: {
  label: string;
  value: number;
  threshold: number;
  inverted?: boolean;
  formatFn?: (v: number) => string;
}) {
  const passing = inverted ? value <= threshold : value >= threshold;
  const pct = inverted
    ? Math.max(0, Math.min(100, (1 - value / (threshold * 2)) * 100))
    : Math.max(0, Math.min(100, (value / (threshold * 1.5)) * 100));

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono font-bold ${passing ? "text-emerald-400" : "text-destructive"}`}>
          {formatFn(value)} / {inverted ? "<=" : ">="} {formatFn(threshold)}
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${passing ? "bg-emerald-500" : "bg-destructive"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function SignalDetail() {
  const [, params] = useRoute("/signals/:id");
  const [, setLocation] = useLocation();
  const id = params?.id || "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { data: signal, isLoading, error } = useGetTraderSignal(id, {
    query: { enabled: !!id, queryKey: getGetTraderSignalQueryKey(id) }
  });

  const approve = useApproveTraderSignal();
  const reject = useRejectTraderSignal();

  const handleApprove = () => {
    approve.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTraderSignalQueryKey(id) });
        toast({ title: "تمت الموافقة", description: "تم الموافقة على الإشارة بنجاح." });
      },
      onError: (err) => toast({ variant: "destructive", title: "فشل", description: err.message })
    });
  };

  const handleReject = () => {
    reject.mutate({ id, data: { reason: rejectReason } }, {
      onSuccess: () => {
        setRejectOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetTraderSignalQueryKey(id) });
        toast({ title: "تم الرفض", description: "تم رفض الإشارة." });
      },
      onError: (err) => toast({ variant: "destructive", title: "فشل", description: err.message })
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (error || !signal) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-bold mb-2">تعذر تحميل الإشارة</h2>
        <Button onClick={() => setLocation("/signals")} variant="outline" className="mt-4">العودة للإشارات</Button>
      </div>
    );
  }

  // Parse consensus from signal.gates (object format from multi-agent engine)
  const gatesRaw = signal.gates as unknown;
  const consensus: ConsensusData | null =
    gatesRaw && typeof gatesRaw === "object" && !Array.isArray(gatesRaw) && "verdict" in (gatesRaw as object)
      ? (gatesRaw as ConsensusData)
      : null;

  // Parse legacy gate array for older signals
  const gateArray: Array<{ gate: string; passed: boolean; reason: string; value?: number | null; threshold?: number | null }> =
    Array.isArray(gatesRaw) ? (gatesRaw as typeof gateArray) : [];

  const aiVotes = (signal.aiVotes ?? []) as Array<{
    modelId: string;
    modelName: string;
    direction: string;
    rationale: string | null;
    latencyMs: number | null;
    agreed: boolean;
  }>;

  return (
    <motion.div className="space-y-6 pb-12 max-w-5xl mx-auto" variants={containerVariants} initial="hidden" animate="show">

      {/* Back + header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/signals")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold font-mono">#{signal.id.substring(0, 8)}</h1>
        <div className="mr-auto flex gap-2">
          <StatusBadge status={signal.status} />
        </div>
      </div>

      {/* Signal summary card */}
      <motion.div variants={itemVariants}>
        <Card className="border-t-4 border-t-primary shadow-md">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row justify-between gap-8">
              <div className="flex items-start gap-6">
                <div className="mt-1"><DirectionBadge direction={signal.direction} /></div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">المُدخل المستهدف</p>
                  <div className="text-4xl font-bold font-mono">{formatPrice(signal.entry)}</div>
                  <div className="flex gap-4 mt-4 text-sm font-mono bg-muted/30 p-3 rounded-md">
                    <div><span className="text-muted-foreground block text-xs">وقف الخسارة (SL)</span>{formatPrice(signal.stopLoss)}</div>
                    <div><span className="text-muted-foreground block text-xs">جني الأرباح (TP)</span>{formatPrice(signal.takeProfit)}</div>
                    <div><span className="text-muted-foreground block text-xs">نسبة المخاطرة/المكافأة</span>{signal.riskReward?.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm bg-card border border-border p-4 rounded-lg">
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> التاريخ</p>
                  <p className="font-mono font-medium">{formatTimeAbsolute(signal.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1"><Target className="w-3 h-3" /> الثقة العالمية</p>
                  <p className="font-mono font-medium text-primary">{formatPercent(signal.confidence * 100)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> حجم الصفقة</p>
                  <p className="font-mono font-medium">{formatNumber(signal.sizeUnits)} وحدات</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> المخاطرة</p>
                  <p className="font-mono font-medium text-destructive">{formatPrice(signal.riskAmount)}$</p>
                </div>
              </div>
            </div>

            {signal.status === "PENDING" && signal.executionMode === "MANUAL" && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="mt-8 pt-6 border-t border-border flex justify-end gap-4">
                <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive hover:text-white"
                  onClick={() => setRejectOpen(true)}>
                  <XCircle className="w-4 h-4 ml-2" /> رفض
                </Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleApprove} disabled={approve.isPending}>
                  <CheckCircle2 className="w-4 h-4 ml-2" /> موافقة
                </Button>
              </motion.div>
            )}

            {signal.rejectionReason && (
              <div className="mt-6 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
                <p className="font-bold flex items-center gap-2"><XCircle className="w-4 h-4" /> سبب الرفض</p>
                <p className="mt-1 text-sm font-mono">{signal.rejectionReason}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── CONSENSUS PANEL (new multi-agent format) ───────────────────────── */}
      {consensus && (
        <motion.div variants={itemVariants}>
          <Card className={`border-2 ${consensus.verdict === "ALLOW" ? "border-emerald-500/40" : "border-destructive/40"}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-primary" />
                  محرك الإجماع متعدد الوكلاء
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatTimeAbsolute(consensus.computedAt)}
                  </span>
                  <Badge className={consensus.verdict === "ALLOW"
                    ? "bg-emerald-600 hover:bg-emerald-600 text-white text-sm px-3"
                    : "bg-destructive hover:bg-destructive text-white text-sm px-3"}>
                    {consensus.verdict === "ALLOW" ? "مسموح بالتنفيذ" : "محظور"}
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {consensus.blockReason && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-sm text-destructive font-mono">
                  {consensus.blockReason}
                </div>
              )}

              {/* Threshold gauges */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/20 rounded-lg border border-border">
                <ThresholdBar
                  label="الثقة العالمية"
                  value={consensus.globalConfidence}
                  threshold={consensus.thresholds.minGlobalConfidence}
                  formatFn={(v) => `${(v * 100).toFixed(1)}%`}
                />
                <ThresholdBar
                  label="نقاط الفخ (مقلوب)"
                  value={consensus.trapScore}
                  threshold={consensus.thresholds.maxTrapScore}
                  inverted
                  formatFn={(v) => `${(v * 100).toFixed(1)}%`}
                />
                <ThresholdBar
                  label="اكتمال البيانات"
                  value={consensus.dataCompleteness}
                  threshold={consensus.thresholds.minDataCompleteness}
                  formatFn={(v) => `${(v * 100).toFixed(1)}%`}
                />
                <ThresholdBar
                  label="توافق الوكلاء الحتميين"
                  value={consensus.deterministicAgreeCount}
                  threshold={consensus.thresholds.minDeterministicAgents}
                  formatFn={(v) => `${v} وكيل`}
                />
                <ThresholdBar
                  label="توافق نماذج اللغة"
                  value={consensus.llmAgreeCount}
                  threshold={consensus.thresholds.minLlmAgents}
                  formatFn={(v) => `${v} نموذج`}
                />
              </div>

              {/* Agent breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" /> تفاصيل الوكلاء
                </h3>
                <div className="space-y-3">
                  {consensus.agents.map((ga, i) => {
                    const Icon = AGENT_ICONS[ga.output.agentId] ?? Activity;
                    const label = AGENT_LABELS[ga.output.agentId] ?? ga.output.agentId;
                    const isLlm = ga.output.agentId === "llm_ensemble";
                    return (
                      <div key={i}
                        className={`p-4 rounded-lg border transition-colors ${ga.guard.passed && ga.output.vote !== "ABSTAIN"
                          ? ga.output.vote === consensus.direction
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border bg-card"
                          : "border-border/50 bg-muted/20 opacity-60"
                        }`}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-primary" />
                            <span className="font-semibold text-sm">{label}</span>
                            {isLlm && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 border-primary/30 text-primary">
                                Plan 0
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {!ga.guard.passed && (
                              <Badge variant="destructive" className="text-[10px]">حارس: مرفوض</Badge>
                            )}
                            <span className="text-xs text-muted-foreground font-mono">
                              {ga.output.latencyMs}ms
                            </span>
                            <VoteChip vote={ga.output.vote} direction={consensus.direction} />
                          </div>
                        </div>

                        {/* Confidence bar */}
                        <div className="mb-3">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground">الثقة المعدلة</span>
                            <span className="font-mono">
                              {(ga.guard.adjustedConfidence * 100).toFixed(1)}%
                              {ga.guard.penaltyScore > 0 && (
                                <span className="text-destructive mr-1">
                                  (-{(ga.guard.penaltyScore * 100).toFixed(0)}% عقوبة)
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${ga.output.vote === consensus.direction ? "bg-emerald-500" : "bg-primary/50"}`}
                              style={{ width: `${ga.guard.adjustedConfidence * 100}%` }}
                            />
                          </div>
                        </div>

                        {/* Reasoning */}
                        <p className="text-xs text-muted-foreground leading-relaxed bg-background/50 p-2 rounded border border-border/50 font-mono">
                          {ga.output.reasoning.slice(0, 240)}{ga.output.reasoning.length > 240 ? "..." : ""}
                        </p>

                        {/* Guard warnings */}
                        {ga.guard.reasons.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {ga.guard.reasons.map((r, j) => (
                              <p key={j} className="text-[11px] text-destructive flex items-start gap-1">
                                <XCircle className="w-3 h-3 mt-0.5 shrink-0" /> {r}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Evidence */}
                        {ga.output.evidence && (ga.output.evidence.sources.length > 0 || ga.output.evidence.features_used.length > 0) && (
                          <div className="mt-2 pt-2 border-t border-border/30 grid grid-cols-2 gap-2">
                            {ga.output.evidence.sources.length > 0 && (
                              <div>
                                <span className="text-[10px] text-muted-foreground">المصادر: </span>
                                <span className="text-[10px] font-mono">{ga.output.evidence.sources.join(", ")}</span>
                              </div>
                            )}
                            {ga.output.evidence.features_used.length > 0 && (
                              <div>
                                <span className="text-[10px] text-muted-foreground">المؤشرات: </span>
                                <span className="text-[10px] font-mono">{ga.output.evidence.features_used.slice(0, 4).join(", ")}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── LLM Ensemble member votes (from aiVotes) ─────────────────────── */}
      {aiVotes.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="w-5 h-5 text-primary" />
                سجل أصوات النماذج (Plan 0 Models)
                <Badge variant="outline" className="mr-auto">
                  {aiVotes.filter(v => v.agreed).length}/{aiVotes.length} موافقون
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {aiVotes.map((vote, i) => (
                  <div key={i}
                    className={`p-4 border rounded-lg ${vote.agreed
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border bg-card"}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {vote.agreed
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          : <XCircle className="w-4 h-4 text-muted-foreground" />
                        }
                        <span className="font-mono text-sm font-bold">{vote.modelName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {vote.latencyMs !== null && (
                          <span className="text-xs text-muted-foreground font-mono">{vote.latencyMs}ms</span>
                        )}
                        <VoteChip vote={vote.direction} direction={signal.direction} />
                      </div>
                    </div>
                    {vote.rationale && (
                      <p className="text-xs text-muted-foreground mt-2 bg-background p-2 rounded border border-border/50 font-mono leading-relaxed">
                        "{vote.rationale}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Classic gates (legacy or risk gates) ─────────────────────────── */}
      {gateArray.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="w-5 h-5 text-primary" /> بوابات المخاطر
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 relative before:absolute before:inset-0 before:ml-4 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                {gateArray.map((gate, i) => (
                  <div key={i} className="relative flex items-start gap-4">
                    <div className={`mt-1 z-10 rounded-full bg-background p-1 border-2 ${gate.passed ? "border-emerald-500 text-emerald-500" : "border-destructive text-destructive"}`}>
                      {gate.passed ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 bg-card border border-border p-3 rounded-lg shadow-sm">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-sm font-mono">{gate.gate}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{gate.reason}</p>
                      {(gate.value != null || gate.threshold != null) && (
                        <div className="flex gap-4 text-xs font-mono bg-muted/50 p-2 rounded">
                          {gate.value != null && <div><span className="text-muted-foreground mr-1">القيمة:</span>{formatNumber(gate.value, 4)}</div>}
                          {gate.threshold != null && <div><span className="text-muted-foreground mr-1">العتبة:</span>{formatNumber(gate.threshold, 4)}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>رفض الإشارة</DialogTitle></DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">السبب (اختياري)</label>
            <Textarea
              placeholder="اكتب سبب رفض هذه الإشارة..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="resize-none"
            />
          </div>
          <DialogFooter className="flex-row-reverse sm:justify-start">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>إلغاء</Button>
            <Button variant="destructive" onClick={handleReject} disabled={reject.isPending}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
