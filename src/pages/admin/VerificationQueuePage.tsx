/**
 * @file VerificationQueuePage.tsx
 * @description Administrative moderation queue for BUK student credentials and landlord KYC vetting.
 *
 * Security Controls:
 * - Private Evidence: Never exposes private Storage buckets or uses `window.alert`/`window.open`.
 *   Generates short-lived (15 min) signed URLs on demand via the `get-private-asset-url` Edge Function
 *   and renders an inline signed link / preview panel with clear error/retry handling.
 * - Live Queue Sync: Uses `useAdminData` with post-review auto-refresh and manual refresh control.
 */

import React, { useState } from 'react';
import { CheckCircle2, ExternalLink, FileCheck2, Loader2, XCircle } from 'lucide-react';
import { adminService, AdminRecord } from '../../application/services/adminService';
import { storageService } from '../../application/services/storageService';
import { useAdminData } from '../../application/hooks/useAdminData';
import { AdminStatusBar } from '../../components/admin/AdminStatusBar';
import { Modal } from '../../components/ui/Modal';

type Kind = 'student' | 'landlord';
type Target = { kind: Kind; id: string; name: string };

function maskIdentifier(value: unknown): string {
  const identifier = String(value || '').trim();
  if (!identifier) return 'Not supplied';
  if (identifier.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(8, Math.max(4, identifier.length - 4)))}${identifier.slice(-4)}`;
}

type EvidencePreviewKind = 'image' | 'pdf' | null;

function getEvidencePreviewKind(item: AdminRecord): EvidencePreviewKind {
  const contentType = String(item.content_type || item.contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType) {
    if (contentType === 'application/pdf') return 'pdf';
    if (['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return 'image';
    return null;
  }

  const extension = String(item.file_name || item.fileName || '').toLowerCase().split('.').pop();
  if (extension === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension || '')) return 'image';
  return null;
}

export const VerificationQueuePage: React.FC = () => {
  const {
    data: queuesData,
    loading,
    refreshing,
    error: loadError,
    isLive,
    lastUpdatedAt,
    refresh,
  } = useAdminData<{ students: AdminRecord[]; landlords: AdminRecord[] }>(
    () => adminService.getVerificationQueues(),
    [],
    {
      realtimeTables: ['student_verification_documents', 'landlord_verification_submissions', 'landlord_profiles'],
    }
  );

  const [activeTab, setActiveTab] = useState<Kind>('student');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string | null>(null);
  const [signedEvidence, setSignedEvidence] = useState<{
    id: string;
    url: string;
    fileName?: string;
    previewKind: EvidencePreviewKind;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');

  const students = !loadError && queuesData ? queuesData.students : [];
  const landlords = !loadError && queuesData ? queuesData.landlords : [];
  const queue = activeTab === 'student' ? students : landlords;

  const handleRequestSignedEvidence = async (item: AdminRecord, kind: Kind) => {
    const recordId = kind === 'student' ? item.id : item.submissionId || item.userId || item.id;
    setOpeningEvidenceId(recordId);
    setActionError(null);
    setSignedEvidence(null);

    try {
      if (!item.storage_path && !item.documentUrl) {
        throw new Error('No uploaded evidence path is attached to this submission.');
      }
      const signedUrl = await storageService.getPrivateAssetDownloadUrl(
        kind === 'student' ? 'student-document' : 'landlord-document',
        recordId
      );
      setSignedEvidence({
        id: recordId,
        url: signedUrl,
        fileName: item.file_name || item.fileName,
        previewKind: getEvidencePreviewKind(item),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : 'Unable to retrieve signed evidence link via get-private-asset-url.';
      setActionError(msg);
    } finally {
      setOpeningEvidenceId(null);
    }
  };

  const decide = async (item: AdminRecord, kind: Kind, decision: 'approved' | 'rejected', rejectionReason = '') => {
    const id = kind === 'student' ? item.id : item.userId || item.id;
    setBusyId(id);
    setActionError(null);
    setMessage(null);
    try {
      await adminService.reviewVerification({
        kind,
        targetId: id,
        decision,
        reason: rejectionReason || undefined,
      });
      await refresh();
      setMessage(
        `${kind === 'student' ? 'Student' : 'Landlord'} verification ${decision}. Database record, user notification, and audit log updated.`
      );
      setTarget(null);
      setReason('');
      setSignedEvidence(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The verification decision could not be saved.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Credential verification</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Review live Student and Landlord submissions stored in Supabase. Private files are accessed exclusively via short-lived signed URLs from <span className="font-mono text-xs">get-private-asset-url</span>.
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

      {actionError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {actionError}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </div>
      )}

      <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800">
        {(['student', 'landlord'] as Kind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setActiveTab(kind)}
            className={`flex-1 rounded-lg py-2.5 capitalize cursor-pointer ${
              activeTab === kind ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white' : 'text-slate-500'
            }`}
          >
            {kind} submissions ({kind === 'student' ? students.length : landlords.length})
          </button>
        ))}
      </div>

      {loading && !queuesData ? (
        <p className="text-sm text-slate-500">Loading verification submissions…</p>
      ) : loadError ? null : queue.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">
          No pending {activeTab} submissions.
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => {
            const name = activeTab === 'student' ? item.fullName : item.legalName;
            const id = activeTab === 'student' ? item.id : item.submissionId || item.userId || item.id;
            const evidenceRecordId = activeTab === 'student' ? item.id : item.submissionId || item.userId || item.id;
            const activeSigned = signedEvidence?.id === evidenceRecordId ? signedEvidence : null;

            return (
              <article
                key={evidenceRecordId}
                className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="h-4 w-4 text-amber-600" />
                      <h2 className="font-bold text-slate-900 dark:text-white">
                        {name || (activeTab === 'student' ? 'Student' : 'Landlord')}
                      </h2>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {activeTab === 'student'
                        ? `${item.studentEmail || 'No email'} · ${item.registrationNumber || 'Registration number not supplied'}`
                        : `${item.email || 'No email'} · ${item.businessName || 'Individual landlord'}`}
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    Pending review
                  </span>
                </div>

                <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800/70 sm:grid-cols-2 lg:grid-cols-4">
                  {activeTab === 'student' ? (
                    <>
                      <div>
                        <span className="text-slate-500">University / campus</span>
                        <p className="mt-1 font-semibold">{[item.university, item.campus].filter(Boolean).join(' · ') || 'Not supplied'}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Programme / level</span>
                        <p className="mt-1 font-semibold">{[item.programme, item.studyLevel].filter(Boolean).join(' · ') || 'Not supplied'}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Document type</span>
                        <p className="mt-1 font-semibold">{item.documentType || 'Not supplied'}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="text-slate-500">Identity type</span>
                        <p className="mt-1 font-semibold">{item.idType || 'Not supplied'}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Reference (partially masked)</span>
                        <p className="mt-1 font-semibold">{maskIdentifier(item.idNumber)}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Ownership evidence</span>
                        <p className="mt-1 font-semibold">{item.ownershipDocType || 'Not supplied'}</p>
                      </div>
                    </>
                  )}
                  <div>
                    <span className="text-slate-500">Submitted</span>
                    <p className="mt-1 font-semibold">
                      {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : 'Date unavailable'}
                    </p>
                  </div>
                </div>

                {activeSigned && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                        Short-lived signed link ready (expires in 15 minutes): {activeSigned.fileName || 'Document'}
                      </span>
                      <a
                        href={activeSigned.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open / Download Evidence
                      </a>
                    </div>
                    {activeSigned.previewKind === 'image' ? (
                      <div className="mt-3 overflow-hidden rounded-lg border border-emerald-200 bg-white dark:border-emerald-900">
                        <img
                          src={activeSigned.url}
                          alt={activeSigned.fileName || 'Verification document'}
                          referrerPolicy="no-referrer"
                          className="mx-auto max-h-[70vh] max-w-full object-contain"
                        />
                      </div>
                    ) : activeSigned.previewKind === 'pdf' ? (
                      <iframe
                        src={activeSigned.url}
                        title={activeSigned.fileName || 'Verification document preview'}
                        referrerPolicy="no-referrer"
                        className="mt-3 h-[70vh] min-h-96 max-h-[48rem] w-full rounded-lg border border-emerald-200 bg-white dark:border-emerald-900"
                      />
                    ) : (
                      <p className="mt-3 text-emerald-800 dark:text-emerald-300">
                        Inline preview is unavailable for this file type. Use the signed link to view or download it.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={openingEvidenceId === evidenceRecordId || !item.hasUploadedEvidence}
                    onClick={() => void handleRequestSignedEvidence(item, activeTab)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 dark:text-emerald-400 cursor-pointer"
                  >
                    {openingEvidenceId === evidenceRecordId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {item.hasUploadedEvidence
                        ? 'Generate signed evidence link (15m)'
                        : 'No document path recorded'}
                    </span>
                  </button>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === id}
                      onClick={() => setTarget({ kind: activeTab, id, name: String(name || activeTab) })}
                      className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 cursor-pointer"
                    >
                      <XCircle className="mr-1 inline h-3.5 w-3.5" />
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busyId === id}
                      onClick={() => void decide(item, activeTab, 'approved')}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                      {busyId === id ? 'Saving…' : 'Approve'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={!!target}
        onClose={() => {
          setTarget(null);
          setReason('');
        }}
        title="Reject verification"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const item = (target?.kind === 'student' ? students : landlords).find(
              (entry) => (target?.kind === 'student' ? entry.id : entry.userId || entry.id) === target?.id
            );
            if (target && item) void decide(item, target.kind, 'rejected', reason);
          }}
          className="space-y-4 text-sm"
        >
          <p className="text-slate-600 dark:text-slate-300">
            Provide a clear reason for rejecting <strong>{target?.name}</strong>. The reason will be recorded and sent to the account.
          </p>
          <label className="block font-semibold">
            Rejection reason
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTarget(null)} className="rounded-lg px-3 py-2 text-xs font-semibold">
              Cancel
            </button>
            <button disabled={!!busyId} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white">
              Confirm rejection
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
