import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouteRequest, RouteRequestTaskType, RouteRequestModelType, RouteResponse, RouteRequest } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Route as RouteIcon, Loader2, Cpu, Activity, Clock, Zap, ArrowDown, Target, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  taskType: z.enum(["realtime", "analysis", "balanced", "embedding"]),
  modelType: z.enum(["chat", "embedding", "completion", "image", "audio", "ALL"]).optional(),
});

export default function RouterPlayground() {
  const [result, setResult] = useState<RouteResponse | null>(null);
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      taskType: "balanced",
      modelType: "chat",
    },
  });

  const routeRequest = useRouteRequest();

  function onSubmit(values: z.infer<typeof formSchema>) {
    const payload: RouteRequest = {
      taskType: values.taskType as RouteRequestTaskType,
      modelType: values.modelType as RouteRequestModelType,
    };
    
    routeRequest.mutate({ data: payload }, {
      onSuccess: (data) => {
        setResult(data);
      },
      onError: (err) => {
        toast({
          title: "Routing failed",
          description: err.message || "Could not find a suitable model for the request.",
          variant: "destructive",
        });
      }
    });
  }

  const getStatusColor = (status: string) => {
    switch(status) {
      case "ACTIVE": return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "SLOW": return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "FAIL": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "ARCHIVED": return "bg-muted text-muted-foreground border-border";
      default: return "";
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Router Playground</h1>
        <p className="text-muted-foreground mt-1">Test the model selection algorithm and evaluate fallbacks.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Form Column */}
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Request Parameters</CardTitle>
              <CardDescription>Simulate a client request to the routing engine.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="taskType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Task Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select task type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="realtime">Realtime (Low Latency)</SelectItem>
                            <SelectItem value="analysis">Analysis (High Quality)</SelectItem>
                            <SelectItem value="balanced">Balanced (Overall Score)</SelectItem>
                            <SelectItem value="embedding">Embedding</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Defines the primary optimization target.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="modelType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Model Capability</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select capability" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ALL">Any Capability</SelectItem>
                            <SelectItem value="chat">Chat</SelectItem>
                            <SelectItem value="completion">Completion</SelectItem>
                            <SelectItem value="embedding">Embedding</SelectItem>
                            <SelectItem value="image">Image</SelectItem>
                            <SelectItem value="audio">Audio</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Filter by specific model modality.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button type="submit" className="w-full" disabled={routeRequest.isPending}>
                    {routeRequest.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RouteIcon className="mr-2 h-4 w-4" />
                    )}
                    Route Request
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Results Column */}
        <div className="md:col-span-2">
          {routeRequest.isPending ? (
            <div className="space-y-6">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : result ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Card className="border-t-4 border-t-emerald-500 overflow-hidden">
                <div className="bg-emerald-500/10 px-6 py-3 border-b flex items-center justify-between">
                  <div className="flex items-center text-emerald-500 font-semibold">
                    <Target className="mr-2 h-5 w-5" />
                    Selected Endpoint
                  </div>
                  <Badge variant="outline" className="bg-background border-emerald-500/30 text-emerald-600">
                    Rank #{result.selected.rank || '-'}
                  </Badge>
                </div>
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row justify-between gap-6">
                    <div className="space-y-3 flex-1">
                      <div>
                        <h3 className="text-2xl font-bold tracking-tight">{result.selected.name}</h3>
                        <p className="text-muted-foreground">{result.selected.provider}</p>
                      </div>
                      
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{result.selected.type}</Badge>
                        <Badge variant="outline" className={`text-xs ${getStatusColor(result.selected.status)}`}>
                          {result.selected.status}
                        </Badge>
                      </div>

                      <div className="p-3 bg-muted rounded-md border font-mono text-sm break-all text-muted-foreground">
                        {result.selected.endpoint}
                      </div>
                    </div>

                    <div className="flex flex-row md:flex-col gap-4 bg-muted/30 p-4 rounded-xl border shrink-0 min-w-40 justify-center">
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Score</div>
                        <div className="text-3xl font-black text-emerald-500">{Math.round(result.selected.score)}</div>
                      </div>
                      <div className="w-full h-px bg-border hidden md:block"></div>
                      <div className="flex justify-between w-full text-sm font-mono gap-4">
                        <div className="text-center flex-1">
                          <Clock className="h-3 w-3 mx-auto mb-1 text-muted-foreground" />
                          <span>{result.selected.latencyMs ? Math.round(result.selected.latencyMs) : '--'}ms</span>
                        </div>
                        <div className="text-center flex-1">
                          <Zap className="h-3 w-3 mx-auto mb-1 text-muted-foreground" />
                          <span>{result.selected.tps ? result.selected.tps.toFixed(1) : '--'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t">
                    <div className="text-sm font-medium mb-1">Routing Reason</div>
                    <p className="text-sm text-muted-foreground">{result.reason}</p>
                  </div>
                </CardContent>
              </Card>

              {result.fallbacks && result.fallbacks.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center text-sm font-medium text-muted-foreground px-1">
                    <ArrowDown className="mr-2 h-4 w-4" />
                    Fallback Chain
                  </div>
                  
                  {result.fallbacks.map((fallback, i) => (
                    <Card key={fallback.id} className="opacity-80 hover:opacity-100 transition-opacity">
                      <CardContent className="p-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 flex-1 overflow-hidden">
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-sm truncate">{fallback.name}</h4>
                            <p className="text-xs text-muted-foreground truncate">{fallback.provider}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 text-sm font-mono">
                          <div className="text-right hidden sm:block">
                            <div className="text-xs text-muted-foreground">Score</div>
                            <div className="font-medium text-emerald-500">{Math.round(fallback.score)}</div>
                          </div>
                          <div className="text-right w-16">
                            <div className="text-xs text-muted-foreground">Latency</div>
                            <div className="font-medium">{fallback.latencyMs ? Math.round(fallback.latencyMs) : '--'}</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Card className="h-full flex items-center justify-center border-dashed bg-muted/10 min-h-[400px]">
              <CardContent className="text-center p-6 flex flex-col items-center">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Cpu className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Awaiting Request</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  Configure the request parameters and submit to see how the routing engine selects the optimal endpoint and fallback chain.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
