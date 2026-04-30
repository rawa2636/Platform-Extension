import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Database, 
  History, 
  Route as RouteIcon,
  Play,
  Activity,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetHarvestStatus, useTriggerHarvest, getGetHarvestStatusQueryKey, getGetLatestRunQueryKey, getGetStatsQueryKey, getListRunsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: harvestStatus } = useGetHarvestStatus({ 
    query: { queryKey: getGetHarvestStatusQueryKey(), refetchInterval: 2500 } 
  });
  
  const triggerHarvest = useTriggerHarvest();
  
  const handleRunHarvest = () => {
    triggerHarvest.mutate(undefined, {
      onSuccess: () => {
        toast({
          title: "Harvest started",
          description: "The pipeline has been triggered successfully."
        });
        queryClient.invalidateQueries({ queryKey: getGetHarvestStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLatestRunQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      },
      onError: (err) => {
        toast({
          title: "Failed to start harvest",
          description: err.message || "An error occurred",
          variant: "destructive"
        });
      }
    });
  };

  const isRunning = harvestStatus?.running;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b">
          <Activity className="h-6 w-6 text-primary mr-2" />
          <span className="font-bold tracking-tight">Model Orchestrator</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            <Link href="/" className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${location === "/" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <LayoutDashboard className="h-4 w-4 mr-3" /> Dashboard
            </Link>
            <Link href="/models" className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${location.startsWith("/models") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <Database className="h-4 w-4 mr-3" /> Registry
            </Link>
            <Link href="/runs" className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${location.startsWith("/runs") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <History className="h-4 w-4 mr-3" /> Runs
            </Link>
            <Link href="/router" className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${location.startsWith("/router") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <RouteIcon className="h-4 w-4 mr-3" /> Router
            </Link>
          </nav>
        </div>
        
        <div className="p-4 border-t">
          {isRunning ? (
            <div className="flex items-center justify-between px-3 py-2 bg-primary/10 text-primary rounded-md text-sm font-medium border border-primary/20">
              <span className="flex items-center">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Harvesting...
              </span>
              <span className="text-xs opacity-80">{Math.round(harvestStatus?.progress || 0)}%</span>
            </div>
          ) : (
            <div className="flex items-center justify-center px-3 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium border">
              <span>System Idle</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b bg-card flex items-center justify-between px-6">
          <div>
            {harvestStatus?.lastFinishedAt && !isRunning && (
              <span className="text-sm text-muted-foreground">
                Last run: {new Date(harvestStatus.lastFinishedAt).toLocaleString()}
              </span>
            )}
            {isRunning && harvestStatus?.stage && (
              <span className="text-sm text-primary font-medium animate-pulse">
                Current stage: {harvestStatus.stage}
              </span>
            )}
          </div>
          <Button 
            onClick={handleRunHarvest} 
            disabled={isRunning || triggerHarvest.isPending}
            size="sm"
          >
            {triggerHarvest.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run Harvest Now
          </Button>
        </header>
        
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
