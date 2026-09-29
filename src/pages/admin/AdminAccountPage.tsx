import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useFirebase } from '../../application/context/FirebaseContext';

export const AdminAccountPage: React.FC = () => {
  const { currentUser, firebaseUser } = useFirebase();
  return <section className="mx-auto max-w-2xl space-y-5">
    <header><h1 className="text-2xl font-black text-slate-900 dark:text-white">Administrator account</h1><p className="mt-1 text-sm text-slate-500">Account identity and access are supplied by Firebase Authentication.</p></header>
    <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><ShieldCheck className="h-5 w-5" /></span><div><p className="font-bold text-slate-900 dark:text-white">Administrator</p><p className="text-xs text-slate-500">Role asserted by a Firebase custom claim</p></div></div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Name</dt><dd className="mt-1 font-semibold">{currentUser?.fullName || 'Administrator'}</dd></div><div><dt className="text-xs text-slate-500">Email</dt><dd className="mt-1 font-semibold">{firebaseUser?.email || currentUser?.email || '—'}</dd></div><div><dt className="text-xs text-slate-500">Email verified</dt><dd className="mt-1 font-semibold">{firebaseUser?.emailVerified ? 'Yes' : 'No'}</dd></div><div><dt className="text-xs text-slate-500">Firebase UID</dt><dd className="mt-1 break-all font-mono text-xs">{firebaseUser?.uid || '—'}</dd></div></dl>
    </div>
  </section>;
};
