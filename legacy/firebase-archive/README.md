# Legacy Firebase Archive

## Legacy Firebase Archive Note

The repository retains selected Firebase configuration, Firestore rules, Storage rules, and Cloud Function files for historical migration traceability and rollback analysis. These files are not part of the active OUTPOST runtime and must not be deployed or imported by the active frontend. Supabase is the only supported backend. The archive may be removed after production acceptance testing, backup verification, and explicit maintainer approval.

### Retained Historical Assets

1. **`legacy/firebase-archive/infrastructure/firebase/`**:
   - Historical Firebase client initialization (`firebaseConfig.ts`), Firestore service wrappers (`firestoreService.ts`), and error handling (`errorHandler.ts`).
2. **`legacy/firebase-archive/repositories/`**:
   - Historical `FirebaseRepository` implementation (`firebaseRepository.ts`).
3. **`legacy/firebase-archive/deployment/`**:
   - Historical Firestore rules (`firestore.rules`), indexes (`firestore.indexes.json`), and Firebase Storage rules (`storage.rules`).
4. **`functions/`**:
   - Historical Firebase Cloud Functions retained strictly for reference and comparison with Supabase Edge Functions (`supabase/functions/`).

### Authoritative Active Backend

OUTPOST uses **Supabase** exclusively:
- **Supabase Auth**: `src/application/context/AuthContext.tsx`
- **Supabase PostgreSQL & RLS**: `supabase/migrations/`
- **Supabase Storage**: `src/infrastructure/supabase/supabaseStorageService.ts`
- **Supabase Edge Functions**: `supabase/functions/`
