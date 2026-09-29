import React, { useEffect, useState } from 'react';
import { Building2, CheckCircle2, ExternalLink, MapPin, ShieldCheck, XCircle } from 'lucide-react';
import { adminService, AdminRecord } from '../../application/services/adminService';
import { Modal } from '../../components/ui/Modal';

type ReviewTarget = { id: string; title: string; scope: 'property' | 'location'; action: 'reject' | 'suspend' };

export const PropertyApprovalsPage: React.FC = () => {
  const [properties, setProperties] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState<ReviewTarget | null>(null);
  const [reason, setReason] = useState('');
  const refresh = async () => setProperties(await adminService.getProperties());
  useEffect(() => {
    let active = true;
    adminService.getProperties().then((items) => { if (active) setProperties(items); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Property records could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const propertyAction = async (propertyId: string, decision: 'approve' | 'reject' | 'suspend' | 'reactivate', note?: string) => {
    setBusy(propertyId); setError(null); setMessage(null);
    try { await adminService.reviewProperty({ propertyId, decision, reason: note }); await refresh(); setMessage(`Property moderation action “${decision}” saved and audited.`); setTarget(null); setReason(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Property action failed.'); }
    finally { setBusy(null); }
  };
  const locationAction = async (propertyId: string, decision: 'verified' | 'rejected', note?: string) => {
    setBusy(propertyId); setError(null); setMessage(null);
    try { await adminService.reviewPropertyLocation({ propertyId, decision, reason: note }); await refresh(); setMessage(`Property location ${decision === 'verified' ? 'verified' : 'rejected'} separately from listing approval.`); setTarget(null); setReason(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Location review failed.'); }
    finally { setBusy(null); }
  };
  const confirmReason = (event: React.FormEvent) => {
    event.preventDefault(); if (!target) return;
    if (target.scope === 'property') void propertyAction(target.id, target.action, reason);
    else void locationAction(target.id, 'rejected', reason);
  };
  return <div className="space-y-6"><header><h1 className="text-2xl font-black text-slate-900 dark:text-white">Property moderation</h1><p className="mt-1 text-sm text-slate-500">Listing approval and location verification are separate decisions; a listing is public only when both conditions are satisfied.</p></header>
    {error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30">{error}</div>}{message && <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30">{message}</div>}
    {loading ? <p className="text-sm text-slate-500">Loading Firebase properties…</p> : properties.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">No Firebase property records.</div> : <div className="space-y-4">{properties.map((property) => {
      const location = property.submittedLocation;
      const propertyStatus = property.moderationStatus === 'suspended' ? 'suspended' : property.verificationStatus || 'unknown';
      const locationStatus = property.locationVerificationStatus || location?.verificationStatus || 'not_submitted';
      const suspended = property.moderationStatus === 'suspended';
      return <article key={property.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-bold uppercase text-emerald-700 dark:text-emerald-400">{property.propertyType || 'Property'}</span><span className="rounded-full bg-purple-100 px-2 py-1 font-semibold text-purple-800 dark:bg-purple-950/40 dark:text-purple-300">Listing: {propertyStatus}</span><span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Location: {locationStatus}</span></div><h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{property.title || 'Untitled property'}</h2><p className="mt-1 text-xs text-slate-500">{property.address || 'No address'} · {property.neighbourhood || property.area || 'Area unavailable'} · Landlord {property.landlordName || property.landlordId || '—'}</p></div><div className="sm:text-right"><div className="font-black text-emerald-700 dark:text-emerald-400">₦{Number(property.pricePerSession || 0).toLocaleString()}</div><span className="text-[11px] text-slate-500">per academic session</span></div></div>
        {location && <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/70"><div className="flex flex-wrap items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-emerald-600" />{location.area || property.area || 'Area unavailable'} · {location.formattedAddress || location.publicLocationLabel || 'Submitted location'} {Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)) && <span className="font-mono text-slate-500">Private review coordinates: {Number(location.latitude).toFixed(4)}, {Number(location.longitude).toFixed(4)}</span>}</div><p className="mt-1 text-slate-500">Approval of the location publishes only a derived public coordinate, not the private pin.</p></div>}
        {Array.isArray(property.images) && property.images.length > 0 && <div className="flex gap-2 overflow-x-auto">{property.images.slice(0, 8).map((url: string, index: number) => <a key={`${property.id}-${index}`} href={url} target="_blank" rel="noreferrer" className="shrink-0"><img src={url} alt={`Evidence ${index + 1} for ${property.title || 'property'}`} className="h-20 w-28 rounded-lg object-cover" /><span className="sr-only">Open property evidence {index + 1}</span></a>)}</div>}
        {property.adminReviewReason && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Last decision note: {property.adminReviewReason}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800"><span className="text-xs text-slate-500">Created {property.createdAt ? new Date(property.createdAt).toLocaleDateString() : 'date unavailable'}</span><div className="flex flex-wrap gap-2">
          {property.verificationStatus !== 'approved' && <button type="button" disabled={busy === property.id} onClick={() => void propertyAction(property.id, 'approve')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Approve listing</button>}
          {property.verificationStatus !== 'rejected' && <button type="button" disabled={busy === property.id} onClick={() => setTarget({ id: property.id, title: property.title || 'Property', scope: 'property', action: 'reject' })} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:text-rose-300"><XCircle className="mr-1 inline h-3.5 w-3.5" />Reject</button>}
          {location && locationStatus === 'pending' && <><button type="button" disabled={busy === property.id} onClick={() => void locationAction(property.id, 'verified')} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 dark:border-blue-900 dark:text-blue-300"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Verify location</button><button type="button" disabled={busy === property.id} onClick={() => setTarget({ id: property.id, title: property.title || 'Property location', scope: 'location', action: 'reject' })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700">Reject location</button></>}
          {suspended ? <button type="button" disabled={busy === property.id} onClick={() => void propertyAction(property.id, 'reactivate')} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Reactivate</button> : property.verificationStatus === 'approved' && <button type="button" disabled={busy === property.id} onClick={() => setTarget({ id: property.id, title: property.title || 'Property', scope: 'property', action: 'suspend' })} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Suspend</button>}
          {location?.documentUrl && <a href={location.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800"><ExternalLink className="h-3.5 w-3.5" />Evidence</a>}
        </div></div>
      </article>;
    })}</div>}
    <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900"><Building2 className="h-4 w-4 shrink-0 text-emerald-600" />Landlord verification does not automatically verify a listing; listing approval and location approval remain distinct and are independently audited.</div>
    <Modal isOpen={!!target} onClose={() => { setTarget(null); setReason(''); }} title={target?.action === 'suspend' ? 'Suspend property' : target?.scope === 'location' ? 'Reject property location' : 'Reject property listing'}><form onSubmit={confirmReason} className="space-y-4 text-sm"><p>Enter the reason for this decision on <strong>{target?.title}</strong>.</p><label className="block font-semibold">Reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setTarget(null)} className="rounded-lg px-3 py-2 text-xs">Cancel</button><button disabled={!!busy} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white">Confirm decision</button></div></form></Modal>
  </div>;
};
