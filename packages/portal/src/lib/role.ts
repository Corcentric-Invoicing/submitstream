// Single source of truth for portal role identity.
//
// Roles: 'admin' and 'supplier'. The legacy 'team' tier was retired
// (RSK-17) — no live users held it, DB check constraint blocks new ones.
// If a stray 'team' row appears via a manual DB edit, isKnownRole()
// returns false so the app treats it as unauthenticated rather than
// silently promoting to admin.

export type Role = 'admin' | 'supplier';

/** All roles the app understands. Used by App.tsx for the
 *  type-narrowing guard before rendering authenticated routes. */
export const KNOWN_ROLES = ['admin', 'supplier'] as const;

/** Type-narrowing guard. Returns true if the value is a Role we
 *  recognize, false for null / unknown / future-but-unreleased roles. */
export function isKnownRole(role: string | null | undefined): role is Role {
  if (!role) return false;
  return (KNOWN_ROLES as readonly string[]).includes(role);
}

/** Admin check. Kept as a helper so future role additions (e.g.
 *  'billing_admin', 'read_only') route through one call site instead
 *  of scattered inline comparisons. */
export function isAdmin(role: Role | string | null | undefined): boolean {
  return role === 'admin';
}
