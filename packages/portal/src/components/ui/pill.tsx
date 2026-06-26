import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Status pill — the canonical way to render an invoice's lifecycle state.
 * Always pair with a dot for at-a-glance scannability.
 *
 *   <Pill variant="submitted">Submitted</Pill>
 *   <Pill variant="ocr" pulse>OCR running</Pill>
 */
const pillVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "px-2 py-0.5 rounded-pill",
    "text-[11px] font-semibold leading-none tracking-[0.005em]",
  ],
  {
    variants: {
      variant: {
        submitted: "bg-success-soft text-success",
        processed: "bg-brand-50 text-brand-600",
        review: "bg-warning-soft text-warning",
        ocr: "bg-info-soft text-info",
        rejected: "bg-danger-soft text-danger",
        neutral: "bg-zinc-100 text-zinc-700",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

const dotVariants = cva("h-1.5 w-1.5 rounded-full shrink-0", {
  variants: {
    variant: {
      submitted: "bg-success",
      processed: "bg-brand",
      review: "bg-warning",
      ocr: "bg-info",
      rejected: "bg-danger",
      neutral: "bg-zinc-500",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  /** Render an animated dot (use for "live" states like OCR running). */
  pulse?: boolean;
  /** Hide the leading dot. Off by default. */
  hideDot?: boolean;
}

export function Pill({
  className,
  variant,
  pulse,
  hideDot,
  children,
  ...props
}: PillProps) {
  return (
    <span className={cn(pillVariants({ variant }), className)} {...props}>
      {!hideDot && (
        <span
          className={cn(
            dotVariants({ variant }),
            pulse && "animate-soft-pulse"
          )}
        />
      )}
      {children}
    </span>
  );
}
