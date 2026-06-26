import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Plus, Pencil, X, AlertTriangle, Mail } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppShell } from '@/components/AppShell';

/**
 * Teams admin (Wave 6a).
 *
 * Manages internal team users — people who can sign in as admin and review
 * invoices across all suppliers. The same /api/team endpoints also handle
 * supplier-portal users (role: 'supplier'), but per-supplier user assignment
 * lives in the Suppliers admin (out of scope for v1).
 *
 * API contracts:
 *   GET    /api/team                    list all members
 *   POST   /api/team/invite             { email, display_name, role, supplier_ids? }
 *   PATCH  /api/team/:id                { role?, display_name? }
 *   POST   /api/team/:id/deactivate
 *   POST   /api/team/:id/reactivate
 *   DELETE /api/team/:id
 */

type TeamRole = 'admin' | 'team' | 'supplier';

interface TeamMember {
  id: string;
  email: string;
  display_name: string | null;
  role: TeamRole;
  active: boolean;
  last_sign_in_at?: string | null;
  created_at: string;
}

type ConfirmAction =
  | { kind: 'deactivate'; member: TeamMember }
  | { kind: 'reactivate'; member: TeamMember }
  | { kind: 'delete'; member: TeamMember };

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

export default function TeamsPage({ role, userId, userEmail }: PageProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    fetchMembers();
  }, []);

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

  async function fetchMembers() {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/team');
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const list: TeamMember[] = Array.isArray(body) ? body : body?.data ?? [];
      // Show internal team users at top, then supplier users below.
      list.sort((a, b) => {
        const rankA = a.role === 'supplier' ? 1 : 0;
        const rankB = b.role === 'supplier' ? 1 : 0;
        if (rankA !== rankB) return rankA - rankB;
        return (a.display_name || a.email).localeCompare(b.display_name || b.email);
      });
      setMembers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(values: InviteValues) {
    const res = await authFetch('/api/team/invite', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    await fetchMembers();
  }

  async function handleEditSave(values: EditValues, id: string) {
    const res = await authFetch(`/api/team/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    await fetchMembers();
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, member } = confirm;
    let path = '';
    let method: 'POST' | 'DELETE' = 'POST';
    if (kind === 'deactivate') path = `/api/team/${member.id}/deactivate`;
    else if (kind === 'reactivate') path = `/api/team/${member.id}/reactivate`;
    else if (kind === 'delete') {
      path = `/api/team/${member.id}`;
      method = 'DELETE';
    }
    const res = await authFetch(path, { method });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(body?.error || `Failed: HTTP ${res.status}`);
      return;
    }
    setConfirm(null);
    await fetchMembers();
  }

  return (
    <AppShell role={role} userId={userId} userEmail={userEmail} breadcrumb="Teams">
    <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-5">
      <div className="flex items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Teams</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Internal team users who can sign in to review invoices and manage
            suppliers. Supplier portal users appear here too — they only see
            invoices for their supplier.
          </p>
        </div>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setInviting(true)}>
            <Plus size={13} aria-hidden />
            Invite member
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-paper border-b border-line">
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Last sign-in</Th>
              <Th>Status</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <div className="inline-flex items-center gap-2 text-sm text-zinc-500">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-zinc-200 border-t-ink" />
                    Loading members…
                  </div>
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-sm text-zinc-500">
                    No members yet. Invite someone to get started.
                  </p>
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr
                  key={m.id}
                  className={cn(
                    'border-b border-line last:border-b-0 transition-colors',
                    !m.active && 'opacity-60'
                  )}
                >
                  <Td>
                    <div className="font-semibold text-ink">
                      {m.display_name || <span className="text-zinc-400 italic">no name</span>}
                    </div>
                  </Td>
                  <Td className="font-mono text-zinc-700 text-[12px]">{m.email}</Td>
                  <Td>
                    <RolePill role={m.role} />
                  </Td>
                  <Td className="text-zinc-500 font-mono text-[12px]">
                    {relTime(m.last_sign_in_at) ?? <span className="text-zinc-400">never</span>}
                  </Td>
                  <Td>
                    {m.active ? (
                      <Pill variant="submitted">Active</Pill>
                    ) : (
                      <Pill variant="neutral">Inactive</Pill>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="secondary" size="sm" onClick={() => setEditing(m)}>
                        <Pencil size={12} aria-hidden />
                        Edit
                      </Button>
                      {m.active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirm({ kind: 'deactivate', member: m })}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirm({ kind: 'reactivate', member: m })}
                        >
                          Reactivate
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirm({ kind: 'delete', member: m })}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onSave={async (values) => {
            await handleInvite(values);
            setInviting(false);
          }}
        />
      )}

      {editing && (
        <EditModal
          member={editing}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            await handleEditSave(values, editing.id);
            setEditing(null);
          }}
        />
      )}

      {confirm && (
        <ConfirmModal
          action={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={runConfirm}
        />
      )}
    </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers + sub-components
// ──────────────────────────────────────────────────────────

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`text-${align} text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.06em] px-4 py-2.5 whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`text-${align} text-[13px] px-4 py-3 align-top ${className}`}>
      {children}
    </td>
  );
}

function RolePill({ role }: { role: TeamRole }) {
  const labels: Record<TeamRole, { label: string; variant: React.ComponentProps<typeof Pill>['variant'] }> = {
    admin: { label: 'Admin', variant: 'processed' },
    team: { label: 'Admin', variant: 'processed' },
    supplier: { label: 'Supplier', variant: 'neutral' },
  };
  const { label, variant } = labels[role] ?? { label: role, variant: 'neutral' as const };
  return (
    <Pill variant={variant} hideDot className="text-[10px]">
      {label}
    </Pill>
  );
}

function relTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const inputClass =
  'w-full h-9 px-2.5 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand';

interface InviteValues {
  email: string;
  display_name: string;
  role: 'admin' | 'supplier';
  supplier_ids?: string[];
}

function InviteModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (v: InviteValues) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'supplier'>('admin');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim() || !name.trim()) {
      setErr('Email and name are required.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        email: email.trim().toLowerCase(),
        display_name: name.trim(),
        role,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-base font-semibold text-ink">Invite team member</h3>
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
          <p className="text-xs text-zinc-500">
            We'll email them a magic link to set their password and access the
            portal at their assigned role.
          </p>
          <FormRow label="Display name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputClass}
            />
          </FormRow>
          <FormRow label="Email" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={cn(inputClass, 'font-mono')}
            />
          </FormRow>
          <FormRow label="Role" required>
            <div className="flex gap-2">
              {(['admin', 'supplier'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    'flex-1 px-3 h-9 rounded-control border text-[13px] font-medium capitalize transition-colors',
                    role === r
                      ? 'bg-ink text-white border-ink'
                      : 'bg-white text-ink border-line-2 hover:border-zinc-300'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {role === 'admin'
                ? 'Sees invoices across all suppliers; can manage settings.'
                : 'Sees only their assigned supplier’s invoices.'}
            </p>
          </FormRow>

          {err && (
            <div className="text-xs text-danger flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              <Mail size={13} aria-hidden />
              {submitting ? 'Sending…' : 'Send invite'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditValues {
  display_name?: string;
  role?: TeamRole;
}

function EditModal({
  member,
  onClose,
  onSave,
}: {
  member: TeamMember;
  onClose: () => void;
  onSave: (v: EditValues) => Promise<void>;
}) {
  const [name, setName] = useState(member.display_name || '');
  const [role, setRole] = useState<TeamRole>(member.role);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const changes: EditValues = {};
    if (name.trim() !== (member.display_name || '')) changes.display_name = name.trim();
    if (role !== member.role) changes.role = role;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    try {
      await onSave(changes);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-base font-semibold text-ink">
            Edit {member.display_name || member.email}
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
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <FormRow label="Email">
            <input
              type="email"
              value={member.email}
              disabled
              className={cn(inputClass, 'font-mono bg-paper text-zinc-500')}
            />
            <p className="text-[11px] text-zinc-500 mt-1">Email is locked once a member is invited.</p>
          </FormRow>
          <FormRow label="Display name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </FormRow>
          <FormRow label="Role">
            <div className="flex gap-2">
              {(['admin', 'supplier'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    'flex-1 px-3 h-9 rounded-control border text-[13px] font-medium capitalize transition-colors',
                    role === r
                      ? 'bg-ink text-white border-ink'
                      : 'bg-white text-ink border-line-2 hover:border-zinc-300'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </FormRow>

          {err && (
            <div className="text-xs text-danger flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({
  action,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const { kind, member } = action;
  const who = member.display_name || member.email;

  const title =
    kind === 'deactivate'
      ? `Deactivate ${who}?`
      : kind === 'reactivate'
      ? `Reactivate ${who}?`
      : `Permanently delete ${who}?`;
  const body =
    kind === 'deactivate'
      ? `Disables ${who}'s login. They won't be able to access the portal until reactivated. Their data is preserved.`
      : kind === 'reactivate'
      ? `${who} will be able to sign in again.`
      : `This cannot be undone. Permanently removes ${who}, their profile, and all supplier assignments.`;

  const confirmLabel =
    kind === 'deactivate' ? 'Deactivate' : kind === 'reactivate' ? 'Reactivate' : 'Delete';
  const variant: 'primary' | 'danger' = kind === 'delete' ? 'danger' : 'primary';

  async function go() {
    setPending(true);
    await onConfirm();
    setPending(false);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-sm w-full p-5">
        <div className="flex items-start gap-3 mb-3">
          {kind === 'delete' && (
            <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          )}
          <div>
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            <p className="text-sm text-zinc-700 mt-1.5">{body}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant={variant} onClick={go} disabled={pending}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FormRow({
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
      <label className="flex items-center gap-1 text-xs font-medium text-zinc-700 mb-1.5">
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
