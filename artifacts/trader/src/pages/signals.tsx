import { useListTraderSignals, getListTraderSignalsQueryKey } from "@workspace/api-client-react";
import { formatTimeAbsolute, formatTimeRelative, formatPrice, formatPercent } from "@/lib/format";
import { DirectionBadge, StatusBadge } from "@/components/ui-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Search, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion, type Variants } from "framer-motion";
import { Link } from "wouter";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ListTraderSignalsStatus } from "@workspace/api-client-react";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { ease: "easeOut", duration: 0.2 } }
};

export default function Signals() {
  const [statusFilter, setStatusFilter] = useState<ListTraderSignalsStatus>("ALL");
  
  const { data: signals, isLoading, error } = useListTraderSignals(
    { status: statusFilter, limit: 100 },
    { query: { queryKey: getListTraderSignalsQueryKey({ status: statusFilter, limit: 100 }), refetchInterval: 8000 } }
  );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-bold mb-2">حدث خطأ في تحميل الإشارات</h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">الإشارات</h1>
          <p className="text-muted-foreground">سجل الإشارات المقترحة والمُنفذة</p>
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
              <SelectTrigger>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <SelectValue placeholder="تصفية حسب الحالة" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">الكل</SelectItem>
                <SelectItem value="PENDING">قيد الانتظار</SelectItem>
                <SelectItem value="APPROVED">موافق عليها</SelectItem>
                <SelectItem value="REJECTED">مرفوضة</SelectItem>
                <SelectItem value="EXECUTED">مُنفَّذة</SelectItem>
                <SelectItem value="EXPIRED">منتهية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y divide-border">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4"><Skeleton className="h-8 w-16" /><Skeleton className="h-4 w-32" /></div>
                  <Skeleton className="h-6 w-24" />
                </div>
              ))}
            </div>
          ) : signals && signals.length > 0 ? (
            <motion.div 
              className="divide-y divide-border"
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              {signals.map(signal => (
                <motion.div key={signal.id} variants={itemVariants}>
                  <Link href={`/signals/${signal.id}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer group gap-4">
                      
                      <div className="flex items-center gap-4 min-w-[200px]">
                        <DirectionBadge direction={signal.direction} />
                        <div>
                          <div className="font-bold text-lg group-hover:text-primary transition-colors font-mono">
                            {formatPrice(signal.entry)}
                          </div>
                          <div className="text-xs text-muted-foreground flex gap-2">
                            <span>{formatTimeAbsolute(signal.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col gap-1 sm:items-center">
                        <div className="flex items-center gap-2 text-sm w-full max-w-[200px]">
                          <span className="text-muted-foreground w-12">الثقة:</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${signal.confidence > 0.8 ? "bg-primary" : signal.confidence > 0.5 ? "bg-amber-500" : "bg-destructive"}`}
                              style={{ width: `${signal.confidence * 100}%` }}
                            />
                          </div>
                          <span className="font-mono w-10 text-left">{formatPercent(signal.confidence * 100)}</span>
                        </div>
                        <div className="text-sm flex gap-4 text-muted-foreground font-mono mt-1 sm:mt-0">
                          <span>R:R {signal.riskReward?.toFixed(1) || "—"}</span>
                          <span>SL {formatPrice(signal.stopLoss)}</span>
                          <span>TP {formatPrice(signal.takeProfit)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 min-w-[150px]">
                        <div className="flex gap-1">
                          <Badge variant="outline" className="text-[10px] uppercase opacity-70 font-mono">{signal.tradingMode}</Badge>
                          <Badge variant="outline" className="text-[10px] uppercase opacity-70 font-mono">{signal.executionMode}</Badge>
                        </div>
                        <StatusBadge status={signal.status} />
                      </div>

                    </div>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-2">لا توجد إشارات تطابق البحث</p>
              <p className="text-sm text-muted-foreground opacity-70">اضغط تشغيل دورة الآن لتوليد إشارة جديدة</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
