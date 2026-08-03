import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * CorcentricConfigBanner — surfaces when the invoice's supplier isn't
 * fully wired to Corcentric, so users find out BEFORE submit instead of
 * via a 400 or a mangled XML preview.
 *
 * Checks (in priority order):
 *   1. No supplier_communities row + no legacy community_id → "assign to
 *      a community"
 *   2. Community has no cor_api_url / cor_username / cor_password →
 *      "community missing DMS credentials"
 *   3. Missing cor_vendor_code (on join OR legacy supplier column) →
 *      "vendor code missing"
 *
 * All check via the primary supplier_communities row when present,
 * falling back to legacy supplier columns during the transition.
 * Reads via supabase client — RLS on suppliers + supplier_communities
 * allows admins, team members, and supplier users to see their own
 * config.
 */

interface CorcentricConfigBannerProps {
  supplierId: string;
}

interface ConfigRow {
  supplier_id: string;
  supplier_name: string;
  legacy_vendor_code: string | null;
  legacy_community_code: string | null;
  legacy_community_id: string | null;
  legacy_community_name: string | null;
  legacy_community_has_creds: boolean;
  primary_join_vendor_code: string | null;
  primary_join_community_id: string | null;
  primary_join_community_name: string | null;
  primary_join_community_code: string | null;
  primary_join_community_has_creds: boolean;
}

export function CorcentricConfigBanner({ supplierId }: CorcentricConfigBannerProps) {
  const [config, setConfig] = useState<ConfigRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Read the supplier + its primary supplier_communities row (with
      // nested community) in one round-trip. Supabase PostgREST returns
      // the nested join as an array — we filter to is_primary + active
      // in-memory to keep the query simple.
      const { data } = await supabase
        .from('suppliers')
        .select(`
          id, name,
          cor_vendor_code,
          community_id,
          communities (id, name, code, cor_api_url, cor_username, cor_password),
          supplier_communities (
            cor_vendor_code,
            is_primary,
            active,
            communities (id, name, code, cor_api_url, cor_username, cor_password)
          )
        `)
        .eq('id', supplierId)
        .single();
      if (cancelled || !data) {
        if (!cancelled) setLoading(false);
        return;
      }
      // Supabase's TS types return joined FKs as arrays even when the FK
      // is single-value — runtime returns whichever it is. Normalize by
      // treating everything as "maybe array" and picking [0] when needed.
      type CommunityShape = {
        id: string;
        name: string;
        code: string;
        cor_api_url: string | null;
        cor_username: string | null;
        cor_password: string | null;
      };
      type SupplierCommunityShape = {
        cor_vendor_code: string | null;
        is_primary: boolean;
        active: boolean;
        communities: CommunityShape | CommunityShape[] | null;
      };
      type Row = {
        id: string;
        name: string;
        cor_vendor_code: string | null;
        community_id: string | null;
        communities: CommunityShape | CommunityShape[] | null;
        supplier_communities: SupplierCommunityShape[];
      };
      const pickOne = <T,>(v: T | T[] | null | undefined): T | null => {
        if (v == null) return null;
        return Array.isArray(v) ? (v[0] ?? null) : v;
      };
      const row = data as unknown as Row;
      const legacyCommunity = pickOne(row.communities);
      const joins = (row.supplier_communities ?? []).filter((r) => r.active !== false);
      const primaryJoin = joins.find((r) => r.is_primary) || joins[0] || null;
      const primaryCommunity = pickOne(primaryJoin?.communities ?? null);
      setConfig({
        supplier_id: row.id,
        supplier_name: row.name,
        legacy_vendor_code: row.cor_vendor_code,
        legacy_community_code: legacyCommunity?.code ?? null,
        legacy_community_id: row.community_id,
        legacy_community_name: legacyCommunity?.name ?? null,
        legacy_community_has_creds: Boolean(
          legacyCommunity?.cor_api_url && legacyCommunity?.cor_username && legacyCommunity?.cor_password,
        ),
        primary_join_vendor_code: primaryJoin?.cor_vendor_code ?? null,
        primary_join_community_id: primaryCommunity?.id ?? null,
        primary_join_community_name: primaryCommunity?.name ?? null,
        primary_join_community_code: primaryCommunity?.code ?? null,
        primary_join_community_has_creds: Boolean(
          primaryCommunity?.cor_api_url &&
            primaryCommunity?.cor_username &&
            primaryCommunity?.cor_password,
        ),
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  if (loading || !config) return null;

  const resolvedVendorCode =
    config.primary_join_vendor_code || config.legacy_vendor_code;
  const resolvedCommunityCode =
    config.primary_join_community_code || config.legacy_community_code;
  const resolvedCommunityName =
    config.primary_join_community_name || config.legacy_community_name;
  const resolvedCommunityHasCreds =
    config.primary_join_community_has_creds || config.legacy_community_has_creds;
  const hasCommunity = Boolean(
    config.primary_join_community_id || config.legacy_community_id,
  );

  // Compute the issue list. Order matters — most fundamental first.
  const issues: Array<{ label: string; detail: string }> = [];
  if (!hasCommunity) {
    issues.push({
      label: 'Not assigned to a community',
      detail:
        'Corcentric routes submissions by community. Add this supplier to the community that owns its DMS.',
    });
  } else {
    if (!resolvedVendorCode) {
      issues.push({
        label: 'Vendor code missing',
        detail: `Corcentric needs a corVendorCode to identify ${config.supplier_name} in the ${resolvedCommunityName ?? 'assigned'} DMS. Set it on the community's Suppliers tab.`,
      });
    }
    if (!resolvedCommunityCode) {
      issues.push({
        label: 'Community code missing',
        detail: `The community "${resolvedCommunityName ?? ''}" has no DMS code. Edit the community and set its code (e.g. DTN, IPW, FLAG).`,
      });
    }
    if (!resolvedCommunityHasCreds) {
      issues.push({
        label: 'Community missing DMS credentials',
        detail: `Set cor_api_url, cor_username, and cor_password on the ${resolvedCommunityName ?? 'assigned'} community. Live submits can't happen without them.`,
      });
    }
  }

  if (issues.length === 0) return null;

  return (
    <div className="bg-danger-soft border border-danger/25 rounded-card overflow-hidden">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <AlertTriangle size={13} className="text-danger shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-danger text-xs">
              {config.supplier_name} isn't ready for Corcentric submission
            </strong>
            <span className="text-[11px] text-zinc-600">
              · {issues.length} configuration issue{issues.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {issues.map((iss, i) => (
              <li key={i} className="text-xs text-zinc-800">
                <span className="font-semibold">{iss.label}</span>
                <span className="text-zinc-600"> — {iss.detail}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-3">
            <Link
              to="/admin/communities"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger hover:underline"
            >
              Open Communities admin
              <ExternalLink size={10} />
            </Link>
            <span className="text-[11px] text-zinc-500">
              Submissions will fail until this is resolved.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
