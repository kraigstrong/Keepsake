import type { UnitSystem } from '../../server/units/quantityVocabulary';
import { supabase } from '../supabase/instance';

/**
 * No generated Supabase types exist yet (`supabase gen types` needs a
 * running local instance — Docker isn't available in this environment,
 * see docs/phase-status.md). Until then, `.rpc(...)` returns `unknown`
 * rather than a real row shape — these casts document the actual RPC
 * return shapes from their migrations rather than leaving `as any`
 * scattered through the call sites. Revisit once types are generated.
 */
interface HouseholdRow {
  id: string;
}
interface CreateInvitationRow {
  token: string;
  expires_at: string;
}

export interface Profile {
  id: string;
  displayName: string;
  // Global unit-system preference (ADR-0018, UNIT-02) — drives the
  // Original/Preferred toggle on a recipe's detail screen.
  preferredUnitSystem: UnitSystem;
}

export interface Household {
  id: string;
}

export interface HouseholdMember {
  userId: string;
  displayName: string;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, preferred_unit_system')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    preferredUnitSystem: data.preferred_unit_system as UnitSystem,
  };
}

export async function createProfile(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, display_name: displayName });
  if (error) throw error;
}

// The first UPDATE this app has ever needed against profiles (every
// prior interaction was fetch/insert-only) — the existing "update own
// row" RLS policy (Phase 3) already covers it, no RPC needed.
export async function updateProfile(
  userId: string,
  updates: { preferredUnitSystem: UnitSystem },
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ preferred_unit_system: updates.preferredUnitSystem })
    .eq('id', userId);
  if (error) throw error;
}

export async function fetchHousehold(): Promise<Household | null> {
  const { data, error } = await supabase.from('households').select('id').maybeSingle();
  if (error) throw error;
  return data ? { id: data.id } : null;
}

export async function createHousehold(): Promise<Household> {
  const { data, error } = await supabase.rpc('create_household').single();
  if (error) throw error;
  const row = data as HouseholdRow;
  return { id: row.id };
}

export interface CreatedInvitation {
  token: string;
  expiresAt: string;
}

export async function createInvitation(): Promise<CreatedInvitation> {
  const { data, error } = await supabase.rpc('create_invitation').single();
  if (error) throw error;
  const row = data as CreateInvitationRow;
  return { token: row.token, expiresAt: row.expires_at };
}

export async function acceptInvitation(token: string): Promise<Household> {
  const { data, error } = await supabase.rpc('accept_invitation', { raw_token: token }).single();
  if (error) throw error;
  const row = data as HouseholdRow;
  return { id: row.id };
}

export async function fetchHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('household_membership')
    .select('user_id')
    .eq('household_id', householdId);
  if (membershipError) throw membershipError;

  const userIds = memberships.map((m) => m.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', userIds);
  if (profilesError) throw profilesError;

  return profiles.map((p) => ({ userId: p.id, displayName: p.display_name }));
}
