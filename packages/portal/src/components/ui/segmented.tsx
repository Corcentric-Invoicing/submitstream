import { cn } from "@/lib/cn";

/**
 * Segmented control — for status filters and view-mode toggles.
 *
 *   <Segmented>
 *     <Segmented.Item active>All <Segmented.Count>128</Segmented.Count></Segmented.Item>
 *     <Segmented.Item>Awaiting review <Segmented.Count>28</Segmented.Count></Segmented.Item>
 *   </Segmented>
 */

interface SegmentedRootProps extends React.HTMLAttributes<HTMLDivElement> {}

function Root({ className, children, ...props }: SegmentedRootProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 p-0.5",
        "bg-white border border-line rounded-control shadow-1",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

function Item({ active, className, children, ...props }: ItemProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] font-medium",
        active
          ? "bg-zinc-100 text-ink shadow-1"
          : "text-zinc-500 hover:text-ink",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium font-num px-1.5 rounded-pill bg-zinc-100 text-zinc-700 group-data-[active=true]:bg-white group-data-[active=true]:text-ink group-data-[active=true]:border group-data-[active=true]:border-line">
      {children}
    </span>
  );
}

export const Segmented = Object.assign(Root, { Item, Count });
