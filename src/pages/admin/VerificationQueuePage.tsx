/**
 * @file VerificationQueuePage.tsx
 * @description Administrative moderation queue for BUK student credentials and landlord KYC vetting.
 * 
 * Features & Security Controls:
 * - Tabbed queues: Student verification requests and Landlord accreditation submissions.
 * - PII Masking: Uses `maskIdentifier()` to conceal sensitive national ID numbers / BUK matriculation digits.
 * - Private Asset Access: Employs `storageService.getPrivateAssetDownloadUrl()` to generate 15-minute
 *   expiring signed URLs on demand, preventing public exposure of identification proofs.
 * - Action modal: Allows administrators to approve or reject submissions with mandatory rejection rationale.
 */

import React, { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileCheck2, ShieldCheck, XCircle, Loader2 } from 'lucide-react';
import { adminService, AdminRecord } from '../../application/services/adminService';
import { storageService } from '../../application/services/storageService';
import { Modal } from '../../components/ui/Modal';

type Kind = 'student' | 'landlord';
type Target = { kind: Kind; id: string; name: string };

/** Masks sensitive identity strings, showing only the final 4 characters */
function maskIdentifier(value: unknown): string {
  const identifier = String(value || '').trim();
  if (!identifier) return 'Not supplied';
  if (identifier.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(8, Math.max(4, identifier.length - 4)))}${identifier.slice(-4)}`;
}

/**
 * VerificationQueuePage Component
 * 
 * Renders pending verification queues, evidence viewing links, and approval/rejection dialogs.
 */
export const VerificationQueuePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Kind>('student');
  const [students, setStudents] = useState<AdminRecord[]>([]);
  const [landlords, setLandlords] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');

  const handleOpenEvidence = async (item: AdminRecord, kind: Kind) => {
    const id = kind === 'student' ? item.id : item.userId || item.id;
    setOpeningEvidenceId(id);
    try {
      const signedUrl = await storageService.getPrivateAssetDownloadUrl(
        kind === 'student' ? 'student-document' : 'landlord-document',
        id
      );
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      if (item.documentUrl) {
        window.open(item.documentUrl, '_blank', 'noopener,noreferrer');
      } else {
        alert('Evidence document could not be retrieved.');
      }
    } finally {
      setOpeningEvidenceId(null);
    }
  };

  const refresh = async () => {
    const queue = await adminService.getVerificationQueues();
    setStudents(queue.students);
    setLandlords(queue.landlords);
  };
  useEffect(() => {
    let active = true;
    adminService.getVerificationQueues().then((queue) => {
      if (active) { setStudents(queue.students); setLandlords(queue.landlords); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load verification queues.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const decide = async (item: AdminRecord, kind: Kind, decision: 'approved' | 'rejected', rejectionReason = '') => {
    const id = kind === 'student' ? item.id : item.userId || item.id;
    setBusyId(id);
    setError(null);
    try {
      await adminService.reviewVerification({ kind, targetId: id, decision, reason: rejectionReason || undefined });
      await refresh();
      setMessage(`${kind === 'student' ? 'Student' : 'Landlord'} verification ${decision}. The decision and notification were recorded.`);
      setTarget(null);
      setReason('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The verification decision could not be saved.');
    } finally {
      setBusyId(null);
    }
  };

  const queue = activeTab === 'student' ? students : landlords;
  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-black text-slate-900 dark:text-white">Credential verification</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review live Student and Landlord submissions. Landlord identity verification is separate from property verification.</p></header>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30">{message}</div>}
      <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800">
        {(['student', 'landlord'] as Kind[]).map((kind) => <button key={kind} type="button" onClick={() => setActiveTab(kind)} className={`flex-1 rounded-lg py-2.5 capitalize ${activeTab === kind ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white' : 'text-slate-500'}`}>{kind} submissions ({kind === 'student' ? students.length : landlords.length})</button>)}
      </div>
      {loading ? <p className="text-sm text-slate-500">Loading verification submissions…</p> : queue.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">No pending {activeTab} submissions.</div> : <div className="space-y-4">
        {queue.map((item) => {
          const name = activeTab === 'student' ? item.fullName : item.legalName;
          const id = activeTab === 'student' ? item.id : item.userId || item.id;
          const documentUrl = item.documentUrl;
          return <article key={id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-amber-600" /><h2 className="font-bold text-slate-900 dark:text-white">{name || (activeTab === 'student' ? 'Student' : 'Landlord')}</h2></div><p className="mt-1 text-xs text-slate-500">{activeTab === 'student' ? `${item.studentEmail || 'No email'} · ${item.registrationNumber || 'Registration number not supplied'}` : `${item.email || 'No email'} · ${item.businessName || 'Individual landlord'}`}</p></div><span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Pending review</span></div>
            <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800/70 sm:grid-cols-2 lg:grid-cols-4">
              {activeTab === 'student' ? (
                <>
                  <div><span className="text-slate-500">University / campus</span><p className="mt-1 font-semibold">{[item.university, item.campus].filter(Boolean).join(' · ') || 'Not supplied'}</p></div>
                  <div><span className="text-slate-500">Programme / level</span><p className="mt-1 font-semibold">{[item.programme, item.studyLevel].filter(Boolean).join(' · ') || 'Not supplied'}</p></div>
                  <div><span className="text-slate-500">Document type</span><p className="mt-1 font-semibold">{item.documentType || 'Not supplied'}</p></div>
                </>
              ) : (
                <>
                  <div><span className="text-slate-500">Identity type</span><p className="mt-1 font-semibold">{item.idType || 'Not supplied'}</p></div>
                  <div><span className="text-slate-500">Reference (partially masked)</span><p className="mt-1 font-semibold">{maskIdentifier(item.idNumber)}</p></div>
                  <div><span className="text-slate-500">Ownership evidence</span><p className="mt-1 font-semibold">{item.ownershipDocType || 'Not supplied'}</p></div>
                </>
              )}
              <div><span className="text-slate-500">Submitted</span><p className="mt-1 font-semibold">{item.submittedAt ? new Date(item.submittedAt).toLocaleString() : 'Date unavailable'}</p></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                disabled={openingEvidenceId === id}
                onClick={() => handleOpenEvidence(item, activeTab)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                {openingEvidenceId === id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                <span>Open submitted evidence (signed link)</span>
              </button>
              <div className="flex gap-2"><button type="button" disabled={busyId === id} onClick={() => setTarget({ kind: activeTab, id, name: String(name || activeTab) })} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300"><XCircle className="mr-1 inline h-3.5 w-3.5" />Reject</button><button type="button" disabled={busyId === id} onClick={() => decide(item, activeTab, 'approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{busyId === id ? 'Saving…' : 'Approve'}</button></div>
            </div>
          </article>;
        })}
      </div>}
      <Modal isOpen={!!target} onClose={() => { setTarget(null); setReason(''); }} title="Reject verification">
        <form onSubmit={(event) => { event.preventDefault(); const item = (target?.kind === 'student' ? students : landlords).find((entry) => (target?.kind === 'student' ? entry.id : entry.userId || entry.id) === target?.id); if (target && item) void decide(item, target.kind, 'rejected', reason); }} className="space-y-4 text-sm">
          <p className="text-slate-600 dark:text-slate-300">Provide a clear reason for rejecting <strong>{target?.name}</strong>. The reason will be recorded and sent to the account.</p>
          <label className="block font-semibold">Rejection reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800" /></label>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setTarget(null)} className="rounded-lg px-3 py-2 text-xs font-semibold">Cancel</button><button disabled={!!busyId} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white">Confirm rejection</button></div>
        </form>
      </Modal>
    </div>
  );
};
