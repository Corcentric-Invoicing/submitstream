import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Linear-style filter chip. Three modes:
 *   - inactive opener:  <FilterChip caret>Customer</FilterChip>
 *   - active w/ value:  <FilterChip active onClear={...}>Supplier · Osprey</FilterChip>
 *   - add filter:       <FilterChip>+ Add filter</FilterChip>
 */

interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  caret?: boolean;
  onClear?: () => void;
}

export function FilterChip({
  active,
  caret,
  onClear,
  className,
  children,
  ...props
}: FilterChipProps) {
  return (
    <button
      type="button"
      className={cn(
        "h-7 px-2.5 inline-flex items-center gap-1.5",
        "text-xs font-medium rounded-pill border shadow-1 transition-colors",
        active
          ? "bg-ink text-white border-ink"
          : "bg-white text-zinc-700 border-line-2 hover:border-zinc-300",
        className
      )}
      {...props}
    >
      <span>{children}</span>
      {caret && !active && (
        <ChevronDown size={12} className="text-zinc-400" aria-hidden />
      )}
      {active && onClear && (
        <span
          role="button"
          aria-label="Remove filter"
          className="opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          <X size={12} />
        </span>
      )}
    </button>
  );
}
