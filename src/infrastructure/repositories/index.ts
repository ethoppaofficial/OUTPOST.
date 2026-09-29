import { IRepository } from '../../domain/repository';
import { appConfig } from '../config/appConfig';
import { FirebaseRepository } from './firebaseRepository';
import { LocalStorageRepository } from './localStorageRepository';

// Instantiate repository singletons
const firebaseRepoInstance = new FirebaseRepository();
const mockRepoInstance = new LocalStorageRepository();

/**
 * Returns active repository based on backend mode.
 * Defaults to Firebase for production and staging.
 */
export function getActiveRepository(): IRepository {
  if (appConfig.backendMode === 'mock') {
    return mockRepoInstance;
  }
  return firebaseRepoInstance;
}

export const repository: IRepository = getActiveRepository();
export { FirebaseRepository, LocalStorageRepository };
