import { Link, useLocation } from "wouter";
import { 
  useGetTraderSettings, 
  useUpdateTraderSettings, 
  useRunTraderCycle,
  getGetTraderSettingsQueryKey,
  getGetTraderDashboardQueryKey,
  getListTraderSignalsQueryKey,
  getListTraderPositionsQueryKey,
  getGetTraderSnapshotQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Activity, BarChart2, Settings, Play, Power, ShieldAlert, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useGetTraderSettings({
    query: { queryKey: getGetTraderSettingsQueryKey() }
  });

  const updateSettings = useUpdateTraderSettings();
  const runCycle = useRunTraderCycle();

  const handleModeSwitch = (mode: "OFF" | "MANUAL" | "AUTO") => {
    updateSettings.mutate({ data: { executionMode: mode } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTraderSettingsQueryKey() });
        toast({ title: "تم التحديث", description: `تم تغيير وضع التنفيذ إلى ${mode === "OFF" ? "إيقاف" : mode === "MANUAL" ? "يدوي" : "آلي"}` });
      }
    });
  };

  const handleRunCycle = () => {
    runCycle.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetTraderDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTraderSignalsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTraderPositionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTraderSnapshotQueryKey() });
        toast({
          title: "اكتملت الدورة",
          description: data.signalCreated ? `تم إنشاء إشارة جديدة: ${data.signalStatus}` : "لا توجد إشارات جديدة",
        });
      },
      onError: (err) => {
        toast({ variant: "destructive", title: "فشل", description: err.message });
      }
    });
  };

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "لوحة التحكم" },
    { href: "/signals", icon: Activity, label: "الإشارات" },
    { href: "/positions", icon: BarChart2, label: "الصفقات" },
    { href: "/settings", icon: Settings, label: "الإعدادات" },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
      <div className="w-64 border-l border-border bg-card flex flex-col z-10">
        <div className="h-16 flex items-center justify-center border-b border-border">
          <h1 className="text-lg font-bold text-primary flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            وكيل تداول الذهب
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6 z-10 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-lg">وضع التنفيذ</h2>
            <div className="flex bg-muted rounded-md p-1 border border-border">
              <button 
                onClick={() => handleModeSwitch("OFF")}
                className={`px-3 py-1 text-sm font-medium rounded-sm transition-all ${settings?.executionMode === "OFF" ? "bg-destructive text-destructive-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Power className="w-4 h-4 inline-block ml-1" />
                إيقاف
              </button>
              <button 
                onClick={() => handleModeSwitch("MANUAL")}
                className={`px-3 py-1 text-sm font-medium rounded-sm transition-all ${settings?.executionMode === "MANUAL" ? "bg-amber-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ShieldAlert className="w-4 h-4 inline-block ml-1" />
                يدوي
              </button>
              <button 
                onClick={() => handleModeSwitch("AUTO")}
                className={`px-3 py-1 text-sm font-medium rounded-sm transition-all ${settings?.executionMode === "AUTO" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Activity className="w-4 h-4 inline-block ml-1" />
                آلي
              </button>
            </div>
            {settings && (
              <Badge variant="outline" className="ml-4 opacity-70">
                {settings.tradingMode === "DAILY" ? "يومي" : "متوسط"}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <Button onClick={handleRunCycle} disabled={runCycle.isPending} size="sm" className="gap-2 font-bold font-sans">
              <Play className="w-4 h-4" />
              تشغيل دورة الآن
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 relative">
          {children}
        </main>
      </div>
    </div>
  );
}
