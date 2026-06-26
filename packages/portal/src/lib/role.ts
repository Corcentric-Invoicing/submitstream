// Single source of truth for portal role identity.
//
// Used to live as five separate `type Role = 'admin' | 'team' | 'supplier'`
// declarations across App.tsx, AppShell.tsx, useAppState.ts,
// InvoiceReview.tsx, and InvoicesPage.tsx, plus five inline
// `isAdmin = role === 'admin' || role === 'team'` checks. Adding a new
// role meant chasing every site. This module is the canonical home.
//
// Note on the legacy `'team'` value: the original schema had separate
// admin and team tiers; the team tier collapsed into admin during the
// rebuild but `user_profiles` rows in production may still carry it,
// so `isAdmin()` accepts both.

export type Role = 'admin' | 'team' | 'supplier';

/** All roles the app understands. Used by App.tsx for the
 *  type-narrowing guard before rendering authenticated routes. */
export const KNOWN_ROLES = ['admin', 'team', 'supplier'] as const;

/** Type-narrowing guard. Returns true if the value is a Role we
 *  recognize, false for null / unknown / future-but-unreleased roles. */
export function isKnownRole(role: string | null | undefined): role is Role {
  if (!role) return false;
  return (KNOWN_ROLES as readonly string[]).includes(role);
}

/** Admin-equivalent check. Treats `'team'` as admin for backward
 *  compatibility with the legacy schema. Use this everywhere instead
 *  of inlining the OR — adding a new admin-equivalent role becomes a
 *  one-line change here. */
export function isAdmin(role: Role | string | null | undefined): boolean {
  return role === 'admin' || role === 'team';
}
