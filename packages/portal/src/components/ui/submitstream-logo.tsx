import { cn } from '@/lib/cn';

/**
 * SubmitStream brand mark.
 *
 * Composition: stacked-chevron icon (orange "data flow" lines) + the
 * "Submit" / "Stream" wordmark. Wordmark uses Plus Jakarta Sans 800 to
 * match the original brand sheet exactly.
 *
 * Usage:
 *   <SubmitStreamLogo />                  // light bg (default)
 *   <SubmitStreamLogo variant="dark" />   // dark bg (header)
 *   <SubmitStreamLogo mark="icon" />      // just the chevrons
 *   <SubmitStreamLogo size="sm" />        // shrinks the whole composition
 */

type Variant = 'light' | 'dark';
type Mark = 'full' | 'icon' | 'wordmark';
type Size = 'sm' | 'md' | 'lg';

interface SubmitStreamLogoProps {
  variant?: Variant;
  mark?: Mark;
  size?: Size;
  className?: string;
}

const HEIGHT_BY_SIZE: Record<Size, number> = {
  sm: 24,
  md: 32,
  lg: 44,
};

const CORAL = '#E8613C';

export function SubmitStreamLogo({
  variant = 'light',
  mark = 'full',
  size = 'md',
  className,
}: SubmitStreamLogoProps) {
  const height = HEIGHT_BY_SIZE[size];
  const submitFill = variant === 'dark' ? '#FFFFFF' : '#1A1A1A';

  if (mark === 'icon') {
    return <Chevrons height={height} className={className} />;
  }

  if (mark === 'wordmark') {
    return (
      <span
        className={cn('inline-flex items-baseline gap-0', className)}
        style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: height * 0.72,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        <span style={{ color: submitFill }}>Submit</span>
        <span style={{ color: CORAL }}>Stream</span>
      </span>
    );
  }

  // Full lockup: icon + wordmark
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Chevrons height={height} />
      <span
        style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: height * 0.72,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        <span style={{ color: submitFill }}>Submit</span>
        <span style={{ color: CORAL }}>Stream</span>
      </span>
    </span>
  );
}

/**
 * Standalone chevron mark — orange parallel diagonal lines suggesting
 * forward motion / data flow. Scales with `height`; the SVG viewBox is
 * fixed so stroke widths render predictably.
 */
function Chevrons({ height, className }: { height: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 30 30"
      width={height}
      height={height}
      aria-hidden
      className={className}
    >
      {/* Three primary diagonal strokes */}
      <line x1="2" y1="3" x2="14" y2="21" stroke={CORAL} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="10" y1="3" x2="22" y2="21" stroke={CORAL} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="18" y1="3" x2="30" y2="21" stroke={CORAL} strokeWidth="2.5" strokeLinecap="round" />
      {/* Trailing flow strokes */}
      <line x1="6" y1="13" x2="18" y2="31" stroke={CORAL} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <line x1="14" y1="13" x2="26" y2="31" stroke={CORAL} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
