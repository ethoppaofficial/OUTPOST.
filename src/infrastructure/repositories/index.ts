import { IRepository } from '../../domain/repository';
import { appConfig } from '../config/appConfig';
import { FirebaseRepository } from './firebaseRepository';
import { SupabaseRepository } from './supabaseRepository';
import { LocalStorageRepository } from './localStorageRepository';

// Instantiate repository singletons
const firebaseRepoInstance = new FirebaseRepository();
const supabaseRepoInstance = new SupabaseRepository();
const mockRepoInstance = new LocalStorageRepository();

/**
 * Returns active repository based on backend mode ('supabase' | 'firebase' | 'mock').
 * Keeps Firebase available for rollback while routing to Supabase when configured.
 */
export function getActiveRepository(): IRepository {
  if (appConfig.backendMode === 'supabase') {
    return supabaseRepoInstance;
  }
  if (appConfig.backendMode === 'mock') {
    return mockRepoInstance;
  }
  return firebaseRepoInstance;
}

export const repository: IRepository = getActiveRepository();
export { FirebaseRepository, SupabaseRepository, LocalStorageRepository };
