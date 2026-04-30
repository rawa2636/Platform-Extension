import { useParams, Link } from "wouter";
import { useGetModel, getGetModelQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, ExternalLink, Activity, Clock, Zap, Target, Star, Calendar } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useToast } from "@/hooks/use-toast";

export default function ModelDetail() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();

  const { data: model, isLoading } = useGetModel(id, {
    query: { enabled: !!id, queryKey: getGetModelQueryKey(id) }
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Text copied.",
    });
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case "ACTIVE": return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "SLOW": return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "FAIL": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "ARCHIVED": return "bg-muted text-muted-foreground border-border";
      default: return "";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-48 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Model not found</p>
        <Link href="/models">
          <Button variant="outline" className="mt-4">Back to Registry</Button>
        </Link>
      </div>
    );
  }

  const chartData = model.history?.map(h => ({
    ...h,
    date: new Date(h.timestamp).toLocaleDateString(),
    time: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })).reverse() || [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div>
        <Link href="/models" className="text-sm text-muted-foreground hover:text-foreground flex items-center mb-4 transition-colors w-fit">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to registry
        </Link>
      </div>

      {/* Header Card */}
      <Card className="border-t-4 border-t-primary shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="space-y-4 flex-1">
              <div>
                <div className="flex items-center space-x-3 mb-1">
                  <h1 className="text-3xl font-bold tracking-tight">{model.name}</h1>
                  <Badge variant="outline" className={`text-xs ${getStatusColor(model.status)}`}>
                    {model.status}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {model.type}
                  </Badge>
                </div>
                <p className="text-muted-foreground font-medium text-lg">{model.provider}</p>
              </div>

              <div className="flex items-center p-3 bg-muted rounded-md font-mono text-sm max-w-2xl border">
                <span className="truncate flex-1 text-muted-foreground">{model.endpoint}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 ml-2 flex-shrink-0" onClick={() => handleCopy(model.endpoint)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>

              {model.sourceUrl && (
                <a href={model.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-sm text-primary hover:underline">
                  <ExternalLink className="h-4 w-4 mr-1" /> View Source
                </a>
              )}
            </div>

            <div className="flex flex-col items-end md:w-48 shrink-0 bg-card rounded-lg border p-4 shadow-sm">
              <div className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">Overall Score</div>
              <div className="flex items-baseline space-x-1">
                <span className="text-4xl font-black text-emerald-500">{Math.round(model.score)}</span>
                <span className="text-muted-foreground text-sm font-medium">/ 100</span>
              </div>
              <div className="mt-4 pt-4 border-t w-full text-right">
                <div className="text-xs text-muted-foreground">Current Rank</div>
                <div className="text-lg font-bold font-mono">#{model.rank || '-'}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
            <Clock className="h-6 w-6 text-muted-foreground mb-2" />
            <div className="text-2xl font-bold font-mono">{model.latencyMs ? Math.round(model.latencyMs) : '--'}</div>
            <div className="text-xs text-muted-foreground mt-1">Latency (ms)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
            <Zap className="h-6 w-6 text-muted-foreground mb-2" />
            <div className="text-2xl font-bold font-mono">{model.tps ? model.tps.toFixed(1) : '--'}</div>
            <div className="text-xs text-muted-foreground mt-1">Tokens / Sec</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
            <Target className="h-6 w-6 text-muted-foreground mb-2" />
            <div className="text-2xl font-bold font-mono">{model.successRate ? Math.round(model.successRate * 100) : '--'}%</div>
            <div className="text-xs text-muted-foreground mt-1">Success Rate</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
            <Star className="h-6 w-6 text-muted-foreground mb-2" />
            <div className="text-2xl font-bold font-mono">{model.quality ? model.quality.toFixed(1) : '--'}</div>
            <div className="text-xs text-muted-foreground mt-1">Quality</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
            <Calendar className="h-6 w-6 text-muted-foreground mb-2" />
            <div className="text-sm font-bold truncate w-full">{model.lastChecked ? new Date(model.lastChecked).toLocaleDateString() : '--'}</div>
            <div className="text-xs text-muted-foreground mt-1">Last Checked</div>
          </CardContent>
        </Card>
      </div>

      {/* History Charts */}
      {chartData.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Score History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                    />
                    <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: 'hsl(var(--primary))' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Performance History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                    <Line yAxisId="left" type="monotone" dataKey="latencyMs" name="Latency (ms)" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="tps" name="TPS" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
