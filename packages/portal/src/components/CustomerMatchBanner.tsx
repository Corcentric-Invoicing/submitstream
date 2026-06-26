import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, X, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Customer-match banner — surfaced when invoice.needs_customer_review === true.
 *
 * Ports customer-resolution-inject.js (670 LOC) into proper React. The
 * inject's complexity — fiber walking, mutation-observer polling, position:
 * fixed on document.body, in-memory caching — all goes away because we own
 * the component tree. This is just a normal component that fetches its
 * candidates on mount and lets the reviewer link or create.
 *
 * API contracts (unchanged from the inject):
 *   GET  /api/invoices/:id/customer-candidates
 *        → { currently_needs_review, bill_to_extracted: {name,address1,…},
 *            match: { candidates: [{ id, name, code, similarity }] } }
 *   PATCH /api/invoices/:id
 *        → { customer_id, needs_customer_review:false, customer_match_confidence }
 *   POST /api/customers
 *        → returns the new row; 409 on duplicate code triggers recovery path
 *          (re-run matcher, link to whichever existing customer matches).
 */

interface BillTo {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface Candidate {
  id: string;
  name: string;
  code: string;
  similarity: number;
}

interface CandidatesResponse {
  currently_needs_review: boolean;
  bill_to_extracted: BillTo;
  match: { candidates: Candidate[] };
  error?: string;
}

interface CustomerMatchBannerProps {
  invoiceId: string;
  /** Tag the new customer row with this supplier_id so per-supplier RLS
   *  policies and the supplier-scoped customers view recognize it
   *  without needing the invoice link. Pass invoice.supplier_id when the
   *  invoice is open in review. */
  supplierId?: string | null;
  onResolved: () => void; // parent should refetch the invoice when this fires
}

export function CustomerMatchBanner({ invoiceId, supplierId, onResolved }: CustomerMatchBannerProps) {
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // ── Fetch candidates on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch(
          `/api/invoices/${encodeURIComponent(invoiceId)}/customer-candidates`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        const body = (await res.json()) as CandidatesResponse;
        if (cancelled) return;
        if (!res.ok || body.error) {
          setError(body.error || `HTTP ${res.status}`);
        } else if (!body.currently_needs_review) {
          // Server says it's already linked — hide ourselves.
          setResolved(true);
        } else {
          setData(body);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (resolved) return null;

  const billTo = data?.bill_to_extracted ?? {};
  const candidates = data?.match?.candidates ?? [];

  async function patchInvoice(customerId: string, confidence: number): Promise<boolean> {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        customer_id: customerId,
        needs_customer_review: false,
        customer_match_confidence: confidence,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      setStatusMsg({ kind: 'err', text: `Link failed: ${text || res.statusText}` });
      return false;
    }
    return true;
  }

  async function handleLink(c: Candidate) {
    setLinkingId(c.id);
    setStatusMsg(null);
    const ok = await patchInvoice(c.id, c.similarity);
    if (ok) {
      setStatusMsg({
        kind: 'ok',
        text: `Linked to ${c.name}. The invoice is now attached to this customer.`,
      });
      setTimeout(() => {
        setResolved(true);
        onResolved();
      }, 900);
    } else {
      setLinkingId(null);
    }
  }

  function handleCreate() {
    setShowCreateModal(true);
  }

  async function handleCreateSubmitted() {
    setResolved(true);
    setShowCreateModal(false);
    onResolved();
  }

  if (loading) {
    return (
      <div className="bg-warning-soft border border-warning/20 rounded-card p-3 flex items-center gap-3">
        <div className="animate-spin rounded-full h-3 w-3 border-2 border-warning/30 border-t-warning" />
        <span className="text-xs text-warning font-medium">Loading customer match…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-danger-soft border border-danger/20 rounded-card p-3">
        <div className="flex items-center gap-2 text-xs text-danger font-medium">
          <AlertTriangle size={13} />
          Customer match failed
        </div>
        <div className="text-xs text-zinc-700 mt-1">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <div className="bg-warning-soft border border-warning/20 rounded-card overflow-hidden">
        {/* Header (always visible, click to toggle) */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-warning/5 transition-colors"
        >
          {collapsed ? (
            <ChevronRight size={14} className="text-warning shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-warning shrink-0" />
          )}
          <AlertTriangle size={13} className="text-warning shrink-0" />
          <strong className="text-warning text-xs flex-shrink-0">Customer needs review</strong>
          <span className="text-zinc-500 text-[11px] truncate">
            ·{' '}
            {candidates.length > 0
              ? `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} · or create new`
              : 'no candidates · create new'}
          </span>
        </button>

        {/* Body (collapsible) */}
        {!collapsed && (
          <div className="px-3 pb-3 pt-1 border-t border-warning/15">
            <p className="text-xs text-zinc-700 mb-2.5">
              The Bill To on this invoice doesn't confidently match any existing
              customer. Link it to a candidate or create a new customer record.
            </p>

            {/* Extracted Bill To */}
            <div className="bg-white border border-line rounded-control px-3 py-2 mb-2.5">
              <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-1">
                From invoice
              </div>
              <div className="font-semibold text-ink text-sm">
                {billTo.name || (
                  <span className="text-zinc-400 italic">— no name extracted —</span>
                )}
              </div>
              {(billTo.address1 || billTo.address2 || billTo.city) && (
                <div className="text-xs text-zinc-500 mt-1">
                  {[billTo.address1, billTo.address2].filter(Boolean).join(', ')}
                  {(billTo.city || billTo.state || billTo.zip) && (
                    <div>
                      {[billTo.city, billTo.state].filter(Boolean).join(', ')}
                      {billTo.zip && ` ${billTo.zip}`}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Candidates */}
            {candidates.length === 0 ? (
              <div className="text-xs text-zinc-500 italic py-1.5">
                No similar customers found. Create one below.
              </div>
            ) : (
              <ul className="space-y-0">
                {candidates.slice(0, 3).map((c) => {
                  const pct = Math.round(Number(c.similarity || 0) * 100);
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 py-2 border-t border-warning/10 first:border-t-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-ink text-sm truncate">{c.name}</div>
                        <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                          <span className="font-mono">{c.code}</span>
                          <span>·</span>
                          <span className="font-num">{pct}% match</span>
                          <span className="flex-1 max-w-[60px] h-1 rounded-pill bg-warning/10 relative overflow-hidden">
                            <span
                              className="absolute inset-y-0 left-0 bg-brand rounded-pill"
                              style={{ width: `${Math.max(6, Math.min(100, pct))}%` }}
                            />
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={linkingId !== null}
                        onClick={() => handleLink(c)}
                      >
                        {linkingId === c.id ? 'Linking…' : 'Link this'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Create-new CTA */}
            <div className="mt-3">
              <Button variant="primary" size="sm" onClick={handleCreate}>
                + Create new customer from this invoice
              </Button>
            </div>

            {/* Status message */}
            {statusMsg && (
              <div
                className={cn(
                  'mt-2.5 text-xs flex items-center gap-1.5 font-medium',
                  statusMsg.kind === 'ok' ? 'text-success' : 'text-danger'
                )}
              >
                {statusMsg.kind === 'ok' ? (
                  <Check size={13} />
                ) : (
                  <AlertTriangle size={13} />
                )}
                {statusMsg.text}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create-customer modal */}
      {showCreateModal && (
        <CreateCustomerModal
          invoiceId={invoiceId}
          billTo={billTo}
          supplierId={supplierId ?? null}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreateSubmitted}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Create-customer modal (Task 34 from the original inject)
// ──────────────────────────────────────────────────────────

interface CreateCustomerModalProps {
  invoiceId: string;
  billTo: BillTo;
  supplierId: string | null;
  onClose: () => void;
  onCreated: () => void;
}

function defaultCodeFrom(name: string | undefined): string {
  return (
    (name || 'CUSTOMER')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'CUSTOMER'
  );
}

function CreateCustomerModal({
  invoiceId,
  billTo,
  supplierId,
  onClose,
  onCreated,
}: CreateCustomerModalProps) {
  const initialCode = useMemo(() => defaultCodeFrom(billTo.name), [billTo.name]);

  const [name, setName] = useState(billTo.name || '');
  const [code, setCode] = useState(initialCode);
  const [addr1, setAddr1] = useState(billTo.address1 || '');
  const [addr2, setAddr2] = useState(billTo.address2 || '');
  const [city, setCity] = useState(billTo.city || '');
  const [state, setState] = useState(billTo.state || '');
  const [zip, setZip] = useState(billTo.zip || '');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function authFetch(path: string, init?: RequestInit) {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function linkToExistingByMatch(submittedName: string): Promise<boolean> {
    // 409 recovery: re-run the matcher, find a candidate by name, link to it.
    const res = await authFetch(
      `/api/invoices/${encodeURIComponent(invoiceId)}/customer-candidates`
    );
    const data = (await res.json()) as CandidatesResponse;
    const lower = submittedName.trim().toLowerCase();
    const cands = data?.match?.candidates ?? [];
    const exact = cands.find((c) => (c.name || '').trim().toLowerCase() === lower);
    const pick = exact || cands[0];
    if (!pick) {
      setStatus({
        kind: 'err',
        text: 'A customer with that code exists, but no matching candidate was found — try a different code.',
      });
      return false;
    }
    const linkRes = await authFetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        customer_id: pick.id,
        needs_customer_review: false,
        customer_match_confidence: 1.0,
      }),
    });
    if (!linkRes.ok) {
      setStatus({ kind: 'err', text: `Link to existing failed: ${linkRes.statusText}` });
      return false;
    }
    setStatus({ kind: 'ok', text: `Linked to existing customer (${pick.name}).` });
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus({ kind: 'err', text: 'Customer name is required' });
      return;
    }
    if (!code.trim()) {
      setStatus({ kind: 'err', text: 'Code is required' });
      return;
    }
    setSubmitting(true);
    setStatus(null);

    const createRes = await authFetch(`/api/customers`, {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        code: code.trim(),
        bill_to_name: name.trim(),
        bill_to_address1: addr1.trim() || null,
        bill_to_address2: addr2.trim() || null,
        bill_to_city: city.trim() || null,
        bill_to_state: state.trim() || null,
        bill_to_zip: zip.trim() || null,
        // Tag the new customer with the inbound invoice's supplier so
        // per-supplier views (and supplier-RLS) can find it without
        // requiring an invoice-link join.
        supplier_id: supplierId ?? null,
        active: true,
      }),
    });

    // Duplicate-code recovery (409) — link to the existing instead.
    if (createRes.status === 409) {
      const recovered = await linkToExistingByMatch(name.trim());
      setSubmitting(false);
      if (recovered) {
        setTimeout(() => onCreated(), 900);
      }
      return;
    }

    if (!createRes.ok) {
      const text = await createRes.text();
      setStatus({ kind: 'err', text: `Create failed: ${text || createRes.statusText}` });
      setSubmitting(false);
      return;
    }

    const createdRow = (await createRes.json()) as
      | { id?: string; data?: { id?: string } | { id?: string }[] }
      | null;
    const newId =
      createdRow?.id ??
      (Array.isArray(createdRow?.data)
        ? createdRow?.data?.[0]?.id
        : (createdRow?.data as { id?: string } | undefined)?.id);

    if (!newId) {
      setStatus({ kind: 'err', text: 'Customer created but no ID returned — refresh.' });
      setSubmitting(false);
      return;
    }

    const linkRes = await authFetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        customer_id: newId,
        needs_customer_review: false,
        customer_match_confidence: 1.0,
      }),
    });
    setSubmitting(false);
    if (!linkRes.ok) {
      const text = await linkRes.text();
      setStatus({ kind: 'err', text: `Customer created but link failed: ${text}` });
      return;
    }
    setStatus({ kind: 'ok', text: 'Customer created and linked.' });
    setTimeout(() => onCreated(), 900);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <h3 className="text-base font-semibold text-ink">Create customer from this invoice</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Pre-filled from the extracted Bill To. Tweak anything OCR got wrong, then save.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-ink p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <FormRow label="Customer name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputClass}
            />
          </FormRow>
          <FormRow
            label="Code"
            required
            hint="Short identifier, uppercase. Used for matching across invoices."
          >
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              className={cn(inputClass, 'font-mono uppercase')}
            />
          </FormRow>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <FormRow label="Bill-to address 1">
                <input
                  type="text"
                  value={addr1}
                  onChange={(e) => setAddr1(e.target.value)}
                  className={inputClass}
                />
              </FormRow>
            </div>
            <FormRow label="Address 2">
              <input
                type="text"
                value={addr2}
                onChange={(e) => setAddr2(e.target.value)}
                className={inputClass}
              />
            </FormRow>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <FormRow label="City">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={inputClass}
                />
              </FormRow>
            </div>
            <FormRow label="State">
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                className={cn(inputClass, 'uppercase')}
              />
            </FormRow>
            <FormRow label="Zip">
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className={cn(inputClass, 'font-mono')}
              />
            </FormRow>
          </div>

          {status && (
            <div
              className={cn(
                'text-xs flex items-center gap-1.5 font-medium',
                status.kind === 'ok' ? 'text-success' : 'text-danger'
              )}
            >
              {status.kind === 'ok' ? (
                <Check size={13} />
              ) : (
                <AlertTriangle size={13} />
              )}
              {status.text}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" size="md" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create customer & link invoice'}
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  'w-full h-9 px-2.5 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand';

function FormRow({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-xs font-medium text-zinc-700 mb-1.5">
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}
