import { useEffect, useRef, useState, useCallback } from "react";
import {
  useGetGoldSnapshot,
  useGetGoldOrderBook,
  getGetGoldSnapshotQueryKey,
  getGetGoldOrderBookQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, TrendingUp, TrendingDown, Minus, Wifi, WifiOff, ArrowUp, ArrowDown } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LiveTick {
  bid: number;
  ask: number;
  mid: number;
  ts: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toFixed(2);
}

function colorClass(v: number | null | undefined) {
  if (v == null || v === 0) return "";
  return v > 0 ? "text-emerald-400" : "text-destructive";
}

// ── Live Price Ticker (SSE) ───────────────────────────────────────────────────
export function GoldPriceTicker() {
  const [tick, setTick] = useState<LiveTick | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource("/api/gold/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { type?: string } & LiveTick;
        if (!d.type || d.type === "tick") {
          setPrev((p) => (tick?.mid ?? p));
          setTick({ bid: d.bid, ask: d.ask, mid: d.mid, ts: d.ts });
        }
      } catch { /* malformed */ }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      setTimeout(connect, 3000);
    };

    esRef.current = es;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  const spread = tick ? (tick.ask - tick.bid).toFixed(2) : null;
  const dir = tick && prev ? (tick.mid > prev ? 1 : tick.mid < prev ? -1 : 0) : 0;

  return (
    <div className="flex items-center gap-6 flex-wrap">
      {/* Connection indicator */}
      <div className={`flex items-center gap-1.5 text-xs ${connected ? "text-emerald-400" : "text-muted-foreground"}`}>
        {connected
          ? <><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> مباشر 10Hz</>
          : <><WifiOff className="w-3 h-3" /> جارٍ الاتصال...</>
        }
      </div>

      {/* Mid price */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tick?.mid ?? "none"}
          initial={{ opacity: 0.6, y: dir * -3 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-1.5 font-mono font-bold text-2xl ${
            dir > 0 ? "text-emerald-400" : dir < 0 ? "text-destructive" : "text-primary"
          }`}
        >
          {dir > 0 && <ArrowUp className="w-4 h-4" />}
          {dir < 0 && <ArrowDown className="w-4 h-4" />}
          {tick ? fmtPrice(tick.mid) : "—"}
        </motion.div>
      </AnimatePresence>

      {/* Bid */}
      <div className="text-xs">
        <span className="text-muted-foreground">شراء </span>
        <span className="font-mono text-emerald-400">{tick ? fmtPrice(tick.bid) : "—"}</span>
      </div>

      {/* Ask */}
      <div className="text-xs">
        <span className="text-muted-foreground">بيع </span>
        <span className="font-mono text-destructive">{tick ? fmtPrice(tick.ask) : "—"}</span>
      </div>

      {/* Spread */}
      {spread && (
        <div className="text-xs">
          <span className="text-muted-foreground">السبريد </span>
          <span className="font-mono text-muted-foreground">{spread}</span>
        </div>
      )}
    </div>
  );
}

// ── Order Book Depth ─────────────────────────────────────────────────────────
export function OrderBookCard() {
  const { data: book } = useGetGoldOrderBook({
    query: {
      queryKey: getGetGoldOrderBookQueryKey(),
      refetchInterval: 2000,
    },
  });

  const bids = book?.bids?.slice(0, 12) ?? [];
  const asks = book?.asks?.slice(0, 12) ?? [];

  const maxSize = Math.max(
    ...bids.map((b) => b.size),
    ...asks.map((a) => a.size),
    1,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          عمق السوق — دفتر الأوامر
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {bids.length === 0 && asks.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            جارٍ تحميل بيانات عمق السوق...
          </div>
        ) : (
          <div className="grid grid-cols-2 divide-x divide-x-reverse divide-border">
            {/* Asks (sell orders) — right side */}
            <div className="p-3 space-y-0.5">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                <span>سعر البيع</span>
                <span>الحجم</span>
              </div>
              {asks.map((a, i) => (
                <div key={i} className="relative flex justify-between items-center text-xs py-0.5">
                  <div
                    className="absolute inset-0 bg-destructive/10 rounded-sm"
                    style={{ width: `${(a.size / maxSize) * 100}%` }}
                  />
                  <span className="relative font-mono text-destructive">{fmtPrice(a.price)}</span>
                  <span className="relative font-mono text-muted-foreground">{a.size.toFixed(1)}</span>
                </div>
              ))}
            </div>

            {/* Bids (buy orders) — left side */}
            <div className="p-3 space-y-0.5">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                <span>الحجم</span>
                <span>سعر الشراء</span>
              </div>
              {bids.map((b, i) => (
                <div key={i} className="relative flex justify-between items-center text-xs py-0.5">
                  <div
                    className="absolute inset-0 bg-emerald-500/10 rounded-sm"
                    style={{ width: `${(b.size / maxSize) * 100}%` }}
                  />
                  <span className="relative font-mono text-muted-foreground">{b.size.toFixed(1)}</span>
                  <span className="relative font-mono text-emerald-400">{fmtPrice(b.price)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Gold Summary Card ─────────────────────────────────────────────────────────
export function GoldSummaryCard() {
  const { data } = useGetGoldSnapshot({
    query: {
      queryKey: getGetGoldSnapshotQueryKey(),
      refetchInterval: 5000,
    },
  });

  const summary = data?.summary;
  const flow = data?.orderFlow;

  function flowIcon(f: string) {
    if (f === "buyers" || f === "buy") return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
    if (f === "sellers" || f === "sell") return <TrendingDown className="w-3.5 h-3.5 text-destructive" />;
    return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
  }

  function flowLabel(f: string) {
    if (f === "buyers" || f === "buy") return "مشترون مسيطرون";
    if (f === "sellers" || f === "sell") return "بائعون مسيطرون";
    return "متوازن";
  }

  function deltaColor(d: number) {
    if (d > 0) return "text-emerald-400";
    if (d < 0) return "text-destructive";
    return "text-muted-foreground";
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          ملخص السوق — تدفق الأوامر
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">التدفق السائد</span>
              <div className="flex items-center gap-1.5">
                {flowIcon(summary.dominantFlow)}
                <span className="text-xs font-medium">{flowLabel(summary.dominantFlow)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">حالة السيولة</span>
              <Badge variant="outline" className="text-xs font-mono">
                {summary.liquidityState}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">الدرجة المؤسسية</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(Math.abs(summary.institutionalScore) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-primary">
                  {(summary.institutionalScore * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">الجلسة</span>
              <span className="text-xs font-mono">{summary.session}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-2">جارٍ التحميل...</p>
        )}

        {flow && (
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">دلتا</span>
              <span className={`text-xs font-mono font-bold ${deltaColor(flow.delta)}`}>
                {flow.delta > 0 ? "+" : ""}{flow.delta.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">دلتا تراكمي</span>
              <span className={`text-xs font-mono ${deltaColor(flow.cumulativeDelta)}`}>
                {flow.cumulativeDelta > 0 ? "+" : ""}{flow.cumulativeDelta.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">امتصاص</span>
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(flow.absorption * 100, 100)}%` }} />
                </div>
                <span className="text-xs font-mono">{(flow.absorption * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Tick Tape ─────────────────────────────────────────────────────────────────
export function TickTape() {
  const [ticks, setTicks] = useState<LiveTick[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource("/api/gold/stream");
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { type?: string } & LiveTick;
        if (!d.type || d.type === "tick") {
          setTicks((prev) => [d, ...prev].slice(0, 20));
        }
      } catch { /* skip */ }
    };
    es.onerror = () => { es.close(); setTimeout(connect, 3000); };
    esRef.current = es;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  return (
    <div className="overflow-hidden h-6 flex items-center gap-0 text-xs font-mono opacity-70">
      <AnimatePresence initial={false}>
        {ticks.map((t, i) => (
          <motion.span
            key={t.ts + "-" + i}
            initial={{ x: -40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`mx-3 shrink-0 ${i === 0 ? "text-primary font-bold" : "text-muted-foreground"}`}
          >
            {fmtPrice(t.mid)}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
