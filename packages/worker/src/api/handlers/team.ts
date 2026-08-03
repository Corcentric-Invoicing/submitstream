// ============================================
// Team Management Handler — admin-only
// Invite, list, assign/unassign suppliers, update profiles,
// deactivate/reactivate, and delete team members
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { requireAdmin } from '../middleware/auth';
import {
  validate,
  inviteTeamMemberSchema,
  inviteTeamMemberRequiredFields,
  inviteSupplierUserSchema,
  inviteSupplierUserRequiredFields,
} from '../middleware/validate';
import { safeJsonBody, sanitizeDbError, extractPathId } from '../middleware/safeParse';
import {
  countRecentProfiles,
  insertProfile,
  insertSupplierAssignments,
  deleteSupplierAssignment,
  deleteAllSupplierAssignments,
  listProfiles,
  listSupplierAssignments,
  updateProfile,
  deleteProfile,
} from '../db/queries';

/** Maximum number of team member invitations an admin can send per hour. */
const MAX_INVITES_PER_HOUR = 5;

/**
 * Create a new user by invitation (admin-only, rate-limited endpoint).
 *
 * All roles: Sends a Supabase invite email (magic link). User lands on /set-password
 *   and chooses their own password.
 *
 * Rolls back auth user creation if profile or supplier assignment creation fails.
 */
export async function inviteTeamMember(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized, userId: callerId } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized || !callerId) return errorResponse('Admin access required', 403);

  // ── Rate limit: max N invites per hour per admin ──
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: recentInvites } = await countRecentProfiles(ctx.serviceClient, oneHourAgo);

  if ((recentInvites || 0) >= MAX_INVITES_PER_HOUR) {
    return errorResponse('Rate limit: too many invites this hour. Try again later.', 429);
  }

  const parsed = await safeJsonBody<{
    email: string;
    display_name: string;
    role: 'admin' | 'supplier';
    supplier_ids?: string[];
    supplier_id?: string;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // ── Supplier role: email invite flow (no password) ──
  if (body.role === 'supplier') {
    const validation = validate(body, inviteSupplierUserSchema, inviteSupplierUserRequiredFields);
    if (!validation.ok) return errorResponse(validation.errors.map(e => `${e.field}: ${e.message}`).join('; '), 400);

    // Build the redirect URL for the invite email
    const portalDomain = ctx.env.PORTAL_DOMAIN || 'www.submitstream.com';
    const redirectTo = `https://${portalDomain}/set-password`;

    // 1. Send invite email via Supabase (creates user + sends magic link)
    const { data: authData, error: authError } = await ctx.serviceClient.auth.admin.inviteUserByEmail(
      body.email,
      { redirectTo, data: { display_name: body.display_name, role: 'supplier' } },
    );
    if (authError || !authData.user) {
      return errorResponse(sanitizeDbError(`Failed to send invite: ${authError?.message}`, 500), 500);
    }
    const userId = authData.user.id;

    // 2. Create profile with supplier_id
    const { error: profileError } = await insertProfile(ctx.serviceClient, {
      id: userId,
      role: 'supplier',
      display_name: body.display_name,
      supplier_id: body.supplier_id,
    });
    if (profileError) {
      await ctx.serviceClient.auth.admin.deleteUser(userId); // Rollback
      return errorResponse(sanitizeDbError(profileError.message, 500), 500);
    }

    return jsonResponse({
      id: userId,
      email: body.email,
      display_name: body.display_name,
      role: 'supplier',
      supplier_id: body.supplier_id,
      invite_sent: true,
    }, 201);
  }

  // ── Team/Admin role: email invite flow (unified with supplier) ──
  if (!body.email || !body.display_name || !body.role) {
    return errorResponse('email, display_name, and role are required', 400);
  }
  if (!['admin', 'supplier'].includes(body.role)) {
    return errorResponse('role must be admin or supplier', 400);
  }

  const portalDomain = ctx.env.PORTAL_DOMAIN || 'www.submitstream.com';
  const redirectTo = `https://${portalDomain}/set-password`;

  // 1. Send invite email via Supabase (creates user + sends magic link)
  const { data: authData, error: authError } = await ctx.serviceClient.auth.admin.inviteUserByEmail(
    body.email,
    { redirectTo, data: { display_name: body.display_name, role: body.role } },
  );
  if (authError || !authData.user) {
    return errorResponse(sanitizeDbError(`Failed to send invite: ${authError?.message}`, 500), 500);
  }
  const userId = authData.user.id;

  // 2. Create profile
  const { error: profileError } = await insertProfile(ctx.serviceClient, {
    id: userId,
    role: body.role,
    display_name: body.display_name,
  });
  if (profileError) {
    await ctx.serviceClient.auth.admin.deleteUser(userId); // Rollback
    return errorResponse(sanitizeDbError(profileError.message, 500), 500);
  }

  // 3. Assign suppliers if specified (with rollback on failure)
  if (body.supplier_ids && body.supplier_ids.length > 0) {
    if (body.supplier_ids.length > 50) {
      // Rollback: remove profile and auth user
      await deleteProfile(ctx.serviceClient, userId);
      await ctx.serviceClient.auth.admin.deleteUser(userId);
      return errorResponse('Cannot assign more than 50 suppliers at once', 400);
    }
    const assignments = body.supplier_ids.map(supplierId => ({
      user_id: userId,
      supplier_id: supplierId,
      assigned_by: callerId,
    }));
    const { error: assignError } = await insertSupplierAssignments(ctx.serviceClient, assignments);
    if (assignError) {
      // Rollback: remove profile and auth user since assignments failed
      await deleteProfile(ctx.serviceClient, userId);
      await ctx.serviceClient.auth.admin.deleteUser(userId);
      return errorResponse(sanitizeDbError(`Failed to assign suppliers: ${assignError.message}`, 500), 500);
    }
  }

  return jsonResponse({
    success: true,
    id: userId,
    email: body.email,
    display_name: body.display_name,
    role: body.role,
    supplier_ids: body.supplier_ids || [],
    invite_sent: true,
  }, 201);
}

/**
 * List all team members with their contact emails and assigned suppliers (admin-only endpoint).
 * Returns assigned_suppliers as array of {id, name, code} objects to match frontend expectations.
 */
export async function listTeamMembers(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  let profilesResult, authResult, assignmentsResult;
  try {
    [profilesResult, authResult, assignmentsResult] = await Promise.all([
      listProfiles(ctx.serviceClient),
      ctx.serviceClient.auth.admin.listUsers(),
      listSupplierAssignments(ctx.serviceClient),
    ]);
  } catch (err) {
    return errorResponse(`Failed to load team data: ${err instanceof Error ? err.message : 'Unknown error'}`, 500);
  }

  if (profilesResult.error) return errorResponse(sanitizeDbError(profilesResult.error.message, 500), 500);
  if (authResult.error) return errorResponse(sanitizeDbError(authResult.error.message, 500), 500);
  if (assignmentsResult.error) return errorResponse(sanitizeDbError(assignmentsResult.error.message, 500), 500);

  const profiles = profilesResult.data || [];
  const authUsers = authResult.data?.users || [];
  const assignments = assignmentsResult.data || [];

  // Build a map of user_id → array of supplier objects {id, name, code}
  const assignmentMap: Record<string, Array<{ id: string; name: string; code: string }>> = {};
  for (const a of assignments) {
    if (!assignmentMap[a.user_id]) assignmentMap[a.user_id] = [];
    const supplier = a.suppliers as unknown as { id: string; name: string; code: string } | null;
    if (supplier) {
      assignmentMap[a.user_id].push(supplier);
    }
  }

  const members = profiles.map(p => {
    const authUser = authUsers.find(u => u.id === p.id);
    return {
      ...p,
      email: authUser?.email || null,
      last_sign_in_at: authUser?.last_sign_in_at || null,
      assigned_suppliers: assignmentMap[p.id] || [],
    };
  });

  return jsonResponse({ success: true, data: members });
}

/**
 * Assign a supplier to a team member (admin-only).
 * POST /api/team/assign { user_id, supplier_id }
 */
export async function assignSupplier(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized, userId: callerId } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized || !callerId) return errorResponse('Admin access required', 403);

  const parsed = await safeJsonBody<{ user_id: string; supplier_id: string }>(request);
  if (!parsed.ok) return parsed.response;
  const { user_id, supplier_id } = parsed.data;

  if (!user_id || !supplier_id) return errorResponse('user_id and supplier_id are required', 400);

  const { error } = await insertSupplierAssignments(ctx.serviceClient, [
    { user_id, supplier_id, assigned_by: callerId },
  ]);

  if (error) {
    // 23505 = unique violation (already assigned)
    if (error.code === '23505') return errorResponse('Supplier already assigned', 409);
    return errorResponse(sanitizeDbError(error.message, 500), 500);
  }

  return jsonResponse({ success: true }, 201);
}

/**
 * Unassign a supplier from a team member (admin-only).
 * DELETE /api/team/assign { user_id, supplier_id }
 */
export async function unassignSupplier(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const parsed = await safeJsonBody<{ user_id: string; supplier_id: string }>(request);
  if (!parsed.ok) return parsed.response;
  const { user_id, supplier_id } = parsed.data;

  if (!user_id || !supplier_id) return errorResponse('user_id and supplier_id are required', 400);

  const { error } = await deleteSupplierAssignment(ctx.serviceClient, user_id, supplier_id);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true });
}

/**
 * Update a team member's profile (admin-only).
 * PATCH /api/team/:id { role?, display_name? }
 */
export async function updateTeamMember(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid member ID', 400);

  const parsed = await safeJsonBody<{ role?: string; display_name?: string }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Only allow known fields
  const updateData: Record<string, string> = {};
  if (body.role && ['admin', 'supplier'].includes(body.role)) updateData.role = body.role;
  if (body.display_name) updateData.display_name = body.display_name;

  if (Object.keys(updateData).length === 0) return errorResponse('No valid fields to update', 400);

  // Update profile fields
  const { data: profileData, error: profileError } = await updateProfile(ctx.serviceClient, id, updateData);
  if (profileError) return errorResponse(sanitizeDbError(profileError.message, 500), 500);

  return jsonResponse({ success: true, data: profileData });
}

/**
 * Reset a team member's password (admin-only).
 * POST /api/team/:id/reset-password { password }
 */
export async function resetTeamMemberPassword(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid member ID', 400);

  const parsed = await safeJsonBody<{ password: string }>(request);
  if (!parsed.ok) return parsed.response;
  const { password } = parsed.data;

  if (!password || password.length < 8) {
    return errorResponse('Password must be at least 8 characters', 400);
  }

  // Set the password AND flip user_metadata.must_reset_password = true so the
  // portal forces them to choose their own on first sign-in. The /set-password
  // page clears the flag after a successful change. Preserves any existing
  // user_metadata keys (display_name, etc.) by merging.
  const { data: existing } = await ctx.serviceClient.auth.admin.getUserById(id);
  const mergedMetadata = {
    ...(existing?.user?.user_metadata ?? {}),
    must_reset_password: true,
  };
  const { error } = await ctx.serviceClient.auth.admin.updateUserById(id, {
    password,
    user_metadata: mergedMetadata,
  });
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true, message: 'Password updated; user will be forced to reset on next sign-in' });
}

/**
 * Resend the invite email for a team member whose original invite expired
 * or was lost (admin-only).
 * POST /api/team/:id/resend-invite
 *
 * Uses inviteUserByEmail again against the same email — Supabase re-issues
 * a fresh invite token. Old tokens are invalidated automatically.
 * Preserves the user's profile row + any supplier assignments (unlike
 * delete + re-invite).
 */
export async function resendInviteToTeamMember(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid member ID', 400);

  // Need the target's email — fetch from auth.users (not user_profiles,
  // which mirrors it but may lag).
  const { data: existing, error: fetchErr } =
    await ctx.serviceClient.auth.admin.getUserById(id);
  if (fetchErr || !existing?.user?.email) {
    return errorResponse('Member not found or missing email', 404);
  }

  const email = existing.user.email;
  const { data: inviteData, error: inviteErr } =
    await ctx.serviceClient.auth.admin.inviteUserByEmail(email);
  if (inviteErr) {
    // Common case: "User already registered" — that's fine here; it just
    // means we can't use inviteUserByEmail. Fall back to a password reset
    // email, which achieves the same "set your password" outcome.
    if (/already registered/i.test(inviteErr.message)) {
      const { error: resetErr } =
        await ctx.serviceClient.auth.resetPasswordForEmail(email);
      if (resetErr) {
        return errorResponse(
          `Couldn't send invite or reset link: ${resetErr.message}`,
          500,
        );
      }
      return jsonResponse({
        success: true,
        message: 'Sent a password-reset email (user already registered)',
        flow: 'recovery',
      });
    }
    return errorResponse(`Couldn't send invite: ${inviteErr.message}`, 500);
  }

  return jsonResponse({
    success: true,
    message: 'Fresh invite sent',
    flow: 'invite',
    user_id: inviteData?.user?.id ?? id,
  });
}

/**
 * Deactivate a team member (admin-only). Disables their auth account.
 * POST /api/team/:id/deactivate
 */
export async function deactivateTeamMember(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized, userId: callerId } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid member ID', 400);

  // Prevent self-deactivation
  if (id === callerId) return errorResponse('Cannot deactivate your own account', 400);

  // Ban the user in Supabase auth (disables login — 876000h ≈ 100 years)
  const { error } = await ctx.serviceClient.auth.admin.updateUserById(id, {
    ban_duration: '876000h',
    user_metadata: { deactivated: true, deactivated_at: new Date().toISOString() },
  });
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true, message: 'Team member deactivated' });
}

/**
 * Reactivate a previously deactivated team member (admin-only).
 * POST /api/team/:id/reactivate
 */
export async function reactivateTeamMember(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid member ID', 400);

  // Unban the user
  const { error } = await ctx.serviceClient.auth.admin.updateUserById(id, {
    ban_duration: 'none',
    user_metadata: { deactivated: false, reactivated_at: new Date().toISOString() },
  });
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true, message: 'Team member reactivated' });
}

/**
 * Permanently delete a team member (admin-only).
 * Removes their profile, supplier assignments, and Supabase auth user.
 * DELETE /api/team/:id
 */
export async function deleteTeamMember(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized, userId: callerId } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid member ID', 400);

  // Prevent self-deletion
  if (id === callerId) return errorResponse('Cannot delete your own account', 400);

  // 1. Remove all supplier assignments
  const { error: assignError } = await deleteAllSupplierAssignments(ctx.serviceClient, id);
  if (assignError) {
    return errorResponse(sanitizeDbError(`Failed to remove supplier assignments: ${assignError.message}`, 500), 500);
  }

  // 2. Remove profile
  const { error: profileError } = await deleteProfile(ctx.serviceClient, id);
  if (profileError) {
    // Assignments already deleted — log but continue to avoid orphaned state
    // In a future iteration, consider a transaction-based approach
    return errorResponse(sanitizeDbError(`Failed to remove profile: ${profileError.message}`, 500), 500);
  }

  // 3. Delete auth user
  const { error: authError } = await ctx.serviceClient.auth.admin.deleteUser(id);
  if (authError) {
    // Profile and assignments already deleted — auth user is orphaned
    // Attempt to restore profile so the user isn't in a broken state
    await insertProfile(ctx.serviceClient, { id, role: 'supplier', display_name: 'RESTORE_NEEDED' });
    return errorResponse(sanitizeDbError(`Failed to delete auth user — profile restored, manual cleanup needed: ${authError.message}`, 500), 500);
  }

  return jsonResponse({ success: true, message: 'Team member permanently deleted' });
}
