import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Collapsible card section used to group fields on the Invoice Review screen.
 * Built on native <details>; no JS state required.
 *
 *   <Section title="Invoice header" badge={{ tone: "warn", label: "2 uncertain" }} defaultOpen>
 *     <Section.Body> ...fields... </Section.Body>
 *   </Section>
 */

type BadgeTone = "neutral" | "warn" | "ok" | "brand";

const badgeStyles: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  warn: "bg-warning-soft text-warning",
  ok: "bg-success-soft text-success",
  brand: "bg-brand-50 text-brand-600",
};

interface SectionProps {
  title: string;
  badge?: { tone?: BadgeTone; label: string };
  defaultOpen?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function Section({
  title,
  badge,
  defaultOpen,
  children,
  className,
}: SectionProps) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        "group bg-white border border-line rounded-card shadow-1 overflow-hidden",
        className
      )}
    >
      <summary className="flex items-center gap-2.5 px-4 py-3 cursor-pointer text-[13px] font-semibold tracking-tight">
        <ChevronRight
          aria-hidden
          size={14}
          className="text-zinc-400 transition-transform group-open:rotate-90"
        />
        <span className="flex-1">{title}</span>
        {badge && (
          <span
            className={cn(
              "px-2 py-0.5 rounded-pill text-[11px] font-semibold",
              badgeStyles[badge.tone ?? "neutral"]
            )}
          >
            {badge.label}
          </span>
        )}
      </summary>
      {children && (
        <div className="border-t border-line px-4 py-3.5">{children}</div>
      )}
    </details>
  );
}
