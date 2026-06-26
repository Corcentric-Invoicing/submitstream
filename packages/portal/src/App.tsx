import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import { TermsAcceptanceGate } from './components/TermsAcceptanceGate';
import { ErrorBoundary } from './components/ErrorBoundary';

// Pages
import LoginPage from './pages/LoginPage';
import InvoicesPage from './pages/InvoicesPage';
import TermsPage from './pages/TermsPage';
import SuppliersPage from './pages/admin/SuppliersPage';
import TeamsPage from './pages/admin/TeamsPage';
import PromoStandardsPage from './pages/admin/PromoStandardsPage';
import CustomersPage from './pages/admin/CustomersPage';
import SubmissionsPage from './pages/admin/SubmissionsPage';
import CommunitiesPage from './pages/admin/CommunitiesPage';
import AdminConsolePage from './pages/admin/AdminConsolePage';
import SettingsPage from './pages/admin/SettingsPage';
import ActivityLogPage from './pages/admin/ActivityLogPage';

/**
 * Role taxonomy lives in lib/role.ts. Anything else (null / unknown /
 * a future-but-unreleased role) is blocked with a clear error screen
 * instead of being pinballed between /login and /invoices in a redirect
 * loop. See the NoAccess fallback below.
 */
import type { Role } from './lib/role';
import { isKnownRole, isAdmin as isRoleAdmin } from './lib/role';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Set true whenever we have a session but haven't yet resolved its role.
  // Prevents the "Account not configured" flash that fires between
  // setSession(session) and fetchUserRole() resolving.
  const [resolvingRole, setResolvingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  // Tracks the user_id we last resolved a role for. The supabase client
  // fires SIGNED_IN/TOKEN_REFRESHED on every tab focus when it does a
  // session recovery — without this guard, every focus would re-fetch
  // role, re-render App, and cascade into every page's useEffect firing
  // again. We compare auth events against this ref and skip everything
  // if the user is the same.
  const resolvedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Initial session check.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        resolvedUserIdRef.current = session.user.id;
        setResolvingRole(true);
        fetchUserRole(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Subsequent auth state changes.
    //
    // The supabase v2 client fires SIGNED_IN, TOKEN_REFRESHED, and
    // USER_UPDATED at various points — and crucially, it can fire
    // SIGNED_IN on tab-focus session recovery, not just first sign-in.
    // Branching on event name alone isn't enough; we have to compare the
    // resolved user_id to detect "this is actually a new login" vs
    // "same user, just keeping the session warm."
    //
    // The earlier bug: every tab focus → SIGNED_IN → setUserRole(null)
    // → resolvingRole=true → BrandedSpinner full-screen → routes
    // unmount → fetchUserRole resolves → routes re-mount → every page
    // re-runs every useEffect → cascading fetch storm + state loss.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Sign-out / no session → wipe everything.
      if (event === 'SIGNED_OUT' || !session) {
        setSession(null);
        setUserRole(null);
        setRoleError(null);
        setResolvingRole(false);
        setLoading(false);
        resolvedUserIdRef.current = null;
        return;
      }
      // Same user as the one we already resolved → silently keep going.
      // We deliberately do NOT call setSession here: that would create
      // a new session reference, force App.tsx to re-render, and (because
      // sharedProps is a new object literal) cascade through every child.
      // The supabase client itself has the refreshed JWT internally, so
      // all subsequent .from() / .functions calls use it without us
      // touching React state.
      if (resolvedUserIdRef.current === session.user.id) {
        return;
      }
      // Different user — actual fresh login. Reset and re-resolve.
      resolvedUserIdRef.current = session.user.id;
      setSession(session);
      setUserRole(null);
      setRoleError(null);
      setResolvingRole(true);
      fetchUserRole(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserRole(userId: string) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error) {
      // Most common cause: no row in user_profiles for this auth user.
      // Surface it instead of silently falling through to a redirect loop.
      setRoleError(
        error.code === 'PGRST116'
          ? 'No profile row found for this account in user_profiles. An admin needs to create one before you can sign in.'
          : `Failed to load profile: ${error.message}`
      );
      setUserRole(null);
    } else {
      setUserRole(data?.role || null);
      setRoleError(null);
    }
    setResolvingRole(false);
    setLoading(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // Initial auth check OR an in-flight role lookup (post-login).
  // Same branded loader for both so there's no flash of NoAccess
  // between login completing and the role fetch resolving.
  if (loading || resolvingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <BrandedSpinner size="lg" />
      </div>
    );
  }

  // Authenticated, role fetched, but the role is missing or unknown.
  // Real configuration issue — show the explanation card.
  if (session && (!userRole || !isKnownRole(userRole))) {
    return (
      <NoAccess
        email={session.user.email}
        userId={session.user.id}
        roleValue={userRole}
        roleError={roleError}
        onSignOut={handleSignOut}
      />
    );
  }

  // Authenticated pages all render their own AppShell internally;
  // App.tsx just hands them role + identity props and gates on session.
  const isAdmin = isRoleAdmin(userRole);
  const sharedProps =
    session && userRole && isKnownRole(userRole)
      ? {
          role: userRole as Role,
          userId: session.user.id,
          userEmail: session.user.email,
        }
      : null;

  function gate(element: React.ReactNode, scope: string, adminOnly = false) {
    if (!sharedProps) return <Navigate to="/login" replace />;
    if (adminOnly && !isAdmin) return <Navigate to="/invoices" replace />;
    return <ErrorBoundary scope={scope}>{element}</ErrorBoundary>;
  }

  return (
    <>
      <Routes>
        {/* Public — no auth gate. */}
        <Route
          path="/terms"
          element={
            <ErrorBoundary scope="Terms">
              <TermsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/login"
          element={
            <ErrorBoundary scope="Login">
              {session ? <Navigate to="/invoices" replace /> : <LoginPage />}
            </ErrorBoundary>
          }
        />

        {/* Workspace */}
        <Route
          path="/invoices"
          element={gate(
            sharedProps && <InvoicesPage {...sharedProps} />,
            'Invoices'
          )}
        />
        {/* Invoice review is a child segment so the URL survives refresh
            and the back-button does the right thing. The same InvoicesPage
            component renders both — it reads :invoiceId from useParams. */}
        <Route
          path="/invoices/:invoiceId"
          element={gate(
            sharedProps && <InvoicesPage {...sharedProps} />,
            'Invoices'
          )}
        />

        {/* Directory */}
        <Route
          path="/customers"
          element={gate(
            sharedProps && <CustomersPage {...sharedProps} />,
            'Customers'
          )}
        />
        <Route
          path="/submissions"
          element={gate(
            sharedProps && <SubmissionsPage {...sharedProps} />,
            'Submissions'
          )}
        />

        {/* Admin */}
        <Route
          path="/suppliers"
          element={gate(
            sharedProps && <SuppliersPage {...sharedProps} />,
            'Suppliers',
            true
          )}
        />
        <Route
          path="/admin/console"
          element={gate(
            sharedProps && <AdminConsolePage {...sharedProps} />,
            'Admin console',
            true
          )}
        />
        <Route
          path="/admin/activity"
          element={gate(
            sharedProps && <ActivityLogPage {...sharedProps} />,
            'Activity log',
            true
          )}
        />
        <Route
          path="/admin/settings"
          element={gate(
            sharedProps && <SettingsPage {...sharedProps} />,
            'Settings',
            true
          )}
        />
        <Route
          path="/admin/communities"
          element={gate(
            sharedProps && <CommunitiesPage {...sharedProps} />,
            'Communities',
            true
          )}
        />
        <Route
          path="/admin/teams"
          element={gate(
            sharedProps && <TeamsPage {...sharedProps} />,
            'Teams',
            true
          )}
        />
        <Route
          path="/admin/promostandards"
          element={gate(
            sharedProps && <PromoStandardsPage {...sharedProps} />,
            'PromoStandards',
            true
          )}
        />
        <Route
          path="/admin"
          element={gate(
            <Navigate to="/admin/console" replace />,
            'Admin',
            true
          )}
        />

        {/* Backward-compat */}
        <Route path="/team/*" element={<Navigate to="/invoices" replace />} />
        <Route path="/supplier/*" element={<Navigate to="/invoices" replace />} />
        <Route path="/" element={<Navigate to="/invoices" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      {/* ToS gate: self-fetches /api/me, blocks the portal until the
          user has accepted the current terms version. Hides itself
          once accepted. */}
      {session && <TermsAcceptanceGate userId={session.user.id} />}
    </>
  );
}

function NoAccess({
  email,
  userId,
  roleValue,
  roleError,
  onSignOut,
}: {
  email: string | undefined;
  userId: string;
  roleValue: string | null;
  roleError: string | null;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="max-w-md w-full bg-white border border-line rounded-card shadow-1 p-6 space-y-4">
        <div>
          <SubmitStreamLogo size="md" />
          <h1 className="mt-3 text-base font-semibold text-ink">Account not configured</h1>
          <p className="text-sm text-zinc-500 mt-1">
            You're signed in, but your profile doesn't have a role assigned, so we can't
            route you to a dashboard.
          </p>
        </div>

        <dl className="text-xs space-y-2 bg-paper border border-line rounded-control p-3">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Email</dt>
            <dd className="font-mono text-ink truncate">{email ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">User ID</dt>
            <dd className="font-mono text-ink truncate text-[11px]">{userId}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Role</dt>
            <dd className="font-mono text-ink">{roleValue ?? '(none)'}</dd>
          </div>
          {roleError && (
            <div className="pt-2 border-t border-line text-danger">{roleError}</div>
          )}
        </dl>

        <p className="text-xs text-zinc-500">
          Have an admin add a row to <code className="font-mono">user_profiles</code> with
          your User ID and a role of <code className="font-mono">admin</code>,{' '}
          <code className="font-mono">team</code>, or{' '}
          <code className="font-mono">supplier</code>.
        </p>

        <Button variant="secondary" className="w-full" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default App;
