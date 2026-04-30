import { useState } from "react";
import { Link } from "wouter";
import { useListModels, getListModelsQueryKey, ListModelsStatus, ListModelsType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Copy, ChevronLeft, ChevronRight, Activity, Clock, Zap, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ModelsRegistry() {
  const [page, setPage] = useState(0);
  const limit = 20;
  const [statusFilter, setStatusFilter] = useState<ListModelsStatus>("ACTIVE");
  const [typeFilter, setTypeFilter] = useState<ListModelsType>("ALL");
  const { toast } = useToast();

  const { data, isLoading } = useListModels({
    limit,
    offset: page * limit,
    status: statusFilter,
    type: typeFilter,
  }, {
    query: { queryKey: getListModelsQueryKey({ limit, offset: page * limit, status: statusFilter, type: typeFilter }) }
  });

  const handleCopyEndpoint = (e: React.MouseEvent, text: string) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Endpoint URL copied.",
    });
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case "ACTIVE": return "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20";
      case "SLOW": return "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20";
      case "FAIL": return "bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20";
      case "ARCHIVED": return "bg-muted text-muted-foreground hover:bg-muted/80 border-border";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Model Registry</h1>
          <p className="text-muted-foreground mt-1">Browse, filter, and inspect the complete fleet of discovered models.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground font-medium mr-2">Status:</span>
              {(["ALL", "ACTIVE", "SLOW", "FAIL", "ARCHIVED"] as ListModelsStatus[]).map((s) => (
                <Badge 
                  key={s} 
                  variant={statusFilter === s ? "default" : "outline"}
                  className={`cursor-pointer ${statusFilter === s ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-muted"}`}
                  onClick={() => { setStatusFilter(s); setPage(0); }}
                >
                  {s}
                </Badge>
              ))}
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground font-medium mr-2">Type:</span>
              {(["ALL", "chat", "embedding", "completion", "image", "audio", "unknown"] as ListModelsType[]).map((t) => (
                <Badge 
                  key={t} 
                  variant={typeFilter === t ? "default" : "outline"}
                  className={`cursor-pointer ${typeFilter === t ? "bg-secondary text-secondary-foreground hover:bg-secondary/90" : "hover:bg-muted"}`}
                  onClick={() => { setTypeFilter(t); setPage(0); }}
                >
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-12 text-center">Rnk</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Provider & Endpoint</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Metrics</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : data?.items.length ? (
                data.items.map((model) => (
                  <TableRow key={model.id} className="group cursor-pointer hover:bg-muted/30 transition-colors">
                    <TableCell className="text-center font-mono text-muted-foreground">
                      {model.rank || '-'}
                    </TableCell>
                    <TableCell>
                      <Link href={`/models/${model.id}`} className="font-medium text-primary hover:underline flex items-center">
                        {model.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col space-y-1">
                        <span className="text-xs text-muted-foreground font-medium">{model.provider}</span>
                        <div className="flex items-center text-xs font-mono max-w-[200px] lg:max-w-[300px]">
                          <span className="truncate text-muted-foreground">{model.endpoint}</span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-5 w-5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => handleCopyEndpoint(e, model.endpoint)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-normal">
                        {model.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${getStatusColor(model.status)}`}>
                        {model.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end space-y-1">
                        <div className="flex items-center text-xs font-mono">
                          <Activity className="h-3 w-3 mr-1 text-muted-foreground" />
                          <span className="font-medium text-emerald-500 w-8 text-right">{Math.round(model.score)}</span>
                        </div>
                        <div className="flex items-center text-[10px] text-muted-foreground font-mono space-x-2">
                          <span className="flex items-center"><Clock className="h-2.5 w-2.5 mr-0.5" />{model.latencyMs ? Math.round(model.latencyMs) : '--'}ms</span>
                          <span className="flex items-center"><Zap className="h-2.5 w-2.5 mr-0.5" />{model.tps ? model.tps.toFixed(1) : '--'}</span>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                    <Search className="h-8 w-8 mx-auto mb-3 opacity-20" />
                    No models match the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data?.total ? `Showing ${page * limit + 1} to ${Math.min((page + 1) * limit, data.total)} of ${data.total} models` : "No models"}
        </p>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            size="sm" 
            disabled={page === 0 || isLoading}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Prev
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            disabled={!data || (page + 1) * limit >= data.total || isLoading}
            onClick={() => setPage(p => p + 1)}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
