import { useListTraderPositions, useCloseTraderPosition, getListTraderPositionsQueryKey, getGetTraderDashboardQueryKey } from "@workspace/api-client-react";
import { formatTimeAbsolute, formatPrice, formatUnits } from "@/lib/format";
import { DirectionBadge, PnlDisplay } from "@/components/ui-patterns";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Filter, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion, type Variants } from "framer-motion";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { ListTraderPositionsStatus } from "@workspace/api-client-react";

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

export default function Positions() {
  const [statusFilter, setStatusFilter] = useState<ListTraderPositionsStatus>("ALL");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [positionToClose, setPositionToClose] = useState<{id: string, symbol: string} | null>(null);

  const { data: positions, isLoading, error } = useListTraderPositions(
    { status: statusFilter, limit: 100 },
    { query: { queryKey: getListTraderPositionsQueryKey({ status: statusFilter, limit: 100 }), refetchInterval: 8000 } }
  );

  const closePosition = useCloseTraderPosition();

  const handleCloseClick = (id: string) => {
    setPositionToClose({ id, symbol: "XAU/USD" });
    setCloseDialogOpen(true);
  };

  const handleConfirmClose = () => {
    if (!positionToClose) return;
    
    closePosition.mutate(
      { id: positionToClose.id },
      {
        onSuccess: () => {
          setCloseDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTraderPositionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTraderDashboardQueryKey() });
          toast({ title: "تم إغلاق الصفقة", description: "تم إرسال أمر الإغلاق بنجاح." });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "فشل الإغلاق", description: err.message });
        }
      }
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-bold mb-2">حدث خطأ في تحميل الصفقات</h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">الصفقات</h1>
          <p className="text-muted-foreground">الصفقات المفتوحة والمغلقة (Paper Trading)</p>
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
                <SelectItem value="OPEN">مفتوحة</SelectItem>
                <SelectItem value="CLOSED">مُغلقة</SelectItem>
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
          ) : positions && positions.length > 0 ? (
            <motion.div 
              className="divide-y divide-border"
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              {positions.map(pos => {
                const isOpen = pos.status === "OPEN";
                const pnl = isOpen ? pos.unrealizedPnl : pos.pnl;
                const pnlR = isOpen ? null : pos.pnlR; // Current API schema has pnlR
                
                return (
                  <motion.div key={pos.id} variants={itemVariants} className={`flex flex-col md:flex-row md:items-center justify-between p-5 transition-colors gap-4 ${isOpen ? "bg-card hover:bg-muted/30" : "bg-muted/10 opacity-80"}`}>
                    
                    <div className="flex items-start md:items-center gap-4 min-w-[200px]">
                      <div className="mt-1 md:mt-0"><DirectionBadge direction={pos.side} /></div>
                      <div>
                        <div className="font-bold text-lg font-mono">
                          {formatPrice(pos.entry)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-col gap-1">
                          <span>فتح: {formatTimeAbsolute(pos.openedAt)}</span>
                          {!isOpen && pos.closedAt && <span>إغلاق: {formatTimeAbsolute(pos.closedAt)}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:flex flex-1 gap-x-4 gap-y-2 md:gap-8 text-sm md:justify-center">
                      <div>
                        <span className="text-muted-foreground block text-xs mb-1">الحجم</span>
                        <span className="font-mono">{formatUnits(pos.sizeUnits)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-xs mb-1">المخاطرة</span>
                        <span className="font-mono">${formatPrice(pos.riskAmount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-xs mb-1">SL / TP</span>
                        <span className="font-mono">{formatPrice(pos.stopLoss)} / {formatPrice(pos.takeProfit)}</span>
                      </div>
                      {!isOpen && pos.exitPrice && (
                        <div>
                          <span className="text-muted-foreground block text-xs mb-1">سعر الخروج</span>
                          <span className="font-mono">{formatPrice(pos.exitPrice)}</span>
                        </div>
                      )}
                      {isOpen && pos.currentPrice && (
                        <div>
                          <span className="text-muted-foreground block text-xs mb-1">السعر الحالي</span>
                          <span className="font-mono">{formatPrice(pos.currentPrice)}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 min-w-[200px] border-t md:border-t-0 pt-3 md:pt-0 mt-2 md:mt-0 border-border">
                      <div className="text-right">
                        <span className="text-muted-foreground block text-xs mb-1">{isOpen ? "الربح غير المحقق" : "الربح"}</span>
                        <div className="flex items-center gap-2">
                          <PnlDisplay value={pnl} />
                          {pnlR != null && <Badge variant="outline" className="font-mono px-1 py-0 h-5 text-[10px] opacity-70">{pnlR.toFixed(1)}R</Badge>}
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end gap-2">
                        {isOpen ? (
                          <Button variant="destructive" size="sm" className="h-8" onClick={() => handleCloseClick(pos.id)}>
                            <XCircle className="w-3 h-3 ml-1" /> إغلاق
                          </Button>
                        ) : (
                          <Badge variant="secondary" className="bg-muted text-muted-foreground">مغلقة</Badge>
                        )}
                        {!isOpen && pos.exitReason && (
                          <span className="text-[10px] text-muted-foreground font-mono">{pos.exitReason}</span>
                        )}
                      </div>
                    </div>

                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-2">
                {statusFilter === "OPEN" ? "لا توجد صفقات مفتوحة" : statusFilter === "CLOSED" ? "لا توجد صفقات مغلقة" : "لا توجد صفقات"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إغلاق الصفقة</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من رغبتك في إغلاق صفقة {positionToClose?.symbol} بالسعر الحالي للسوق؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row-reverse sm:justify-start mt-4">
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>إلغاء</Button>
            <Button variant="destructive" onClick={handleConfirmClose} disabled={closePosition.isPending}>تأكيد الإغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
