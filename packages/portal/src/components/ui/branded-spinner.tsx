import { cn } from '@/lib/cn';

/**
 * Branded loading spinner — the SubmitStream chevron mark with a
 * staggered opacity ripple across the strokes. Reads as data flowing
 * through, which is what the chevron is meant to evoke.
 *
 * Use anywhere we'd otherwise show a neutral spinner:
 *   <BrandedSpinner />            // default 40px
 *   <BrandedSpinner size="sm" />  // 24px
 *   <BrandedSpinner size="lg" />  // 64px
 *   <BrandedSpinner label="Processing OCR…" />  // with caption
 */

const CORAL = '#E8613C';

const SIZE: Record<'sm' | 'md' | 'lg', number> = {
  sm: 24,
  md: 40,
  lg: 64,
};

interface BrandedSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | number;
  label?: string;
  className?: string;
}

export function BrandedSpinner({ size = 'md', label, className }: BrandedSpinnerProps) {
  const px = typeof size === 'number' ? size : SIZE[size];

  // 5 strokes. Stagger their animation start by ~120ms each so the
  // pulse appears to ripple from the leading edge to the trailing edge.
  const strokes = [
    { x1: 2, y1: 3, x2: 14, y2: 21, w: 2.5, opacity: 1, delay: '0s' },
    { x1: 10, y1: 3, x2: 22, y2: 21, w: 2.5, opacity: 1, delay: '0.12s' },
    { x1: 18, y1: 3, x2: 30, y2: 21, w: 2.5, opacity: 1, delay: '0.24s' },
    { x1: 6, y1: 13, x2: 18, y2: 31, w: 2, opacity: 0.6, delay: '0.36s' },
    { x1: 14, y1: 13, x2: 26, y2: 31, w: 2, opacity: 0.6, delay: '0.48s' },
  ];

  return (
    <div
      className={cn('inline-flex flex-col items-center gap-3', className)}
      role="status"
      aria-label={label || 'Loading'}
    >
      {/* Inline keyframes — scoped to this component, no global CSS dependency. */}
      <style>{`
        @keyframes ss-flow {
          0%, 100% { opacity: 0.18; }
          50%      { opacity: var(--ss-peak, 1); }
        }
      `}</style>
      <svg
        viewBox="0 0 30 30"
        width={px}
        height={px}
        aria-hidden
        className="block"
      >
        {strokes.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={CORAL}
            strokeWidth={s.w}
            strokeLinecap="round"
            style={{
              animation: 'ss-flow 1.4s ease-in-out infinite',
              animationDelay: s.delay,
              // Each stroke peaks at its own native opacity so the trailing
              // strokes still read as secondary even at the brightest frame.
              ['--ss-peak' as string]: String(s.opacity),
            }}
          />
        ))}
      </svg>
      {label && (
        <span className="text-xs text-zinc-500 font-medium">{label}</span>
      )}
    </div>
  );
}
