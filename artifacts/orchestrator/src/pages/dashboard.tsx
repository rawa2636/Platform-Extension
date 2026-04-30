import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  useGetStats,
  useGetLatestRun,
  useGetTopModels,
  useListRuns,
  getGetStatsQueryKey,
  getGetLatestRunQueryKey,
  getGetTopModelsQueryKey,
  getListRunsQueryKey,
  useGetHarvestStatus,
  getGetHarvestStatusQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Activity, Database, CheckCircle, XCircle, Clock, Zap, ArrowRight, ZapIcon, AlertTriangle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

export default function Dashboard() {
  const { data: harvestStatus } = useGetHarvestStatus({
    query: { queryKey: getGetHarvestStatusQueryKey(), refetchInterval: 2500 }
  });

  const isRunning = harvestStatus?.running;
  
  const { data: stats, isLoading: isStatsLoading } = useGetStats({
    query: { queryKey: getGetStatsQueryKey(), refetchInterval: isRunning ? 5000 : false }
  });
  
  const { data: latestRun, isLoading: isRunLoading } = useGetLatestRun({
    query: { queryKey: getGetLatestRunQueryKey(), refetchInterval: isRunning ? 5000 : false }
  });
  
  const { data: topModels, isLoading: isModelsLoading } = useGetTopModels({ limit: 10 }, {
    query: { queryKey: getGetTopModelsQueryKey({ limit: 10 }) }
  });
  
  const { data: recentRuns, isLoading: isRunsLoading } = useListRuns({ limit: 5 }, {
    query: { queryKey: getListRunsQueryKey({ limit: 5 }) }
  });

  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mission Control</h1>
        <p className="text-muted-foreground mt-1">Real-time overview of the AI model fleet.</p>
      </div>

      {isRunning && harvestStatus && (
        <Card className="border-primary/50 bg-primary/5 shadow-sm shadow-primary/10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </div>
                <h3 className="font-semibold text-primary">Harvest Pipeline Active</h3>
              </div>
              <span className="text-sm font-mono">{Math.round(harvestStatus.progress || 0)}%</span>
            </div>
            <Progress value={harvestStatus.progress || 0} className="h-2 mb-2" />
            <p className="text-sm text-muted-foreground">Current Stage: <span className="font-medium text-foreground">{harvestStatus.stage || "Initializing..."}</span></p>
          </CardContent>
        </Card>
      )}

      {/* KPI Strip */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Models</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isStatsLoading ? <Skeleton className="h-8 w-20" /> : (
              <>
                <div className="text-2xl font-bold">{stats?.totalModels || 0}</div>
                <div className="flex items-center text-xs text-muted-foreground mt-1 space-x-2">
                  <span className="text-emerald-500 font-medium">{stats?.activeModels || 0} active</span>
                  <span>•</span>
                  <span className="text-amber-500 font-medium">{stats?.slowModels || 0} slow</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isStatsLoading ? <Skeleton className="h-8 w-20" /> : (
              <>
                <div className="text-2xl font-bold">{stats?.avgScore ? stats.avgScore.toFixed(1) : 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Out of 100</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isStatsLoading ? <Skeleton className="h-8 w-20" /> : (
              <>
                <div className="text-2xl font-bold">{stats?.avgLatencyMs ? Math.round(stats.avgLatencyMs) : 0}ms</div>
                <p className="text-xs text-muted-foreground mt-1">Global response time</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Throughput</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isStatsLoading ? <Skeleton className="h-8 w-20" /> : (
              <>
                <div className="text-2xl font-bold">{stats?.avgTps ? stats.avgTps.toFixed(1) : 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Tokens per second</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Top Models Leaderboard</CardTitle>
            <CardDescription>Highest scoring active endpoints across the fleet</CardDescription>
          </CardHeader>
          <CardContent>
            {isModelsLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : topModels?.length ? (
              <div className="space-y-4">
                {topModels.slice(0, 7).map((model, i) => (
                  <Link key={model.id} href={`/models/${model.id}`} className="flex items-center p-3 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border transition-all group">
                    <div className="flex-shrink-0 w-8 text-center font-mono text-muted-foreground group-hover:text-primary transition-colors">
                      {i + 1}
                    </div>
                    <div className="ml-4 flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{model.name}</p>
                      <p className="text-xs text-muted-foreground">{model.provider}</p>
                    </div>
                    <div className="flex items-center space-x-4 text-sm">
                      <div className="flex items-center text-muted-foreground">
                        <Clock className="mr-1 h-3 w-3" />
                        {model.latencyMs ? Math.round(model.latencyMs) : '--'}ms
                      </div>
                      <div className="font-mono font-medium text-emerald-500 text-right w-12">
                        {Math.round(model.score)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>No active models found</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-3 space-y-6 flex flex-col">
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Model Types</CardTitle>
            </CardHeader>
            <CardContent>
              {isStatsLoading ? <Skeleton className="h-48 w-full" /> : stats?.typeBreakdown?.length ? (
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.typeBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="count"
                        nameKey="type"
                      >
                        {stats.typeBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">No data</div>
              )}
            </CardContent>
          </Card>
          
          <Card className="flex-1">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>Latest Run</CardTitle>
              <Link href="/runs" className="text-xs text-primary hover:underline flex items-center">
                View all <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent className="pt-4">
              {isRunLoading ? <Skeleton className="h-32 w-full" /> : latestRun ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Status</div>
                    <Badge variant={latestRun.status === 'SUCCESS' ? 'default' : latestRun.status === 'FAILED' ? 'destructive' : 'secondary'}
                      className={latestRun.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20' : ''}
                    >
                      {latestRun.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Finished</div>
                    <div className="text-sm font-medium">{latestRun.finishedAt ? new Date(latestRun.finishedAt).toLocaleString() : '--'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                    <div>
                      <div className="text-xs text-muted-foreground">Tested</div>
                      <div className="font-mono font-medium">{latestRun.linksTested}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Active</div>
                      <div className="font-mono font-medium text-emerald-500">{latestRun.modelsActive}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">No run history</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
