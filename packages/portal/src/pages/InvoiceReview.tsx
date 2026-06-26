import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Invoice } from '../types/invoice';
import { STATUS_LABELS, STATUS_VARIANTS } from '../types/invoice';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Section } from '@/components/ui/section';
import { Field, FieldInput } from '@/components/ui/field';
import { OcrSummary } from '@/components/ui/ocr-summary';
import { DmsBar } from '@/components/ui/dms-bar';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import { CustomerMatchBanner } from '../components/CustomerMatchBanner';
import { ShipToMatchBanner } from '../components/ShipToMatchBanner';
import {
  X,
  FileText,
  Columns2,
  FileSignature,
  Save,
  Check,
  AlertTriangle,
  ChevronRight,
  FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Full-screen invoice review surface.
 *
 * Replaces the side-drawer pattern with a true two-pane workspace:
 *   - PDF preview (left), fetched as a blob from /api/invoices/:id/pdf
 *   - Form pane (right), with the three-state Field model derived from
 *     overall confidence + ocr_raw_response.issues[]
 *   - OcrSummary at top, sticky DmsBar at bottom (admin only)
 *   - Mode toggle [PDF | Split | Form] persisted in localStorage
 *
 * Mounting strategy: this component is a fixed-position overlay. Pop the
 * underlying scroll position by rendering on top of the InvoicesPage; close
 * by setting the parent's selectedInvoice back to null.
 */

import type { Role } from '../lib/role';
import { isAdmin as isRoleAdmin } from '../lib/role';
type ViewMode = 'pdf' | 'split' | 'form';

interface InvoiceReviewProps {
  invoice: Invoice;
  role: Role;
  onClose: () => void;
  onChanged: () => void; // tells parent to refetch the list
}

interface DmsLastSubmission {
  ago: string;
  status: number;
  docId?: string;
}

const MODE_KEY = 'submitstream:invoice-review:mode';
const SPLIT_KEY = 'submitstream:invoice-review:split';

// Split width constraints (percentage of total workspace width).
const SPLIT_MIN = 25;
const SPLIT_MAX = 75;
const SPLIT_DEFAULT = 50;

export default function InvoiceReview({
  invoice,
  role,
  onClose,
  onChanged,
}: InvoiceReviewProps) {
  const isAdmin = isRoleAdmin(role);

  // ── View mode (persisted) ──
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'split';
    const stored = window.localStorage.getItem(MODE_KEY);
    return stored === 'pdf' || stored === 'form' || stored === 'split' ? stored : 'split';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  // ── Split width (% of workspace, persisted) ──
  // Only relevant in 'split' mode. Drag the divider to adjust.
  const [splitPct, setSplitPct] = useState<number>(() => {
    if (typeof window === 'undefined') return SPLIT_DEFAULT;
    const stored = Number(window.localStorage.getItem(SPLIT_KEY));
    if (!Number.isFinite(stored) || stored < SPLIT_MIN || stored > SPLIT_MAX) {
      return SPLIT_DEFAULT;
    }
    return stored;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SPLIT_KEY, String(splitPct));
    }
  }, [splitPct]);

  // Drag-to-resize state. We attach mousemove/mouseup to window during a drag
  // so the cursor can leave the divider without losing the gesture.
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const el = workspaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct));
      setSplitPct(clamped);
    }
    function onUp() {
      setDragging(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Disable text selection + show resize cursor globally during a drag.
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging]);

  // ── Editable state ──
  const initialData = useMemo(
    () => (invoice.invoice_data || {}) as Record<string, unknown>,
    [invoice.invoice_data]
  );
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── PDF blob URL ──
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPdfError(null);
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch(`/api/invoices/${invoice.id}/pdf`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
      } catch (err) {
        if (!cancelled) {
          setPdfError(
            err instanceof Error ? err.message : 'Failed to load PDF preview.'
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, [invoice.id]);

  // ── DMS last submission ──
  // Both admin and supplier roles can submit, so both need to see the
  // "last submission" state. RLS on dms_submissions handles visibility.
  const [lastSubmission, setLastSubmission] = useState<DmsLastSubmission | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('dms_submissions')
        .select('cor_status_code, completed_at, doc_id, submission_status')
        .eq('invoice_id', invoice.id)
        .order('created_at', { ascending: false })
        .limit(1);
      const row = (data as
        | {
            cor_status_code?: number;
            completed_at?: string;
            doc_id?: string;
            submission_status?: string;
          }[]
        | null)?.[0];
      if (row) {
        setLastSubmission({
          ago: relTime(row.completed_at) ?? 'recently',
          status: row.cor_status_code ?? 0,
          docId: row.doc_id,
        });
      }
    })();
  }, [invoice.id]);

  // ── Matched customer's Corcentric DMS code ──
  // The DMS XML uses customers.cor_customer_code as the customer
  // identifier. Without it, submission fails server-side. Fetch it for
  // the matched customer so the validation memo can flag it pre-submit
  // (same UX gate as missing header fields).
  const [customerCorCode, setCustomerCorCode] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!invoice.customer_id) {
      setCustomerCorCode(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('customers')
        .select('cor_customer_code')
        .eq('id', invoice.customer_id)
        .maybeSingle();
      if (cancelled) return;
      setCustomerCorCode(
        ((data as { cor_customer_code?: string | null } | null)?.cor_customer_code ?? null)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice.customer_id]);

  // ── Supplier test_mode flag ──
  // Loaded for both roles so the test-mode banner + DmsBar pill render
  // for whoever is viewing. The list endpoint nests `supplier` in some
  // shapes but not others; safest to fetch explicitly. Defaults to
  // undefined (treated as "not in test mode") until the fetch resolves.
  const [supplierTestMode, setSupplierTestMode] = useState<boolean>(
    Boolean(invoice.supplier?.test_mode)
  );
  useEffect(() => {
    if (!invoice.supplier_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('suppliers')
        .select('test_mode')
        .eq('id', invoice.supplier_id)
        .maybeSingle();
      if (cancelled) return;
      setSupplierTestMode(Boolean((data as { test_mode?: boolean } | null)?.test_mode));
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice.id, invoice.supplier_id]);

  // ── OCR summary derivation ──
  const ocrIssues = useMemo<string[]>(() => {
    const raw = (invoice.ocr_raw_response || {}) as Record<string, unknown>;
    const issues = raw['issues'];
    return Array.isArray(issues) ? (issues as string[]) : [];
  }, [invoice.ocr_raw_response]);

  const ocrModel = useMemo<string>(() => {
    const raw = (invoice.ocr_raw_response || {}) as Record<string, unknown>;
    return invoice.ocr_provider === 'mistral'
      ? 'mistral · pixtral-large'
      : invoice.ocr_provider === 'claude'
      ? 'anthropic · claude-3-sonnet'
      : (raw['model'] as string) || invoice.ocr_provider;
  }, [invoice.ocr_provider, invoice.ocr_raw_response]);

  // ── Field updates ──
  function updateField(key: string, value: string) {
    setData((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaveStatus('idle');
  }

  function updateLineItem(index: number, key: keyof LineItem, value: string) {
    setData((prev) => {
      const items = ((prev.LineItems as LineItem[] | undefined) ?? []).map((it, i) =>
        i === index ? { ...it, [key]: value } : it
      );
      return { ...prev, LineItems: items };
    });
    setDirty(true);
    setSaveStatus('idle');
  }

  function addLineItem() {
    setData((prev) => {
      const items = ((prev.LineItems as LineItem[] | undefined) ?? []).slice();
      const nextLineNum = (items.length + 1).toString();
      items.push({ LineNumber: nextLineNum });
      return { ...prev, LineItems: items };
    });
    setDirty(true);
    setSaveStatus('idle');
  }

  function removeLineItem(index: number) {
    setData((prev) => {
      const items = ((prev.LineItems as LineItem[] | undefined) ?? []).filter(
        (_, i) => i !== index
      );
      return { ...prev, LineItems: items };
    });
    setDirty(true);
    setSaveStatus('idle');
  }

  // ── Save ──
  async function handleSave() {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ invoice_data: data }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveStatus('saved');
      setDirty(false);
      onChanged();
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  // ── Status changes (Approve / Reject) ──
  async function changeStatus(newStatus: 'processed' | 'rejected', feedback?: string) {
    const update: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'rejected' && feedback) {
      update.feedback = feedback;
      update.needs_supplier_review = true;
      update.feedback_date = new Date().toISOString();
    }
    if (newStatus === 'processed') update.needs_supplier_review = false;
    await supabase.from('invoices').update(update).eq('id', invoice.id);
    onChanged();
    onClose();
  }

  // ── DMS error state ──
  // Inline error panel inside the DMS bar. Surfaces HTTP status code,
  // Corcentric reason codes, raw response — no more alert boxes.
  const [dmsError, setDmsError] = useState<{
    kind: 'preview' | 'submit' | 'dryrun';
    httpStatus: number;
    httpStatusText: string;
    corStatusCode?: number | string | null;
    corReasonCodes?: string[];
    message: string;
    rawResponse?: unknown;
  } | null>(null);
  const [dmsBusy, setDmsBusy] = useState<'preview' | 'dryrun' | 'submit' | null>(null);

  // ── DMS actions ──
  async function previewXml() {
    setDmsBusy('preview');
    setDmsError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/invoices/${invoice.id}/corcentric-xml?format=json`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDmsError({
          kind: 'preview',
          httpStatus: res.status,
          httpStatusText: res.statusText,
          message: json?.error || 'Could not generate XML preview.',
          rawResponse: json,
        });
        return;
      }
      const xml = (json && (json.xml || json.body)) || JSON.stringify(json, null, 2);
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      setDmsError({
        kind: 'preview',
        httpStatus: 0,
        httpStatusText: 'Network error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDmsBusy(null);
    }
  }

  async function submitToDms(dryRun: boolean) {
    setDmsBusy(dryRun ? 'dryrun' : 'submit');
    setDmsError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const path = `/api/invoices/${invoice.id}/corcentric-submit${dryRun ? '?dry_run=true' : ''}`;
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      const corStatus = json?.cor_status_code ?? json?.cor_status;
      const ok =
        res.ok &&
        (!corStatus || (Number(corStatus) >= 200 && Number(corStatus) < 300));
      if (ok) {
        setLastSubmission({
          ago: 'just now',
          status: Number(corStatus ?? 200),
          docId: json?.doc_id,
        });
        onChanged();
      } else {
        // Pull every diagnostic the response exposes so the panel is useful.
        const reasons: string[] = Array.isArray(json?.cor_reason_codes)
          ? json.cor_reason_codes.map((r: unknown) =>
              typeof r === 'string' ? r : JSON.stringify(r)
            )
          : Array.isArray(json?.reason_codes)
          ? json.reason_codes
          : [];
        setDmsError({
          kind: dryRun ? 'dryrun' : 'submit',
          httpStatus: res.status,
          httpStatusText: res.statusText,
          corStatusCode: corStatus ?? null,
          corReasonCodes: reasons,
          message:
            json?.error ||
            json?.error_message ||
            (dryRun ? 'Dry run failed.' : 'Submission failed.'),
          rawResponse: json,
        });
      }
    } catch (err) {
      setDmsError({
        kind: dryRun ? 'dryrun' : 'submit',
        httpStatus: 0,
        httpStatusText: 'Network error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDmsBusy(null);
    }
  }

  // ── Field state derivation ──
  function stateFor(key: string, value: unknown): 'confident' | 'uncertain' | 'missing' {
    const empty =
      value === null ||
      value === undefined ||
      String(value).trim() === '' ||
      String(value).trim() === 'N/A';
    if (empty) return 'missing';
    if (
      invoice.confidence === 'low' ||
      ocrIssues.some((i) => i.toLowerCase().includes(key.toLowerCase()))
    ) {
      return 'uncertain';
    }
    return 'confident';
  }

  // ── Mandatory-field validation ──
  // Header- and line-level required fields per the Corcentric DMS spec.
  // Submission is blocked until all required fields are filled.
  const validation = useMemo(() => {
    const headerMissing: { key: string; label: string }[] = [];

    // Customer-link gate: the matched customer must exist. Without a
    // customer_id the worker can't build the XML at all.
    if (!invoice.customer_id) {
      headerMissing.push({
        key: '__customer_link__',
        label: 'Customer not matched yet — resolve the customer banner above',
      });
    }
    // Note on cor_customer_code: it IS required for live Corcentric DMS,
    // but during onboarding/test mode the codes don't exist yet — they
    // get populated when each customer goes live. So we don't block
    // submission on it. The worker will surface a clear DMS error if a
    // live submission lacks one. Test-mode submissions to UAT pass
    // without it.
    // customerCorCode === undefined means the fetch is in flight.

    for (const key of MANDATORY_HEADER_KEYS) {
      if (isFieldEmpty(data[key])) {
        // Find the field with its owning section, so the banner can render
        // a fully-disambiguated label. Without the section prefix, three
        // fields collapse to indistinguishable strings:
        //   BillToCode  → "Customer code"
        //   ShipToCode  → "Customer code"   ← duplicate
        //   RemitToCode → "Code"            ← bare
        // With the prefix:
        //   BillToCode  → "Bill to · Customer code"
        //   ShipToCode  → "Ship to · Customer code"
        //   RemitToCode → "Remit to · Code"
        let label = key
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/(\d)/g, ' $1')
          .trim();
        for (const section of ALL_FIELDS) {
          const f = section.fields.find((f) => f.key === key);
          if (f) {
            label = `${section.title} · ${f.label}`;
            break;
          }
        }
        headerMissing.push({ key, label });
      }
    }
    const lineItems = (data.LineItems as LineItem[] | undefined) ?? [];
    const lineMissing: { index: number; lineLabel: string; missing: string[] }[] = [];
    lineItems.forEach((it, i) => {
      const m: string[] = [];
      for (const key of MANDATORY_LINE_KEYS) {
        if (isFieldEmpty(it[key as keyof LineItem])) {
          // Resolve to the friendly label from LINE_FIELDS — falls back to
          // the raw key with spaces inserted so the banner is never empty.
          const found = LINE_FIELDS.find((f) => f.key === key);
          m.push(
            found?.label ??
              key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\d)/g, ' $1').trim()
          );
        }
      }
      if (m.length > 0) {
        lineMissing.push({
          index: i,
          lineLabel: it.LineNumber ? `Line ${it.LineNumber}` : `Line ${i + 1}`,
          missing: m,
        });
      }
    });
    if (lineItems.length === 0) {
      // No line items at all — that's also a hard fail.
      lineMissing.push({
        index: -1,
        lineLabel: 'Line items',
        missing: ['no line items extracted or added'],
      });
    }
    const totalMissing =
      headerMissing.length + lineMissing.reduce((acc, l) => acc + l.missing.length, 0);
    return { headerMissing, lineMissing, totalMissing };
  }, [data, invoice.customer_id, invoice.supplier?.name, customerCorCode]);

  // ── Math check ──
  // Sanity-check the OCR's arithmetic. If the model misread a unit price
  // or dropped a digit, the sums won't reconcile and we surface it.
  // Tolerance is one cent to absorb rounding.
  const mathCheck = useMemo(() => buildMathCheck(data), [data]);

  // ── Counts for OcrSummary ──
  const fieldCounts = useMemo(() => {
    const all = ALL_FIELDS.flatMap((s) => s.fields).map((f) => f.key);
    let confident = 0;
    let uncertain = 0;
    let missing = 0;
    for (const k of all) {
      const s = stateFor(k, data[k]);
      if (s === 'confident') confident++;
      else if (s === 'uncertain') uncertain++;
      else missing++;
    }
    return { confident, uncertain, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, invoice.confidence, ocrIssues]);

  // ── Render ──
  return (
    <div className="fixed inset-0 z-50 bg-canvas flex flex-col">
      {/* ── Top bar ── */}
      <div className="bg-ink flex items-center justify-between px-4 h-14 border-b border-line"
        style={{ borderBottomColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-control transition-colors"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.92)',
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <SubmitStreamLogo variant="dark" size="sm" />
          <div className="flex items-center gap-3">
            <span
              className="text-xs font-mono"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              {invoice.file_name}
            </span>
            <Pill variant={STATUS_VARIANTS[invoice.status]}>
              {STATUS_LABELS[invoice.status]}
            </Pill>
          </div>
        </div>

        {/* Mode toggle */}
        <div
          className="inline-flex items-center gap-0.5 p-0.5 rounded-control"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <ModeButton active={mode === 'pdf'} onClick={() => setMode('pdf')}>
            <FileText size={13} />
            PDF
          </ModeButton>
          <ModeButton active={mode === 'split'} onClick={() => setMode('split')}>
            <Columns2 size={13} />
            Split
          </ModeButton>
          <ModeButton active={mode === 'form'} onClick={() => setMode('form')}>
            <FileSignature size={13} />
            Form
          </ModeButton>
        </div>

        {/* Save / status actions */}
        <div className="flex items-center gap-2">
          {dirty && saveStatus !== 'saving' && (
            <span
              className="text-xs"
              style={{ color: 'rgba(255,255,255,0.65)' }}
            >
              Unsaved changes
            </span>
          )}
          {saveStatus === 'saved' && (
            <span
              className="text-xs inline-flex items-center gap-1"
              style={{ color: '#7DD3A4' }}
            >
              <Check size={12} /> Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="text-xs text-danger" title={saveError ?? ''}>
              Save failed
            </span>
          )}
          {isAdmin && (
            <button
              onClick={handleSave}
              disabled={!dirty || saveStatus === 'saving'}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-control text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.92)',
              }}
            >
              <Save size={13} />
              {saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* ── OCR summary strip ── */}
      <div className="px-4 py-2.5 border-b border-line bg-paper">
        <OcrSummary
          confident={fieldCounts.confident}
          uncertain={fieldCounts.uncertain}
          missing={fieldCounts.missing}
          model={ocrModel}
        />
      </div>

      {/* ── Two-pane workspace ── */}
      <div ref={workspaceRef} className="flex-1 flex overflow-hidden relative">
        {/* PDF pane */}
        {(mode === 'pdf' || mode === 'split') && (
          <div
            className="border-r border-line bg-zinc-100 shrink-0"
            style={{
              width: mode === 'pdf' ? '100%' : `${splitPct}%`,
            }}
          >
            {pdfError ? (
              <div className="h-full flex items-center justify-center p-6 text-center">
                <div className="max-w-sm">
                  <p className="text-sm font-medium text-ink">PDF unavailable</p>
                  <p className="text-xs text-zinc-500 mt-1">{pdfError}</p>
                </div>
              </div>
            ) : pdfUrl ? (
              <embed
                // PDF Open Parameters strip the native browser viewer chrome:
                //   toolbar=0   → hide the top toolbar
                //   navpanes=0  → hide the page-thumbnail / outline sidebar
                //   scrollbar=0 → hide the embedded scrollbar
                //   view=FitH   → fit to width on first paint
                src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                type="application/pdf"
                className="w-full h-full"
                style={{ pointerEvents: dragging ? 'none' : 'auto' }}
                title="Invoice PDF preview"
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-zinc-200 border-t-ink" />
              </div>
            )}
          </div>
        )}

        {/* Drag handle (split mode only) — 6px hit area, 1px visible line */}
        {mode === 'split' && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            onMouseDown={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDoubleClick={() => setSplitPct(SPLIT_DEFAULT)}
            className="relative shrink-0 group cursor-col-resize"
            style={{ width: 6, marginLeft: -3, marginRight: -3, zIndex: 10 }}
            title="Drag to resize · double-click to reset"
          >
            <div
              className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors"
              style={{
                background: dragging ? 'var(--brand)' : 'var(--line-2)',
              }}
            />
            {/* Subtle grip indicator */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity"
              aria-hidden
            >
              <span className="block w-0.5 h-0.5 rounded-full bg-zinc-500" />
              <span className="block w-0.5 h-0.5 rounded-full bg-zinc-500" />
              <span className="block w-0.5 h-0.5 rounded-full bg-zinc-500" />
              <span className="block w-0.5 h-0.5 rounded-full bg-zinc-500" />
            </div>
          </div>
        )}

        {/* Form pane */}
        {(mode === 'form' || mode === 'split') && (
          <div
            className="overflow-y-auto shrink-0"
            style={{
              width: mode === 'form' ? '100%' : `${100 - splitPct}%`,
            }}
          >
            <div className="max-w-2xl mx-auto p-5 pb-24 space-y-3">
              {/* Customer-match banner — surfaces when invoice flag says
                  the OCR'd Bill To didn't confidently match an existing
                  customer. Lets the reviewer link a candidate or create
                  a new customer pre-filled from the BillTo extraction. */}
              {invoice.needs_customer_review && (
                <CustomerMatchBanner
                  invoiceId={invoice.id}
                  supplierId={invoice.supplier_id}
                  onResolved={onChanged}
                />
              )}

              {/* Ship-to match banner — sibling to the customer banner.
                  Only relevant once the customer is resolved (otherwise
                  we don't know which customer's ship-tos to compare
                  against). Reads ShipTo* from invoice_data so the worker
                  matcher and the UI agree on the source of truth. */}
              {invoice.needs_ship_to_review && invoice.customer_id && (
                <ShipToMatchBanner
                  invoiceId={invoice.id}
                  customerId={invoice.customer_id}
                  extracted={{
                    name: (data['ShipToName'] as string | undefined) ?? null,
                    address1: (data['ShipToAddress1'] as string | undefined) ?? null,
                    address2: (data['ShipToAddress2'] as string | undefined) ?? null,
                    city: (data['ShipToCity'] as string | undefined) ?? null,
                    state: (data['ShipToState'] as string | undefined) ?? null,
                    zip: (data['ShipToZip'] as string | undefined) ?? null,
                  }}
                  onResolved={onChanged}
                />
              )}

              {/* Test-mode banner — supplier is flagged test_mode, so the
                  live "Submit to Corcentric" path is suppressed end-to-end
                  (UI hides the button; the worker also coerces dry_run=true
                  on the server side). Sits above mandatory-fields so
                  reviewers see this state first. */}
              {supplierTestMode && (
                <TestModeBanner supplierName={invoice.supplier?.name} />
              )}

              {/* Math check — reconciles line totals → subtotal → grand
                  total to flag OCR arithmetic errors. */}
              <MandatoryFieldsBanner validation={validation} />

              <MathCheckPanel result={mathCheck} />


              {ALL_FIELDS.map((section) => {
                const sectionMissing = section.fields.filter(
                  (f) => stateFor(f.key, data[f.key]) === 'missing'
                ).length;
                const sectionUncertain = section.fields.filter(
                  (f) => stateFor(f.key, data[f.key]) === 'uncertain'
                ).length;
                const badge =
                  sectionUncertain > 0
                    ? { tone: 'warn' as const, label: `${sectionUncertain} uncertain` }
                    : sectionMissing === section.fields.length
                    ? { tone: 'neutral' as const, label: 'all missing' }
                    : sectionMissing > 0
                    ? {
                        tone: 'neutral' as const,
                        label: `${sectionMissing} missing`,
                      }
                    : undefined;
                return (
                  <Section
                    key={section.title}
                    title={section.title}
                    badge={badge}
                    defaultOpen
                  >
                    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                      {section.fields.map((f) => {
                        const val = data[f.key];
                        const state = stateFor(f.key, val);
                        return (
                          <div
                            key={f.key}
                            className={cn('group', f.full && 'col-span-2')}
                          >
                            <Field
                              label={f.label}
                              required={f.required}
                              state={state}
                              hint={f.hint}
                            >
                              <FieldInput
                                value={String(val ?? '')}
                                onChange={(e) => updateField(f.key, e.target.value)}
                                disabled={!isAdmin}
                                placeholder={state === 'missing' ? 'Empty' : ''}
                                mono={f.mono}
                              />
                            </Field>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                );
              })}

              {/* Line items — editable per-line cards. Each line shows
                  all 14 OCR-schema fields grouped by row, with required
                  fields marked. Add/remove rows with the buttons in the
                  section header. */}
              {(() => {
                const lineItems = (data.LineItems as LineItem[] | undefined) ?? [];
                const lineSum = lineItems.reduce((acc, it) => {
                  const qty = Number(it.Quantity ?? 0);
                  const price = Number(it.UnitPrice ?? 0);
                  if (Number.isFinite(qty) && Number.isFinite(price)) {
                    return acc + qty * price;
                  }
                  return acc;
                }, 0);
                return (
                  <Section
                    title="Line items"
                    badge={{
                      tone: 'neutral',
                      label: `${lineItems.length} ${
                        lineItems.length === 1 ? 'item' : 'items'
                      }`,
                    }}
                    defaultOpen={lineItems.length > 0}
                  >
                    {lineItems.length === 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs text-zinc-500 italic">
                          OCR didn't extract any line items.
                        </p>
                        {isAdmin && (
                          <Button variant="secondary" size="sm" onClick={addLineItem}>
                            + Add line item
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {lineItems.map((it, i) => (
                          <LineItemCard
                            key={i}
                            index={i}
                            item={it}
                            disabled={!isAdmin}
                            onChange={(key, value) => updateLineItem(i, key, value)}
                            onRemove={isAdmin ? () => removeLineItem(i) : undefined}
                          />
                        ))}
                        {isAdmin && (
                          <div className="flex items-center justify-between pt-1">
                            <Button variant="secondary" size="sm" onClick={addLineItem}>
                              + Add line item
                            </Button>
                            {lineSum > 0 && (
                              <div className="text-xs text-zinc-500">
                                Sum of line totals:{' '}
                                <span className="font-mono-num font-semibold text-ink">
                                  ${lineSum.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </Section>
                );
              })()}

              {/* Feedback / approve / reject */}
              {isAdmin && invoice.status !== 'processed' && (
                <div className="bg-white border border-line rounded-card shadow-1 p-4 mt-4">
                  <h3 className="text-sm font-semibold text-ink mb-2">Decision</h3>
                  <p className="text-xs text-zinc-500 mb-3">
                    Approve to mark as processed and move on. Reject to send back to the
                    supplier with feedback.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => changeStatus('processed')}>
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        const fb = window.prompt('Feedback for the supplier:');
                        if (fb) changeStatus('rejected', fb);
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              {invoice.feedback && (
                <div className="bg-warning-soft border border-warning/20 rounded-card p-3 mt-4">
                  <h4 className="text-xs font-semibold text-warning uppercase tracking-wider mb-1">
                    Previous feedback
                  </h4>
                  <p className="text-sm text-ink whitespace-pre-wrap">{invoice.feedback}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky DMS error panel (only when something failed) ── */}
      {dmsError && (
        <DmsErrorPanel error={dmsError} onDismiss={() => setDmsError(null)} />
      )}

      {/* ── Sticky DMS bar (visible to admin and supplier; suppliers
          submit through their assigned community's credentials, with
          test-mode acting as the UAT guardrail). Hidden once the
          invoice is rejected — there's nothing to submit then. ── */}
      {invoice.status !== 'rejected' && (
        <DmsBar
          lastSubmission={lastSubmission ?? undefined}
          onPreviewXml={previewXml}
          onDryRun={() => submitToDms(true)}
          onSubmit={() => submitToDms(false)}
          blockedReason={
            validation.totalMissing > 0
              ? `${validation.totalMissing} mandatory field${
                  validation.totalMissing === 1 ? '' : 's'
                } missing — fix before submit`
              : undefined
          }
        />
      )}

      {/* Visual hint: which DMS action is in flight (overlays the buttons). */}
      {dmsBusy && (
        <div
          className="fixed bottom-[68px] right-6 z-50 inline-flex items-center gap-2 px-3 py-1.5 bg-ink text-white text-xs rounded-control shadow-2"
          aria-live="polite"
        >
          <BrandedSpinner size={14} />
          {dmsBusy === 'preview'
            ? 'Generating XML preview…'
            : dmsBusy === 'dryrun'
            ? 'Running DMS dry-run…'
            : 'Submitting to Corcentric DMS…'}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// DMS error panel — sticks above the bottom rail when anything fails
// ──────────────────────────────────────────────────────────

function DmsErrorPanel({
  error,
  onDismiss,
}: {
  error: {
    kind: 'preview' | 'submit' | 'dryrun';
    httpStatus: number;
    httpStatusText: string;
    corStatusCode?: number | string | null;
    corReasonCodes?: string[];
    message: string;
    rawResponse?: unknown;
  };
  onDismiss: () => void;
}) {
  const kindLabel =
    error.kind === 'preview'
      ? 'XML preview failed'
      : error.kind === 'dryrun'
      ? 'Dry run failed'
      : 'Submission failed';

  return (
    <div
      className="fixed left-0 right-0 bottom-[60px] z-40 bg-danger-soft border-t border-b border-danger/25"
      role="alert"
    >
      <div className="max-w-[1280px] mx-auto px-6 py-3 flex items-start gap-3">
        <span className="shrink-0 text-danger mt-0.5">
          <AlertTriangle size={16} aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-danger">{kindLabel}</span>
            {error.httpStatus > 0 && (
              <span className="text-[11px] font-mono text-danger/85">
                HTTP {error.httpStatus} {error.httpStatusText}
              </span>
            )}
            {error.corStatusCode != null && error.corStatusCode !== '' && (
              <span className="text-[11px] font-mono text-danger/85">
                · Corcentric {String(error.corStatusCode)}
              </span>
            )}
          </div>
          <div className="text-[12px] text-zinc-700 mt-0.5">{error.message}</div>
          {error.corReasonCodes && error.corReasonCodes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {error.corReasonCodes.map((r, i) => (
                <li key={i} className="text-[11px] font-mono text-danger/85">
                  · {r}
                </li>
              ))}
            </ul>
          )}
          {error.rawResponse !== undefined && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-ink select-none">
                Raw response
              </summary>
              <pre className="mt-1.5 text-[10px] font-mono bg-white border border-line rounded-control p-2 max-h-40 overflow-auto whitespace-pre-wrap text-zinc-700">
                {typeof error.rawResponse === 'string'
                  ? error.rawResponse
                  : JSON.stringify(error.rawResponse, null, 2)}
              </pre>
            </details>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-zinc-500 hover:text-ink p-1 -m-1"
          aria-label="Dismiss error"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function ModeButton({
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
      className="inline-flex items-center gap-1.5 px-3 h-7 rounded text-[12px] font-medium transition-colors"
      style={
        active
          ? {
              background: 'rgba(255,255,255,0.16)',
              color: 'rgba(255,255,255,0.95)',
            }
          : {
              background: 'transparent',
              color: 'rgba(255,255,255,0.62)',
            }
      }
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Test-mode banner — shown when the supplier is flagged test_mode.
// Live submission is suppressed; preview + dry-run remain available.
// ──────────────────────────────────────────────────────────

function TestModeBanner({ supplierName }: { supplierName?: string }) {
  return (
    <div className="bg-warning-soft border border-warning/25 rounded-card px-3 py-2 flex items-center gap-2">
      <FlaskConical
        size={13}
        className="text-warning shrink-0"
        aria-hidden
      />
      <span className="text-[12px] text-zinc-700">
        <span className="font-semibold text-warning">Test invoice</span>
        {' — '}
        {supplierName ?? 'this supplier'} is still in onboarding. Flip
        <span className="font-mono text-[11px] mx-0.5">Test mode</span>
        off in <span className="font-mono text-[11px]">Admin → Suppliers</span> when
        they're ready for go-live.
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Mandatory-fields banner — top of form pane
// ──────────────────────────────────────────────────────────

function MandatoryFieldsBanner({
  validation,
}: {
  validation: {
    headerMissing: { key: string; label: string }[];
    lineMissing: { index: number; lineLabel: string; missing: string[] }[];
    totalMissing: number;
  };
}) {
  if (validation.totalMissing === 0) {
    return (
      <div className="bg-success-soft border border-success/20 rounded-card px-3 py-2 flex items-center gap-2">
        <Check size={14} className="text-success shrink-0" aria-hidden />
        <span className="text-[12px] font-medium text-success">
          All mandatory fields populated — ready to submit.
        </span>
      </div>
    );
  }

  return (
    <details
      open
      className="group bg-danger-soft border border-danger/25 rounded-card overflow-hidden"
    >
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[12px] font-semibold text-danger select-none">
        <ChevronRight
          size={13}
          aria-hidden
          className="transition-transform group-open:rotate-90 opacity-70"
        />
        <AlertTriangle size={13} aria-hidden />
        <span>
          {validation.totalMissing} mandatory field
          {validation.totalMissing === 1 ? '' : 's'} missing — required by Corcentric DMS
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 border-t border-danger/15 text-[12px] text-zinc-700 space-y-2.5">
        {validation.headerMissing.length > 0 && (
          <div>
            <div className="font-semibold text-danger text-[11px] uppercase tracking-[0.06em] mb-1">
              Header fields
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {validation.headerMissing.map((m) => (
                <li key={m.key} className="flex items-center gap-1.5">
                  <span aria-hidden className="h-1 w-1 rounded-full bg-danger" />
                  {m.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        {validation.lineMissing.length > 0 && (
          <div>
            <div className="font-semibold text-danger text-[11px] uppercase tracking-[0.06em] mb-1">
              Line items
            </div>
            <ul className="space-y-0.5">
              {validation.lineMissing.map((l) => (
                <li key={l.index} className="flex items-start gap-1.5">
                  <span
                    aria-hidden
                    className="h-1 w-1 rounded-full bg-danger mt-1.5 shrink-0"
                  />
                  <span>
                    <span className="font-medium">{l.lineLabel}:</span>{' '}
                    <span className="text-zinc-600">{l.missing.join(', ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

// ──────────────────────────────────────────────────────────
// Math check
// ──────────────────────────────────────────────────────────

const PENNY = 0.01; // tolerance for floating-point rounding

interface MathCheckLineFinding {
  index: number;
  lineLabel: string;
  qtyTimesPrice: number;
  declaredAmount: number;
  delta: number;
}

interface MathCheckResult {
  status: 'ok' | 'warning' | 'incomplete';
  // Sub-checks. Each is one of: 'ok' (balances), 'off' (delta exceeds
  // tolerance), 'na' (missing data, can't check).
  lineMath: { state: 'ok' | 'off' | 'na'; findings: MathCheckLineFinding[] };
  linesVsSubtotal: {
    state: 'ok' | 'off' | 'na';
    sumOfLines: number;
    declaredSubtotal: number | null;
    delta: number;
  };
  totalReconciliation: {
    state: 'ok' | 'off' | 'na';
    expectedTotal: number;
    declaredTotal: number | null;
    delta: number;
    breakdown: {
      subtotal: number;
      tax: number;
      freight: number;
      misc: number;
      discount: number;
    };
  };
}

function num(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function buildMathCheck(data: Record<string, unknown>): MathCheckResult {
  const lineItems = (data.LineItems as LineItem[] | undefined) ?? [];

  // ── 1. Per-line: Qty × UnitPrice vs LineItemAmount ──
  const findings: MathCheckLineFinding[] = [];
  let perLineCheckable = 0;
  for (let i = 0; i < lineItems.length; i++) {
    const it = lineItems[i];
    const qty = num(it.Quantity);
    const price = num(it.UnitPrice);
    const declared = num(it.LineItemAmount);
    if (qty > 0 && price > 0 && declared > 0) {
      perLineCheckable++;
      const computed = qty * price;
      const delta = computed - declared;
      if (Math.abs(delta) > PENNY) {
        findings.push({
          index: i,
          lineLabel: it.LineNumber ? `Line ${it.LineNumber}` : `Line ${i + 1}`,
          qtyTimesPrice: computed,
          declaredAmount: declared,
          delta,
        });
      }
    }
  }
  const lineMathState: 'ok' | 'off' | 'na' =
    perLineCheckable === 0 ? 'na' : findings.length === 0 ? 'ok' : 'off';

  // ── 2. Σ(line items) vs Subtotal ──
  const sumOfLines = lineItems.reduce((acc, it) => {
    const qty = num(it.Quantity);
    const price = num(it.UnitPrice);
    return acc + (qty > 0 && price > 0 ? qty * price : 0);
  }, 0);
  const subtotalRaw =
    num(data.Subtotal) ||
    num((data as { SubTotal?: unknown }).SubTotal) ||
    num(data.DiscountableAmount);
  const linesVsSubtotalDelta = sumOfLines - subtotalRaw;
  const linesVsSubtotalState: 'ok' | 'off' | 'na' =
    sumOfLines === 0 || subtotalRaw === 0
      ? 'na'
      : Math.abs(linesVsSubtotalDelta) <= PENNY
      ? 'ok'
      : 'off';

  // ── 3. Subtotal + tax + freight + misc - discount vs InvoiceTotal ──
  const tax =
    num(data.FederalTaxAmount) +
    num(data.StateTaxAmount) +
    num(data.LocalTaxAmount);
  const freight = num(data.FreightAmount);
  const misc = num(data.MiscChargeAmount) + num(data.MiscItemAmount) + num(data.MiscSumAmount);
  const discount = num(data.DiscountAmount);
  // Use the largest of (declared subtotal, computed sumOfLines) so we
  // can still reconcile when OCR didn't pull a Subtotal but the line
  // items add up.
  const subForRecon = subtotalRaw || sumOfLines;
  const expectedTotal = subForRecon + tax + freight + misc - discount;
  const declaredTotal = num(data.InvoiceTotal);
  const totalDelta = expectedTotal - declaredTotal;
  const totalReconState: 'ok' | 'off' | 'na' =
    declaredTotal === 0 || subForRecon === 0
      ? 'na'
      : Math.abs(totalDelta) <= PENNY
      ? 'ok'
      : 'off';

  // ── Roll up to overall status ──
  const states = [lineMathState, linesVsSubtotalState, totalReconState];
  const hasOff = states.some((s) => s === 'off');
  const hasOk = states.some((s) => s === 'ok');
  const status: MathCheckResult['status'] = hasOff
    ? 'warning'
    : hasOk
    ? 'ok'
    : 'incomplete';

  return {
    status,
    lineMath: { state: lineMathState, findings },
    linesVsSubtotal: {
      state: linesVsSubtotalState,
      sumOfLines,
      declaredSubtotal: subtotalRaw || null,
      delta: linesVsSubtotalDelta,
    },
    totalReconciliation: {
      state: totalReconState,
      expectedTotal,
      declaredTotal: declaredTotal || null,
      delta: totalDelta,
      breakdown: { subtotal: subForRecon, tax, freight, misc, discount },
    },
  };
}

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function MathCheckPanel({ result }: { result: MathCheckResult }) {
  if (result.status === 'incomplete') return null;

  const ok = result.status === 'ok';
  const tone = ok ? 'success' : 'warning';
  const Icon = ok ? Check : AlertTriangle;

  return (
    <details
      open={!ok}
      className={cn(
        'group rounded-card overflow-hidden border',
        ok ? 'bg-success-soft border-success/20' : 'bg-warning-soft border-warning/20'
      )}
    >
      <summary
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer text-xs font-semibold',
          ok ? 'text-success' : 'text-warning'
        )}
      >
        <ChevronRight
          aria-hidden
          size={13}
          className="transition-transform group-open:rotate-90 opacity-60"
        />
        <Icon size={13} aria-hidden />
        <span>
          Math check: {ok ? 'all sums reconcile' : 'discrepancy found — verify before submit'}
        </span>
      </summary>
      <div
        className={cn(
          'px-3 pb-3 pt-1.5 border-t text-xs',
          ok ? 'border-success/15 text-zinc-700' : 'border-warning/15 text-zinc-700'
        )}
      >
        <ul className="space-y-2">
          <CheckRow
            state={result.lineMath.state}
            label="Per-line totals"
            okHint="Qty × Unit price equals declared Amount on every line."
            naHint="Lines don't have both Qty/Unit price and Amount populated — can't check."
            offHint={
              result.lineMath.findings.length > 0 ? (
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {result.lineMath.findings.map((f) => (
                    <li key={f.index}>
                      <span className="text-zinc-700">{f.lineLabel}:</span>{' '}
                      computed {fmt(f.qtyTimesPrice)} vs declared {fmt(f.declaredAmount)}{' '}
                      <span className={tone === 'warning' ? 'text-warning font-semibold' : ''}>
                        (Δ {fmt(Math.abs(f.delta))})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                'One or more lines have a price-times-quantity mismatch.'
              )
            }
          />
          <CheckRow
            state={result.linesVsSubtotal.state}
            label="Line items → Subtotal"
            okHint={`Σ(line items) = ${fmt(result.linesVsSubtotal.sumOfLines)} matches the declared Subtotal.`}
            naHint="No declared Subtotal or no line items — can't check."
            offHint={
              <>
                Line items sum to{' '}
                <span className="font-mono">
                  {fmt(result.linesVsSubtotal.sumOfLines)}
                </span>{' '}
                but Subtotal reads{' '}
                <span className="font-mono">
                  {result.linesVsSubtotal.declaredSubtotal != null
                    ? fmt(result.linesVsSubtotal.declaredSubtotal)
                    : '—'}
                </span>{' '}
                <span className="font-semibold">
                  (Δ {fmt(Math.abs(result.linesVsSubtotal.delta))})
                </span>
              </>
            }
          />
          <CheckRow
            state={result.totalReconciliation.state}
            label="Subtotal + tax + freight − discount → Invoice total"
            okHint={`${fmt(result.totalReconciliation.breakdown.subtotal)} + tax ${fmt(result.totalReconciliation.breakdown.tax)} + frt ${fmt(result.totalReconciliation.breakdown.freight)} − disc ${fmt(result.totalReconciliation.breakdown.discount)} = ${fmt(result.totalReconciliation.expectedTotal)} matches Invoice total.`}
            naHint="Missing Invoice total or Subtotal — can't reconcile."
            offHint={
              <>
                Expected{' '}
                <span className="font-mono">
                  {fmt(result.totalReconciliation.expectedTotal)}
                </span>{' '}
                but Invoice total reads{' '}
                <span className="font-mono">
                  {result.totalReconciliation.declaredTotal != null
                    ? fmt(result.totalReconciliation.declaredTotal)
                    : '—'}
                </span>{' '}
                <span className="font-semibold">
                  (Δ {fmt(Math.abs(result.totalReconciliation.delta))})
                </span>
              </>
            }
          />
        </ul>
      </div>
    </details>
  );
}

function CheckRow({
  state,
  label,
  okHint,
  offHint,
  naHint,
}: {
  state: 'ok' | 'off' | 'na';
  label: string;
  okHint: React.ReactNode;
  offHint: React.ReactNode;
  naHint: React.ReactNode;
}) {
  const dotClass =
    state === 'ok'
      ? 'bg-success'
      : state === 'off'
      ? 'bg-warning'
      : 'border border-dashed border-zinc-400 bg-transparent';
  const labelClass =
    state === 'ok' ? 'text-success' : state === 'off' ? 'text-warning' : 'text-zinc-500';

  return (
    <li className="flex gap-2 items-start">
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full mt-1.5 shrink-0', dotClass)} />
      <div className="min-w-0">
        <div className={cn('font-medium text-[12px]', labelClass)}>{label}</div>
        <div className="text-[11px] text-zinc-600 mt-0.5">
          {state === 'ok' ? okHint : state === 'off' ? offHint : naHint}
        </div>
      </div>
    </li>
  );
}

/**
 * Editable per-line card. Mirrors the live deployed layout: a small
 * "Line N" pill, then field rows grouped by what reviewers naturally
 * scan for — description first (full width), then qty/UOM/price/amount,
 * then part numbers, then container + packaging, then weights.
 */
function LineItemCard({
  index,
  item,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  item: LineItem;
  disabled: boolean;
  onChange: (key: keyof LineItem, value: string) => void;
  onRemove?: () => void;
}) {
  const lineLabel = item.LineNumber ? `Line ${item.LineNumber}` : `Line ${index + 1}`;
  const inputClass =
    'w-full h-9 px-2.5 bg-white border border-line-2 rounded-control text-[13px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand disabled:bg-paper disabled:text-zinc-500';

  return (
    <div className="border border-line rounded-card bg-paper p-3.5">
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-semibold bg-brand-50 text-brand-600">
          {lineLabel}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-[11px] text-zinc-500 hover:text-danger transition-colors px-2 py-0.5"
            aria-label={`Remove ${lineLabel}`}
          >
            Remove
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
        {LINE_FIELDS.map((f) => {
          const val = item[f.key];
          const empty = val === undefined || val === null || String(val).trim() === '';
          return (
            <div key={f.key} className={f.full ? 'col-span-3' : ''}>
              <label className="flex items-center gap-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.04em] mb-1">
                {f.label}
                {f.req && <span className="text-danger">*</span>}
              </label>
              <input
                type="text"
                value={String(val ?? '')}
                onChange={(e) => onChange(f.key, e.target.value)}
                disabled={disabled}
                placeholder={empty && f.req ? 'Required' : ''}
                className={cn(
                  inputClass,
                  f.mono && 'font-mono-num',
                  f.req && empty && '!border-danger'
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function relTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
  full?: boolean;
  mono?: boolean;
}

interface SectionDef {
  title: string;
  fields: FieldDef[];
}

/**
 * Field map keyed against the OCR schema produced by ocr-pipeline. Critical
 * fields (required) flag the row in the OcrSummary if missing. The schema
 * matches what Mistral / Claude extract — see worker-deploy/src/ocr-pipeline
 * for the canonical field list (InvoiceNumber, PONumber, VendorAddress1, etc).
 */
const ALL_FIELDS: SectionDef[] = [
  {
    title: 'Invoice header',
    fields: [
      { key: 'InvoiceNumber', label: 'Invoice number', required: true, mono: true },
      { key: 'InvoiceDate', label: 'Invoice date', required: true, mono: true },
      { key: 'DueDate', label: 'Due date', mono: true },
      { key: 'PONumber', label: 'PO number', mono: true },
      { key: 'PODate', label: 'PO date', mono: true },
      { key: 'ShipDate', label: 'Ship date', mono: true },
      { key: 'Currency', label: 'Currency' },
      { key: 'NetDays', label: 'Net days', mono: true },
      { key: 'TermsDescription', label: 'Payment terms', full: true },
    ],
  },
  {
    title: 'Totals',
    fields: [
      // Subtotal is OCR-extracted into the canonical `Subtotal` field
      // (post-prompt tuning). On legacy invoices it'll be blank — same
      // treatment as any other field that wasn't on the invoice.
      { key: 'Subtotal', label: 'Subtotal', mono: true },
      { key: 'FreightAmount', label: 'Freight', mono: true },
      { key: 'DiscountAmount', label: 'Discount', mono: true },
      { key: 'DiscountPercent', label: 'Discount %', mono: true },
      { key: 'FederalTaxAmount', label: 'Federal tax', mono: true },
      { key: 'StateTaxAmount', label: 'State tax', mono: true },
      { key: 'LocalTaxAmount', label: 'Local tax', mono: true },
      { key: 'MiscChargeAmount', label: 'Misc charges', mono: true },
      { key: 'InvoiceTotal', label: 'Invoice total', required: true, mono: true },
    ],
  },
  {
    title: 'Vendor',
    fields: [
      { key: 'VendorName', label: 'Name', required: true, full: true },
      { key: 'VendorCode', label: 'Vendor code', mono: true },
      { key: 'VendorAddress1', label: 'Address line 1', full: true },
      { key: 'VendorAddress2', label: 'Address line 2', full: true },
      { key: 'VendorCity', label: 'City' },
      { key: 'VendorState', label: 'State' },
      { key: 'VendorZip', label: 'Zip' },
    ],
  },
  {
    title: 'Bill to',
    fields: [
      { key: 'BillToName', label: 'Name', full: true },
      { key: 'BillToCode', label: 'Customer code', mono: true },
      { key: 'BillToAddress1', label: 'Address line 1', full: true },
      { key: 'BillToAddress2', label: 'Address line 2', full: true },
      { key: 'BillToCity', label: 'City' },
      { key: 'BillToState', label: 'State' },
    ],
  },
  {
    title: 'Ship to',
    fields: [
      { key: 'ShipToName', label: 'Name', full: true },
      { key: 'ShipToCode', label: 'Customer code', mono: true },
      { key: 'ShipToAddress1', label: 'Address line 1', full: true },
      { key: 'ShipToAddress2', label: 'Address line 2', full: true },
      { key: 'ShipToCity', label: 'City' },
      { key: 'ShipToState', label: 'State' },
      { key: 'ShipToZip', label: 'Zip' },
    ],
  },
  {
    title: 'Remit to',
    fields: [
      { key: 'RemitToName', label: 'Name', full: true },
      { key: 'RemitToCode', label: 'Code', mono: true },
      { key: 'RemitToAddress1', label: 'Address line 1', full: true },
      { key: 'RemitToAddress2', label: 'Address line 2', full: true },
      { key: 'RemitToCity', label: 'City' },
      { key: 'RemitToState', label: 'State' },
    ],
  },
  {
    title: 'References',
    fields: [
      { key: 'BillOfLading', label: 'Bill of lading', mono: true },
      { key: 'PackingSlip', label: 'Packing slip', mono: true },
      { key: 'ReferenceNumber1', label: 'Reference 1', mono: true },
      { key: 'ReferenceQualifier1', label: 'Qualifier 1' },
      { key: 'ReferenceNumber2', label: 'Reference 2', mono: true },
      { key: 'ReferenceQualifier2', label: 'Qualifier 2' },
    ],
  },
];

interface LineItem {
  LineNumber?: string | number;
  Quantity?: string | number;
  UOM?: string;
  UnitPrice?: string | number;
  BuyerPartNumber?: string;
  VendorPartNumber?: string;
  Description?: string;
  // Extended line-item fields from edi-schema.ts.
  LineItemAmount?: string | number;
  ContainerNumber?: string;
  PackagingQuantity?: string | number;
  PackagingUOM?: string;
  NetWeight?: string | number;
  GrossWeight?: string | number;
  WeightUOM?: string;
}

/**
 * Header-level mandatory fields for Corcentric DMS submission.
 *
 * Note: the address-level "*_Code" fields (BillToCode, ShipToCode,
 * RemitToCode) were required by the *legacy CSV export* but are NOT
 * required for DMS XML submission. The DMS-side customer code is
 * `customers.cor_customer_code`, resolved server-side from
 * invoice.customer_id at submission time — not from invoice header data.
 * VendorCode is similarly redundant since the vendor (supplier) is known
 * from invoice.supplier_id and joined to suppliers.code on the worker.
 */
const MANDATORY_HEADER_KEYS = new Set<string>([
  'InvoiceDate',
  'InvoiceNumber',
  'Currency',
  'ShipToName',
  'ShipToAddress1',
  'ShipToCity',
  'ShipToState',
  'ShipToZip',
  'VendorName',
  'VendorAddress1',
  'VendorCity',
  'VendorState',
  'VendorZip',
  'RemitToName',
  'RemitToAddress1',
  'RemitToCity',
  'RemitToState',
  'RemitToZip',
  'BillToName',
  'BillToAddress1',
  'BillToCity',
  'BillToState',
  'BillToZip',
  'DueDate',
  'TermsDescription',
  'ShipDate',
  'InvoiceTotal',
]);

/** Per-line mandatory fields. */
const MANDATORY_LINE_KEYS = new Set<string>([
  'LineNumber',
  'Quantity',
  'UOM',
  'UnitPrice',
  'BuyerPartNumber',
  'VendorPartNumber',
  'Description',
]);

function isFieldEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === '' || s === 'N/A' || s === 'null';
}

/** Per-line field defs. `req` matches MANDATORY_FIELDS in edi-schema.ts. */
const LINE_FIELDS: {
  key: keyof LineItem;
  label: string;
  req?: boolean;
  mono?: boolean;
  full?: boolean;
}[] = [
  { key: 'LineNumber', label: 'Line #', req: true, mono: true },
  { key: 'Description', label: 'Description', req: true, full: true },
  { key: 'Quantity', label: 'Qty', req: true, mono: true },
  { key: 'UOM', label: 'UOM', req: true, mono: true },
  { key: 'UnitPrice', label: 'Unit price', req: true, mono: true },
  { key: 'LineItemAmount', label: 'Amount', mono: true },
  { key: 'BuyerPartNumber', label: 'Buyer part #', req: true, mono: true },
  { key: 'VendorPartNumber', label: 'Vendor part #', req: true, mono: true },
  { key: 'ContainerNumber', label: 'Container #', mono: true },
  { key: 'PackagingQuantity', label: 'Pkg qty', mono: true },
  { key: 'PackagingUOM', label: 'Pkg UOM', mono: true },
  { key: 'NetWeight', label: 'Net wt', mono: true },
  { key: 'GrossWeight', label: 'Gross wt', mono: true },
  { key: 'WeightUOM', label: 'Wt UOM', mono: true },
];
