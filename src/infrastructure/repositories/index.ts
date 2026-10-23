import { IRepository } from '../../domain/repository';
import { SupabaseRepository } from '../supabase/supabaseRepository';

const supabaseRepoInstance = new SupabaseRepository();

/**
 * Returns the authoritative production repository.
 * Supabase is the exclusive active production backend for OUTPOST.
 * Firebase is archived and not constructed or imported by the active application.
 */
export function getActiveRepository(): IRepository {
  return supabaseRepoInstance;
}

export const repository: IRepository = supabaseRepoInstance;
export { SupabaseRepository };

