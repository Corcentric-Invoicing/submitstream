import { ArrowRight, Code2 } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/cn";

/**
 * Sticky bottom rail surfacing the Corcentric DMS submission state. This is
 * the most credibility-bearing element on the Invoice Review screen — it
 * shows the integration is real, not aspirational.
 *
 *   <DmsBar
 *     lastSubmission={{ ago: "2d ago", status: 200, docId: "4XJ-99821" }}
 *     onPreviewXml={() => ...}
 *     onDryRun={() => ...}
 *     onSubmit={() => ...}
 *     // For pages with a left sidebar, anchor the rail to its right edge:
 *     leftOffset={240}
 *   />
 */

interface DmsBarProps {
  lastSubmission?: {
    ago: string; // "2d ago"
    status: number; // 200
    docId?: string; // "4XJ-99821"
  };
  onPreviewXml?: () => void;
  onDryRun?: () => void;
  onSubmit?: () => void;
  /** Left edge offset in px (e.g. width of a sidebar). Default 0. */
  leftOffset?: number;
  /**
   * If set, all action buttons are disabled and a hint replaces the
   * "last submission" text. Use this for mandatory-field validation gates.
   */
  blockedReason?: string;
  className?: string;
}

export function DmsBar({
  lastSubmission,
  onPreviewXml,
  onDryRun,
  onSubmit,
  leftOffset = 0,
  blockedReason,
  className,
}: DmsBarProps) {
  const disabled = Boolean(blockedReason);
  return (
    <div
      style={{ left: leftOffset }}
      className={cn(
        "fixed right-0 bottom-0 z-50",
        "bg-white border-t border-line shadow-rail",
        className
      )}
    >
      <div className="max-w-[1280px] mx-auto px-6 py-3 flex items-center gap-4">
        <span className="text-[11px] uppercase tracking-[0.06em] font-bold text-zinc-500">
          Corcentric DMS
        </span>

        {disabled ? (
          <span className="text-xs text-warning flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full bg-warning" />
            {blockedReason}
          </span>
        ) : (
          lastSubmission && (
            <span className="text-xs text-zinc-700 flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 rounded-full",
                  lastSubmission.status >= 200 && lastSubmission.status < 300
                    ? "bg-success"
                    : "bg-danger"
                )}
              />
              Last submission · {lastSubmission.ago} ·{" "}
              <span className="font-num font-semibold">
                {lastSubmission.status}{" "}
                {lastSubmission.status >= 200 && lastSubmission.status < 300
                  ? "OK"
                  : ""}
              </span>
              {lastSubmission.docId && (
                <span className="font-mono text-zinc-500">
                  · doc {lastSubmission.docId}
                </span>
              )}
            </span>
          )
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Preview XML + Dry run intentionally NOT gated on validation:
              they're diagnostic — Preview generates the XML locally, Dry
              run runs the worker pipeline without posting to Corcentric.
              Both are how a reviewer debugs *what's* missing, so blocking
              them defeats the purpose. Only live Submit honors
              blockedReason. */}
          {onPreviewXml && (
            <Button
              variant="secondary"
              onClick={onPreviewXml}
              title="Generate the XML payload locally — no submission."
            >
              <Code2 size={13} aria-hidden />
              Preview XML
            </Button>
          )}
          {onDryRun && (
            <Button
              variant="secondary"
              onClick={onDryRun}
              title="Validate end-to-end without submitting to Corcentric."
            >
              Dry run
            </Button>
          )}
          {onSubmit && (
            <Button
              variant="brand"
              onClick={onSubmit}
              disabled={disabled}
              title={blockedReason}
            >
              Submit to Corcentric
              <ArrowRight size={13} aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
