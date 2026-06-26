import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Variants:
 *   primary   → ink fill, white text. Default app-wide CTA.
 *   brand     → brand fill, white text. RESERVED for the Corcentric submit
 *               action and similarly weighted "ship it" affordances.
 *   secondary → white surface, hairline border. Most table/toolbar buttons.
 *   ghost     → transparent at rest, paper on hover. Inline list actions.
 *   danger    → soft danger surface; for destructive actions only.
 *
 * Sizes:
 *   sm → h-7  (toolbar / row actions)
 *   md → h-8  (default)
 *   lg → h-9  (page-header CTAs)
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "font-medium text-[13px] leading-none whitespace-nowrap",
    "rounded-control border transition-colors",
    "shadow-1",
    "focus-visible:outline-none focus-visible:ring-0",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-ink text-white border-ink",
          "hover:bg-ink-2 hover:border-ink-2",
          "focus-visible:shadow-ring-ink",
        ],
        brand: [
          "bg-brand text-white border-brand",
          "hover:bg-brand-600 hover:border-brand-600",
          "focus-visible:shadow-ring-brand",
        ],
        secondary: [
          "bg-white text-ink border-line-2",
          "hover:border-zinc-300 hover:shadow-2",
          "focus-visible:shadow-ring-ink",
        ],
        ghost: [
          "bg-transparent text-zinc-700 border-transparent shadow-none",
          "hover:bg-zinc-50 hover:text-ink",
          "focus-visible:shadow-ring-ink",
        ],
        danger: [
          "bg-danger-soft text-danger border-danger-soft",
          "hover:bg-danger hover:text-white hover:border-danger",
          "focus-visible:shadow-ring-brand",
        ],
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-9 px-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the underlying child instead of a <button>. Useful with next/link. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
