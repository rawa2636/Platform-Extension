import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PENDING: { label: "قيد الانتظار", className: "bg-blue-600/20 text-blue-500 border-blue-600/30" },
    APPROVED: { label: "موافق عليها", className: "bg-emerald-600/20 text-emerald-500 border-emerald-600/30" },
    REJECTED: { label: "مرفوضة", className: "bg-destructive/20 text-destructive border-destructive/30" },
    EXECUTED: { label: "مُنفَّذة", className: "bg-amber-500/20 text-amber-500 border-amber-500/30" },
    EXPIRED: { label: "منتهية", className: "bg-muted text-muted-foreground border-border" },
    OPEN: { label: "مفتوحة", className: "bg-emerald-600/20 text-emerald-500 border-emerald-600/30" },
    CLOSED: { label: "مُغلقة", className: "bg-muted text-muted-foreground border-border" },
  };

  const item = map[status] || { label: status, className: "bg-muted" };

  return (
    <Badge variant="outline" className={`font-medium ${item.className}`}>
      {item.label}
    </Badge>
  );
}

export function DirectionBadge({ direction }: { direction: string }) {
  const map: Record<string, { label: string; className: string }> = {
    BUY: { label: "شراء", className: "bg-emerald-600/20 text-emerald-500 border-emerald-600/30" },
    SELL: { label: "بيع", className: "bg-destructive/20 text-destructive border-destructive/30" },
    NEUTRAL: { label: "محايد", className: "bg-muted text-muted-foreground border-border" },
  };

  const item = map[direction] || { label: direction, className: "bg-muted" };

  return (
    <Badge variant="outline" className={`font-medium ${item.className}`}>
      {item.label}
    </Badge>
  );
}

export function PnlDisplay({ value, isPercent = false }: { value: number | null | undefined, isPercent?: boolean }) {
  if (value == null) return <span>—</span>;
  const isPos = value > 0;
  const isNeg = value < 0;
  
  let formatted = "";
  if (isPercent) {
    formatted = `${Math.abs(value).toFixed(2)}%`;
  } else {
    formatted = `$${Math.abs(value).toFixed(2)}`;
  }
  
  if (isPos) formatted = `+${formatted}`;
  if (isNeg) formatted = `-${formatted}`;

  return (
    <span className={`font-mono font-medium ${isPos ? "text-emerald-500" : isNeg ? "text-destructive" : "text-muted-foreground"}`}>
      {formatted}
    </span>
  );
}
