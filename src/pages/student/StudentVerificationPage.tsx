import React, { useState } from 'react';
import { ShieldCheck, Upload, FileText, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { verificationService } from '../../application/services/verificationService';
import { storageService } from '../../infrastructure/firebase/storageService';
import { StudentDocumentType } from '../../domain/types';
import { VerificationBadge, Badge } from '../../components/ui/Badge';

export const StudentVerificationPage: React.FC = () => {
  const session = authService.getSession();
  const student = authService.getCurrentStudentProfile();
  const [documents, setDocuments] = useState(() => verificationService.getStudentDocuments(session.user.id));

  const [documentType, setDocumentType] = useState<StudentDocumentType>('student_id');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      // Check size < 5MB
      if (selected.size > 5 * 1024 * 1024) {
        setError('File size must be strictly under 5 MB.');
        return;
      }
      // Check type
      const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
      if (!allowed.includes(selected.type)) {
        setError('Only JPEG, PNG, or PDF files are accepted for identity proof.');
        return;
      }
      setFile(selected);
      setFileName(selected.name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file && !fileName) {
      setError('Please select a document file to upload.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let documentUrl = `https://outpost-storage.ng/docs/student_${session.user.id}_${Date.now()}.pdf`;
      let finalSize = file?.size || 1024 * 350;

      if (file) {
        const uploadRes = await storageService.uploadStudentDocument(session.user.id, file, fileName || file.name);
        documentUrl = uploadRes.url;
        finalSize = uploadRes.fileSize;
      }

      const res = await verificationService.uploadStudentDocument({
        studentId: session.user.id,
        studentName: student?.fullName || session.displayName || 'Student',
        documentType,
        fileName: fileName || `${documentType}_proof.pdf`,
        fileSize: finalSize,
        fileUrl: documentUrl,
        documentUrl,
      });

      if (res.success && res.doc) {
        setSuccessMsg('Document successfully uploaded for administrator review.');
        setDocuments(verificationService.getStudentDocuments(session.user.id));
        setFile(null);
        setFileName('');
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setError(res.error || 'Failed to upload document.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error uploading document to storage.');
    } finally {
      setSubmitting(false);
    }
  };

  const isProfileVerified = student?.isProfileVerified;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Student Identity Verification
          </h1>
          <VerificationBadge type="student" status={!!isProfileVerified} />
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
            <span className="font-semibold text-slate-800 dark:text-slate-200">{student?.fullName}</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
            <span className="text-slate-400 block text-[11px]">Registration No:</span>
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{student?.registrationNumber}</span>
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
                accept=".pdf,.png,.jpg,.jpeg"
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
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Document History & Review Log</h3>

        {documents.length === 0 ? (
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
