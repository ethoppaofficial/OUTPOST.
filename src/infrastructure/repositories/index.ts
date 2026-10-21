import { IRepository } from '../../domain/repository';
import { SupabaseRepository } from '../supabase/supabaseRepository';
import { FirebaseRepository } from './firebaseRepository';

const supabaseRepoInstance = new SupabaseRepository();

/**
 * Returns the authoritative production repository.
 * Supabase is the exclusive production backend.
 */
export function getActiveRepository(): IRepository {
  return supabaseRepoInstance;
}

export const repository: IRepository = supabaseRepoInstance;
export { SupabaseRepository, FirebaseRepository };
