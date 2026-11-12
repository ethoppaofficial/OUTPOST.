/**
 * @file StudentVerificationPage.tsx
 * @description Academic credential verification page for Bayero University Kano (BUK) students.
 * 
 * Provides an interface for students to upload academic credentials (BUK Student ID card,
 * Official Admission Letter, or current Semester Course Registration Form) to verify their
 * student status before renting or joining verified roommate groups.
 * 
 * Security & Validation:
 * - Client-side validation: MIME type check (JPEG, PNG, PDF) and max size limit (5MB).
 * - Documents are stored in isolated private storage paths (`student-documents/{userId}/*`).
 * - Uploaded documents enter a `pending` state awaiting administrator review in VerificationQueuePage.
 * - Prevents arbitrary file uploads and displays verification badge according to approval status.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Upload, FileText, CheckCircle2, Clock, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { verificationService } from '../../application/services/verificationService';
import { storageService } from '../../application/services/storageService';
import { StudentDocumentType, StudentVerificationDocument } from '../../domain/types';
import { VerificationBadge, Badge } from '../../components/ui/Badge';
import { validateUploadFile, STUDENT_DOCUMENT_UPLOAD_RULES } from '../../application/utils/uploadValidation';
import { normalizeError } from '../../application/utils/errorUtils';
import { useAuth } from '../../application/context/AuthContext';

import { supabase } from '../../infrastructure/supabase/supabaseClient';

export const StudentVerificationPage: React.FC = () => {
  const { currentUser, loading: authLoading } = useAuth();
  const studentId = currentUser?.id;
  const studentName = currentUser?.fullName || currentUser?.name || currentUser?.email || 'Student';
  const cachedStudent = authService.getCurrentStudentProfile();

  const [documents, setDocuments] = useState<StudentVerificationDocument[]>(() =>
    studentId ? verificationService.getStudentDocuments(studentId) : []
  );
  const [liveVerified, setLiveVerified] = useState<boolean>(Boolean(cachedStudent?.isProfileVerified));
  const [liveRegNumber, setLiveRegNumber] = useState<string>(cachedStudent?.registrationNumber || '');
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<StudentDocumentType>('student_id');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refreshDocuments = useCallback(async () => {
    if (authLoading) return;
    if (!studentId || studentId === 'anonymous') {
      setLoadingDocs(false);
      return;
    }
    setLoadingDocs(true);
    setLoadError(null);
    try {
      const [liveDocs, { data: spRow }, { data: profRow }] = await Promise.all([
        verificationService.loadStudentDocuments(studentId),
        supabase.from('student_profiles').select('is_profile_verified, registration_number').eq('user_id', studentId).maybeSingle(),
        supabase.from('profiles').select('is_verified').eq('id', studentId).maybeSingle(),
      ]);
      setDocuments(liveDocs);
      if (spRow || profRow) {
        setLiveVerified(Boolean(spRow?.is_profile_verified || profRow?.is_verified));
      }
      if (spRow?.registration_number) {
        setLiveRegNumber(spRow.registration_number);
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Could not load uploaded verification documents.');
      setLoadError(normalized.userMessage);
    } finally {
      setLoadingDocs(false);
    }
  }, [authLoading, studentId]);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      const check = validateUploadFile(selected, STUDENT_DOCUMENT_UPLOAD_RULES);
      if (!check.isValid) {
        setError(check.error!);
        setFile(null);
        setFileName('');
        return;
      }
      setFile(selected);
      setFileName(check.sanitizedFileName || selected.name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!studentId || studentId === 'anonymous') {
      setError('Your authenticated student session is missing. Please sign in again.');
      return;
    }

    const check = validateUploadFile(file, STUDENT_DOCUMENT_UPLOAD_RULES);
    if (!check.isValid || !file) {
      setError(check.error || 'Please select an authentic document file (JPEG, PNG, WebP, or PDF, max 5 MB).');
      return;
    }

    setSubmitting(true);

    try {
      const uploadRes = await storageService.uploadStudentDocument(
        studentId,
        file,
        check.sanitizedFileName || fileName || file.name,
        documentType
      );

      if (!uploadRes || !uploadRes.path) {
        throw new Error('Could not upload document to secure storage.');
      }

      const res = await verificationService.uploadStudentDocument({
        studentId,
        studentName: cachedStudent?.fullName || studentName,
        documentType,
        fileName: uploadRes.fileName,
        fileSize: uploadRes.fileSize,
        fileUrl: uploadRes.path,
        documentUrl: uploadRes.path,
        contentType: uploadRes.contentType,
      });

      if (res.success && res.doc) {
        setSuccessMsg('Document successfully uploaded and recorded for administrator review.');
        await refreshDocuments();
        setFile(null);
        setFileName('');
        setTimeout(() => setSuccessMsg(null), 5000);
      } else {
        setError(res.error || 'Failed to record uploaded document metadata.');
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Error uploading document to storage.');
      setError(normalized.userMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const isProfileVerified = liveVerified;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Student Identity Verification
          </h1>
          <VerificationBadge type="student" status={isProfileVerified} />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Upload authentic proof of active university enrolment to obtain your verified student badge.
        </p>
      </div>

      {/* Overview status box */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Verification Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
            <span className="text-slate-400 block text-[11px]">Enrolled Student:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{cachedStudent?.fullName || studentName}</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
            <span className="text-slate-400 block text-[11px]">Registration No:</span>
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{liveRegNumber || 'Not supplied'}</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
            <span className="text-slate-400 block text-[11px]">Badge Status:</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {isProfileVerified ? 'Verified & Trusted' : 'Action Required'}
            </span>
          </div>
        </div>
      </div>

      {/* Upload Form */}
      <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-emerald-600" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Upload Verification Document
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Document Type</label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as StudentDocumentType)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
            >
              <option value="student_id">University Student Identity Card</option>
              <option value="admission_letter">Official University Admission Letter</option>
              <option value="school_fees_receipt">Current Session School Fees Receipt</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Document File (PDF, PNG, JPG - max 5MB)
            </label>
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-6 text-center hover:border-emerald-500 transition cursor-pointer relative bg-slate-50/50 dark:bg-slate-800/50">
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {fileName ? fileName : 'Click to browse or drag and drop document'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Ensure text, matric number, and your passport photograph are legible.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 text-xs">
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-md disabled:opacity-50"
          >
            {submitting ? 'Submitting Document...' : 'Submit Document for Review'}
          </button>
        </form>
      </div>

      {/* Submitted Documents Log */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Document History & Review Log</h3>
          <button
            type="button"
            onClick={() => void refreshDocuments()}
            disabled={loadingDocs}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingDocs ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {loadError && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-2">
            <span>{loadError}</span>
            <button type="button" onClick={() => void refreshDocuments()} className="font-bold underline shrink-0">Retry</button>
          </div>
        )}

        {loadingDocs ? (
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span>Loading verification documents…</span>
          </div>
        ) : documents.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
            No verification documents submitted yet.
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white capitalize">
                      {doc.documentType.replace('_', ' ')}
                    </span>
                  </div>

                  <div>
                    {doc.status === 'approved' && (
                      <Badge variant="success" icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
                        Approved
                      </Badge>
                    )}
                    {doc.status === 'pending' && (
                      <Badge variant="warning" icon={<Clock className="w-3.5 h-3.5" />}>
                        Review Pending
                      </Badge>
                    )}
                    {doc.status === 'rejected' && (
                      <Badge variant="danger" icon={<XCircle className="w-3.5 h-3.5" />}>
                        Rejected
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>File: {doc.fileName}</span>
                  <span>Uploaded: {new Date(doc.uploadedAt).toLocaleDateString()}</span>
                </div>

                {doc.status === 'rejected' && doc.rejectionReason && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40 text-[11px] text-rose-700 dark:text-rose-300">
                    <span className="font-bold">Rejection Reason: </span>
                    {doc.rejectionReason}. Please re-upload a higher resolution copy.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
