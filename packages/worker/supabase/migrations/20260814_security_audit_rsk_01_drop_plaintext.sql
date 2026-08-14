-- ============================================================
-- Security audit response: RSK-01 final step.
--
-- Applied to production via Supabase migration API on 2026-08-14
-- once worker code stopped reading and writing plaintext
-- credential columns (see queries.ts / handlers/suppliers.ts /
-- handlers/communities.ts / promostandards/puller.ts).
--
-- After this migration, no plaintext credential lives in the DB
-- at rest — decryption requires the SECURITY DEFINER function
-- decrypt_credential(bytea) which the worker calls via RPC.
-- The transition-safety sync trigger is removed at the same time
-- and views are recreated over the encrypted columns only.
-- ============================================================

DROP FUNCTION IF EXISTS public.sync_credentials_to_encrypted() CASCADE;

DROP VIEW IF EXISTS public.communities_v;
DROP VIEW IF EXISTS public.suppliers_v;

ALTER TABLE public.communities
  DROP COLUMN IF EXISTS cor_username,
  DROP COLUMN IF EXISTS cor_password;

ALTER TABLE public.suppliers
  DROP COLUMN IF EXISTS cor_username,
  DROP COLUMN IF EXISTS cor_password,
  DROP COLUMN IF EXISTS ps_auth_id,
  DROP COLUMN IF EXISTS ps_auth_password;

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
