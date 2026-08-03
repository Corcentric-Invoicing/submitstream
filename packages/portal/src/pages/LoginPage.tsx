import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '@/components/ui/button';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Sign-in surface — split-screen, restraint-first.
 *
 *   Left  (Ink) : tracked eyebrow → display headline → quiet lede → stats band
 *   Right (Bone): italic Fraunces "Welcome" + form + brand-coral CTA
 *
 * One typographic gesture per side. No pills, no scattered ornaments. The
 * brand glow + a single hairline divider with a chevron mark on the seam
 * are the only decorative moves.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAdminLogin, setIsAdminLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    // shouldCreateUser:false → unregistered emails fail loudly with
    // "Signups not allowed" instead of silently creating a profile-less
    // auth user that lands on the "Account not configured" screen. New
    // suppliers are onboarded via the admin's Suppliers → Users → Invite
    // flow, which creates auth.users + user_profiles atomically.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      // Friendlier copy than the raw Supabase error text.
      const msg = /signups? not allowed|user not found|otp_disabled/i.test(error.message)
        ? "We don't recognize this email. Ask your admin to send you an invite."
        : error.message;
      setError(msg);
    } else {
      setMessage("Check your email for a login link.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex relative">
      {/* ═══ Left pane — Ink ═══ */}
      <aside
        className="hidden lg:flex lg:w-[58%] xl:w-[55%] flex-col p-12 xl:p-16 relative overflow-hidden"
        style={{ background: 'var(--ink)', color: '#fff' }}
      >
        {/* Single ambient brand glow — the only decoration on this side */}
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            top: '-25%',
            left: '40%',
            width: '70%',
            height: '90%',
            background:
              'radial-gradient(ellipse at center, rgba(232,97,60,0.20) 0%, rgba(232,97,60,0) 60%)',
            filter: 'blur(40px)',
          }}
        />

        {/* Top: logo */}
        <div className="relative z-10">
          <SubmitStreamLogo variant="dark" size="lg" />
        </div>

        {/* Center: the typographic moment — let it carry the page alone */}
        <div className="relative z-10 flex-1 flex flex-col justify-center max-w-[640px] -mt-8">
          <h1
            className="font-bold tracking-[-0.035em] leading-[0.92]"
            style={{
              fontSize: 'clamp(56px, 7.5vw, 104px)',
              color: '#fff',
            }}
          >
            Invoices,
            <br />
            <span
              style={{
                fontFamily: "'Fraunces', 'Plus Jakarta Sans', serif",
                fontStyle: 'italic',
                fontWeight: 500,
                background:
                  'linear-gradient(110deg, #FCDFD3 0%, #F07A5A 45%, #E8613C 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              simplified.
            </span>
          </h1>

          <p
            className="mt-8 text-[18px] leading-[1.5] max-w-[440px]"
            style={{ color: 'rgba(255,255,255,0.62)' }}
          >
            Dual-pass OCR pulls every EDI field automatically. From inbox to
            DMS submission in minutes — not days.
          </p>
        </div>

        {/* Bottom: stats band — anchored to bottom edge with hairline */}
        <div
          className="relative z-10 pt-7 grid grid-cols-3 gap-0 max-w-[560px]"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Stat value="99.2" suffix="%" label="Extraction accuracy" />
          <Stat value="<30" suffix="s" label="Processing time" divider />
          <Stat value="79" suffix="+" label="EDI fields covered" divider />
        </div>
      </aside>

      {/* ═══ Right pane — Bone ═══ */}
      <main
        className="flex-1 flex items-center justify-center p-6 sm:p-12 relative"
        style={{ background: 'var(--canvas)' }}
      >
        <div className="w-full max-w-[400px]">
          {/* Mobile-only logo */}
          <div className="lg:hidden mb-10 flex justify-center">
            <SubmitStreamLogo size="md" />
          </div>

          {/* Italic Fraunces — typographic counterpoint to the left side */}
          <h2
            className="leading-none"
            style={{
              fontFamily: "'Fraunces', 'Plus Jakarta Sans', serif",
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: '40px',
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
            }}
          >
            Welcome back.
          </h2>
          <p className="mt-3 text-[14px] text-zinc-500">
            Sign in to your portal to continue.
          </p>

          {/* Role switcher — ghost segmented, less corporate */}
          <div className="mt-8 mb-6 flex items-center gap-1 text-[13px]">
            <RoleTab
              active={isAdminLogin}
              onClick={() => {
                setIsAdminLogin(true);
                setError('');
                setMessage('');
              }}
            >
              Admin
            </RoleTab>
            <span className="text-zinc-300">/</span>
            <RoleTab
              active={!isAdminLogin}
              onClick={() => {
                setIsAdminLogin(false);
                setError('');
                setMessage('');
              }}
            >
              Supplier
            </RoleTab>
          </div>

          {isAdminLogin ? (
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className={inputClass}
                />
              </Field>
              <Field
                label="Password"
                action={
                  <a
                    href="/forgot-password"
                    className="text-[12px] text-zinc-500 hover:text-ink"
                  >
                    Forgot?
                  </a>
                }
              >
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className={inputClass}
                />
              </Field>
              <Button
                type="submit"
                variant="brand"
                size="lg"
                disabled={loading}
                className="w-full !h-11 mt-2"
              >
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading && <ArrowRight size={14} aria-hidden />}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <Field
                label="Email"
                action={
                  // Supplier who was set up with a password (via admin
                  // Set-Password) needs a way to reset. Without this link
                  // they'd be stuck resending magic links forever.
                  <a
                    href="/forgot-password"
                    className="text-[12px] text-zinc-500 hover:text-ink"
                  >
                    Forgot password?
                  </a>
                }
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                  className={inputClass}
                />
              </Field>
              <Button
                type="submit"
                variant="brand"
                size="lg"
                disabled={loading}
                className="w-full !h-11 mt-2"
              >
                {loading ? 'Sending…' : 'Send login link'}
                {!loading && <ArrowRight size={14} aria-hidden />}
              </Button>
              <p className="text-[12px] text-zinc-500 text-center pt-1">
                We'll email a one-time link. No password needed.
              </p>
            </form>
          )}

          {error && (
            <div className="mt-5 rounded-control bg-danger-soft border border-danger/20 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          {message && (
            <div className="mt-5 rounded-control bg-success-soft border border-success/20 px-3 py-2 text-xs text-success">
              {message}
            </div>
          )}
        </div>

        {/* Tiny edge marker for taste (bottom-right) */}
        <div className="hidden lg:flex absolute bottom-6 right-8 items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
          <Link to="/terms" className="hover:text-ink transition-colors">
            Terms of use
          </Link>
          <span className="text-zinc-300">·</span>
          <span>v1.0 · {new Date().getFullYear()}</span>
        </div>
      </main>
    </div>
  );
}

const inputClass =
  'w-full h-11 px-3 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand';

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[12px] font-semibold text-ink">{label}</label>
        {action}
      </div>
      {children}
    </div>
  );
}

function RoleTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-1 text-[13px] transition-colors',
        active
          ? 'text-ink font-semibold'
          : 'text-zinc-400 hover:text-zinc-700'
      )}
    >
      {children}
    </button>
  );
}

function Stat({
  value,
  suffix,
  label,
  divider,
}: {
  value: string;
  suffix: string;
  label: string;
  divider?: boolean;
}) {
  return (
    <div
      className={cn('px-5 first:pl-0', divider && 'border-l')}
      style={divider ? { borderColor: 'rgba(255,255,255,0.08)' } : undefined}
    >
      <div className="flex items-baseline gap-0.5 mb-1.5">
        <span
          className="font-bold tracking-[-0.02em] leading-none"
          style={{ fontSize: '36px', color: '#fff' }}
        >
          {value}
        </span>
        <span
          className="font-bold leading-none"
          style={{ fontSize: '20px', color: 'rgba(255,255,255,0.55)' }}
        >
          {suffix}
        </span>
      </div>
      <div
        className="text-[10px] uppercase tracking-[0.08em]"
        style={{ color: 'rgba(255,255,255,0.45)' }}
      >
        {label}
      </div>
    </div>
  );
}
