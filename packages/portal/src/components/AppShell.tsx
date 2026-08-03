import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Supplier } from '../types/invoice';
import { useAppState } from '../lib/useAppState';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';
import {
  ChevronsUpDown,
  CheckCircle2,
  Clock,
  Send,
  XCircle,
  Inbox,
  Users,
  Building2,
  Plug,
  Settings as SettingsIcon,
  Activity,
  ShieldCheck,
  Network,
  UserCog,
  Search,
  Bell,
  HelpCircle,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Persistent application shell — left sidebar + top breadcrumb bar.
 *
 * Sidebar:
 *   - Wordmark + workspace scope (supplier name; clickable picker for admin)
 *   - WORKSPACE   (Invoices + status counts)
 *   - DIRECTORY   (Customers, Suppliers, Submissions)
 *   - ADMIN       (Admin console, Activity log, Settings — admin only)
 *   - User chip   (avatar, name/email, role, sign out)
 *
 * Top bar:
 *   - Breadcrumb showing current section
 *   - Global search input (cmd+K affordance)
 *   - Notifications + help bells
 *
 * Used by every authenticated page. Renders {children} as the inner page.
 */

import type { Role } from '../lib/role';
import { isAdmin as isRoleAdmin } from '../lib/role';

interface Counts {
  total: number;
  pending: number;
  processed: number;
  submitted: number;
  rejected: number;
}

interface AppShellProps {
  role: Role;
  userId: string;
  userEmail: string | undefined;
  /** Page title shown after the workspace breadcrumb. */
  breadcrumb: string;
  /** Optional override for sidebar counts. If omitted, AppShell fetches its own. */
  counts?: Counts;
  /** Search field placeholder. */
  searchPlaceholder?: string;
  /** Search field value (controlled by parent). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  children: React.ReactNode;
}

export function AppShell({
  role,
  userId,
  userEmail,
  breadcrumb,
  counts: countsProp,
  searchPlaceholder = 'Search invoices, suppliers…',
  searchValue,
  onSearchChange,
  children,
}: AppShellProps) {
  // Shared scope state from URL (?supplier=<id>) + suppliers list.
  const { supplierScope, suppliers, scopedSupplierName, setSupplierScope } =
    useAppState(role, userId);

  // Pull the caller's display_name so we can personalize the supplier
  // welcome ("Welcome Dustin"). Cheap one-shot query — RLS lets a user read
  // their own profile via user_profiles_self_read.
  const [displayName, setDisplayName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('display_name')
        .eq('id', userId)
        .single();
      if (!cancelled) setDisplayName((data as { display_name?: string } | null)?.display_name ?? null);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Internal counts fetcher — sidebar badges. Re-fetches whenever the
  // supplier scope changes. If the parent provided counts (e.g. the
  // InvoicesPage already has them in memory), use those instead.
  const [internalCounts, setInternalCounts] = useState<Counts>({
    total: 0,
    pending: 0,
    processed: 0,
    submitted: 0,
    rejected: 0,
  });

  useEffect(() => {
    if (countsProp) return; // parent supplied them; skip fetch
    let cancelled = false;
    (async () => {
      let q = supabase.from('invoices').select('status', { count: 'exact', head: false });
      if (supplierScope !== 'all') q = q.eq('supplier_id', supplierScope);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data as { status: string }[] | null) ?? [];
      const c: Counts = { total: 0, pending: 0, processed: 0, submitted: 0, rejected: 0 };
      for (const r of rows) {
        c.total++;
        if (r.status === 'pending') c.pending++;
        else if (r.status === 'processed') c.processed++;
        else if (r.status === 'submitted') c.submitted++;
        else if (r.status === 'rejected') c.rejected++;
      }
      setInternalCounts(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [supplierScope, countsProp]);

  const counts: Counts = countsProp ?? internalCounts;
  const onChangeSupplierScope = setSupplierScope;
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = isRoleAdmin(role);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Close the supplier picker when route changes
  useEffect(() => {
    setPickerOpen(false);
  }, [location.pathname]);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // The status-filtered invoice "sub-items" navigate to /invoices?status=...
  // The active state matches both pathname AND query param.
  const currentStatus = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    return sp.get('status') ?? 'all';
  }, [location.search]);

  const onInvoicesPage = location.pathname.startsWith('/invoices');

  function gotoStatus(status: string) {
    if (status === 'all') navigate('/invoices');
    else navigate(`/invoices?status=${status}`);
  }

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* ═══════ Sidebar ═══════ */}
      <aside
        className="w-[240px] shrink-0 border-r border-line bg-white flex flex-col"
        style={{ minHeight: '100vh', position: 'sticky', top: 0, height: '100vh' }}
      >
        {/* Header: workspace scope */}
        <div className="px-3 pt-4 pb-3 border-b border-line">
          <button
            type="button"
            onClick={() => isAdmin && setPickerOpen((o) => !o)}
            disabled={!isAdmin}
            className={cn(
              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-control text-left transition-colors relative',
              isAdmin && 'hover:bg-paper'
            )}
          >
            <span
              className="h-9 w-9 rounded-control inline-flex items-center justify-center shrink-0"
              style={{ background: 'var(--ink)' }}
            >
              <SubmitStreamLogo variant="dark" mark="icon" size="sm" />
            </span>
            <span className="min-w-0 flex-1">
              {isAdmin ? (
                <>
                  <span className="block text-[13px] font-semibold text-ink leading-tight truncate">
                    SubmitStream
                  </span>
                  <span className="block text-[11px] text-zinc-500 leading-tight truncate mt-0.5">
                    {scopedSupplierName}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-[13px] font-semibold text-ink leading-tight truncate">
                    {scopedSupplierName}
                  </span>
                  <span className="block text-[11px] text-zinc-500 leading-tight truncate mt-0.5">
                    Welcome {displayName || 'back'}
                  </span>
                </>
              )}
            </span>
            {isAdmin && (
              <ChevronsUpDown size={13} aria-hidden className="text-zinc-400 shrink-0" />
            )}
          </button>

          {/* Supplier picker dropdown */}
          {pickerOpen && isAdmin && (
            <div className="mt-1 bg-white border border-line rounded-control shadow-2 max-h-72 overflow-y-auto z-30 absolute top-[68px] left-3 right-3 w-[216px]">
              <button
                type="button"
                onClick={() => {
                  onChangeSupplierScope('all');
                  setPickerOpen(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 text-[13px] hover:bg-paper border-b border-line',
                  supplierScope === 'all' && 'bg-paper font-medium'
                )}
              >
                All suppliers
              </button>
              {suppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onChangeSupplierScope(s.id);
                    setPickerOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-[13px] hover:bg-paper border-b last:border-b-0 border-line',
                    supplierScope === s.id && 'bg-paper font-medium'
                  )}
                >
                  <div className="text-ink">{s.name}</div>
                  <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{s.code}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <NavSection title="Workspace">
            <NavItem
              icon={<Inbox size={14} />}
              to="/invoices"
              active={onInvoicesPage && currentStatus === 'all'}
              count={counts.total}
              onClick={(e) => {
                e.preventDefault();
                gotoStatus('all');
              }}
            >
              Invoices
            </NavItem>
            <NavItem
              icon={<Clock size={14} />}
              to="/invoices?status=pending"
              active={onInvoicesPage && currentStatus === 'pending'}
              count={counts.pending}
              onClick={(e) => {
                e.preventDefault();
                gotoStatus('pending');
              }}
            >
              Awaiting review
            </NavItem>
            <NavItem
              icon={<Send size={14} />}
              to="/invoices?status=processed"
              active={onInvoicesPage && currentStatus === 'processed'}
              count={counts.processed}
              onClick={(e) => {
                e.preventDefault();
                gotoStatus('processed');
              }}
            >
              Ready to submit
            </NavItem>
            <NavItem
              icon={<CheckCircle2 size={14} />}
              to="/invoices?status=submitted"
              active={onInvoicesPage && currentStatus === 'submitted'}
              count={counts.submitted}
              onClick={(e) => {
                e.preventDefault();
                gotoStatus('submitted');
              }}
            >
              Submitted to DMS
            </NavItem>
            <NavItem
              icon={<XCircle size={14} />}
              to="/invoices?status=rejected"
              active={onInvoicesPage && currentStatus === 'rejected'}
              count={counts.rejected}
              onClick={(e) => {
                e.preventDefault();
                gotoStatus('rejected');
              }}
            >
              Rejected
            </NavItem>
          </NavSection>

          <NavSection title="Directory">
            <NavItem icon={<Users size={14} />} to="/customers">
              Customers
            </NavItem>
            <NavItem icon={<Send size={14} />} to="/submissions">
              Submissions
            </NavItem>
          </NavSection>

          {isAdmin && (
            <NavSection title="Admin">
              <NavItem icon={<ShieldCheck size={14} />} to="/admin/console">
                Admin console
              </NavItem>
              <NavItem icon={<Network size={14} />} to="/admin/communities">
                Communities
              </NavItem>
              <NavItem icon={<Building2 size={14} />} to="/suppliers">
                Suppliers
              </NavItem>
              <NavItem icon={<Plug size={14} />} to="/admin/promostandards">
                PromoStandards
              </NavItem>
              <NavItem icon={<UserCog size={14} />} to="/admin/teams">
                Teams
              </NavItem>
              <NavItem icon={<Activity size={14} />} to="/admin/activity">
                Activity log
              </NavItem>
              <NavItem icon={<SettingsIcon size={14} />} to="/admin/settings">
                Settings
              </NavItem>
            </NavSection>
          )}
        </nav>

        {/* User chip footer */}
        <div className="border-t border-line px-2 py-2">
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-control text-left hover:bg-paper transition-colors group"
          >
            <span
              className="h-7 w-7 rounded-control inline-flex items-center justify-center shrink-0 text-[11px] font-semibold text-white"
              style={{ background: 'var(--ink)' }}
            >
              {(userEmail ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-ink leading-tight truncate">
                {userEmail ?? 'Account'}
              </span>
              <span className="block text-[10px] text-zinc-500 leading-tight truncate mt-0.5 capitalize">
                {role === 'team' ? 'admin' : role}
              </span>
            </span>
            <LogOut size={13} aria-hidden className="text-zinc-400 group-hover:text-ink shrink-0" />
          </button>
        </div>
      </aside>

      {/* ═══════ Main column ═══════ */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar: breadcrumb + search + bells */}
        <header className="bg-white border-b border-line">
          <div className="px-7 h-14 flex items-center gap-4">
            <div className="flex items-center gap-2 text-[13px] text-zinc-500 min-w-0">
              <span className="text-zinc-500">Workspace</span>
              <span className="text-zinc-300">/</span>
              <span className="text-ink font-medium truncate">{breadcrumb}</span>
            </div>
            <div className="flex-1" />
            {onSearchChange && (
              <div className="relative w-[320px] max-w-[40%]">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                  aria-hidden
                />
                <input
                  type="text"
                  value={searchValue ?? ''}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full h-9 pl-8 pr-12 bg-paper border border-line-2 rounded-control text-[13px] text-ink placeholder:text-zinc-400 outline-none focus:border-brand focus:shadow-ring-brand"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-[10px] font-mono text-zinc-400">
                  <kbd className="px-1 py-0.5 rounded bg-white border border-line">⌘</kbd>
                  <kbd className="px-1 py-0.5 rounded bg-white border border-line">K</kbd>
                </span>
              </div>
            )}
            <button
              type="button"
              className="h-8 w-8 inline-flex items-center justify-center rounded-control text-zinc-500 hover:text-ink hover:bg-paper transition-colors"
              aria-label="Notifications"
            >
              <Bell size={15} />
            </button>
            <button
              type="button"
              className="h-8 w-8 inline-flex items-center justify-center rounded-control text-zinc-500 hover:text-ink hover:bg-paper transition-colors"
              aria-label="Help"
            >
              <HelpCircle size={15} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Nav helpers
// ──────────────────────────────────────────────────────────

function NavSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] font-semibold text-zinc-400">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavItem({
  icon,
  to,
  count,
  active,
  onClick,
  children,
}: {
  icon?: React.ReactNode;
  to: string;
  count?: number;
  /** Override active matching; otherwise NavLink computes from pathname. */
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  // If `active` is provided, control the styling explicitly. Otherwise use
  // NavLink's own activeness. We render NavLink either way so right-click /
  // open-in-new-tab works.
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) => {
        const isOn = active ?? isActive;
        return cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-control text-[13px] transition-colors',
          isOn
            ? 'bg-paper text-ink font-medium'
            : 'text-zinc-600 hover:text-ink hover:bg-paper'
        );
      }}
    >
      {icon && (
        <span className="text-zinc-500 group-[.active]:text-ink shrink-0">
          {icon}
        </span>
      )}
      <span className="flex-1 truncate">{children}</span>
      {typeof count === 'number' && (
        <span className="text-[11px] font-num text-zinc-500">{count}</span>
      )}
    </NavLink>
  );
}
