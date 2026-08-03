# Supabase Email Templates (OTP)

Three templates for the OTP-based auth flow. Each file is pure HTML — no
markdown fences, no headers. Open, Cmd+A, Cmd+C, paste into the Supabase
Studio template body.

| File                    | Supabase template     | Subject                                                 |
| ----------------------- | --------------------- | ------------------------------------------------------- |
| `reset-password.html`   | Reset Password        | `Your SubmitStream password reset code`                 |
| `magic-link.html`       | Magic Link            | `Your SubmitStream sign-in code`                        |
| `invite.html`           | Invite user           | `You're invited to SubmitStream — your access code inside` |

## Paste procedure

1. `https://supabase.com/dashboard/project/xlgnmmjklzbyzqxwnzlv/auth/templates`
2. Pick a template from the left rail
3. Set the Subject field from the table above
4. Open the corresponding `.html` file in this folder
5. Cmd+A → Cmd+C → paste into the template body
6. Save
7. Repeat for the other two

## Also confirm in Supabase Studio

- **Auth → Providers → Email → OTP Length = 6** (our forms expect exactly 6 digits)
- **Site URL = `https://submitstream.com`** (used by `{{ .SiteURL }}` in the templates)

## Logo

Templates reference `{{ .SiteURL }}/favicon.svg` (the SubmitStream chevron
mark). That file is deployed with the portal at
`https://submitstream.com/favicon.svg`. Some email clients block external
images until the user allows them; the layout still works without the
image (empty tile with the "SubmitStream" wordmark next to it).
