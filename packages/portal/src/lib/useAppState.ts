import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from './supabase';
import type { Supplier } from '../types/invoice';

/**
 * Shared app state hook used by every shell-wrapped page.
 *
 *   - supplierScope     URL-driven (?supplier=<id> or "all"). For supplier-
 *                       role users, locked to their own supplier_id.
 *   - suppliers         Cached list (admin only).
 *   - scopedSupplierName Resolved display name for breadcrumb / sidebar.
 *   - setSupplierScope  Updates the URL search param.
 *
 * URL-as-state-of-truth means switching scope from the sidebar AppShell
 * picker propagates to whichever page is mounted, and a refresh
 * preserves the scope.
 */

import type { Role } from './role';
import { isAdmin as isRoleAdmin } from './role';

export interface AppState {
  supplierScope: string; // 'all' or a supplier UUID
  suppliers: Supplier[];
  scopedSupplierName: string;
  setSupplierScope: (id: string) => void;
}

export function useAppState(role: Role, userId: string): AppState {
  const isAdmin = isRoleAdmin(role);
  const [params, setParams] = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierLockId, setSupplierLockId] = useState<string | null>(null);

  // ── Resolve scope ──
  // Admin: read from URL, default 'all'
  // Supplier: locked to their own supplier_id (loaded from user_profiles)
  const urlScope = params.get('supplier') || 'all';

  // For supplier role, override URL scope with their locked supplier ID.
  const supplierScope = !isAdmin && supplierLockId ? supplierLockId : urlScope;

  // Fetch suppliers (admin) or just the user's own supplier (non-admin).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isAdmin) {
        const { data } = await supabase
          .from('suppliers')
          .select('*')
          .eq('active', true)
          .order('name', { ascending: true });
        if (!cancelled) setSuppliers((data as Supplier[]) ?? []);
      } else {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('supplier_id')
          .eq('id', userId)
          .single();
        const sid = (profile as { supplier_id?: string } | null)?.supplier_id ?? null;
        if (!sid || cancelled) return;
        setSupplierLockId(sid);
        const { data: s } = await supabase
          .from('suppliers')
          .select('*')
          .eq('id', sid)
          .single();
        if (!cancelled && s) setSuppliers([s as Supplier]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, userId]);

  const scopedSupplierName =
    supplierScope === 'all'
      ? 'All suppliers'
      : suppliers.find((s) => s.id === supplierScope)?.name ?? '—';

  const setSupplierScope = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      if (id === 'all') next.delete('supplier');
      else next.set('supplier', id);
      setParams(next, { replace: false });
    },
    [params, setParams]
  );

  return {
    supplierScope,
    suppliers,
    scopedSupplierName,
    setSupplierScope,
  };
}
