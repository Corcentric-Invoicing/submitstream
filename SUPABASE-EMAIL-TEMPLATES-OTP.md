# Supabase Email Templates — OTP edition

**Why:** Microsoft 365 / Outlook Advanced Threat Protection pre-fetches URLs
in email to scan for phishing. That pre-fetch consumes single-use auth
tokens before the user can click. Numeric codes can't be pre-fetched, so
they survive corporate email pipelines that keep breaking link-based flows.

**When to use:** Paste these into Supabase Studio → Authentication → Email
Templates. Save each. Then the portal's OTP-based `/forgot-password`,
`/accept-invite`, and login-supplier-tab flows all "just work" across every
email provider we've hit.

---

## 1. Reset Password (Recovery)

**Subject:**

```
Your SubmitStream password reset code
```

**HTML body:**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">Your SubmitStream password reset code is {{ .Token }}. Expires in one hour.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 20px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#FAF8F7;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:26px 32px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="background:#1A1A1A;width:34px;height:34px;border-radius:8px;text-align:center;color:#E8613C;font-weight:700;font-size:20px;line-height:34px;">›</td>
                <td style="padding-left:10px;font-size:18px;font-weight:700;color:#1A1A1A;">SubmitStream</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <h1 style="margin:0 0 8px;font-size:22px;color:#1A1A1A;">Reset your password</h1>
              <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.55;">Enter this 6-digit code on the reset page to choose a new password. The code expires in <strong>1 hour</strong>.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 20px;">
              <div style="display:inline-block;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 28px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.28em;color:#1A1A1A;">{{ .Token }}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0 0 6px;font-size:13px;color:#6b7280;line-height:1.55;">Go to <a href="{{ .SiteURL }}/forgot-password" style="color:#E8613C;text-decoration:none;font-weight:600;">{{ .SiteURL }}/forgot-password</a>, enter your email, then this code.</p>
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;">If you didn't request this, ignore the email — your password won't change.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #eee;background:#fafafa;">
              <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">SubmitStream · Automated invoice submission for Corcentric DMS</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

---

## 2. Magic Link (Sign-in)

**Subject:**

```
Your SubmitStream sign-in code
```

**HTML body:**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">Your SubmitStream sign-in code is {{ .Token }}. Expires in one hour.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 20px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#FAF8F7;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:26px 32px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="background:#1A1A1A;width:34px;height:34px;border-radius:8px;text-align:center;color:#E8613C;font-weight:700;font-size:20px;line-height:34px;">›</td>
                <td style="padding-left:10px;font-size:18px;font-weight:700;color:#1A1A1A;">SubmitStream</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <h1 style="margin:0 0 8px;font-size:22px;color:#1A1A1A;">Sign in to SubmitStream</h1>
              <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.55;">Enter this 6-digit code on the sign-in page. Code expires in <strong>1 hour</strong>.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 20px;">
              <div style="display:inline-block;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 28px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.28em;color:#1A1A1A;">{{ .Token }}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0 0 6px;font-size:13px;color:#6b7280;line-height:1.55;">Go to <a href="{{ .SiteURL }}/login" style="color:#E8613C;text-decoration:none;font-weight:600;">{{ .SiteURL }}/login</a>, click the <strong>Supplier</strong> tab, enter your email, then this code.</p>
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;">If you didn't request this, ignore the email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #eee;background:#fafafa;">
              <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">SubmitStream · Automated invoice submission for Corcentric DMS</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

---

## 3. Invite user

**Subject:**

```
You're invited to SubmitStream — your access code inside
```

**HTML body:**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">Your SubmitStream invite code is {{ .Token }}. Expires in 24 hours.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 20px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#FAF8F7;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:26px 32px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="background:#1A1A1A;width:34px;height:34px;border-radius:8px;text-align:center;color:#E8613C;font-weight:700;font-size:20px;line-height:34px;">›</td>
                <td style="padding-left:10px;font-size:18px;font-weight:700;color:#1A1A1A;">SubmitStream</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <h1 style="margin:0 0 8px;font-size:22px;color:#1A1A1A;">You're invited to SubmitStream</h1>
              <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.55;">Use this 6-digit code to accept the invite and set your password. Code expires in <strong>24 hours</strong>.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 20px;">
              <div style="display:inline-block;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 28px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.28em;color:#1A1A1A;">{{ .Token }}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 20px;">
              <p style="margin:0 0 12px;font-size:14px;color:#1A1A1A;line-height:1.55;"><strong>How to accept:</strong></p>
              <ol style="margin:0 0 12px;padding-left:20px;font-size:13px;color:#4b5563;line-height:1.7;">
                <li>Go to <a href="{{ .SiteURL }}/accept-invite" style="color:#E8613C;text-decoration:none;font-weight:600;">{{ .SiteURL }}/accept-invite</a></li>
                <li>Enter your email address</li>
                <li>Enter the 6-digit code above</li>
                <li>Choose a password</li>
              </ol>
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;">If you weren't expecting this invite, ignore the email — no account is created until you accept.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #eee;background:#fafafa;">
              <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">SubmitStream · Automated invoice submission for Corcentric DMS</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

---

## Where to paste in Supabase Studio

1. `https://supabase.com/dashboard/project/xlgnmmjklzbyzqxwnzlv/auth/templates`
2. Pick each template from the left rail
3. Set the Subject field
4. Paste the HTML into the message body
5. Click **Save**
6. Repeat for the other two

## OTP length setting

Supabase → Authentication → Providers → Email → **OTP Length**. Set to
`6` if it isn't already. Our forms expect exactly 6 digits.

## OTP expiry (optional bump)

Same page — **Email OTP Expiration**. Defaults are 1 hour for magic link,
1 hour for recovery, 24 hours for invite. Bump the shorter ones to 4h if
you want to be extra forgiving of Outlook's delivery delays. Not required.

## What to test after paste

- `/forgot-password` → send code to yourself → check inbox → enter code +
  new password → confirm you land signed in
- `/login` supplier tab → enter email → get code → enter code → signed in
- Teams admin → Invite → new email address → recipient hits
  `/accept-invite` → enter email + code + password → signed in
