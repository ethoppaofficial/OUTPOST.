import React from 'react';

export const PropertyCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs animate-pulse">
    <div className="h-52 bg-slate-200 dark:bg-slate-800 w-full" />
    <div className="p-5 space-y-3">
      <div className="flex justify-between">
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-md w-1/3" />
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-md w-1/4" />
      </div>
      <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-md w-3/4" />
      <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-md w-1/2" />
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
        <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-md w-1/3" />
        <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-lg w-24" />
      </div>
    </div>
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="space-y-3 animate-pulse">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="h-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full p-4 flex items-center justify-between"
      >
        <div className="space-y-2 w-1/3">
          <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-md w-3/4" />
          <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-md w-1/2" />
        </div>
        <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-full w-24" />
        <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-lg w-20" />
      </div>
    ))}
  </div>
);
