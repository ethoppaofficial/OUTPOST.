import React, { useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Receipt, Search } from 'lucide-react';
import { adminService, AdminRecord } from '../../application/services/adminService';
import { storageService } from '../../application/services/storageService';
import { useAdminData } from '../../application/hooks/useAdminData';
import { AdminStatusBar } from '../../components/admin/AdminStatusBar';
import { ReservationStatusBadge } from '../../components/ui/Badge';

interface OversightPayload {
  reservations: AdminRecord[];
  receipts: AdminRecord[];
}

export const DisputesPage: React.FC = () => {
  const {
    data,
    loading,
    refreshing,
    error: loadError,
    isLive,
    lastUpdatedAt,
    refresh,
  } = useAdminData<OversightPayload>(
    async () => {
      const [reservations, receipts] = await Promise.all([
        adminService.getReservations(),
        adminService.getReceipts(),
      ]);
      return { reservations, receipts };
    },
    [],
    { realtimeTables: ['reservations', 'payment_receipts'] }
  );

  const [tab, setTab] = useState<'reservations' | 'receipts'>('reservations');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loadingReceiptId, setLoadingReceiptId] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [signedReceiptLink, setSignedReceiptLink] = useState<{ id: string; url: string; fileName?: string } | null>(null);

  const reservations = !loadError && data ? data.reservations : [];
  const receipts = !loadError && data ? data.receipts : [];

  const filteredReservations = useMemo(
    () =>
      reservations.filter((item) => {
        const matchesStatus = status === 'all' || item.status === status;
        const term = search.trim().toLowerCase();
        const matchesText =
          !term ||
          [item.reservationNumber, item.propertyTitle, item.studentName, item.landlordName, item.id].some((value) =>
            String(value || '').toLowerCase().includes(term)
          );
        return matchesStatus && matchesText;
      }),
    [reservations, status, search]
  );

  const filteredReceipts = useMemo(
    () =>
      receipts.filter((item) => {
        const matchesStatus = status === 'all' || item.status === status;
        const term = search.trim().toLowerCase();
        const matchesText =
          !term ||
          [item.propertyName, item.studentName, item.paymentReference, item.id].some((value) =>
            String(value || '').toLowerCase().includes(term)
          );
        return matchesStatus && matchesText;
      }),
    [receipts, status, search]
  );

  const handleRequestReceiptSignedUrl = async (item: AdminRecord) => {
    setLoadingReceiptId(item.id);
    setReceiptError(null);
    setSignedReceiptLink(null);
    try {
      const url = await storageService.getPrivateAssetDownloadUrl('payment-receipt', item.id);
      setSignedReceiptLink({ id: item.id, url, fileName: item.file_name || item.fileName });
    } catch (err: unknown) {
      setReceiptError(err instanceof Error ? err.message : 'Unable to retrieve signed receipt URL.');
    } finally {
      setLoadingReceiptId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Reservations and receipt oversight</h1>
        <p className="mt-1 text-sm text-slate-500">
          Read-only monitoring across live Supabase reservations and payment receipts. Private receipt files require short-lived signed URLs from <span className="font-mono text-xs">get-private-asset-url</span>.
        </p>
      </header>

      <AdminStatusBar
        isLive={isLive}
        loading={loading}
        refreshing={refreshing}
        error={loadError}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={() => void refresh()}
      />

      {receiptError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {receiptError}
        </div>
      )}

      <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800">
        <button
          type="button"
          onClick={() => {
            setTab('reservations');
            setStatus('all');
          }}
          className={`flex-1 rounded-lg py-2.5 cursor-pointer ${
            tab === 'reservations' ? 'bg-white dark:bg-slate-900' : 'text-slate-500'
          }`}
        >
          Reservations ({reservations.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('receipts');
            setStatus('all');
          }}
          className={`flex-1 rounded-lg py-2.5 cursor-pointer ${
            tab === 'receipts' ? 'bg-white dark:bg-slate-900' : 'text-slate-500'
          }`}
        >
          Payment receipts ({receipts.length})
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={120}
            placeholder="Search reservation, account, property or reference"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <option value="all">All statuses</option>
          {(tab === 'reservations'
            ? ['pending_payment', 'payment_submitted', 'confirmed', 'expired', 'cancelled', 'rejected']
            : ['pending_review', 'approved', 'rejected']
          ).map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading platform records…</p>
      ) : loadError ? null : tab === 'reservations' ? (
        filteredReservations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            No reservations match this filter.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredReservations.map((item) => (
              <article
                key={item.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{item.reservationNumber || item.id}</span>
                    <ReservationStatusBadge status={item.status} />
                  </div>
                  <p className="mt-2 font-semibold">{item.propertyTitle || 'Property'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Student: {item.studentName || item.studentId} · Landlord: {item.landlordName || item.landlordId}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Hold expires: {item.holdExpiresAt ? new Date(item.holdExpiresAt).toLocaleString() : '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">
                    ₦{Number(item.amount || 0).toLocaleString()}
                  </p>
                  <p className="text-[11px] text-slate-500">Read-only financial record</p>
                </div>
              </article>
            ))}
          </div>
        )
      ) : filteredReceipts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          No receipts match this filter.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredReceipts.map((item) => {
            const activeLink = signedReceiptLink?.id === item.id ? signedReceiptLink : null;
            return (
              <article
                key={item.id}
                className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row">
                  <div>
                    <p className="flex items-center gap-2 font-semibold">
                      <Receipt className="h-4 w-4 text-emerald-600" />
                      {item.propertyName || 'Receipt'}{' '}
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                        {item.status}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Student: {item.studentName || item.studentId} · Reference: {item.paymentReference || '—'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Uploaded: {item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">₦{Number(item.amountPaid || 0).toLocaleString()}</p>
                    {item.storagePath && (
                      <button
                        type="button"
                        disabled={loadingReceiptId === item.id}
                        onClick={() => void handleRequestReceiptSignedUrl(item)}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400 cursor-pointer disabled:opacity-50"
                      >
                        {loadingReceiptId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="h-3.5 w-3.5" />
                        )}
                        <span>Generate signed receipt link</span>
                      </button>
                    )}
                  </div>
                </div>

                {activeLink && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30">
                    <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                      15-minute signed link ready: {activeLink.fileName || 'Payment Receipt'}
                    </span>
                    <a
                      href={activeLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Receipt
                    </a>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Admins can inspect private receipts through audited signed URLs, but cannot mutate amounts or approve financial settlements from this oversight view.
      </div>
    </div>
  );
};
