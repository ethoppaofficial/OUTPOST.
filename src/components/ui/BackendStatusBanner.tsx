import React from 'react';
import { Database, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { useFirebase } from '../../application/context/FirebaseContext';
import { appConfig, configValidationError } from '../../infrastructure/config/appConfig';

export const ConfigErrorScreen: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-3xl p-6 sm:p-8 shadow-xl space-y-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-900/50 text-rose-600 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">
          Firebase Configuration Required
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {configValidationError || 'Firebase backend configuration is incomplete or missing.'}
        </p>
        <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-xl text-left font-mono text-[11px] text-slate-700 dark:text-slate-300">
          <p className="font-bold text-slate-900 dark:text-white mb-1">Required in firebase-applet-config.json:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>projectId</li>
            <li>authDomain</li>
            <li>firestoreDatabaseId</li>
            <li>storageBucket</li>
            <li>appId</li>
            <li>apiKey</li>
          </ul>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Retry Connection</span>
        </button>
      </div>
    </div>
  );
};

export const BackendStatusBadge: React.FC = () => {
  const { connected, backendMode, firestoreDatabaseId } = useFirebase();

  if (backendMode === 'mock') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        <span>Mock Mode (Local Storage Only)</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold" title={`Connected to Firestore DB: ${firestoreDatabaseId}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
      <Database className="w-3 h-3" />
      <span>Firebase: {connected ? 'Live' : 'Connecting'}</span>
    </div>
  );
};
