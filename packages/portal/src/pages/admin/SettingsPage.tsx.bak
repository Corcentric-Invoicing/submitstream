import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import { AlertTriangle, Check, Save, Bell, Cog, Archive, Mail } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Settings — tenant-level configuration. Backed by GET /api/settings
 * (returns array of {key, value} rows from app_settings) and
 * PATCH /api/settings { key, value } (upserts a single row).
 *
 * Each section maps to a small group of keys. Save is per-section so a
 * change to one doesn't dirty unrelated sections.
 */

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

interface SettingRow {
  key: string;
  value: unknown;
  description?: string | null;
  updated_at?: string | null;
}

// Known setting keys we manage from this UI. New keys can be added safely;
// the patch endpoint upserts so unknown keys won't break anything.
const KEYS = {
  dailyUploadLimit: 'daily_upload_limit',
  notifyOcrErrors: 'notify_ocr_errors_to',
  notifyDmsFailures: 'notify_dms_failures_to',
  notifyDailyDigest: 'notify_daily_digest_to',
  retentionDays: 'retention_days',
  defaultExtractionTemplate: 'default_extraction_template',
  orgName: 'org_name',
  defaultCurrency: 'default_currency',
} as const;

export default function SettingsPage({ role, userId, userEmail }: PageProps) {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function authFetch(path: string, init?: RequestInit) {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function fetchSettings() {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/settings');
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && body.error) || `HTTP ${res.status}`);
        return;
      }
      const list: SettingRow[] = Array.isArray(body) ? body : body?.data ?? [];
      const map: Record<string, unknown> = {};
      for (const r of list) map[r.key] = r.value;
      setSettings(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveOne(key: string, value: unknown): Promise<boolean> {
    const res = await authFetch('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ key, value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body?.error || `Failed to save ${key}: HTTP ${res.status}`);
      return false;
    }
    setSettings((prev) => ({ ...prev, [key]: value }));
    setError(null);
    return true;
  }

  return (
    <AppShell
      role={role}
      userId={userId}
      userEmail={userEmail}
      breadcrumb="Settings"
    >
      <div className="px-7 py-7 max-w-[860px] mx-auto space-y-7">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
            Tenant-level configuration. Changes apply to every supplier and
            user in this workspace.
          </p>
        </div>

        {error && (
          <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center">
            <BrandedSpinner size="lg" />
          </div>
        ) : (
          <>
            <SettingsSection
              icon={<Cog size={14} />}
              title="General"
              description="Basic tenant info shown across the portal."
            >
              <TextField
                label="Organization name"
                hint="Shown in invite emails and the portal footer."
                value={String(settings[KEYS.orgName] ?? '')}
                onSave={(v) => saveOne(KEYS.orgName, v)}
              />
              <TextField
                label="Default currency"
                hint="ISO 4217 code (USD, EUR, GBP). Used when an invoice doesn't specify."
                placeholder="USD"
                value={String(settings[KEYS.defaultCurrency] ?? '')}
                onSave={(v) => saveOne(KEYS.defaultCurrency, v.toUpperCase())}
                mono
              />
            </SettingsSection>

            <SettingsSection
              icon={<Bell size={14} />}
              title="Notifications"
              description="Who gets alerted when something needs attention. Comma-separated email addresses."
            >
              <TextField
                label="OCR errors"
                hint="Notify these recipients when OCR extraction fails or returns low-confidence data."
                value={String(settings[KEYS.notifyOcrErrors] ?? '')}
                onSave={(v) => saveOne(KEYS.notifyOcrErrors, v)}
                mono
                icon={<Mail size={11} />}
              />
              <TextField
                label="DMS submission failures"
                hint="Notify these recipients when a Corcentric submission returns a non-2xx."
                value={String(settings[KEYS.notifyDmsFailures] ?? '')}
                onSave={(v) => saveOne(KEYS.notifyDmsFailures, v)}
                mono
                icon={<Mail size={11} />}
              />
              <TextField
                label="Daily digest"
                hint="Daily summary of new invoices, submissions, and rejections."
                value={String(settings[KEYS.notifyDailyDigest] ?? '')}
                onSave={(v) => saveOne(KEYS.notifyDailyDigest, v)}
                mono
                icon={<Mail size={11} />}
              />
            </SettingsSection>

            <SettingsSection
              icon={<Cog size={14} />}
              title="OCR & extraction"
              description="Pipeline guardrails and global extraction defaults."
            >
              <NumberField
                label="Daily upload cap"
                hint="Maximum invoices that can be uploaded across the tenant per day. Controls API spend."
                value={Number(settings[KEYS.dailyUploadLimit] ?? 100)}
                onSave={(v) => saveOne(KEYS.dailyUploadLimit, v)}
              />
              <TextareaField
                label="Default extraction template"
                hint="Falls back here when a supplier has no per-supplier template. Markdown / plain text."
                rows={6}
                value={String(settings[KEYS.defaultExtractionTemplate] ?? '')}
                onSave={(v) => saveOne(KEYS.defaultExtractionTemplate, v)}
                mono
              />
            </SettingsSection>

            <SettingsSection
              icon={<Archive size={14} />}
              title="Retention"
              description="How long invoice records and PDFs are retained before automated archive."
            >
              <NumberField
                label="Retention period (days)"
                hint="Older than this is archived to cold storage. 0 disables auto-archive."
                value={Number(settings[KEYS.retentionDays] ?? 0)}
                onSave={(v) => saveOne(KEYS.retentionDays, v)}
              />
            </SettingsSection>
          </>
        )}
      </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Sections + fields
// ──────────────────────────────────────────────────────────

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <h2 className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink uppercase tracking-[0.06em]">
          {icon}
          {title}
        </h2>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose">{description}</p>
      </div>
      <div className="px-5 py-4 space-y-5">{children}</div>
    </section>
  );
}

const inputClass =
  'w-full h-9 px-2.5 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand';

function TextField({
  label,
  hint,
  value,
  placeholder,
  mono,
  icon,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  icon?: React.ReactNode;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dirty = draft !== value;
  return (
    <FieldRow label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {icon && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
              {icon}
            </span>
          )}
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className={cn(inputClass, mono && 'font-mono', icon && 'pl-7')}
          />
        </div>
        <SaveButton
          dirty={dirty}
          saving={saving}
          savedRecently={savedAt !== null && Date.now() - savedAt < 2500}
          onClick={async () => {
            setSaving(true);
            const ok = await onSave(draft);
            setSaving(false);
            if (ok) setSavedAt(Date.now());
          }}
        />
      </div>
    </FieldRow>
  );
}

function TextareaField({
  label,
  hint,
  value,
  rows = 4,
  mono,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string;
  rows?: number;
  mono?: boolean;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dirty = draft !== value;
  return (
    <FieldRow label={label} hint={hint}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={rows}
        className={cn(
          'w-full px-2.5 py-2 bg-white border border-line-2 rounded-control text-[13px] text-ink placeholder:text-zinc-400 outline-none shadow-1 focus:border-brand focus:shadow-ring-brand resize-y leading-relaxed',
          mono && 'font-mono'
        )}
      />
      <div className="mt-2 flex justify-end">
        <SaveButton
          dirty={dirty}
          saving={saving}
          savedRecently={savedAt !== null && Date.now() - savedAt < 2500}
          onClick={async () => {
            setSaving(true);
            const ok = await onSave(draft);
            setSaving(false);
            if (ok) setSavedAt(Date.now());
          }}
        />
      </div>
    </FieldRow>
  );
}

function NumberField({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint?: string;
  value: number;
  onSave: (v: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const numeric = Number(draft);
  const dirty = numeric !== value && !Number.isNaN(numeric);
  return (
    <FieldRow label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={cn(inputClass, 'font-mono-num max-w-[160px]')}
        />
        <SaveButton
          dirty={dirty}
          saving={saving}
          savedRecently={savedAt !== null && Date.now() - savedAt < 2500}
          onClick={async () => {
            if (Number.isNaN(numeric)) return;
            setSaving(true);
            const ok = await onSave(numeric);
            setSaving(false);
            if (ok) setSavedAt(Date.now());
          }}
        />
      </div>
    </FieldRow>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-ink mb-1">{label}</label>
      {hint && <p className="text-[11px] text-zinc-500 mb-2 max-w-prose">{hint}</p>}
      {children}
    </div>
  );
}

function SaveButton({
  dirty,
  saving,
  savedRecently,
  onClick,
}: {
  dirty: boolean;
  saving: boolean;
  savedRecently: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="primary"
      size="sm"
      disabled={!dirty || saving}
      onClick={onClick}
    >
      {saving ? (
        <>
          <span className="animate-spin rounded-full h-3 w-3 border-2 border-white/30 border-t-white" />
          Saving…
        </>
      ) : savedRecently ? (
        <>
          <Check size={12} aria-hidden />
          Saved
        </>
      ) : (
        <>
          <Save size={12} aria-hidden />
          Save
        </>
      )}
    </Button>
  );
}
