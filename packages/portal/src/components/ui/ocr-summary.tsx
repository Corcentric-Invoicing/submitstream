import { cn } from "@/lib/cn";

/**
 * OCR confidence summary — three stats + stacked progress bar + meta line.
 * Sits at the top of the Invoice Review screen and is the first
 * trust-bearing element a reviewer sees.
 *
 *   <OcrSummary
 *     confident={38}
 *     uncertain={7}
 *     missing={5}
 *     model="mistral · pixtral-large"
 *     latencyMs={1400}
 *   />
 */

interface OcrSummaryProps {
  confident: number;
  uncertain: number;
  missing: number;
  /** OCR model identifier surfaced as a small mono badge. */
  model?: string;
  /** Inference latency in ms; rendered as a small mono badge. */
  latencyMs?: number;
  className?: string;
}

export function OcrSummary({
  confident,
  uncertain,
  missing,
  model,
  latencyMs,
  className,
}: OcrSummaryProps) {
  const total = confident + uncertain + missing || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-4",
        "px-4 py-3 bg-white border border-line rounded-card shadow-1",
        className
      )}
    >
      <Stat tone="success" value={confident} label="Confident" />
      <Stat tone="warning" value={uncertain} label="Uncertain" />
      <Stat tone="missing" value={missing} label="Missing" />

      <div className="flex-1 min-w-[200px] flex h-1.5 rounded-pill overflow-hidden bg-zinc-100">
        <span className="block h-full bg-success" style={{ width: pct(confident) }} />
        <span className="block h-full bg-warning" style={{ width: pct(uncertain) }} />
        <span className="block h-full bg-zinc-300" style={{ width: pct(missing) }} />
      </div>

      {(model || latencyMs !== undefined) && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {model && <span>OCR by</span>}
          {model && (
            <code className="bg-zinc-100 text-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px]">
              {model}
            </code>
          )}
          {latencyMs !== undefined && (
            <>
              <span>in</span>
              <code className="bg-zinc-100 text-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px]">
                {(latencyMs / 1000).toFixed(1)}s
              </code>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  tone,
  value,
  label,
}: {
  tone: "success" | "warning" | "missing";
  value: number;
  label: string;
}) {
  const marker =
    tone === "missing"
      ? "border border-dashed border-zinc-400"
      : tone === "success"
      ? "bg-success"
      : "bg-warning";

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span className={cn("h-2 w-2 rounded-full", marker)} aria-hidden />
      <span className="text-base font-bold text-ink font-num leading-none">
        {value}
      </span>
      <span>{label}</span>
    </div>
  );
}
