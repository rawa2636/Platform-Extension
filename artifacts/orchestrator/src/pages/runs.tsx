import { useListRuns, getListRunsQueryKey, HarvestRunStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Clock, Database, Link as LinkIcon, CheckCircle2, XCircle, AlertTriangle, Activity } from "lucide-react";

export default function RunsHistory() {
  const limit = 50;
  const { data: runs, isLoading } = useListRuns({ limit }, {
    query: { queryKey: getListRunsQueryKey({ limit }) }
  });

  const getStatusBadge = (status: HarvestRunStatus) => {
    switch(status) {
      case "SUCCESS": return <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">SUCCESS</Badge>;
      case "FAILED": return <Badge className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20">FAILED</Badge>;
      case "RUNNING": return <Badge className="bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 animate-pulse">RUNNING</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (ms?: number | null) => {
    if (!ms) return '--';
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Harvest History</h1>
        <p className="text-muted-foreground mt-1">Review past extraction and testing pipelines.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Links</TableHead>
                <TableHead className="text-right">Models</TableHead>
                <TableHead className="text-right">Metrics</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  </TableRow>
                ))
              ) : runs?.length ? (
                runs.map((run) => (
                  <TableRow key={run.id} className="hover:bg-muted/30">
                    <TableCell>
                      {getStatusBadge(run.status)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col space-y-1">
                        <span className="text-sm font-medium">
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          {run.finishedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }) : 'In progress'}
                          <span className="mx-1">•</span>
                          {formatDuration(run.durationMs)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end space-y-1 text-sm font-mono">
                        <span className="text-muted-foreground flex items-center" title="Links Discovered">
                          <LinkIcon className="h-3 w-3 mr-1" /> {run.linksDiscovered}
                        </span>
                        <span className="flex items-center" title="Links Tested">
                          <Activity className="h-3 w-3 mr-1 text-primary" /> {run.linksTested}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end space-y-1 text-sm font-mono">
                        <span className="text-emerald-500 flex items-center" title="Models Active">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> {run.modelsActive}
                        </span>
                        <span className="text-red-500 flex items-center" title="Models Failed">
                          <XCircle className="h-3 w-3 mr-1" /> {run.modelsFailed}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end space-y-1 text-sm font-mono">
                        <span className="text-muted-foreground flex items-center" title="Average Score">
                          <Database className="h-3 w-3 mr-1" />
                          {run.avgScore ? run.avgScore.toFixed(1) : '--'}
                        </span>
                        <span className="text-muted-foreground flex items-center" title="Average Latency">
                          <Clock className="h-3 w-3 mr-1" />
                          {run.avgLatencyMs ? Math.round(run.avgLatencyMs) : '--'}ms
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground max-w-xs truncate" title={run.message || ""}>
                        {run.message || "No message"}
                      </div>
                      {run.sourceCommit && (
                        <div className="text-[10px] font-mono mt-1 opacity-70">
                          commit: {run.sourceCommit.substring(0, 7)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-20" />
                    No harvest runs recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
