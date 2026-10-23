/**
 * @file FirebaseContext.tsx
 * @deprecated This compatibility facade re-exports from AuthContext.tsx.
 *
 * Migration Note:
 * OUTPOST has migrated to Supabase Auth. All active components should import
 * `AuthContext`, `AuthProvider`, and `useAuth` from `src/application/context/AuthContext.tsx`.
 * This file is retained purely as a non-breaking compatibility bridge and does not
 * import or initialize any Firebase SDK code.
 */

export {
  AuthContext as FirebaseContext,
  AuthProvider as FirebaseProvider,
  useAuth,
  useFirebase,
} from './AuthContext';
export type { AuthContextType } from './AuthContext';
