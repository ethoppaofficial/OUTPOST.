import { IRepository } from '../../domain/repository';
import { FirebaseRepository } from './firebaseRepository';

const firebaseRepoInstance = new FirebaseRepository();

export function getActiveRepository(): IRepository {
  return firebaseRepoInstance;
}

export const repository: IRepository = firebaseRepoInstance;
export { FirebaseRepository };
