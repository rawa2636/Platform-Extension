import { useGetTraderSignal, useApproveTraderSignal, useRejectTraderSignal, getGetTraderSignalQueryKey } from "@workspace/api-client-react";
import { useRoute, useLocation } from "wouter";
import { formatTimeAbsolute, formatPrice, formatPercent, formatNumber } from "@/lib/format";
import { DirectionBadge, StatusBadge } from "@/components/ui-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowRight, CheckCircle2, XCircle, Clock, ShieldCheck, Brain, Server, DollarSign, Target } from "lucide-react";
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
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0, transition: { ease: "easeOut", duration: 0.3 } }
};

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
    approve.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTraderSignalQueryKey(id) });
          toast({ title: "تمت الموافقة", description: "تم الموافقة على الإشارة بنجاح وسيتم تنفيذها." });
        },
        onError: (err) => toast({ variant: "destructive", title: "فشل", description: err.message })
      }
    );
  };

  const handleReject = () => {
    reject.mutate(
      { id, data: { reason: rejectReason } },
      {
        onSuccess: () => {
          setRejectOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetTraderSignalQueryKey(id) });
          toast({ title: "تم الرفض", description: "تم رفض الإشارة بنجاح." });
        },
        onError: (err) => toast({ variant: "destructive", title: "فشل", description: err.message })
      }
    );
  };

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-32 w-full" /><Skeleton className="h-96 w-full" /></div>;
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

  return (
    <motion.div className="space-y-6 pb-12 max-w-5xl mx-auto" variants={containerVariants} initial="hidden" animate="show">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/signals")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold font-mono">#{signal.id.substring(0, 8)}</h1>
        <div className="mr-auto flex gap-2">
          <StatusBadge status={signal.status} />
        </div>
      </div>

      {/* Main Signal Info */}
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
                  <div><span className="text-muted-foreground block text-xs">المخاطرة/المكافأة</span>{signal.riskReward?.toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm bg-card border border-border p-4 rounded-lg">
              <div>
                <p className="text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3"/> التاريخ</p>
                <p className="font-mono font-medium">{formatTimeAbsolute(signal.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 flex items-center gap-1"><Target className="w-3 h-3"/> الثقة</p>
                <p className="font-mono font-medium text-primary">{formatPercent(signal.confidence * 100)}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3"/> حجم الصفقة</p>
                <p className="font-mono font-medium">{formatNumber(signal.sizeUnits)} وحدات</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 flex items-center gap-1"><ShieldCheck className="w-3 h-3"/> المخاطرة</p>
                <p className="font-mono font-medium text-destructive">{formatPrice(signal.riskAmount)}$</p>
              </div>
            </div>
          </div>

          {/* Action Area for Manual Mode */}
          {signal.status === "PENDING" && signal.executionMode === "MANUAL" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-8 pt-6 border-t border-border flex justify-end gap-4">
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive hover:text-white" onClick={() => setRejectOpen(true)}>
                <XCircle className="w-4 h-4 ml-2" /> رفض
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleApprove} disabled={approve.isPending}>
                <CheckCircle2 className="w-4 h-4 ml-2" /> موافقة
              </Button>
            </motion.div>
          )}

          {signal.rejectionReason && (
            <div className="mt-6 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
              <p className="font-bold flex items-center gap-2"><XCircle className="w-4 h-4"/> سبب الرفض</p>
              <p className="mt-1 text-sm">{signal.rejectionReason}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Gates Audit */}
        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="w-5 h-5 text-primary" /> بوابات القواعد (Gates)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted rounded-md font-medium text-sm">
                  <span>النتيجة النهائية للقواعد</span>
                  {signal.rulesPassed ? 
                    <Badge className="bg-emerald-600">اجتازت</Badge> : 
                    <Badge variant="destructive">فشلت</Badge>
                  }
                </div>
                
                <div className="space-y-3 mt-4 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                  {signal.gates && signal.gates.length > 0 ? signal.gates.map((gate, i) => (
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
                  )) : (
                    <p className="text-muted-foreground text-sm text-center py-4">لا توجد بيانات بوابات</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* AI Confirmation Audit */}
        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><Brain className="w-5 h-5 text-primary" /> تأكيد المفتاحين (AI Models)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted rounded-md font-medium text-sm">
                  <span>النتيجة النهائية للذكاء الاصطناعي</span>
                  {signal.aiPassed === true ? 
                    <Badge className="bg-emerald-600">تأكيد ({signal.aiAgreeCount}/{signal.aiVotersCount})</Badge> : 
                   signal.aiPassed === false ?
                    <Badge variant="destructive">رفض ({signal.aiAgreeCount}/{signal.aiVotersCount})</Badge> :
                    <Badge variant="outline">غير مطلوب</Badge>
                  }
                </div>
                
                <div className="space-y-4 mt-4">
                  {signal.aiVotes && signal.aiVotes.length > 0 ? signal.aiVotes.map((vote, i) => (
                    <div key={i} className={`p-4 border rounded-lg ${vote.agreed ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"}`}>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-muted-foreground" />
                          <span className="font-mono text-sm font-bold">{vote.modelName}</span>
                        </div>
                        <Badge variant="outline" className={`font-mono ${vote.direction === signal.direction ? "text-emerald-500 border-emerald-500/50" : vote.direction === "NEUTRAL" || vote.direction === "ABSTAIN" ? "text-muted-foreground" : "text-destructive border-destructive/50"}`}>
                          صوت: {vote.direction}
                        </Badge>
                      </div>
                      {vote.rationale && (
                        <div className="text-sm text-muted-foreground mt-2 bg-background p-3 rounded border border-border/50 leading-relaxed italic">
                          "{vote.rationale}"
                        </div>
                      )}
                    </div>
                  )) : (
                    <p className="text-muted-foreground text-sm text-center py-4">لم يتم طلب تأكيد الذكاء الاصطناعي</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>رفض الإشارة</DialogTitle>
          </DialogHeader>
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
