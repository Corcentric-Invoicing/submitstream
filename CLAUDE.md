# SubmitStream — Claude session notes

This file is read by Claude at the start of every session working in this repo.
Keep it focused on things that are easy to get wrong from a fresh read of the
codebase.

---

## ⚠️ ACCOUNT MIGRATION IN PROGRESS

Everything below tagged `[ACCOUNT]` is about to change — we are moving from
the **STCH Network** Cloudflare account to **Narrows**. When the migration
lands, update:

- `worker-deploy/wrangler.toml` → `account_id`
- The `CLOUDFLARE_API_TOKEN` value (cfut_…)
- This file (search for `[ACCOUNT]`)
- Any DNS / R2 / email-routing references to the old account

Until the migration: use the existing token + account_id.

---

## GitHub

- Repo: `https://github.com/Corcentric-Invoicing/submitstream`
- Push identity: `dustin-narrowsweb` (Narrows account) — has push rights via the
  Corcentric-Invoicing org. The org name is Corcentric-side; the account
  pushing is Narrows-side. Don't get thrown off — different from Cloudflare
  ownership (which is separately migrating STCH → Narrows, see [ACCOUNT]).
- The older name `Corcentric-Invoicing/corcentric-invoicing` was renamed to
  `submitstream` inside the same org.

## Repo layout (monorepo — everything lives here now)

| Thing                    | Path                                                 |
| ------------------------ | ---------------------------------------------------- |
| Repo root                | `/Users/dc/Desktop/SubmitStream/`                    |
| React portal             | `packages/portal/`                                   |
| Cloudflare Worker        | `packages/worker/` (was `~/Downloads/ocr processing/worker-deploy/` before Aug 2026 reunification) |
| Legacy upload staging dir | `~/Downloads/ocr processing/portal-deploy/` (the old `upload-portal.sh` flow — superseded by `deploy-portal.sh`) |

The old `worker-deploy/` location outside this repo is kept temporarily as a
backup. Once you've verified `packages/worker/` deploys cleanly and the
initial commit is pushed, it's safe to delete the external copy.

---

## Deploy commands — USE THE SCRIPT

```bash
# Portal only
cd /Users/dc/Desktop/SubmitStream
export CLOUDFLARE_API_TOKEN="cfut_XXXX"   # [ACCOUNT] — get real token from 1Password / .env.local
./scripts/deploy-portal.sh

# Portal + worker in one shot
./scripts/deploy-portal.sh --with-worker

# Worker only
cd /Users/dc/Desktop/SubmitStream/packages/worker
export CLOUDFLARE_API_TOKEN="cfut_XXXX"   # [ACCOUNT] — get real token from 1Password / .env.local
npx wrangler deploy

# Tail worker logs
cd /Users/dc/Desktop/SubmitStream/packages/worker
npx wrangler tail
```

### DO NOT use `npm run deploy` in `packages/portal/`

That script (`wrangler pages deploy dist`) is a **stale leftover**. The portal
is NOT served by Cloudflare Pages — it's served by the Worker from R2 under
the `portal/` prefix. Running the package.json deploy script will prompt to
pick a Pages project (the only one visible, `stch`, is unrelated).

### Why the `CLOUDFLARE_API_TOKEN` export?  [ACCOUNT]

`wrangler whoami` shows `dustin@narrowsweb.com`, but the worker + R2 bucket
live in the `Dcochran@stchnetwork.com` account (id
`50c65f617dd2112476424061ea46db14`). The API token forces wrangler to that
account. Goes away after the Narrows migration.

---

## Architecture cheat sheet

- **Worker** `submitstream` (name in `wrangler.toml`) — serves BOTH the API
  and the portal HTML. Portal assets live in R2 bucket `invoice-pdfs` under
  the `portal/` prefix. SPA fallback in `src/index.ts` serves
  `portal/index.html` for any non-file path.
- **Portal** — Vite + React + TypeScript + Tailwind. Build emits to
  `packages/portal/dist/`. `deploy-portal.sh` rebuilds, then `wrangler r2
  object put`s each asset to `invoice-pdfs/portal/...`.
- **Supabase** — project `xlgnmmjklzbyzqxwnzlv.supabase.co`. Multi-tenant
  RLS using `is_admin()` / `is_admin_or_team()` SECURITY DEFINER helpers
  (the previous recursive-policy bug is fixed; if you write a new admin
  policy, use the helper).
- **OCR pipeline** — 3-tier cascade in `packages/worker/src/ocr-pipeline/`:
  Mistral OCR (`mistral-ocr-4-0`, file-upload API) → Pixtral (vision LLM,
  free-tier fallback) → Claude Haiku 4.5 (paid last resort, best-of-all-
  three scoring when reached).
- **Auth** — custom `/auth/confirm` React route does the token_hash
  exchange. `user_metadata.must_reset_password=true` forces a redirect to
  `/set-password` on next sign-in (set by admin "Set password" button in
  TeamsPage, cleared by the set-password page itself). Email templates use
  `{{ .SiteURL }}/auth/confirm?token_hash=...&type=...` pattern.

---

## Things that bite

### iCloud lock on Desktop

`/Users/dc/Desktop/` is iCloud-synced. Bash commands operating on files in
this repo can hit "Resource deadlock avoided." Prefer the file tools
(Read/Write/Edit) over shell commands when working with files in
`packages/portal/`.

### Modals — NO backdrop click-to-close

We deliberately don't close modals on backdrop click — too easy to nuke
in-progress input with a stray click. All 13+ modals across the portal use
the same pattern: backdrop div has a comment instead of an `onClick`
handler. Close via X button or Cancel only. If you add a new modal, follow
the same pattern.

### Three copies of `allowedFields` in worker validators

`packages/worker/src/api/middleware/validate.ts` has three independent
`allowedFields` lists. Adding a field to a schema (e.g. `community_id`)
silently 400s until you also add it to the matching `allowedFields` list.
TODO: consolidate, but for now: when you add a column, grep `allowedFields`
and update every match.

### `cfut_` token in chat is fine, service-role key is not

The Cloudflare API token is rotated frequently and only grants Cloudflare
access — pasting it in chat is annoying but not dangerous. The Supabase
service-role key is the opposite: rotate it immediately if it appears in
chat.

---

## Open / pending work (as of this session)

See the TodoList in the active session for the live list; recurring themes:

- ~~Supabase Site URL still points at localhost~~ — verified Aug 2026:
  Site URL = `https://submitstream.com`, redirect URLs allowlist includes
  `submitstream.com/**` and `www.submitstream.com/**`. Auth pain in this
  era was actually the invisible-status-message bug in the /set-password
  /forgot-password /reset-password pages (fixed) plus fast OTP expiry.
- **Cloudflare Workers Paid plan** ($5/mo) — needs activation; current plan
  has rate limits that bit us during the demo.
- **SUPPLIER-COMMUNITIES-REFACTOR** runbook — a supplier should be allowed
  to belong to multiple communities (today it's a single FK). Schema change
  pending.
- **OCR retry logic** — providers fail occasionally with transient errors;
  add exponential backoff in `packages/worker/src/ocr-pipeline/`.

---

## When in doubt

Read `scripts/deploy-portal.sh` for the canonical deploy flow — it has a
helpful header comment block.
