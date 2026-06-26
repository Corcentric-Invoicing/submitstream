import { Link } from 'react-router-dom';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';
import { ArrowLeft } from 'lucide-react';

/**
 * Public Terms of Use page. No auth required. Shares its content with
 * the TermsAcceptanceGate modal so the canonical terms live in one place
 * — they're rendered here as a standalone document and inside the modal
 * for first-login acceptance.
 *
 * Route: /terms
 */

const TERMS_VERSION = '1.0';
const EFFECTIVE = 'April 2026';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      {/* Ink header — matches the rest of the portal */}
      <header
        className="bg-ink"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="max-w-[760px] mx-auto px-6 sm:px-8 py-6 flex items-center justify-between gap-6 flex-wrap">
          <Link to="/" className="inline-flex">
            <SubmitStreamLogo variant="dark" size="md" />
          </Link>
          <div
            className="text-[12px] text-right"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            Version{' '}
            <strong style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600 }}>
              {TERMS_VERSION}
            </strong>{' '}
            &middot; Effective {EFFECTIVE}
          </div>
        </div>
      </header>

      {/* Page heading band */}
      <div className="bg-white border-b border-line">
        <div className="max-w-[760px] mx-auto px-6 sm:px-8 py-12 sm:py-14">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-ink mb-4"
          >
            <ArrowLeft size={12} aria-hidden />
            Back to sign in
          </Link>
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-zinc-500 mb-3">
            Supplier portal
          </div>
          <h1
            className="leading-none"
            style={{
              fontFamily: "'Fraunces', 'Plus Jakarta Sans', serif",
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 'clamp(40px, 6vw, 56px)',
              letterSpacing: '-0.025em',
              color: 'var(--ink)',
            }}
          >
            Terms of Use.
          </h1>
          <p className="mt-3 text-[15px] text-zinc-500 max-w-[540px]">
            The agreement that governs use of the SubmitStream Portal for
            invoice submission to a downstream Document Management System.
          </p>
        </div>
      </div>

      {/* Body */}
      <main className="max-w-[760px] mx-auto px-6 sm:px-8 py-12 sm:py-14">
        <p
          className="text-[17px] font-semibold text-ink pb-7"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          Please review the following terms before using the Portal. By signing
          in and submitting invoices, you confirm you have read and accept
          them.
        </p>

        <Section heading="Purpose &amp; scope" number={1}>
          The SubmitStream Portal (&ldquo;Portal&rdquo;) is a convenience tool
          provided to non-EDI suppliers for the electronic submission of
          invoice data to a downstream Document Management System (DMS). Use
          of this Portal is governed by these Terms of Use and any applicable
          agreements between your organization and SubmitStream.
        </Section>

        <Section heading="Automated data extraction" number={2}>
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

        <Section heading="Supplier responsibility" number={3}>
          By using this Portal, you acknowledge and agree that:
          <ul className="mt-3 space-y-2.5">
            <BulletItem>
              You are solely responsible for{' '}
              <strong>reviewing, verifying, and correcting</strong> all
              extracted invoice data before approving it for submission.
            </BulletItem>
            <BulletItem>
              Clicking &ldquo;Approve&rdquo; or initiating submission
              constitutes your confirmation that the data is accurate and
              complete to the best of your knowledge.
            </BulletItem>
            <BulletItem>
              SubmitStream is not liable for any errors, delays, or financial
              discrepancies arising from inaccurate data submitted through this
              Portal.
            </BulletItem>
            <BulletItem>
              You will not upload documents containing malicious content,
              fraudulent information, or data you are not authorized to submit.
            </BulletItem>
          </ul>
        </Section>

        <Section heading="Data handling &amp; privacy" number={4}>
          Invoice data uploaded to this Portal is processed and stored in
          accordance with SubmitStream&rsquo;s data security policies. Uploaded
          documents and extracted data are accessible only to authorized users
          within your organization and designated downstream-system personnel.
          Data is retained in accordance with applicable retention policies.
        </Section>

        <Section heading="Acceptable use" number={5}>
          You agree to use this Portal only for its intended purpose of
          submitting legitimate invoice data. Any misuse, including but not
          limited to unauthorized access attempts, submission of fraudulent
          invoices, or interference with Portal operations, may result in
          immediate account suspension and potential legal action.
        </Section>

        <Section heading="Modifications" number={6}>
          SubmitStream reserves the right to update these Terms of Use at any
          time. Continued use of the Portal after changes constitutes
          acceptance of the revised terms. Material changes will be
          communicated through the Portal.
        </Section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-paper mt-14">
        <div className="max-w-[760px] mx-auto px-6 sm:px-8 py-7 flex items-center justify-between gap-4 flex-wrap text-[12px] text-zinc-500">
          <span className="font-mono">
            <strong className="text-ink font-semibold">
              SubmitStream Terms of Use
            </strong>{' '}
            &middot; v{TERMS_VERSION}
          </span>
          <span>Effective {EFFECTIVE}</span>
        </div>
      </footer>
    </div>
  );
}

function Section({
  number,
  heading,
  children,
}: {
  number: number;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.06em] text-brand mb-2.5">
        <span className="text-brand-600 mr-2">{number}</span>
        <span dangerouslySetInnerHTML={{ __html: heading }} />
      </h2>
      <div className="text-[15px] text-ink leading-[1.6]">{children}</div>
    </section>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-5 text-[15px] leading-[1.6]">
      <span
        aria-hidden
        className="absolute left-1 top-2.5 h-1 w-1 rounded-full"
        style={{ background: 'var(--brand)' }}
      />
      {children}
    </li>
  );
}
