# SubmitStream Go-Live Checklist

Things that MUST happen before real supplier traffic hits production, and
things that MUST happen at cutover from UAT to production. Written as a
checkbox list — tick each one, don't skip.

---

## Before the first real supplier onboards

- [ ] **PromoStandards sweep schedule restored.** `packages/worker/wrangler.toml`
      has the cron `crons = ["0 0 * * SUN"]` (weekly, Sundays 00:00 UTC).
      That's the parked value from the pre-first-supplier era. Change to
      `"0 */6 * * *"` (every 6 hours) or whatever cadence agreed, then
      redeploy the worker. If left at weekly, PromoStandards-enabled
      suppliers will only be swept once a week — invoices will land in
      the portal up to 7 days late.
- [ ] **Retention job scheduled.** Retention code exists but isn't
      invoked on any cron. Decide cadence (nightly? weekly?) and add a
      trigger. See RSK-05, RSK-06, RSK-20 in the risk register.
- [ ] **Cloudflare account consolidation complete.** All `[ACCOUNT]` tags
      in `CLAUDE.md` addressed. See `CLOUDFLARE-CONSOLIDATION.md`.
- [ ] **Cloudflare Workers Paid plan active** ($5/mo) — free tier's rate
      limits bit us during a demo. Bumped this earlier but confirm still
      active at go-live.
- [ ] **Supabase Site URL** verified `https://submitstream.com` (not
      localhost). Redirect URLs allowlist includes the production
      domains. Verified Aug 2026 but re-confirm before cutover.
- [ ] **Corcentric API URLs per community** verified pointing at
      production DMS endpoints (not `-uat` or `-qa`). Each community
      needs the `/web` suffix on the URL for the WebHttp binding.
- [ ] **Corcentric credentials rotated.** UAT credentials in Communities
      admin should be replaced with production creds. Never share prod
      creds via chat or unencrypted email.
- [ ] **All UAT test suppliers deactivated.** The "in test mode" flag on
      supplier records determines whether submissions actually POST to
      Corcentric or dry-run only. Confirm each real supplier is OUT of
      test mode.
- [ ] **All test invoices deleted from the queue.** Fixture data
      (Foley Chemical sample, Osprey, Fedrigoni, etc.) removed from
      `invoices` table so real intake starts from a clean slate.
- [ ] **DNS + email routing verified.** Test that `*@submitstream.com`
      routes to the inbound worker and OCR pipeline fires.
- [ ] **Backup + restore drill.** Confirm a full Supabase DB restore
      works from snapshot. Corcentric's own DR requirements TBD.

## Security posture before opening the door

- [ ] **RSK-01: Credentials encrypted at rest.** pgsodium/pgcrypto on
      `communities.cor_password` and supplier PromoStandards creds.
- [ ] **RSK-02: Blanket read policies replaced with tenant-scoped RLS.**
      No `qual: true` policies on customer / ship-to / codes tables.
- [ ] **RSK-04: `corcentric_submissions` RLS locked to service_role +
      admin.** Currently open to all authenticated.
- [ ] **RSK-07: `WITH CHECK` clauses on supplier UPDATE policies.**

## Onboarding process for a new real supplier

- [ ] Create supplier record with `test_mode = true`
- [ ] Assign to a community with correct `cor_vendor_code`
- [ ] Optionally configure `cor_customer_code` per-community default
- [ ] Upload a test invoice, verify OCR extraction
- [ ] Submit a dry-run to Corcentric, confirm `corResponseStatusCode` = 2
      or 3
- [ ] Flip `test_mode = false`
- [ ] Configure sender email allow-list on the supplier (see RSK-12)
- [ ] Confirm the supplier's team members received their OTP-based
      invite emails and can sign in

## What NOT to do at go-live

- Don't push migrations directly to production without applying them via
  the migration tool (see RSK-03).
- Don't paste production credentials into chat, tickets, or unencrypted
  email.
- Don't skip the dry-run. Corcentric's DMS validates against real
  business rules (customer must exist, date must be within 60 days, etc)
  — dry-run surfaces the issues before a real submission produces a
  real payable.
