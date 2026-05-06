import { useGetTraderDashboard, useGetTraderDecision, getGetTraderDashboardQueryKey, getGetTraderDecisionQueryKey } from "@workspace/api-client-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, RadialBarChart, RadialBar, Cell } from "recharts";
import { formatMoney, formatPercent, formatPrice, formatTimeAbsolute, formatUnits } from "@/lib/format";
import { PnlDisplay, DirectionBadge, StatusBadge } from "@/components/ui-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowUpRight, TrendingUp, Clock, AlertTriangle, Zap, Shield, Target, Cpu, Brain, Activity, Eye, ShieldCheck, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion, type Variants } from "framer-motion";
import { Link } from "wouter";

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

export default function Dashboard() {
  const { data, isLoading, error } = useGetTraderDashboard({
    query: { queryKey: getGetTraderDashboardQueryKey(), refetchInterval: 8000 }
  });

  const {
    data: decisionData,
    isFetching: decisionFetching,
    refetch: refetchDecision,
  } = useGetTraderDecision({
    query: {
      queryKey: getGetTraderDecisionQueryKey(),
      enabled: false,
      staleTime: 0,
    }
  });

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

      {/* ── Consensus Engine Live Panel ──────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <Card className={`border-2 transition-colors ${
          decisionData
            ? decisionData.verdict === "ALLOW"
              ? "border-emerald-500/40"
              : "border-destructive/40"
            : "border-border"
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                محرك الإجماع متعدد الوكلاء (6 وكلاء + Plan 0)
              </div>
              <div className="flex items-center gap-3">
                {decisionData && (
                  <Badge className={decisionData.verdict === "ALLOW"
                    ? "bg-emerald-600 text-white text-xs"
                    : "bg-destructive text-white text-xs"}>
                    {decisionData.verdict === "ALLOW" ? "مسموح" : "محظور"}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchDecision()}
                  disabled={decisionFetching}
                  className="h-8 text-xs gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${decisionFetching ? "animate-spin" : ""}`} />
                  {decisionFetching ? "جارٍ التحليل..." : "تشغيل تحليل الإجماع"}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!decisionData && !decisionFetching && (
              <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
                <Cpu className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">اضغط "تشغيل تحليل الإجماع" لاستطلاع 6 وكلاء + نماذج Plan 0 في الوقت الفعلي</p>
                <p className="text-xs mt-1 opacity-60">يستغرق ~10-15 ثانية (يشمل استدعاء نماذج LLM)</p>
              </div>
            )}
            {decisionFetching && (
              <div className="space-y-3 py-4">
                {["محلل المنصة", "تدفق الأوامر", "كشف الفخ", "العوامل الكلية", "رؤية الهيت ماب", "نماذج LLM (Plan 0)"].map((label) => (
                  <div key={label} className="flex items-center gap-3 p-3 border border-border rounded-lg animate-pulse">
                    <div className="w-4 h-4 rounded-full bg-muted" />
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <div className="mr-auto w-16 h-5 bg-muted rounded" />
                  </div>
                ))}
              </div>
            )}
            {decisionData && !decisionFetching && (
              <div className="space-y-4">
                {/* Threshold row */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    { label: "الثقة العالمية", value: decisionData.globalConfidence, threshold: decisionData.thresholds?.minGlobalConfidence ?? 0.8, fmt: (v: number) => `${(v*100).toFixed(0)}%`, inverted: false },
                    { label: "نقاط الفخ", value: decisionData.trapScore, threshold: decisionData.thresholds?.maxTrapScore ?? 0.2, fmt: (v: number) => `${(v*100).toFixed(0)}%`, inverted: true },
                    { label: "اكتمال البيانات", value: decisionData.dataCompleteness, threshold: decisionData.thresholds?.minDataCompleteness ?? 0.9, fmt: (v: number) => `${(v*100).toFixed(0)}%`, inverted: false },
                    { label: "توافق الوكلاء", value: decisionData.deterministicAgreeCount, threshold: decisionData.thresholds?.minDeterministicAgents ?? 3, fmt: (v: number) => `${v}`, inverted: false },
                    { label: "توافق LLM", value: decisionData.llmAgreeCount, threshold: decisionData.thresholds?.minLlmAgents ?? 2, fmt: (v: number) => `${v}`, inverted: false },
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

                {/* Agent grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  {decisionData.agents?.map((ga: { output: { agentId: string; vote: string; confidence: number }; guard: { passed: boolean; adjustedConfidence: number } }) => {
                    const Icon = AGENT_ICONS[ga.output.agentId] ?? Activity;
                    const label = AGENT_LABELS[ga.output.agentId] ?? ga.output.agentId;
                    const direction = decisionData.direction;
                    const isAgree = ga.output.vote === direction;
                    const voteColor =
                      ga.output.vote === "BUY" ? "text-emerald-400"
                      : ga.output.vote === "SELL" ? "text-destructive"
                      : "text-muted-foreground";
                    return (
                      <div key={ga.output.agentId}
                        className={`p-3 rounded-lg border text-center ${
                          isAgree && ga.guard.passed
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : !ga.guard.passed
                              ? "border-border/50 bg-muted/10 opacity-50"
                              : "border-border bg-card"
                        }`}>
                        <Icon className="w-4 h-4 mx-auto mb-1 text-primary" />
                        <div className={`text-sm font-bold font-mono ${voteColor}`}>{ga.output.vote}</div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">{label}</div>
                        <div className="text-[10px] font-mono mt-0.5 opacity-70">{(ga.guard.adjustedConfidence * 100).toFixed(0)}%</div>
                        {!ga.guard.passed && (
                          <XCircle className="w-3 h-3 text-destructive mx-auto mt-1" />
                        )}
                        {ga.guard.passed && isAgree && (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 mx-auto mt-1" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Entry Zone — always shown when computed */}
                {decisionData.entryZone && (() => {
                  const ez = decisionData.entryZone!;
                  const isBuy = ez.direction === "BUY";
                  return (
                    <div className={`rounded-lg border-2 p-4 ${isBuy ? "border-emerald-500/50 bg-emerald-500/5" : "border-destructive/50 bg-destructive/5"}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Target className={`h-4 w-4 ${isBuy ? "text-emerald-400" : "text-destructive"}`} />
                          <span className="text-sm font-semibold">منطقة الدخول المثلى (SL≤30 نقطة)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={isBuy ? "bg-emerald-600 text-white" : "bg-destructive text-white"}>
                            {isBuy ? "شراء" : "بيع"}
                          </Badge>
                          <Badge variant="outline" className="font-mono text-xs">{ez.levelType}</Badge>
                          <Badge variant="outline" className="font-mono text-xs text-primary">R:R {ez.riskReward}</Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-2 rounded bg-background/50 border border-border">
                          <div className="text-[10px] text-muted-foreground mb-1">دخول</div>
                          <div className="text-base font-bold font-mono text-foreground">{ez.entry.toFixed(2)}</div>
                        </div>
                        <div className="text-center p-2 rounded bg-background/50 border border-destructive/30">
                          <div className="text-[10px] text-muted-foreground mb-1">وقف الخسارة ({ez.slPips} نقطة)</div>
                          <div className="text-base font-bold font-mono text-destructive">{ez.stopLoss.toFixed(2)}</div>
                        </div>
                        <div className="text-center p-2 rounded bg-background/50 border border-emerald-500/30">
                          <div className="text-[10px] text-muted-foreground mb-1">هدف ({ez.tpPips} نقطة)</div>
                          <div className="text-base font-bold font-mono text-emerald-400">{ez.takeProfit.toFixed(2)}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground font-mono text-center">
                        مصدر التحليل: {ez.source} | ثقة المستوى: {(ez.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  );
                })()}

                {decisionData.blockReason && (
                  <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-3 font-mono leading-relaxed">
                    {decisionData.blockReason.split(";").map((r, i) => (
                      <div key={i} className="flex gap-1"><span className="opacity-50">—</span><span>{r.trim()}</span></div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
