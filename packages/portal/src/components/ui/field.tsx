import { forwardRef } from "react";
import { cn } from "@/lib/cn";

/**
 * The three-state field model.
 *
 *   confident → OCR returned a high-confidence value. Default look.
 *   uncertain → OCR returned a value but flagged it. Amber surface, hint shown.
 *   missing   → OCR found nothing. Dashed border, italic placeholder.
 *
 * "Required" is metadata, not a state — pass `required` to surface a small
 * "· required" suffix in the label without changing the visual treatment.
 *
 *   <Field
 *     label="Invoice date"
 *     required
 *     state="uncertain"
 *     hint="Low OCR confidence on year. Verify before submit."
 *   >
 *     <FieldInput defaultValue="2026-04-22" />
 *   </Field>
 */

export type FieldState = "confident" | "uncertain" | "missing";

const markerStyles: Record<FieldState, string> = {
  confident: "bg-success",
  uncertain: "bg-warning",
  missing: "bg-transparent border border-dashed border-zinc-400",
};

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  state?: FieldState;
  required?: boolean;
  hint?: string;
}

export function Field({
  label,
  state = "confident",
  required,
  hint,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <div
      data-state={state}
      className={cn("flex flex-col gap-1.5 min-w-0", className)}
      {...props}
    >
      <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", markerStyles[state])}
        />
        {label}
        {required && <span className="text-zinc-400 font-normal">· required</span>}
      </label>
      {children}
      {hint && (
        <span
          className={cn(
            "text-xs",
            state === "uncertain" ? "text-warning" : "text-zinc-500"
          )}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * Field-aware input. Reads its parent's data-state attribute via :where() to
 * adopt the correct visual treatment without prop drilling.
 *
 * For textarea / select we expose <FieldTextarea> and <FieldSelect> below
 * with the same data-state inheritance via a helper class.
 */
const inputBase =
  "h-9 px-2.5 w-full bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color,background-color] focus:border-brand focus:shadow-ring-brand";

const stateAdjustments =
  // Read the parent <Field>'s data-state and adjust appearance.
  "group-[[data-state=uncertain]]:bg-[#FFFAEB] group-[[data-state=uncertain]]:border-[#F0CC74] " +
  "group-[[data-state=missing]]:bg-zinc-50 group-[[data-state=missing]]:border-dashed group-[[data-state=missing]]:border-zinc-300 group-[[data-state=missing]]:text-zinc-500 group-[[data-state=missing]]:italic";

export const FieldInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
>(({ className, mono, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(inputBase, mono && "font-mono-num", className)}
    {...props}
  />
));
FieldInput.displayName = "FieldInput";

export const FieldSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(inputBase, "pr-8", className)} {...props}>
    {children}
  </select>
));
FieldSelect.displayName = "FieldSelect";

/**
 * NOTE on the data-state pattern:
 * Tailwind's group-[[data-state=...]] needs the parent to also have `group`.
 * If you prefer not to add `group` to every Field, just hard-code the state-
 * specific classes on FieldInput from the parent:
 *
 *   <FieldInput className={state === 'uncertain' && 'bg-[#FFFAEB] border-[#F0CC74]'} />
 */
