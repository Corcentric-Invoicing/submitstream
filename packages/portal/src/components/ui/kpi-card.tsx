import { cn } from "@/lib/cn";
import { Sparkline } from "./sparkline";

/**
 * KPI tile with big number, delta indicator, and inline sparkline.
 *
 *   <KpiCard
 *     label="Total invoices"
 *     value="128"
 *     delta={{ direction: "up", text: "12%" }}
 *     deltaSubtext="vs. last 30d"
 *     sparkline={trendData}
 *     active
 *     onClick={...}
 *   />
 *
 * Active = filter is applied. Renders an Ink ring instead of a fill so the
 * brand color stays reserved for submission/CTA contexts.
 */

type Direction = "up" | "down" | "flat";

const arrow: Record<Direction, string> = {
  up: "▲",
  down: "▼",
  flat: "—",
};

const deltaColor: Record<Direction, string> = {
  up: "text-success",
  down: "text-danger",
  flat: "text-zinc-500",
};

type Tone = "ink" | "brand" | "success" | "warning" | "info" | "danger";

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  delta?: { direction: Direction; text: string };
  deltaSubtext?: string;
  sparkline?: number[];
  /** Tone for the sparkline. Default "ink" for total/primary, semantic for others. */
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export function KpiCard({
  label,
  value,
  delta,
  deltaSubtext,
  sparkline,
  tone = "ink",
  active,
  onClick,
  className,
}: KpiCardProps) {
  const interactive = Boolean(onClick);
  const Tag: React.ElementType = interactive ? "button" : "div";

  return (
    <Tag
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-2 overflow-hidden text-left",
        "px-4 py-4 bg-white border border-line rounded-card shadow-1",
        "transition-shadow",
        interactive && "cursor-pointer hover:shadow-2",
        active && "border-ink shadow-[0_0_0_1px_var(--ink)] hover:shadow-[0_0_0_1px_var(--ink),0_4px_12px_rgb(15_17_22/0.04)]",
        className
      )}
    >
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="text-3xl font-bold tracking-tight font-num leading-[1.1]">
        {value}
      </div>
      {(delta || deltaSubtext) && (
        <div className="flex items-center gap-2 text-xs">
          {delta && (
            <span className={cn("font-semibold font-num", deltaColor[delta.direction])}>
              {arrow[delta.direction]} {delta.text}
            </span>
          )}
          {deltaSubtext && <span className="text-zinc-500">{deltaSubtext}</span>}
        </div>
      )}
      {sparkline && (
        <Sparkline data={sparkline} tone={tone} className="-mb-1" />
      )}
    </Tag>
  );
}
