import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import { Button } from '@/components/ui/button';

/**
 * /auth/confirm — receives the token_hash from branded auth emails and
 * exchanges it for a Supabase session, then redirects to the `next` URL
 * (defaults to /invoices).
 *
 * URL pattern this handles:
 *   https://submitstream.com/auth/confirm?token_hash=<hash>&type=<type>&next=<path>
 *
 * Replaces the default Supabase verify URL (which used the project's
 * supabase.co subdomain in every email link). With this in place the
 * emails point at our own domain instead.
 *
 * Supabase auth types we expect:
 *   invite       → new user accepting an admin invite → redirect to /set-password
 *   recovery     → password reset → /set-password (the portal has no /reset-password route)
 *   magiclink    → magic-link sign-in → /invoices (or whatever `next` is)
 *   signup       → email confirmation after self-signup → /invoices
 *   email_change → confirming new email address → /invoices with success toast
 *
 * Failure modes handled here:
 *   - Missing token_hash / type in search params → "link malformed"
 *   - Supabase bounces us to /auth/confirm#error=access_denied&error_code=otp_expired
 *     when verifyOtp rejects — we parse the hash so users see "link expired"
 *     instead of the misleading "missing required parameters"
 *   - verifyOtp returns an error → surface the specific error class
 */
export default function AuthConfirmPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<'verifying' | 'redirecting' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Supabase can bounce here with an error in the URL hash instead of
    // the expected token_hash search params. Check the hash FIRST so we
    // surface the real reason (expired / already used) instead of the
    // generic "missing required parameters" that used to fire.
    const rawHash =
      typeof window !== 'undefined' ? window.location.hash : '';
    if (rawHash && rawHash.includes('error=')) {
      const hashParams = new URLSearchParams(rawHash.substring(1));
      const errCode =
        hashParams.get('error_code') || hashParams.get('error') || '';
      const errDesc = (hashParams.get('error_description') || '').replace(
        /\+/g,
        ' ',
      );
      setState('error');
      if (errCode === 'otp_expired' || /expired/i.test(errDesc)) {
        setErrorMessage(
          "This invite / reset link has expired. Ask the person who invited you to send a fresh one — links time out after a few hours.",
        );
      } else if (errCode === 'access_denied') {
        setErrorMessage(
          "This link has already been used or is invalid. If you already have a password, sign in from the portal. Otherwise ask your admin for a new invite.",
        );
      } else {
        setErrorMessage(
          `The link is invalid: ${errDesc || errCode || 'unknown error'}. Ask your admin to send a new one.`,
        );
      }
      return;
    }

    const tokenHash = params.get('token_hash');
    const type = params.get('type') as
      | 'invite'
      | 'recovery'
      | 'magiclink'
      | 'signup'
      | 'email_change'
      | null;
    const next = params.get('next') || defaultNextFor(type);

    if (!tokenHash || !type) {
      setState('error');
      setErrorMessage('This link is missing required parameters. It may have been copied incorrectly.');
      return;
    }

    let cancelled = false;
    (async () => {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (cancelled) return;
      if (error) {
        setState('error');
        setErrorMessage(
          error.message.toLowerCase().includes('expired')
            ? 'This link has expired. Ask the person who invited you to resend it from the SubmitStream admin.'
            : error.message.toLowerCase().includes('already')
              ? 'This link has already been used. If you need to sign in again, request a new magic link from the sign-in page.'
              : `Couldn't verify the link: ${error.message}`
        );
        return;
      }
      // verifyOtp set the session in localStorage; navigate to the next URL.
      setState('redirecting');
      // Brief delay so user sees confirmation before route change
      setTimeout(() => navigate(next, { replace: true }), 200);
    })();

    return () => {
      cancelled = true;
    };
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="max-w-md w-full bg-white border border-line rounded-card shadow-1 p-7 text-center space-y-4">
        <SubmitStreamLogo size="md" />
        {state === 'verifying' && (
          <>
            <div className="inline-flex flex-col items-center gap-3 mt-3">
              <BrandedSpinner size="md" />
              <h1 className="text-base font-semibold text-ink">Verifying your link…</h1>
              <p className="text-sm text-zinc-500">One moment.</p>
            </div>
          </>
        )}
        {state === 'redirecting' && (
          <>
            <h1 className="text-base font-semibold text-ink mt-3">Signed in. Taking you there now…</h1>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="text-base font-semibold text-ink mt-3">Link didn't work</h1>
            <p className="text-sm text-zinc-600">{errorMessage}</p>
            <div className="pt-2">
              <Button variant="primary" onClick={() => navigate('/login', { replace: true })}>
                Go to sign-in
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Default redirect target per auth flow type. Used when the email template
 * doesn't include an explicit `?next=` (so older email templates that still
 * point at this route still route the user somewhere sensible).
 */
function defaultNextFor(
  type:
    | 'invite'
    | 'recovery'
    | 'magiclink'
    | 'signup'
    | 'email_change'
    | null
): string {
  switch (type) {
    case 'invite':
      return '/set-password';
    case 'recovery':
      return '/set-password';
    case 'magiclink':
      return '/invoices';
    case 'signup':
      return '/invoices';
    case 'email_change':
      return '/invoices';
    default:
      return '/invoices';
  }
}
