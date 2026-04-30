import { useGetTraderSettings, useUpdateTraderSettings, useResetTraderAccount, getGetTraderSettingsQueryKey, getGetTraderDashboardQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

// Recreate schema to match API bounds
const settingsSchema = z.object({
  executionMode: z.enum(["OFF", "MANUAL", "AUTO"]),
  tradingMode: z.enum(["DAILY", "MID"]),
  riskPerTradePct: z.coerce.number().min(0.05).max(5),
  dailyLossCapPct: z.coerce.number().min(0.5).max(20),
  maxOpenPositions: z.coerce.number().min(1).max(10),
  maxTradesPerDay: z.coerce.number().min(1).max(50),
  minConfidence: z.coerce.number().min(0).max(1),
  minRiskReward: z.coerce.number().min(0.5).max(5),
  requireAiConfirmation: z.boolean(),
  aiConfirmCount: z.coerce.number().min(1).max(5),
  signalExpirySec: z.coerce.number().min(30).max(3600),
});

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [startingBalance, setStartingBalance] = useState("100000");

  const { data: settings, isLoading, error } = useGetTraderSettings({
    query: { queryKey: getGetTraderSettingsQueryKey() }
  });

  const updateSettings = useUpdateTraderSettings();
  const resetAccount = useResetTraderAccount();

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      executionMode: "OFF",
      tradingMode: "DAILY",
      riskPerTradePct: 1,
      dailyLossCapPct: 5,
      maxOpenPositions: 3,
      maxTradesPerDay: 5,
      minConfidence: 0.7,
      minRiskReward: 1.5,
      requireAiConfirmation: true,
      aiConfirmCount: 2,
      signalExpirySec: 300,
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        executionMode: settings.executionMode as any,
        tradingMode: settings.tradingMode as any,
        riskPerTradePct: settings.riskPerTradePct,
        dailyLossCapPct: settings.dailyLossCapPct,
        maxOpenPositions: settings.maxOpenPositions,
        maxTradesPerDay: settings.maxTradesPerDay,
        minConfidence: settings.minConfidence,
        minRiskReward: settings.minRiskReward,
        requireAiConfirmation: settings.requireAiConfirmation,
        aiConfirmCount: settings.aiConfirmCount,
        signalExpirySec: settings.signalExpirySec,
      });
    }
  }, [settings, form]);

  const onSubmit = (values: z.infer<typeof settingsSchema>) => {
    updateSettings.mutate(
      { data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTraderSettingsQueryKey() });
          toast({ title: "تم الحفظ", description: "تم حفظ الإعدادات بنجاح." });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "فشل", description: err.message });
        }
      }
    );
  };

  const handleReset = () => {
    const bal = parseFloat(startingBalance);
    if (isNaN(bal) || bal < 1) {
      toast({ variant: "destructive", title: "خطأ", description: "الرصيد الافتتاحي غير صالح" });
      return;
    }
    
    resetAccount.mutate(
      { data: { startingBalance: bal } },
      {
        onSuccess: () => {
          setResetDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetTraderDashboardQueryKey() });
          toast({ title: "تم إعادة التعيين", description: "تم تصفير الحساب وإغلاق جميع الصفقات بنجاح." });
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "فشل", description: err.message });
        }
      }
    );
  };

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (error || !settings) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-bold mb-2">حدث خطأ في تحميل الإعدادات</h2>
        <p className="text-muted-foreground">{error?.message ?? "تعذر تحميل الإعدادات"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">الإعدادات</h1>
        <p className="text-muted-foreground">تكوين قواعد التداول وإدارة المخاطر</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          <Card>
            <CardHeader>
              <CardTitle>وضع التداول</CardTitle>
              <CardDescription>التحكم الأساسي في النظام</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="executionMode"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>وضع التنفيذ</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                        dir="rtl"
                      >
                        <FormItem className="flex items-center space-x-0 space-x-reverse gap-3 rounded-md border p-3 bg-background">
                          <FormControl><RadioGroupItem value="OFF" /></FormControl>
                          <FormLabel className="font-normal flex-1 cursor-pointer">إيقاف (لا توجد إشارات)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-0 space-x-reverse gap-3 rounded-md border p-3 bg-background">
                          <FormControl><RadioGroupItem value="MANUAL" /></FormControl>
                          <FormLabel className="font-normal flex-1 cursor-pointer">يدوي (يتطلب موافقة)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-0 space-x-reverse gap-3 rounded-md border p-3 bg-background border-emerald-500/30">
                          <FormControl><RadioGroupItem value="AUTO" /></FormControl>
                          <FormLabel className="font-normal flex-1 cursor-pointer font-bold text-emerald-500">آلي (تنفيذ فوري)</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tradingMode"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>استراتيجية التداول</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                        dir="rtl"
                      >
                        <FormItem className="flex items-center space-x-0 space-x-reverse gap-3 rounded-md border p-3 bg-background">
                          <FormControl><RadioGroupItem value="DAILY" /></FormControl>
                          <FormLabel className="font-normal flex-1 cursor-pointer">يومي (Intraday)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-0 space-x-reverse gap-3 rounded-md border p-3 bg-background">
                          <FormControl><RadioGroupItem value="MID" /></FormControl>
                          <FormLabel className="font-normal flex-1 cursor-pointer">متوسط الأجل (Swing)</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>إدارة المخاطر</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              
              <FormField
                control={form.control}
                name="riskPerTradePct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex justify-between">
                      <span>المخاطرة لكل صفقة (%)</span>
                      <span className="font-mono text-primary">{field.value.toFixed(2)}%</span>
                    </FormLabel>
                    <FormControl>
                      <Slider
                        min={0.05} max={5} step={0.05}
                        value={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                        className="py-4"
                        dir="ltr" // Sliders usually work better ltr even in rtl layouts visually
                      />
                    </FormControl>
                    <FormDescription>الحد الأقصى للمخاطرة من حقوق الملكية في صفقة واحدة</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dailyLossCapPct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex justify-between">
                      <span>الحد الأقصى للخسارة اليومية (%)</span>
                      <span className="font-mono text-primary">{field.value.toFixed(1)}%</span>
                    </FormLabel>
                    <FormControl>
                      <Slider
                        min={0.5} max={20} step={0.5}
                        value={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                        className="py-4"
                        dir="ltr"
                      />
                    </FormControl>
                    <FormDescription>إيقاف التداول إذا تم تجاوز هذا الحد</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxOpenPositions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>الحد الأقصى للصفقات المفتوحة</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={10} className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxTradesPerDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>الحد الأقصى لصفقات اليوم</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={50} className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>توليد الإشارات</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              
              <FormField
                control={form.control}
                name="minConfidence"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex justify-between">
                      <span>الحد الأدنى للثقة</span>
                      <span className="font-mono text-primary">{(field.value * 100).toFixed(0)}%</span>
                    </FormLabel>
                    <FormControl>
                      <Slider
                        min={0} max={1} step={0.05}
                        value={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                        className="py-4"
                        dir="ltr"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="minRiskReward"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>الحد الأدنى لنسبة المخاطرة/المكافأة (R:R)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" min={0.5} max={5} className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="signalExpirySec"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>صلاحية الإشارة (ثواني)</FormLabel>
                    <FormControl>
                      <Input type="number" min={30} max={3600} className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription>الوقت قبل أن تصبح الإشارة "منتهية"</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </CardContent>
          </Card>

          <Card className="border-primary/50 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-primary">الذكاء الاصطناعي (تأكيد المفتاحين)</CardTitle>
              <CardDescription>التحقق من الإشارات عبر النماذج اللغوية</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              <FormField
                control={form.control}
                name="requireAiConfirmation"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 bg-background">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">تفعيل تأكيد الذكاء الاصطناعي</FormLabel>
                      <FormDescription>
                        لن تمر الإشارة للقرار إلا إذا وافقت النماذج
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aiConfirmCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>عدد النماذج المطلوبة للتأكيد</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min={1} max={5} 
                        className="font-mono" 
                        {...field} 
                        disabled={!form.watch("requireAiConfirmation")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </CardContent>
          </Card>

          <div className="flex justify-between items-center pt-4 border-t border-border">
            <Button type="button" variant="destructive" onClick={() => setResetDialogOpen(true)}>
              <RotateCcw className="w-4 h-4 ml-2" /> إعادة تعيين الحساب
            </Button>
            <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary/90 px-8" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "جاري الحفظ..." : <><Save className="w-4 h-4 ml-2" /> حفظ الإعدادات</>}
            </Button>
          </div>
        </form>
      </Form>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="w-5 h-5" /> تحذير: إعادة تعيين الحساب
            </DialogTitle>
            <DialogDescription className="pt-2">
              هذا الإجراء سيقوم بإغلاق جميع الصفقات المفتوحة وحذف سجل الإشارات وإعادة الرصيد إلى القيمة الافتتاحية. لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">الرصيد الافتتاحي الجديد ($)</label>
            <Input 
              type="number" 
              value={startingBalance} 
              onChange={(e) => setStartingBalance(e.target.value)} 
              className="font-mono"
            />
          </div>
          <DialogFooter className="flex-row-reverse sm:justify-start">
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>إلغاء</Button>
            <Button variant="destructive" onClick={handleReset} disabled={resetAccount.isPending}>تأكيد الحذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
