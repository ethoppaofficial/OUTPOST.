import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { AdminServiceError } from '../../application/services/adminService';

interface AdminStatusBarProps {
  isLive: boolean;
  loading: boolean;
  refreshing: boolean;
  error: AdminServiceError | Error | null;
  lastUpdatedAt: string | null;
  onRefresh: () => void;
}

export const AdminStatusBar: React.FC<AdminStatusBarProps> = ({
  isLive,
  loading,
  refreshing,
  error,
  lastUpdatedAt,
  onRefresh,
}) => {
  const errorCode = error instanceof AdminServiceError ? error.code : null;
  const errorHint = error instanceof AdminServiceError ? error.hint : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          {error ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-400">
              <AlertCircle className="h-3.5 w-3.5" />
              Live Data Unavailable
            </span>
          ) : loading ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600" />
              Connecting to live Supabase…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isLive ? 'Live Supabase Connected' : 'Synced'}
            </span>
          )}

          {lastUpdatedAt && (
            <span className="text-slate-500 dark:text-slate-400">
              Last refreshed: {new Date(lastUpdatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
          <span>{refreshing ? 'Refreshing…' : loading ? 'Loading…' : 'Refresh live data'}</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="font-bold">
                {errorCode ? `[${errorCode}] ` : ''}
                {error.message}
              </p>
              {errorHint && (
                <p className="text-xs text-rose-700 dark:text-rose-300">{errorHint}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || refreshing}
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
