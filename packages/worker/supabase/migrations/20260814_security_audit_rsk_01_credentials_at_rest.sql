-- ============================================================
-- Security audit response: RSK-01 (High — encrypt Corcentric +
-- PromoStandards credentials at rest).
--
-- Applied to production via Supabase migration API on 2026-08-14
-- as a series of migrations; captured here in one file for
-- reproducibility (per RSK-03).
--
-- Approach:
--   1. New public.encryption_keys table holds a 32-byte random key
--      (row: 'credentials_v1'). Table has RLS enabled with NO
--      policies, so only service_role can read it. Worker never
--      touches the key material directly.
--   2. SECURITY DEFINER functions encrypt_credential(text) and
--      decrypt_credential(bytea) wrap pgp_sym_encrypt/decrypt from
--      the extensions schema (pgcrypto). SET search_path so the
--      functions can find the extension.
--   3. write_credential(text) is a public RPC that authenticated
--      admins call from the worker to convert plaintext → bytea
--      for INSERT/UPDATE of *_enc columns.
--   4. *_enc bytea columns added to communities and suppliers
--      (cor_username_enc, cor_password_enc, ps_auth_id_enc,
--      ps_auth_password_enc). Backfilled from existing plaintext.
--   5. BEFORE INSERT/UPDATE trigger sync_credentials_to_encrypted
--      auto-encrypts if plaintext columns change (transition
--      safety net; removed once worker code fully migrated).
--   6. Views communities_v and suppliers_v expose decrypted
--      values on read (security_invoker = true so RLS still fires
--      on the base tables).
-- ============================================================

-- ─── 1. Key storage ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.encryption_keys (
  name       TEXT PRIMARY KEY,
  key_value  BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.encryption_keys ENABLE ROW LEVEL SECURITY;
-- No policies → only service_role can read/write.

-- Seed the working key if not present. Uses gen_random_bytes from
-- pgcrypto (schema = extensions on Supabase).
INSERT INTO public.encryption_keys (name, key_value)
SELECT 'credentials_v1', extensions.gen_random_bytes(32)
WHERE NOT EXISTS (
  SELECT 1 FROM public.encryption_keys WHERE name = 'credentials_v1'
);

-- ─── 2. SECURITY DEFINER encrypt/decrypt functions ───────────

CREATE OR REPLACE FUNCTION public.encrypt_credential(plaintext TEXT)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE k BYTEA;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN RETURN NULL; END IF;
  SELECT key_value INTO k FROM public.encryption_keys WHERE name = 'credentials_v1';
  IF k IS NULL THEN RAISE EXCEPTION 'credentials_v1 encryption key not found'; END IF;
  RETURN extensions.pgp_sym_encrypt(plaintext, encode(k, 'base64'));
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_credential(ciphertext BYTEA)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE k BYTEA;
BEGIN
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  SELECT key_value INTO k FROM public.encryption_keys WHERE name = 'credentials_v1';
  IF k IS NULL THEN RAISE EXCEPTION 'credentials_v1 encryption key not found'; END IF;
  RETURN extensions.pgp_sym_decrypt(ciphertext, encode(k, 'base64'));
END;
$$;

-- Called by the worker via .rpc('write_credential', { plaintext })
-- to convert a value into ciphertext for insertion.
CREATE OR REPLACE FUNCTION public.write_credential(plaintext TEXT)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN public.encrypt_credential(plaintext);
END;
$$;

GRANT EXECUTE ON FUNCTION public.encrypt_credential(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_credential(BYTEA) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_credential(TEXT) TO authenticated, service_role;

-- ─── 3. Encrypted columns ────────────────────────────────────

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS cor_username_enc BYTEA,
  ADD COLUMN IF NOT EXISTS cor_password_enc BYTEA;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS cor_username_enc     BYTEA,
  ADD COLUMN IF NOT EXISTS cor_password_enc     BYTEA,
  ADD COLUMN IF NOT EXISTS ps_auth_id_enc       BYTEA,
  ADD COLUMN IF NOT EXISTS ps_auth_password_enc BYTEA;

-- ─── 4. Backfill from existing plaintext ─────────────────────

UPDATE public.communities
SET cor_username_enc = public.encrypt_credential(cor_username)
WHERE cor_username IS NOT NULL AND cor_username_enc IS NULL;

UPDATE public.communities
SET cor_password_enc = public.encrypt_credential(cor_password)
WHERE cor_password IS NOT NULL AND cor_password_enc IS NULL;

UPDATE public.suppliers
SET cor_username_enc = public.encrypt_credential(cor_username)
WHERE cor_username IS NOT NULL AND cor_username_enc IS NULL;

UPDATE public.suppliers
SET cor_password_enc = public.encrypt_credential(cor_password)
WHERE cor_password IS NOT NULL AND cor_password_enc IS NULL;

UPDATE public.suppliers
SET ps_auth_id_enc = public.encrypt_credential(ps_auth_id)
WHERE ps_auth_id IS NOT NULL AND ps_auth_id_enc IS NULL;

UPDATE public.suppliers
SET ps_auth_password_enc = public.encrypt_credential(ps_auth_password)
WHERE ps_auth_password IS NOT NULL AND ps_auth_password_enc IS NULL;

-- ─── 5. Transition-period auto-encrypt trigger ───────────────
-- Kept in place until worker code stops writing plaintext columns
-- entirely; a follow-up migration drops both the plaintext columns
-- and this trigger.

CREATE OR REPLACE FUNCTION public.sync_credentials_to_encrypted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_TABLE_NAME = 'communities' THEN
    IF TG_OP = 'INSERT' OR NEW.cor_password IS DISTINCT FROM OLD.cor_password THEN
      NEW.cor_password_enc := public.encrypt_credential(NEW.cor_password);
    END IF;
    IF TG_OP = 'INSERT' OR NEW.cor_username IS DISTINCT FROM OLD.cor_username THEN
      NEW.cor_username_enc := public.encrypt_credential(NEW.cor_username);
    END IF;
  ELSIF TG_TABLE_NAME = 'suppliers' THEN
    IF TG_OP = 'INSERT' OR NEW.cor_password IS DISTINCT FROM OLD.cor_password THEN
      NEW.cor_password_enc := public.encrypt_credential(NEW.cor_password);
    END IF;
    IF TG_OP = 'INSERT' OR NEW.cor_username IS DISTINCT FROM OLD.cor_username THEN
      NEW.cor_username_enc := public.encrypt_credential(NEW.cor_username);
    END IF;
    IF TG_OP = 'INSERT' OR NEW.ps_auth_password IS DISTINCT FROM OLD.ps_auth_password THEN
      NEW.ps_auth_password_enc := public.encrypt_credential(NEW.ps_auth_password);
    END IF;
    IF TG_OP = 'INSERT' OR NEW.ps_auth_id IS DISTINCT FROM OLD.ps_auth_id THEN
      NEW.ps_auth_id_enc := public.encrypt_credential(NEW.ps_auth_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_credentials_communities ON public.communities;
CREATE TRIGGER sync_credentials_communities
  BEFORE INSERT OR UPDATE ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.sync_credentials_to_encrypted();

DROP TRIGGER IF EXISTS sync_credentials_suppliers ON public.suppliers;
CREATE TRIGGER sync_credentials_suppliers
  BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.sync_credentials_to_encrypted();

-- ─── 6. Views with decrypted values ──────────────────────────
-- security_invoker = true → RLS on the base tables still applies
-- to callers of the view.

CREATE OR REPLACE VIEW public.communities_v
WITH (security_invoker = true) AS
SELECT
  c.*,
  public.decrypt_credential(c.cor_username_enc) AS cor_username_decrypted,
  public.decrypt_credential(c.cor_password_enc) AS cor_password_decrypted
FROM public.communities c;

CREATE OR REPLACE VIEW public.suppliers_v
WITH (security_invoker = true) AS
SELECT
  s.*,
  public.decrypt_credential(s.cor_username_enc)     AS cor_username_decrypted,
  public.decrypt_credential(s.cor_password_enc)     AS cor_password_decrypted,
  public.decrypt_credential(s.ps_auth_id_enc)       AS ps_auth_id_decrypted,
  public.decrypt_credential(s.ps_auth_password_enc) AS ps_auth_password_decrypted
FROM public.suppliers s;
