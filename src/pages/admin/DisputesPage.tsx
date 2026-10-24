import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Receipt, Search } from 'lucide-react';
import { adminService, AdminRecord } from '../../application/services/adminService';
import { ReservationStatusBadge } from '../../components/ui/Badge';

export const DisputesPage: React.FC = () => {
  const [tab, setTab] = useState<'reservations' | 'receipts'>('reservations');
  const [reservations, setReservations] = useState<AdminRecord[]>([]);
  const [receipts, setReceipts] = useState<AdminRecord[]>([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([adminService.getReservations(), adminService.getReceipts()]).then(([reservationData, receiptData]) => {
      if (active) { setReservations(reservationData); setReceipts(receiptData); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Reservation data could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const filteredReservations = useMemo(() => reservations.filter((item) => {
    const matchesStatus = status === 'all' || item.status === status;
    const term = search.trim().toLowerCase();
    const matchesText = !term || [item.reservationNumber, item.propertyTitle, item.studentName, item.landlordName, item.id].some((value) => String(value || '').toLowerCase().includes(term));
    return matchesStatus && matchesText;
  }), [reservations, status, search]);
  const filteredReceipts = useMemo(() => receipts.filter((item) => {
    const matchesStatus = status === 'all' || item.status === status;
    const term = search.trim().toLowerCase();
    const matchesText = !term || [item.propertyName, item.studentName, item.paymentReference, item.id].some((value) => String(value || '').toLowerCase().includes(term));
    return matchesStatus && matchesText;
  }), [receipts, status, search]);
  return <div className="space-y-6"><header><h1 className="text-2xl font-black text-slate-900 dark:text-white">Reservations and receipt oversight</h1><p className="mt-1 text-sm text-slate-500">Read-only monitoring across the platform. Financial records cannot be changed from this screen.</p></header>{error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30">{error}</div>}
    <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800"><button type="button" onClick={() => { setTab('reservations'); setStatus('all'); }} className={`flex-1 rounded-lg py-2.5 ${tab === 'reservations' ? 'bg-white dark:bg-slate-900' : 'text-slate-500'}`}>Reservations ({reservations.length})</button><button type="button" onClick={() => { setTab('receipts'); setStatus('all'); }} className={`flex-1 rounded-lg py-2.5 ${tab === 'receipts' ? 'bg-white dark:bg-slate-900' : 'text-slate-500'}`}>Payment receipts ({receipts.length})</button></div>
    <div className="flex flex-col gap-3 sm:flex-row"><label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900"><Search className="h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="Search reservation, account, property or reference" className="w-full bg-transparent text-sm outline-none" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900"><option value="all">All statuses</option>{(tab === 'reservations' ? ['pending_payment','receipt_submitted','confirmed','expired','cancelled','rejected'] : ['pending_review','approved','rejected']).map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></div>
    {loading ? <p className="text-sm text-slate-500">Loading platform records…</p> : tab === 'reservations' ? filteredReservations.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">No reservations match this filter.</p> : <div className="space-y-3">{filteredReservations.map((item) => <article key={item.id} className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono font-bold">{item.reservationNumber || item.id}</span><ReservationStatusBadge status={item.status} /></div><p className="mt-2 font-semibold">{item.propertyTitle || item.propertyName || 'Property'} {item.unitName ? `· ${item.unitName}` : ''}</p><p className="mt-1 text-xs text-slate-500">Student: {item.studentName || item.studentId} · Landlord: {item.landlordName || item.landlordId}</p><p className="mt-1 text-xs text-slate-500">Hold expires: {item.holdExpiresAt ? new Date(item.holdExpiresAt).toLocaleString() : '—'}</p></div><div className="text-right"><p className="text-lg font-black text-emerald-700 dark:text-emerald-400">₦{Number(item.amount || 0).toLocaleString()}</p><p className="text-[11px] text-slate-500">Read-only financial record</p></div></article>)}</div> : filteredReceipts.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">No receipts match this filter.</p> : <div className="space-y-3">{filteredReceipts.map((item) => <article key={item.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:flex-row"><div><p className="flex items-center gap-2 font-semibold"><Receipt className="h-4 w-4 text-emerald-600" />{item.propertyName || item.propertyTitle || 'Receipt'} <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">{item.status}</span></p><p className="mt-1 text-xs text-slate-500">Student: {item.studentName || item.studentId} · Reference: {item.paymentReference || '—'}</p><p className="mt-1 text-xs text-slate-500">Uploaded: {item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : '—'}</p></div><div className="text-right"><p className="font-bold">₦{Number(item.amountPaid || 0).toLocaleString()}</p>{item.fileUrl && <a href={item.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">View receipt</a>}</div></article>)}</div>}
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />Admins can investigate, but cannot approve receipts, change amounts, release holds, or edit financial records from this oversight page.</div>
  </div>;
};
