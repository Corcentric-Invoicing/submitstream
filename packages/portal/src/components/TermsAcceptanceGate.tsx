import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '@/components/ui/button';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';

/**
 * Ports terms-inject.js (247 LOC) into proper React. Mounted at the
 * App level once a session exists; checks /api/me for terms_accepted_at,
 * blocks the portal with a modal until accepted, then unmounts.
 *
 * API contracts (unchanged):
 *   GET  /api/me               → returns user_profile incl. terms_accepted_at
 *   POST /api/me/accept-terms  → records acceptance, returns { accepted: true }
 */

const TERMS_VERSION = '1.0';

interface TermsAcceptanceGateProps {
  /** Re-fetch when this changes (e.g., session change). */
  userId: string;
}

export function TermsAcceptanceGate({ userId }: TermsAcceptanceGateProps) {
  const [shouldShow, setShouldShow] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Check whether the user needs to accept terms ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!token) return;
        const res = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const me = (await res.json()) as { id?: string; terms_accepted_at?: string | null };
        if (cancelled) return;
        if (me.id && !me.terms_accepted_at) {
          setShouldShow(true);
        }
      } catch {
        // Silent; will retry on next mount.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ── Body scroll lock while modal is showing ──
  useEffect(() => {
    if (!shouldShow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  async function handleAccept() {
    if (!agreed) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/me/accept-terms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = (await res.json()) as { accepted?: boolean };
      if (!res.ok || !data.accepted) {
        setError('Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      // Done — unmount.
      setShouldShow(false);
    } catch {
      setError('Network error. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(10,11,13,0.7)', backdropFilter: 'blur(2px)' }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-line"
          style={{ background: 'var(--ink)' }}
        >
          <SubmitStreamLogo variant="dark" size="md" />
          <div className="text-right">
            <div className="text-white text-base font-semibold">Terms of Use</div>
            <div
              className="text-xs"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              Version {TERMS_VERSION}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 flex-1">
          <p className="text-sm font-semibold text-ink mb-4">
            Please review and accept the following terms before continuing.
          </p>

          <Section heading="1. Purpose & Scope">
            The SubmitStream Portal ("Portal") is a convenience tool provided to
            non-EDI suppliers for the electronic submission of invoice data to
            Corcentric's Document Management System (DMS). Use of this Portal is
            governed by these Terms of Use and any applicable agreements between
            your organization and SubmitStream.
          </Section>

          <Section heading="2. Automated Data Extraction">
            The Portal uses automated optical character recognition (OCR) and
            AI-powered extraction to read invoice data from uploaded PDF
            documents. While these technologies are designed to be accurate,{' '}
            <strong>
              automated extraction may contain errors, omissions, or
              misinterpretations
            </strong>
            . SubmitStream does not guarantee the accuracy, completeness, or
            reliability of automatically extracted data.
          </Section>

          <Section heading="3. Supplier Responsibility">
            By using this Portal, you acknowledge and agree that:
            <ul className="list-disc pl-6 mt-2 space-y-1.5">
              <li>
                You are solely responsible for{' '}
                <strong>reviewing, verifying, and correcting</strong> all
                extracted invoice data before approving it for submission.
              </li>
              <li>
                Clicking "Approve" or initiating submission constitutes your
                confirmation that the data is accurate and complete to the best
                of your knowledge.
              </li>
              <li>
                SubmitStream is not liable for any errors, delays, or financial
                discrepancies arising from inaccurate data submitted through this
                Portal.
              </li>
              <li>
                You will not upload documents containing malicious content,
                fraudulent information, or data you are not authorized to submit.
              </li>
            </ul>
          </Section>

          <Section heading="4. Data Handling & Privacy">
            Invoice data uploaded to this Portal is processed and stored in
            accordance with SubmitStream's data security policies. Uploaded
            documents and extracted data are accessible only to authorized users
            within your organization and designated Corcentric personnel. Data
            is retained in accordance with applicable retention policies.
          </Section>

          <Section heading="5. Acceptable Use">
            You agree to use this Portal only for its intended purpose of
            submitting legitimate invoice data. Any misuse, including but not
            limited to unauthorized access attempts, submission of fraudulent
            invoices, or interference with Portal operations, may result in
            immediate account suspension and potential legal action.
          </Section>

          <Section heading="6. Modifications">
            SubmitStream reserves the right to update these Terms of Use at any
            time. Continued use of the Portal after changes constitutes
            acceptance of the revised terms. Material changes will be
            communicated through the Portal.
          </Section>

          <p className="text-xs text-zinc-500 mt-6">
            Version {TERMS_VERSION} — Effective April 2026
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-line px-6 py-4 bg-paper">
          <label className="flex items-start gap-2.5 cursor-pointer select-none mb-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand cursor-pointer shrink-0"
            />
            <span className="text-sm text-ink leading-relaxed">
              I have read and agree to the Terms of Use. I understand that I am
              responsible for verifying all extracted invoice data before
              submission.
            </span>
          </label>

          {error && (
            <p className="text-xs text-danger mb-3">{error}</p>
          )}

          <Button
            variant="brand"
            size="lg"
            disabled={!agreed || submitting}
            onClick={handleAccept}
            className="w-full"
          >
            {submitting ? 'Accepting…' : 'Accept & continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="text-[13px] font-bold text-brand uppercase tracking-[0.05em] mb-1.5">
        {heading}
      </h3>
      <div className="text-[13px] leading-[1.65] text-ink">{children}</div>
    </div>
  );
}
