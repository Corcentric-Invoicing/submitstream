import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, X, AlertTriangle, Search, MapPin, Hash, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppShell } from '@/components/AppShell';
import { useAppState } from '@/lib/useAppState';

/**
 * Customers admin (Wave 6a-extension).
 *
 * API contracts (already exist in worker-deploy/src/api/handlers/customers.ts):
 *   GET    /api/customers              list (scoped by role)
 *   GET    /api/customers/:id          single (with ship-tos)
 *   POST   /api/customers              create
 *   PATCH  /api/customers/:id          partial update
 *
 * Sub-resources (codes, ship-tos) are out of scope for v1; the buttons
 * surface their counts but the management modals come later.
 */

interface Customer {
  id: string;
  name: string;
  code: string | null;
  cor_customer_code: string | null;
  bill_to_name: string | null;
  bill_to_address1: string | null;
  bill_to_address2: string | null;
  bill_to_city: string | null;
  bill_to_state: string | null;
  bill_to_zip: string | null;
  ship_to_name: string | null;
  ship_to_address1: string | null;
  ship_to_address2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
}

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

export default function CustomersPage({ role, userId, userEmail }: PageProps) {
  const { supplierScope, scopedSupplierName } = useAppState(role, userId);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // When supplier scope is set, we narrow customers to ones that have at
  // least one invoice from that supplier. Cached customer-id allowlist.
  const [allowedCustomerIds, setAllowedCustomerIds] = useState<Set<string> | null>(
    null
  );

  useEffect(() => {
    fetchCustomers();
    if (supplierScope === 'all') {
      setAllowedCustomerIds(null);
    } else {
      // Fetch the unique set of customer_ids in invoices for this supplier.
      (async () => {
        const { data } = await supabase
          .from('invoices')
          .select('customer_id')
          .eq('supplier_id', supplierScope)
          .not('customer_id', 'is', null);
        const ids = new Set<string>(
          ((data as { customer_id: string }[] | null) ?? [])
            .map((r) => r.customer_id)
            .filter((id) => id != null)
        );
        setAllowedCustomerIds(ids);
      })();
    }
  }, [supplierScope]);

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

  async function fetchCustomers() {
    setLoading(true);
    setError(null);
    try {
      // Read directly from Supabase so RLS handles role-based visibility:
      //   - admin/team: sees all (admin_manages_customers policy)
      //   - supplier:   sees customers via "Everyone reads customers"
      //                 (granted to the `authenticated` role) — including
      //                 customers their invoices link to even when the
      //                 customers row has supplier_id = null. The worker's
      //                 /api/customers endpoint historically filtered too
      //                 aggressively for the supplier role; bypassing it
      //                 here keeps the supplier-self-serve view honest.
      const { data, error: dbErr } = await supabase
        .from('customers')
        .select('*')
        .order('name', { ascending: true });
      if (dbErr) {
        setError(dbErr.message);
        return;
      }
      const list: Customer[] = (data as Customer[] | null) ?? [];
      setCustomers(list);
      if (selectedId && !list.find((c) => c.id === selectedId)) {
        setSelectedId(list[0]?.id ?? null);
      } else if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(values: Partial<Customer>, isNew: boolean, id?: string) {
    const path = isNew ? '/api/customers' : `/api/customers/${id}`;
    const method = isNew ? 'POST' : 'PATCH';
    const res = await authFetch(path, {
      method,
      body: JSON.stringify(values),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    await fetchCustomers();
    if (isNew && (body?.id || body?.data?.id)) {
      setSelectedId(body.id ?? body.data?.id);
    }
  }

  const filtered = useMemo(() => {
    // If a supplier is scoped AND we found customer IDs in their invoices,
    // narrow the pool. If scope is set but no customers are linked yet
    // (invoices.customer_id mostly null — common on fresh test data),
    // fall back to showing all customers rather than an empty list.
    let pool = customers;
    if (allowedCustomerIds && allowedCustomerIds.size > 0) {
      pool = customers.filter((c) => allowedCustomerIds.has(c.id));
    }
    // Then apply the search filter.
    const q = search.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((c) => {
      return [
        c.name,
        c.code,
        c.cor_customer_code,
        c.bill_to_city,
        c.bill_to_state,
        c.bill_to_name,
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .some((v) => v.includes(q));
    });
  }, [customers, search, allowedCustomerIds]);

  const selected = customers.find((c) => c.id === selectedId) || null;

  return (
    <AppShell role={role} userId={userId} userEmail={userEmail} breadcrumb="Customers">
    <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-5">
      <div className="flex items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {supplierScope === 'all' ? (
              <>
                Customer records across all suppliers — used to match Bill To
                extraction on inbound invoices and map to the DMS.
              </>
            ) : allowedCustomerIds && allowedCustomerIds.size > 0 ? (
              <>
                <span className="font-medium text-ink">{scopedSupplierName}</span>
                {' · '}
                customers linked to this supplier's invoices.
              </>
            ) : (
              <>
                <span className="font-medium text-ink">{scopedSupplierName}</span>
                {' · '}
                no customers linked to this supplier's invoices yet — showing
                all so you can add the link from the invoice review screen.
              </>
            )}
          </p>
        </div>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={13} aria-hidden />
            Add customer
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Master-detail layout: list on the left, detail on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
        {/* Left: list panel */}
        <div className="bg-white border border-line rounded-card shadow-1 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-line">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code, city…"
                className="w-full h-9 pl-8 pr-2.5 bg-paper border border-line-2 rounded-control text-[13px] text-ink placeholder:text-zinc-400 outline-none focus:border-brand focus:shadow-ring-brand"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[640px]">
            {loading ? (
              <div className="p-4 text-center text-sm text-zinc-500">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-zinc-200 border-t-ink mx-auto mb-2" />
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-zinc-500">
                  {search ? 'No matches.' : 'No customers yet.'}
                </p>
              </div>
            ) : (
              <ul>
                {filtered.map((c) => {
                  const isActive = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          'w-full text-left px-3 py-2.5 border-b border-line last:border-b-0 transition-colors',
                          isActive
                            ? 'bg-paper border-l-2 border-l-ink -ml-px'
                            : 'hover:bg-paper border-l-2 border-l-transparent -ml-px'
                        )}
                      >
                        <div className="font-semibold text-ink text-sm truncate">
                          {c.name}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5 flex items-center gap-1.5">
                          {c.code && <span>{c.code}</span>}
                          {c.code && c.cor_customer_code && <span>·</span>}
                          {c.cor_customer_code && (
                            <span className="text-brand-600">
                              COR {c.cor_customer_code}
                            </span>
                          )}
                          {!c.code && !c.cor_customer_code && (
                            <span className="text-zinc-400">no code</span>
                          )}
                        </div>
                        {(c.bill_to_city || c.bill_to_state) && (
                          <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                            {[c.bill_to_city, c.bill_to_state].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="px-3 py-2 border-t border-line bg-paper text-[11px] text-zinc-500">
            <span className="font-num">{filtered.length}</span>
            {filtered.length !== customers.length && (
              <span className="text-zinc-400">
                {' '}
                of <span className="font-num">{customers.length}</span>
              </span>
            )}{' '}
            customer{filtered.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
          {selected ? (
            <CustomerDetail
              customer={selected}
              onEdit={() => setEditing(selected)}
            />
          ) : (
            <div className="p-12 text-center">
              <p className="text-sm text-zinc-500">
                {customers.length === 0
                  ? 'Create your first customer to get started.'
                  : 'Select a customer from the list to view details.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <CustomerFormModal
          customer={editing === 'new' ? null : editing}
          // When admin is filtered by a specific supplier, default new
          // customers to that supplier_id so the customer is owned by
          // the right supplier from the start. Admins can override in
          // the form if they need to attach to a different one.
          defaultSupplierId={
            editing === 'new' && supplierScope !== 'all' ? supplierScope : null
          }
          onClose={() => setEditing(null)}
          onSave={async (vals) => {
            await handleSave(
              vals,
              editing === 'new',
              editing === 'new' ? undefined : editing.id
            );
            setEditing(null);
          }}
        />
      )}
    </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Detail panel
// ──────────────────────────────────────────────────────────

// Sub-resource types
interface SupplierLite {
  id: string;
  name: string;
  code: string;
}

interface CustomerCode {
  id: string;
  supplier_id: string;
  supplier_code: string;
  supplier?: { name?: string; code?: string };
  created_at?: string;
}

interface ShipTo {
  id: string;
  name: string | null;
  code: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function CustomerDetail({
  customer,
  onEdit,
}: {
  customer: Customer;
  onEdit: () => void;
}) {
  const billLines = [
    customer.bill_to_address1,
    customer.bill_to_address2,
    [customer.bill_to_city, customer.bill_to_state].filter(Boolean).join(', ') +
      (customer.bill_to_zip ? ` ${customer.bill_to_zip}` : ''),
  ].filter(Boolean);
  const shipLines = [
    customer.ship_to_address1,
    customer.ship_to_address2,
    [customer.ship_to_city, customer.ship_to_state].filter(Boolean).join(', ') +
      (customer.ship_to_zip ? ` ${customer.ship_to_zip}` : ''),
  ].filter(Boolean);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-ink truncate">
            {customer.name}
          </h2>
          {customer.code && (
            <div className="mt-1 text-xs">
              <span className="font-mono text-zinc-500">{customer.code}</span>
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil size={12} aria-hidden />
          Edit
        </Button>
      </div>

      {/* Corcentric DMS code — top-of-detail because it's the field that
          determines whether this customer can have invoices submitted to
          DMS at all. Empty state is danger-styled so it's impossible to
          miss. Edit the customer record to set it. */}
      <div className="px-5 pt-4">
        {customer.cor_customer_code ? (
          <div className="bg-paper border border-line rounded-card px-3.5 py-2.5 flex items-center gap-3">
            <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500 shrink-0">
              Corcentric DMS code
            </div>
            <div className="font-mono text-[13px] text-ink font-semibold flex-1 truncate">
              {customer.cor_customer_code}
            </div>
            <span className="text-[10px] uppercase tracking-[0.06em] text-zinc-500 shrink-0">
              required for submission
            </span>
          </div>
        ) : (
          <div className="bg-danger-soft border border-danger/25 rounded-card px-3.5 py-2.5 flex items-center gap-3">
            <AlertTriangle size={14} className="text-danger shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-danger">
                No Corcentric DMS code set
              </div>
              <div className="text-[11px] text-zinc-700 mt-0.5">
                Invoices for this customer cannot be submitted to DMS until a
                code is assigned. Click Edit to add it.
              </div>
            </div>
            <Button variant="primary" size="sm" onClick={onEdit}>
              Add code
            </Button>
          </div>
        )}
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <DetailGroup heading="Bill to">
          {billLines.length > 0 || customer.bill_to_name ? (
            <>
              {customer.bill_to_name && customer.bill_to_name !== customer.name && (
                <p className="font-medium text-ink">{customer.bill_to_name}</p>
              )}
              {billLines.map((line, i) => (
                <p key={i} className="text-zinc-700">
                  {line}
                </p>
              ))}
            </>
          ) : (
            <p className="text-zinc-400 italic">No bill-to address on file.</p>
          )}
        </DetailGroup>

        <DetailGroup heading="Ship to (default)">
          {shipLines.length > 0 || customer.ship_to_name ? (
            <>
              {customer.ship_to_name && (
                <p className="font-medium text-ink">{customer.ship_to_name}</p>
              )}
              {shipLines.map((line, i) => (
                <p key={i} className="text-zinc-700">
                  {line}
                </p>
              ))}
            </>
          ) : (
            <p className="text-zinc-400 italic">Same as Bill to.</p>
          )}
        </DetailGroup>

        <DetailGroup heading="Contact">
          {customer.contact_email || customer.contact_phone ? (
            <>
              {customer.contact_email && (
                <p className="font-mono text-zinc-700 text-[12px]">
                  {customer.contact_email}
                </p>
              )}
              {customer.contact_phone && (
                <p className="font-mono text-zinc-700 text-[12px]">
                  {customer.contact_phone}
                </p>
              )}
            </>
          ) : (
            <p className="text-zinc-400 italic">No contact details.</p>
          )}
        </DetailGroup>

        <DetailGroup heading="Notes">
          {customer.notes ? (
            <p className="text-zinc-700 whitespace-pre-wrap">{customer.notes}</p>
          ) : (
            <p className="text-zinc-400 italic">No notes.</p>
          )}
        </DetailGroup>
      </div>

      {/* Sub-resources: alternate codes + ship-to locations */}
      <div className="px-5 pb-5 space-y-3">
        <CustomerCodesPanel customerId={customer.id} />
        <CustomerShipTosPanel customerId={customer.id} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Codes sub-table
// ──────────────────────────────────────────────────────────

function CustomerCodesPanel({ customerId }: { customerId: string }) {
  const [codes, setCodes] = useState<CustomerCode[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  async function load() {
    setError(null);
    try {
      const [codesRes, supRes] = await Promise.all([
        authFetch(`/api/customers/${customerId}/codes`),
        authFetch('/api/suppliers'),
      ]);
      const codesBody = await codesRes.json().catch(() => ({}));
      const supBody = await supRes.json().catch(() => ({}));
      if (!codesRes.ok) {
        setError(codesBody?.error || `HTTP ${codesRes.status}`);
        return;
      }
      const codesList: CustomerCode[] = Array.isArray(codesBody)
        ? codesBody
        : codesBody?.data ?? [];
      const supList: SupplierLite[] = Array.isArray(supBody) ? supBody : supBody?.data ?? [];
      setSuppliers(supList);
      // Hydrate supplier names
      const byId = new Map(supList.map((s) => [s.id, s]));
      for (const c of codesList) {
        const s = byId.get(c.supplier_id);
        if (s) c.supplier = { name: s.name, code: s.code };
      }
      setCodes(codesList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || !code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/customers/${customerId}/codes`, {
        method: 'POST',
        body: JSON.stringify({ supplier_id: supplierId, supplier_code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      setCode('');
      setSupplierId('');
      setAdding(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(codeId: string) {
    if (!confirm('Remove this alternate code?')) return;
    const res = await authFetch(`/api/customers/${customerId}/codes/${codeId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error || `Failed: HTTP ${res.status}`);
      return;
    }
    await load();
  }

  return (
    <details className="group bg-paper border border-line rounded-card overflow-hidden" open>
      <summary className="cursor-pointer px-3 py-2.5 flex items-center justify-between gap-2 text-[12px] font-semibold text-ink">
        <span className="inline-flex items-center gap-1.5">
          <Hash size={12} className="text-zinc-500" aria-hidden />
          Alternate codes
          {codes && (
            <span className="text-zinc-500 font-normal">· {codes.length}</span>
          )}
        </span>
        <span className="text-[11px] text-zinc-500 font-normal">
          per-supplier code overrides
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 border-t border-line">
        {error && (
          <div className="mb-2 text-[11px] text-danger flex items-start gap-1.5">
            <AlertTriangle size={11} className="mt-0.5" aria-hidden />
            {error}
          </div>
        )}
        {codes === null ? (
          <p className="text-xs text-zinc-500 py-2">Loading…</p>
        ) : codes.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-2">
            No alternate codes — this customer is matched by its primary code only.
          </p>
        ) : (
          <ul className="divide-y divide-line bg-white border border-line rounded-control overflow-hidden mb-2">
            {codes.map((c) => (
              <li
                key={c.id}
                className="px-3 py-2 flex items-center gap-2 text-[12px]"
              >
                <span className="text-zinc-700 flex-1">
                  {c.supplier?.name || c.supplier_id}
                  <span className="text-zinc-400 mx-1.5">·</span>
                  <span className="font-mono text-ink">{c.supplier_code}</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="text-zinc-400 hover:text-danger p-0.5"
                  aria-label="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={11} aria-hidden />
            Add code
          </Button>
        )}
        {adding && (
          <form
            onSubmit={handleAdd}
            className="bg-white border border-line rounded-control p-2.5 space-y-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                required
                className="h-8 px-2 pr-7 bg-white border border-line-2 rounded-control text-[12px] text-ink outline-none focus:border-brand"
              >
                <option value="">Supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Code"
                required
                className="h-8 px-2 bg-white border border-line-2 rounded-control text-[12px] font-mono text-ink outline-none focus:border-brand"
              />
            </div>
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" size="sm" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setCode('');
                  setSupplierId('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

// ──────────────────────────────────────────────────────────
// Ship-tos sub-table
// ──────────────────────────────────────────────────────────

function CustomerShipTosPanel({ customerId }: { customerId: string }) {
  const [shipTos, setShipTos] = useState<ShipTo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<ShipTo>>({});
  const [submitting, setSubmitting] = useState(false);

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

  async function load() {
    setError(null);
    try {
      const res = await authFetch(`/api/customers/${customerId}/ship-tos`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const list: ShipTo[] = Array.isArray(body) ? body : body?.data ?? [];
      setShipTos(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.address1 && !draft.name) {
      setError('At least name or address line 1 is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/customers/${customerId}/ship-tos`, {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name || null,
          code: draft.code || null,
          address1: draft.address1 || null,
          address2: draft.address2 || null,
          city: draft.city || null,
          state: draft.state || null,
          zip: draft.zip || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      setDraft({});
      setAdding(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this ship-to location?')) return;
    const res = await authFetch(`/api/customers/${customerId}/ship-tos/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error || `Failed: HTTP ${res.status}`);
      return;
    }
    await load();
  }

  function inputCls(extra = '') {
    return cn(
      'w-full h-8 px-2 bg-white border border-line-2 rounded-control text-[12px] text-ink outline-none focus:border-brand',
      extra
    );
  }

  return (
    <details className="group bg-paper border border-line rounded-card overflow-hidden" open>
      <summary className="cursor-pointer px-3 py-2.5 flex items-center justify-between gap-2 text-[12px] font-semibold text-ink">
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={12} className="text-zinc-500" aria-hidden />
          Ship-to locations
          {shipTos && (
            <span className="text-zinc-500 font-normal">· {shipTos.length}</span>
          )}
        </span>
        <span className="text-[11px] text-zinc-500 font-normal">
          additional shipping addresses
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 border-t border-line">
        {error && (
          <div className="mb-2 text-[11px] text-danger flex items-start gap-1.5">
            <AlertTriangle size={11} className="mt-0.5" aria-hidden />
            {error}
          </div>
        )}
        {shipTos === null ? (
          <p className="text-xs text-zinc-500 py-2">Loading…</p>
        ) : shipTos.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-2">
            No additional ship-to locations on file.
          </p>
        ) : (
          <ul className="space-y-1.5 mb-2">
            {shipTos.map((s) => (
              <li
                key={s.id}
                className="bg-white border border-line rounded-control px-3 py-2 flex items-start gap-3 text-[12px]"
              >
                <div className="flex-1 min-w-0">
                  {s.name && (
                    <div className="font-medium text-ink">{s.name}</div>
                  )}
                  {(s.address1 || s.city) && (
                    <div className="text-zinc-700 mt-0.5">
                      {s.address1}
                      {s.address2 && `, ${s.address2}`}
                    </div>
                  )}
                  {(s.city || s.state || s.zip) && (
                    <div className="text-zinc-500 text-[11px] mt-0.5">
                      {[s.city, s.state].filter(Boolean).join(', ')}
                      {s.zip && ` ${s.zip}`}
                    </div>
                  )}
                  {s.code && (
                    <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                      Code: {s.code}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(s.id)}
                  className="text-zinc-400 hover:text-danger p-0.5"
                  aria-label="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={11} aria-hidden />
            Add location
          </Button>
        )}
        {adding && (
          <form
            onSubmit={handleAdd}
            className="bg-white border border-line rounded-control p-2.5 space-y-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={draft.name ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Location name"
                className={inputCls()}
              />
              <input
                type="text"
                value={draft.code ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                placeholder="Code"
                className={inputCls('font-mono uppercase')}
              />
            </div>
            <input
              type="text"
              value={draft.address1 ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, address1: e.target.value }))}
              placeholder="Address line 1"
              className={inputCls()}
            />
            <input
              type="text"
              value={draft.address2 ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, address2: e.target.value }))}
              placeholder="Address line 2 (optional)"
              className={inputCls()}
            />
            <div className="grid grid-cols-4 gap-2">
              <input
                type="text"
                value={draft.city ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
                placeholder="City"
                className={inputCls('col-span-2')}
              />
              <input
                type="text"
                value={draft.state ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value.toUpperCase() }))}
                placeholder="State"
                className={inputCls('uppercase')}
              />
              <input
                type="text"
                value={draft.zip ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, zip: e.target.value }))}
                placeholder="Zip"
                className={inputCls('font-mono')}
              />
            </div>
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" size="sm" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setDraft({});
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

function DetailGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-1.5">
        {heading}
      </div>
      <div className="text-sm space-y-0.5 leading-relaxed">{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Edit modal
// ──────────────────────────────────────────────────────────

const inputClass =
  'w-full h-9 px-2.5 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand';

function CustomerFormModal({
  customer,
  defaultSupplierId,
  onClose,
  onSave,
}: {
  customer: Customer | null;
  /** Used only on create. When admin is filtered to a single supplier,
   *  the new customer is tagged with that supplier_id so per-supplier
   *  views see it without needing an invoice link. */
  defaultSupplierId?: string | null;
  onClose: () => void;
  onSave: (vals: Partial<Customer>) => Promise<void>;
}) {
  const isNew = customer === null;
  const [v, setV] = useState({
    name: customer?.name ?? '',
    code: customer?.code ?? '',
    cor_customer_code: customer?.cor_customer_code ?? '',
    bill_to_name: customer?.bill_to_name ?? '',
    bill_to_address1: customer?.bill_to_address1 ?? '',
    bill_to_address2: customer?.bill_to_address2 ?? '',
    bill_to_city: customer?.bill_to_city ?? '',
    bill_to_state: customer?.bill_to_state ?? '',
    bill_to_zip: customer?.bill_to_zip ?? '',
    ship_to_name: customer?.ship_to_name ?? '',
    ship_to_address1: customer?.ship_to_address1 ?? '',
    ship_to_address2: customer?.ship_to_address2 ?? '',
    ship_to_city: customer?.ship_to_city ?? '',
    ship_to_state: customer?.ship_to_state ?? '',
    ship_to_zip: customer?.ship_to_zip ?? '',
    contact_email: customer?.contact_email ?? '',
    contact_phone: customer?.contact_phone ?? '',
    notes: customer?.notes ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shipSameAsBill, setShipSameAsBill] = useState(
    !customer ||
      (!customer.ship_to_address1 &&
        !customer.ship_to_address2 &&
        !customer.ship_to_city)
  );

  function set<K extends keyof typeof v>(key: K, value: (typeof v)[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!v.name.trim()) {
      setErr('Customer name is required.');
      return;
    }
    if (!v.cor_customer_code.trim()) {
      setErr('Corcentric customer code is required.');
      return;
    }
    setSubmitting(true);
    const payload: Partial<Customer> = {
      name: v.name.trim(),
      code: v.code.trim() || null,
      cor_customer_code: v.cor_customer_code.trim(),
      bill_to_name: v.bill_to_name.trim() || null,
      bill_to_address1: v.bill_to_address1.trim() || null,
      bill_to_address2: v.bill_to_address2.trim() || null,
      bill_to_city: v.bill_to_city.trim() || null,
      bill_to_state: v.bill_to_state.trim() || null,
      bill_to_zip: v.bill_to_zip.trim() || null,
      ship_to_name: shipSameAsBill ? null : v.ship_to_name.trim() || null,
      ship_to_address1: shipSameAsBill ? null : v.ship_to_address1.trim() || null,
      ship_to_address2: shipSameAsBill ? null : v.ship_to_address2.trim() || null,
      ship_to_city: shipSameAsBill ? null : v.ship_to_city.trim() || null,
      ship_to_state: shipSameAsBill ? null : v.ship_to_state.trim() || null,
      ship_to_zip: shipSameAsBill ? null : v.ship_to_zip.trim() || null,
      contact_email: v.contact_email.trim() || null,
      contact_phone: v.contact_phone.trim() || null,
      notes: v.notes.trim() || null,
      // On create, inherit the active supplier scope. On edit, leave the
      // existing supplier_id alone (don't accidentally re-tag).
      ...(isNew && defaultSupplierId
        ? { supplier_id: defaultSupplierId }
        : {}),
    };
    try {
      await onSave(payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      // NOTE: no backdrop click-to-close. A stray click outside the modal
      // would nuke in-progress form input. Users close via X or Cancel.
    >
      <div className="bg-white rounded-card shadow-2 max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-base font-semibold text-ink">
            {isNew ? 'Add customer' : `Edit ${customer?.name}`}
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

        <form
          onSubmit={handleSubmit}
          className="px-5 py-4 space-y-4 overflow-y-auto flex-1"
        >
          {/* Identity */}
          <Group title="Identity">
            <FormRow label="Customer name" required>
              <input
                type="text"
                value={v.name}
                onChange={(e) => set('name', e.target.value)}
                required
                className={inputClass}
              />
            </FormRow>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Internal code" hint="Used for fuzzy matching.">
                <input
                  type="text"
                  value={v.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                  className={cn(inputClass, 'font-mono uppercase')}
                />
              </FormRow>
              <FormRow label="Corcentric code" required hint="DMS customer ID.">
                <input
                  type="text"
                  value={v.cor_customer_code}
                  onChange={(e) =>
                    set('cor_customer_code', e.target.value.toUpperCase())
                  }
                  required
                  className={cn(inputClass, 'font-mono uppercase')}
                />
              </FormRow>
            </div>
          </Group>

          {/* Bill to */}
          <Group title="Bill to">
            <FormRow label="Bill-to name (if different)">
              <input
                type="text"
                value={v.bill_to_name}
                onChange={(e) => set('bill_to_name', e.target.value)}
                placeholder={v.name || 'Defaults to customer name'}
                className={inputClass}
              />
            </FormRow>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <FormRow label="Address line 1">
                  <input
                    type="text"
                    value={v.bill_to_address1}
                    onChange={(e) => set('bill_to_address1', e.target.value)}
                    className={inputClass}
                  />
                </FormRow>
              </div>
              <FormRow label="Address line 2">
                <input
                  type="text"
                  value={v.bill_to_address2}
                  onChange={(e) => set('bill_to_address2', e.target.value)}
                  className={inputClass}
                />
              </FormRow>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <FormRow label="City">
                  <input
                    type="text"
                    value={v.bill_to_city}
                    onChange={(e) => set('bill_to_city', e.target.value)}
                    className={inputClass}
                  />
                </FormRow>
              </div>
              <FormRow label="State">
                <input
                  type="text"
                  value={v.bill_to_state}
                  onChange={(e) => set('bill_to_state', e.target.value.toUpperCase())}
                  className={cn(inputClass, 'uppercase')}
                />
              </FormRow>
              <FormRow label="Zip">
                <input
                  type="text"
                  value={v.bill_to_zip}
                  onChange={(e) => set('bill_to_zip', e.target.value)}
                  className={cn(inputClass, 'font-mono')}
                />
              </FormRow>
            </div>
          </Group>

          {/* Ship to */}
          <Group title="Ship to">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-1">
              <input
                type="checkbox"
                checked={shipSameAsBill}
                onChange={(e) => setShipSameAsBill(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              <span className="text-xs text-ink">Same as bill-to</span>
            </label>
            {!shipSameAsBill && (
              <>
                <FormRow label="Ship-to name (if different)">
                  <input
                    type="text"
                    value={v.ship_to_name}
                    onChange={(e) => set('ship_to_name', e.target.value)}
                    className={inputClass}
                  />
                </FormRow>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <FormRow label="Address line 1">
                      <input
                        type="text"
                        value={v.ship_to_address1}
                        onChange={(e) => set('ship_to_address1', e.target.value)}
                        className={inputClass}
                      />
                    </FormRow>
                  </div>
                  <FormRow label="Address line 2">
                    <input
                      type="text"
                      value={v.ship_to_address2}
                      onChange={(e) => set('ship_to_address2', e.target.value)}
                      className={inputClass}
                    />
                  </FormRow>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <FormRow label="City">
                      <input
                        type="text"
                        value={v.ship_to_city}
                        onChange={(e) => set('ship_to_city', e.target.value)}
                        className={inputClass}
                      />
                    </FormRow>
                  </div>
                  <FormRow label="State">
                    <input
                      type="text"
                      value={v.ship_to_state}
                      onChange={(e) =>
                        set('ship_to_state', e.target.value.toUpperCase())
                      }
                      className={cn(inputClass, 'uppercase')}
                    />
                  </FormRow>
                  <FormRow label="Zip">
                    <input
                      type="text"
                      value={v.ship_to_zip}
                      onChange={(e) => set('ship_to_zip', e.target.value)}
                      className={cn(inputClass, 'font-mono')}
                    />
                  </FormRow>
                </div>
              </>
            )}
          </Group>

          {/* Contact */}
          <Group title="Contact">
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Email">
                <input
                  type="email"
                  value={v.contact_email}
                  onChange={(e) => set('contact_email', e.target.value)}
                  className={cn(inputClass, 'font-mono')}
                />
              </FormRow>
              <FormRow label="Phone">
                <input
                  type="tel"
                  value={v.contact_phone}
                  onChange={(e) => set('contact_phone', e.target.value)}
                  className={cn(inputClass, 'font-mono')}
                />
              </FormRow>
            </div>
          </Group>

          {/* Notes */}
          <Group title="Notes">
            <textarea
              value={v.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="w-full px-2.5 py-2 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 focus:border-brand focus:shadow-ring-brand resize-y"
            />
          </Group>

          {err && (
            <div className="text-xs text-danger flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {err}
            </div>
          )}
        </form>

        <div className="border-t border-line px-5 py-3.5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={submitting}
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
          >
            {submitting ? 'Saving…' : isNew ? 'Create customer' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-2">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

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
