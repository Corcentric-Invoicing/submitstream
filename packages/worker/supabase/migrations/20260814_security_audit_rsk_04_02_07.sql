-- ============================================================
-- Security audit response: RSK-04, RSK-02, RSK-07
-- Applied to production via Supabase migration API on 2026-08-14.
-- File captured in source-control for reproducibility (per RSK-03).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- RSK-04: Lock corcentric_submissions RLS
-- Previously: SELECT/INSERT/UPDATE all qual=true / with_check=true
-- for role=public → any authenticated user could read every
-- tenant's full request/response XML.
-- Now: SELECT scoped to admin | team-assigned | own-supplier.
-- INSERT/UPDATE/DELETE have no authenticated-role policies;
-- writes flow exclusively through service_role (bypasses RLS).
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS users_can_view_submissions        ON public.corcentric_submissions;
DROP POLICY IF EXISTS service_role_updates_submissions  ON public.corcentric_submissions;
DROP POLICY IF EXISTS service_role_inserts_submissions  ON public.corcentric_submissions;

ALTER TABLE public.corcentric_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY corcentric_submissions_select
  ON public.corcentric_submissions
  FOR SELECT
  TO authenticated
  USING (
    is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.team_supplier_assignments tsa
      WHERE tsa.user_id = auth.uid()
        AND tsa.supplier_id = corcentric_submissions.supplier_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'supplier'
        AND up.supplier_id = corcentric_submissions.supplier_id
    )
  );

-- ─────────────────────────────────────────────────────────────
-- RSK-02: Replace blanket authenticated-read policies with
-- tenant-scoped ones on customer_supplier_codes + supplier_communities.
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS everyone_reads_customer_supplier_codes ON public.customer_supplier_codes;

CREATE POLICY customer_supplier_codes_select
  ON public.customer_supplier_codes
  FOR SELECT
  TO authenticated
  USING (
    is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.team_supplier_assignments tsa
      WHERE tsa.user_id = auth.uid()
        AND tsa.supplier_id = customer_supplier_codes.supplier_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'supplier'
        AND up.supplier_id = customer_supplier_codes.supplier_id
    )
  );

DROP POLICY IF EXISTS everyone_reads_supplier_communities ON public.supplier_communities;

CREATE POLICY supplier_communities_select
  ON public.supplier_communities
  FOR SELECT
  TO authenticated
  USING (
    is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.team_supplier_assignments tsa
      WHERE tsa.user_id = auth.uid()
        AND tsa.supplier_id = supplier_communities.supplier_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'supplier'
        AND up.supplier_id = supplier_communities.supplier_id
    )
  );

-- ─────────────────────────────────────────────────────────────
-- RSK-07: Add WITH CHECK to supplier / team UPDATE policies so
-- an update can't reassign a row's supplier_id to another tenant.
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS supplier_updates_own_customers ON public.customers;
CREATE POLICY supplier_updates_own_customers
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'supplier'
        AND user_profiles.supplier_id = customers.supplier_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'supplier'
        AND user_profiles.supplier_id = customers.supplier_id
    )
  );

DROP POLICY IF EXISTS supplier_update_own_invoices ON public.invoices;
CREATE POLICY supplier_update_own_invoices
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'supplier'
        AND up.supplier_id = invoices.supplier_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'supplier'
        AND up.supplier_id = invoices.supplier_id
    )
  );

DROP POLICY IF EXISTS team_update_assigned_invoices ON public.invoices;
CREATE POLICY team_update_assigned_invoices
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_supplier_assignments tsa
      WHERE tsa.user_id = auth.uid()
        AND tsa.supplier_id = invoices.supplier_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_supplier_assignments tsa
      WHERE tsa.user_id = auth.uid()
        AND tsa.supplier_id = invoices.supplier_id
    )
  );
