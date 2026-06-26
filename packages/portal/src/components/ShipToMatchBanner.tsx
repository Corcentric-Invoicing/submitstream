import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '@/components/ui/button';
import {
  ChevronDown,
  ChevronRight,
  X,
  Truck,
  AlertTriangle,
  Check,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Ship-to match banner — surfaced when invoice.needs_ship_to_review === true.
 *
 * Mirror of CustomerMatchBanner, scoped to the customer_ship_tos table for
 * the matched customer. The reviewer can:
 *   - Link to an existing ship-to row for this customer
 *   - Create a new ship-to (pre-filled from the OCR'd ShipTo*)
 *   - Mark "one-time only" — clear the flag without linking, ship-to stays
 *     embedded in invoice_data and DMS submission still uses it from there
 *
 * Why a separate banner: the customer match banner answers "which customer
 * is this invoice for?" — the ship-to banner answers "which warehouse /
 * dock for that customer?" Different question, different reviewer flow.
 *
 * Reads:  customer_ship_tos via Supabase client (RLS handles role gating)
 * Writes: invoices.ship_to_id + invoices.needs_ship_to_review via Supabase
 *         client (admin/supplier policies cover both)
 */

interface InvoiceShipTo {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface ShipToRow {
  id: string;
  customer_id: string;
  code: string;
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  attention_to: string | null;
}

interface Candidate extends ShipToRow {
  similarity: number;
}

interface ShipToMatchBannerProps {
  invoiceId: string;
  customerId: string;
  /** Extracted ship-to from invoice_data — the candidate set is ranked
   *  against this. Pulled out by the parent so this component doesn't
   *  need to know the invoice_data shape. */
  extracted: InvoiceShipTo;
  onResolved: () => void;
}

export function ShipToMatchBanner({
  invoiceId,
  customerId,
  extracted,
  onResolved,
}: ShipToMatchBannerProps) {
  const [shipTos, setShipTos] = useState<ShipToRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Below this similarity, clicking a candidate requires explicit
  // confirmation. The earlier UX let a stray click attach an
  // unrelated address to the invoice with no recovery path beyond
  // SQL surgery — never again.
  const [pendingConfirm, setPendingConfirm] = useState<Candidate | null>(null);

  // Fetch existing ship-tos for this customer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: dbErr } = await supabase
        .from('customer_ship_tos')
        .select('id, customer_id, code, name, address1, address2, city, state, zip, attention_to')
        .eq('customer_id', customerId)
        .eq('active', true)
        .order('name', { ascending: true });
      if (cancelled) return;
      if (dbErr) {
        setError(dbErr.message);
      } else {
        setShipTos((data as ShipToRow[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Rank candidates by client-side similarity. Field-weighted: name +
  // address1 + city carry the signal; zip is a strong exact-match bonus.
  const candidates = useMemo<Candidate[]>(() => {
    const scored = shipTos.map((row) => ({
      ...row,
      similarity: similarity(row, extracted),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored;
  }, [shipTos, extracted]);

  // High-confidence threshold: candidates above this can be linked
  // with a single click. Below it, the user must confirm in a modal.
  // Mirrors the worker-side SHIP_TO_AUTO_LINK_THRESHOLD.
  const CONFIRM_THRESHOLD = 0.70;

  async function patchInvoice(update: {
    ship_to_id: string | null;
    needs_ship_to_review: false;
    invoiceDataPatch?: Partial<Record<string, string | null>>;
  }): Promise<boolean> {
    // Pull the current invoice_data, merge in the ship-to overrides,
    // and write everything back atomically. We do this so DMS XML at
    // submission time uses the canonical address from the linked
    // customer_ship_tos row, not the OCR'd values that may differ
    // (typos, format variance, abbreviations). Without this sync,
    // "linking" would correct the database link but the form display
    // and DMS payload would still show the old extraction.
    let finalUpdate: Record<string, unknown> = {
      ship_to_id: update.ship_to_id,
      needs_ship_to_review: update.needs_ship_to_review,
    };
    if (update.invoiceDataPatch) {
      const { data: existing } = await supabase
        .from('invoices')
        .select('invoice_data')
        .eq('id', invoiceId)
        .single();
      const cur = ((existing as { invoice_data?: Record<string, unknown> } | null)?.invoice_data) || {};
      finalUpdate = {
        ...finalUpdate,
        invoice_data: { ...cur, ...update.invoiceDataPatch },
      };
    }
    const { error: dbErr } = await supabase
      .from('invoices')
      .update(finalUpdate)
      .eq('id', invoiceId);
    if (dbErr) {
      setStatusMsg({ kind: 'err', text: `Update failed: ${dbErr.message}` });
      return false;
    }
    return true;
  }

  /** Build the invoice_data overrides from a canonical ship-to row.
   *  When a candidate is linked, we copy its address fields onto the
   *  invoice so the form display + DMS submission both reflect the
   *  authoritative customer record. */
  function shipToPatchFromCandidate(c: Candidate | ShipToRow) {
    return {
      ShipToName: c.name ?? null,
      ShipToCode: c.code ?? null,
      ShipToAddress1: c.address1 ?? null,
      ShipToAddress2: c.address2 ?? null,
      ShipToCity: c.city ?? null,
      ShipToState: c.state ?? null,
      ShipToZip: c.zip ?? null,
    };
  }

  async function commitLink(c: Candidate) {
    setLinkingId(c.id);
    setStatusMsg(null);
    const ok = await patchInvoice({
      ship_to_id: c.id,
      needs_ship_to_review: false,
      invoiceDataPatch: shipToPatchFromCandidate(c),
    });
    setLinkingId(null);
    if (ok) {
      setStatusMsg({
        kind: 'ok',
        text: `Linked to ${c.name || c.code}. Ship-to on this invoice updated to match.`,
      });
      setResolved(true);
      setTimeout(() => onResolved(), 700);
    }
  }

  function handleLink(c: Candidate) {
    // Above threshold: link immediately. Below: open the confirm modal
    // so the reviewer has to actively acknowledge they're attaching a
    // potentially-wrong address.
    if (c.similarity >= CONFIRM_THRESHOLD) {
      commitLink(c);
    } else {
      setPendingConfirm(c);
    }
  }

  async function handleOneTime() {
    setStatusMsg(null);
    // One-time only: leave invoice_data ShipTo* as the OCR'd values.
    // Don't write a customer_ship_tos link. DMS submission uses the
    // OCR'd address as-is for this single invoice.
    const ok = await patchInvoice({
      ship_to_id: null,
      needs_ship_to_review: false,
    });
    if (ok) {
      setStatusMsg({
        kind: 'ok',
        text: 'Marked as one-time. Ship-to stays on this invoice only.',
      });
      setResolved(true);
      setTimeout(() => onResolved(), 700);
    }
  }

  function handleCreate() {
    setShowCreateModal(true);
  }

  async function handleCreateSubmitted(newId: string, canonical: ShipToRow) {
    setShowCreateModal(false);
    // The freshly-created customer_ship_tos row IS the canonical record.
    // Sync invoice_data so the form display + DMS use it.
    const ok = await patchInvoice({
      ship_to_id: newId,
      needs_ship_to_review: false,
      invoiceDataPatch: shipToPatchFromCandidate(canonical),
    });
    if (ok) {
      setStatusMsg({
        kind: 'ok',
        text: 'New ship-to added and linked.',
      });
      setResolved(true);
      setTimeout(() => onResolved(), 700);
    }
  }

  if (resolved && !statusMsg) return null;

  return (
    <>
      <div className="bg-paper border border-line rounded-card overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white transition-colors"
        >
          {collapsed ? (
            <ChevronRight size={13} className="text-zinc-500" aria-hidden />
          ) : (
            <ChevronDown size={13} className="text-zinc-500" aria-hidden />
          )}
          <Truck size={13} className="text-warning" aria-hidden />
          <span className="text-[12px] font-semibold text-ink">
            New ship-to detected
          </span>
          <span className="text-[12px] text-zinc-500 truncate">
            {extracted.name || extracted.address1 || 'unknown'}
            {extracted.city ? ` · ${extracted.city}` : ''}
            {extracted.state ? `, ${extracted.state}` : ''}
          </span>
          {statusMsg && !collapsed && (
            <span
              className={cn(
                'ml-auto text-[11px] flex items-center gap-1',
                statusMsg.kind === 'ok' ? 'text-success' : 'text-danger'
              )}
            >
              {statusMsg.kind === 'ok' ? <Check size={11} aria-hidden /> : <AlertTriangle size={11} aria-hidden />}
              {statusMsg.text}
            </span>
          )}
        </button>

        {!collapsed && (
          <div className="px-3 pb-3 pt-1 border-t border-line space-y-3">
            <div className="text-[12px] text-zinc-700 leading-snug">
              The ship-to on this invoice doesn't match any saved location for
              this customer. Link it to one, add it as a new permanent ship-to,
              or use it for this invoice only.
            </div>

            {error && (
              <div className="bg-danger-soft border border-danger/20 rounded-control px-2.5 py-2 text-[11px] text-danger">
                {error}
              </div>
            )}

            {/* Extracted card (what OCR pulled) */}
            <div className="bg-white border border-line rounded-control px-3 py-2 text-[12px]">
              <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-1">
                From this invoice
              </div>
              <div className="text-ink font-medium">
                {extracted.name || <span className="text-zinc-400 italic">no name</span>}
              </div>
              <div className="text-zinc-700">
                {[extracted.address1, extracted.address2].filter(Boolean).join(' · ') || (
                  <span className="text-zinc-400 italic">no address</span>
                )}
              </div>
              <div className="text-zinc-700">
                {[extracted.city, extracted.state, extracted.zip].filter(Boolean).join(', ')}
              </div>
            </div>

            {/* Existing ship-tos for this customer */}
            {loading ? (
              <div className="text-[11px] text-zinc-500">Loading existing ship-tos…</div>
            ) : candidates.length > 0 ? (
              <div>
                <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-1.5">
                  Possible matches for this customer
                </div>
                <ul className="space-y-1.5">
                  {candidates.slice(0, 4).map((c) => {
                    const isLowConfidence = c.similarity < CONFIRM_THRESHOLD;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={linkingId !== null}
                          onClick={() => handleLink(c)}
                          className={cn(
                            'w-full text-left bg-white border rounded-control px-3 py-2 transition-[border-color,box-shadow] disabled:opacity-60 disabled:cursor-not-allowed',
                            isLowConfidence
                              ? 'border-zinc-200 hover:border-warning/60 hover:shadow-[0_0_0_3px_rgba(245,158,11,0.12)]'
                              : 'border-line hover:border-brand hover:shadow-ring-brand',
                            linkingId === c.id && (isLowConfidence
                              ? 'border-warning/60'
                              : 'border-brand shadow-ring-brand')
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] text-ink font-medium truncate">
                                {c.name || c.code}
                              </div>
                              <div className="text-[11px] text-zinc-600 truncate">
                                {[c.address1, c.address2].filter(Boolean).join(' · ') || '—'}
                              </div>
                              <div className="text-[11px] text-zinc-500">
                                {[c.city, c.state, c.zip].filter(Boolean).join(', ')}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 shrink-0">
                              <span className={cn(
                                'text-[10px] uppercase tracking-[0.06em] font-semibold',
                                isLowConfidence ? 'text-warning' : 'text-success'
                              )}>
                                {Math.round(c.similarity * 100)}% match
                              </span>
                              {isLowConfidence && (
                                <span className="text-[9px] uppercase tracking-[0.04em] text-warning/80">
                                  needs confirm
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="text-[11px] text-zinc-500">
                No saved ship-tos exist for this customer yet.
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="primary" size="sm" onClick={handleCreate}>
                <Plus size={12} aria-hidden />
                Add as new ship-to
              </Button>
              <Button variant="secondary" size="sm" onClick={handleOneTime}>
                Use one-time only
              </Button>
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateShipToModal
          customerId={customerId}
          extracted={extracted}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreateSubmitted}
        />
      )}

      {/* Low-confidence link confirmation. The original ShipToMatchBanner
          let any candidate be linked with a single click — including
          ones with sub-30% similarity. This modal stops a stray click
          from attaching the wrong address and surfaces the diff so
          the reviewer can decide whether the match is good enough. */}
      {pendingConfirm && (
        <ConfirmLowMatchModal
          extracted={extracted}
          candidate={pendingConfirm}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const c = pendingConfirm;
            setPendingConfirm(null);
            commitLink(c);
          }}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Low-confidence link confirmation modal
// ──────────────────────────────────────────────────────────

function ConfirmLowMatchModal({
  extracted,
  candidate,
  onCancel,
  onConfirm,
}: {
  extracted: InvoiceShipTo;
  candidate: Candidate;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-lg w-full overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-base font-semibold text-ink flex items-center gap-2">
            <AlertTriangle size={14} className="text-warning" aria-hidden />
            Low-confidence match — please confirm
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-ink p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-[13px] text-zinc-700">
            This candidate matches the invoice's ship-to with only{' '}
            <span className="font-semibold text-warning">
              {Math.round(candidate.similarity * 100)}% similarity
            </span>
            . Linking will overwrite the invoice's ship-to fields with the
            saved record below. Continue only if you're sure they refer
            to the same location.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-paper border border-line rounded-control p-3">
              <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-1">
                From this invoice
              </div>
              <div className="text-[12px] text-ink font-medium">
                {extracted.name || <span className="italic text-zinc-400">no name</span>}
              </div>
              <div className="text-[11px] text-zinc-700">
                {[extracted.address1, extracted.address2].filter(Boolean).join(' · ') || '—'}
              </div>
              <div className="text-[11px] text-zinc-500">
                {[extracted.city, extracted.state, extracted.zip].filter(Boolean).join(', ')}
              </div>
            </div>
            <div className="bg-warning-soft border border-warning/30 rounded-control p-3">
              <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-warning mb-1">
                Saved record (will be used)
              </div>
              <div className="text-[12px] text-ink font-medium">
                {candidate.name || candidate.code}
              </div>
              <div className="text-[11px] text-zinc-700">
                {[candidate.address1, candidate.address2].filter(Boolean).join(' · ') || '—'}
              </div>
              <div className="text-[11px] text-zinc-500">
                {[candidate.city, candidate.state, candidate.zip].filter(Boolean).join(', ')}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-paper">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Link anyway
          </Button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Create-ship-to modal
// ──────────────────────────────────────────────────────────

function CreateShipToModal({
  customerId,
  extracted,
  onClose,
  onCreated,
}: {
  customerId: string;
  extracted: InvoiceShipTo;
  onClose: () => void;
  /** Returns both the new row's id AND its full record so the parent
   *  can sync invoice_data ShipTo* without an extra round-trip. */
  onCreated: (newId: string, canonical: ShipToRow) => void;
}) {
  const initialCode = useMemo(() => defaultCodeFrom(extracted.name, extracted.city), [extracted]);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(extracted.name || '');
  const [addr1, setAddr1] = useState(extracted.address1 || '');
  const [addr2, setAddr2] = useState(extracted.address2 || '');
  const [city, setCity] = useState(extracted.city || '');
  const [state, setState] = useState(extracted.state || '');
  const [zip, setZip] = useState(extracted.zip || '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!code.trim()) {
      setErr('Code is required.');
      return;
    }
    setSubmitting(true);
    const trimmedCode = code.trim();
    const payload = {
      customer_id: customerId,
      code: trimmedCode,
      name: name.trim() || null,
      address1: addr1.trim() || null,
      address2: addr2.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      zip: zip.trim() || null,
      active: true,
    };
    const { data, error: dbErr } = await supabase
      .from('customer_ship_tos')
      .insert(payload)
      .select('id')
      .single();

    // Duplicate-key recovery: if (customer_id, code) already exists,
    // reuse the existing row and update its address fields with what
    // the user just entered (so corrections / fresh OCR data win
    // instead of a stale dupe). Mirrors the 409-recovery pattern we
    // use for customer creation.
    if (dbErr && /duplicate key|customer_ship_tos_customer_id_code_key|23505/i.test(dbErr.message)) {
      const { data: existing, error: findErr } = await supabase
        .from('customer_ship_tos')
        .select('id')
        .eq('customer_id', customerId)
        .eq('code', trimmedCode)
        .maybeSingle();
      if (findErr || !existing) {
        setErr(`A ship-to with code "${trimmedCode}" already exists, but couldn't be loaded. Try a different code.`);
        setSubmitting(false);
        return;
      }
      const existingId = (existing as { id: string }).id;
      // Update fields so any newly entered values overwrite the stale row.
      const { error: updErr } = await supabase
        .from('customer_ship_tos')
        .update({
          name: payload.name,
          address1: payload.address1,
          address2: payload.address2,
          city: payload.city,
          state: payload.state,
          zip: payload.zip,
        })
        .eq('id', existingId);
      setSubmitting(false);
      if (updErr) {
        setErr(`Recovered the existing row but couldn't update it: ${updErr.message}`);
        return;
      }
      // Build the canonical row from what we just wrote so the parent
      // can sync invoice_data.ShipTo* without an extra round-trip.
      onCreated(existingId, {
        id: existingId,
        customer_id: customerId,
        code: trimmedCode,
        name: payload.name,
        address1: payload.address1,
        address2: payload.address2,
        city: payload.city,
        state: payload.state,
        zip: payload.zip,
        attention_to: null,
      });
      return;
    }

    setSubmitting(false);
    if (dbErr || !data) {
      setErr(dbErr?.message || 'Insert failed');
      return;
    }
    onCreated((data as { id: string }).id, {
      id: (data as { id: string }).id,
      customer_id: customerId,
      code: trimmedCode,
      name: payload.name,
      address1: payload.address1,
      address2: payload.address2,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      attention_to: null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-base font-semibold text-ink flex items-center gap-2">
            <Truck size={14} className="text-warning" aria-hidden />
            Add ship-to location
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-ink p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Code" required>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className={modalInputClass}
                placeholder="WHSE-BEND"
                maxLength={32}
              />
            </ModalField>
            <ModalField label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={modalInputClass}
                placeholder="Distribution center"
              />
            </ModalField>
          </div>
          <ModalField label="Address line 1">
            <input
              type="text"
              value={addr1}
              onChange={(e) => setAddr1(e.target.value)}
              className={modalInputClass}
            />
          </ModalField>
          <ModalField label="Address line 2">
            <input
              type="text"
              value={addr2}
              onChange={(e) => setAddr2(e.target.value)}
              className={modalInputClass}
            />
          </ModalField>
          <div className="grid grid-cols-[1fr_120px_120px] gap-3">
            <ModalField label="City">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={modalInputClass}
              />
            </ModalField>
            <ModalField label="State">
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                className={modalInputClass}
                maxLength={2}
              />
            </ModalField>
            <ModalField label="ZIP">
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className={modalInputClass}
              />
            </ModalField>
          </div>

          {err && (
            <div className="bg-danger-soft border border-danger/20 rounded-control px-2.5 py-2 text-xs text-danger">
              {err}
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-paper">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add ship-to'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const modalInputClass =
  'w-full h-9 px-3 bg-white border border-line-2 rounded-control text-[13px] text-ink placeholder:text-zinc-400 outline-none shadow-1 focus:border-brand focus:shadow-ring-brand';

function ModalField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-ink mb-1">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function defaultCodeFrom(name: string | null | undefined, city: string | null | undefined): string {
  const base = (city || name || '').toString().trim();
  if (!base) return '';
  return base.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16);
}

function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) return out;
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (aa.size === 0 && bb.size === 0) return 1;
  if (aa.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const g of aa) if (bb.has(g)) inter++;
  return (2 * inter) / (aa.size + bb.size);
}

/**
 * Field-weighted similarity between a candidate ship-to row and the OCR'd
 * extraction. Tuned to be forgiving on names (typos / abbreviations) while
 * weighting address and ZIP more heavily because they're stable.
 */
function similarity(row: ShipToRow, extracted: InvoiceShipTo): number {
  const rName = normalize(row.name);
  const rAddr1 = normalize(row.address1);
  const rCity = normalize(row.city);
  const rState = normalize(row.state);
  const rZip = normalize(row.zip);

  const eName = normalize(extracted.name);
  const eAddr1 = normalize(extracted.address1);
  const eCity = normalize(extracted.city);
  const eState = normalize(extracted.state);
  const eZip = normalize(extracted.zip);

  const nameSim = rName && eName ? dice(rName, eName) : 0;
  const addrSim = rAddr1 && eAddr1 ? dice(rAddr1, eAddr1) : 0;
  const citySim = rCity && eCity ? dice(rCity, eCity) : 0;
  const stateMatch = rState && eState && rState === eState ? 1 : 0;
  const zipMatch = rZip && eZip && rZip === eZip ? 1 : 0;

  // Weights sum to 1.0
  return (
    0.25 * nameSim +
    0.30 * addrSim +
    0.15 * citySim +
    0.10 * stateMatch +
    0.20 * zipMatch
  );
}
