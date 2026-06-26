/** @type {import('tailwindcss').Config} */
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces — cool neutrals, not warm. (Tailwind's default white is
        // kept untouched so opacity modifiers like `text-white/80` continue
        // to work; we only override the cooler page surfaces.)
        canvas: 'var(--canvas)',
        paper: 'var(--paper)',

        // Text + hairlines.
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
        },
        line: 'var(--line)',
        'line-2': 'var(--line-2)',

        // Brand — rust/orange. Used for accents, focus rings, and the
        // single primary action that posts to the Corcentric DMS.
        brand: {
          DEFAULT: 'var(--brand)',
          600: 'var(--brand-600)',
          100: 'var(--brand-100)',
          50: 'var(--brand-50)',
        },

        // Semantic — fintech-bright but tasteful.
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)',
        },
        info: {
          DEFAULT: 'var(--info)',
          soft: 'var(--info-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs: ['11px', { lineHeight: '16px' }],
        sm: ['12px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        md: ['15px', { lineHeight: '22px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '30px', letterSpacing: '-0.02em' }],
        '3xl': ['28px', { lineHeight: '32px', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        control: '6px',
        card: '8px',
        pill: '999px',
      },
      boxShadow: {
        1: '0 1px 2px rgb(15 17 22 / 0.04)',
        2: '0 1px 2px rgb(15 17 22 / 0.06), 0 4px 12px rgb(15 17 22 / 0.04)',
        'ring-brand': '0 0 0 3px var(--brand-100)',
        'ring-ink': '0 0 0 3px rgb(10 11 13 / 0.10)',
        rail: '0 -8px 16px rgb(15 17 22 / 0.04)',
      },
      keyframes: {
        'soft-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'soft-pulse': 'soft-pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [
    animate,
    function ({ addUtilities }) {
      addUtilities({
        '.font-num': { fontVariantNumeric: 'tabular-nums' },
        '.font-mono-num': {
          fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: 'tabular-nums',
        },
      });
    },
  ],
};
