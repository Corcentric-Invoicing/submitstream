import { cn } from "@/lib/cn";

/**
 * Inline SVG sparkline. Pure layout — no axis, no labels. Designed to live
 * inside a <KpiCard>. Uses currentColor for the stroke and fades the fill
 * with a CSS gradient so it can adopt the parent's tone.
 *
 *   <Sparkline data={[3, 5, 4, 8, 7, 9, 11]} tone="success" />
 */

type Tone = "ink" | "brand" | "success" | "warning" | "info" | "danger";

const stroke: Record<Tone, string> = {
  ink: "var(--ink)",
  brand: "var(--brand)",
  success: "var(--success)",
  warning: "var(--warning)",
  info: "var(--info)",
  danger: "var(--danger)",
};

interface SparklineProps {
  data: number[];
  tone?: Tone;
  className?: string;
  /** Pixel height of the SVG. Default 36. */
  height?: number;
  /** Pixel width of the viewBox; SVG scales to container width. Default 200. */
  width?: number;
}

export function Sparkline({
  data,
  tone = "ink",
  className,
  height = 36,
  width = 200,
}: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  // Pad the top a little so the line never kisses the edge.
  const yFor = (v: number) =>
    height - 4 - ((v - min) / range) * (height - 8);

  const points = data.map((v, i) => `${i * stepX} ${yFor(v)}`).join(" L ");
  const linePath = `M ${points}`;
  const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  const id = `spark-${tone}-${data.length}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height, color: stroke[tone] }}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${id})`} />
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
