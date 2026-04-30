import { formatDistanceToNow, format } from "date-fns";
import { ar } from "date-fns/locale";

export function formatMoney(amount: number | null | undefined, showSign = false): string {
  if (amount == null) return "—";
  const abs = Math.abs(amount).toFixed(2);
  const sign = amount < 0 ? "-" : amount > 0 && showSign ? "+" : "";
  return `${sign}$${abs}`;
}

export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  return price.toFixed(2);
}

export function formatPercent(pct: number | null | undefined, showSign = false): string {
  if (pct == null) return "—";
  const abs = Math.abs(pct).toFixed(2);
  const sign = pct < 0 ? "-" : pct > 0 && showSign ? "+" : "";
  return `${sign}${abs}%`;
}

export function formatUnits(units: number | null | undefined): string {
  if (units == null) return "—";
  return units.toFixed(2);
}

export function formatNumber(num: number | null | undefined, decimals = 2): string {
  if (num == null) return "—";
  return num.toFixed(decimals);
}

export function formatTimeRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ar });
  } catch (e) {
    return dateStr;
  }
}

export function formatTimeAbsolute(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(new Date(dateStr), "yyyy-MM-dd HH:mm:ss");
  } catch (e) {
    return dateStr;
  }
}
