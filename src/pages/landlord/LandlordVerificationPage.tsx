/**
 * @file LandlordVerificationPage.tsx
 * @description Landlord KYC and property ownership credential submission interface.
 * 
 * Flow & Requirements:
 * - Collects landlord legal name, registered business entity name (optional), and national ID (NIN, Driver's License, International Passport, or Voter's Card).
 * - Collects physical proof of property ownership / authority (C of O, Deed of Assignment, Local Government Allocation, or Utility Bill).
 * - Uploads the authentic document file to private Supabase storage.
 * - Submits verification package to `verificationService.submitLandlordVerification()`.
 * - Status displays: `pending` (under review), `approved` (grants gold shield badge on listings), or `rejected`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Upload, CheckCircle2, Clock, FileText, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { verificationService } from '../../application/services/verificationService';
import { storageService } from '../../application/services/storageService';
import { VerificationBadge, Badge } from '../../components/ui/Badge';
import { validateUploadFile } from '../../application/utils/uploadValidation';
import { normalizeError } from '../../application/utils/errorUtils';
import { useAuth } from '../../application/context/AuthContext';
import { LandlordProfile, VerificationReviewStatus } from '../../domain/types';

export const LandlordVerificationPage: React.FC = () => {
  const { currentUser } = useAuth();
  const session = authService.getSession();
  const landlordId = currentUser?.id || session.user.id;
  const cachedProfile = authService.getCurrentLandlordProfile();

  const [liveProfile, setLiveProfile] = useState<LandlordProfile | null>(cachedProfile || null);
  const [submissions, setSubmissions] = useState<Array<{
    id: string;
    documentType: string;
    fileName: string;
    status: VerificationReviewStatus;
    rejectionReason?: string;
    createdAt: string;
  }>>([]);
  const [loadingState, setLoadingState] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [legalName, setLegalName] = useState(cachedProfile?.legalName || currentUser?.fullName || session.displayName);
  const [businessName, setBusinessName] = useState(cachedProfile?.businessName || '');
  const [idType, setIdType] = useState('NIN');
  const [idNumber, setIdNumber] = useState('');
  const [ownershipDocType, setOwnershipDocType] = useState('Electricity Utility Bill');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const loadVerification = useCallback(async () => {
    if (!landlordId || landlordId === 'anonymous') {
      setLoadingState(false);
      return;
    }
    setLoadingState(true);
    setLoadError(null);
    try {
      const state = await verificationService.loadLandlordVerificationState(landlordId);
      if (state.profile) {
        setLiveProfile(state.profile);
        if (state.profile.businessName) setBusinessName(state.profile.businessName);
      }
      setSubmissions(state.submissions);
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Could not load landlord verification status.');
      setLoadError(normalized.userMessage);
    } finally {
      setLoadingState(false);
    }
  }, [landlordId]);

  useEffect(() => {
    void loadVerification();
  }, [loadVerification]);

  const status = liveProfile?.verificationStatus || 'not_started';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      const check = validateUploadFile(selected, {
        maxSizeMB: 10,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.pdf'],
      });
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

    if (!legalName.trim() || !idNumber.trim()) {
      setError('Please provide your full legal name and official ID number.');
      return;
    }

    if (!file) {
      setError('Please select an authentic identification or ownership document file (JPEG, PNG, or PDF, max 10 MB).');
      return;
    }

    setSubmitting(true);

    try {
      // Direct upload through tenant-isolated Supabase storage
      const uploadRes = await storageService.uploadLandlordDocument(
        landlordId,
        file,
        fileName || file.name
      );

      if (!uploadRes || !uploadRes.path) {
        throw new Error('Failed to upload landlord verification document to secure storage.');
      }

      const res = await verificationService.submitLandlordVerification({
        landlordId,
        legalName: legalName.trim(),
        businessName: businessName.trim() || undefined,
        idType,
        idNumber: idNumber.trim(),
        idDocumentUrl: uploadRes.path,
        proofOfOwnershipUrl: uploadRes.path,
        ownershipDocType,
        fileName: uploadRes.fileName,
        fileSize: uploadRes.fileSize,
        contentType: uploadRes.contentType,
      });

      if (res && res.success) {
        setSubmitted(true);
        setFile(null);
        setFileName('');
        await loadVerification();
      } else {
        setError('Failed to submit verification request.');
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Failed to upload verification document.');
      setError(normalized.userMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Landlord Credential Verification
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Build trust with university students by verifying your legal identity and accommodation ownership
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadVerification()}
            disabled={loadingState}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingState ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <VerificationBadge type="landlord" status={status} />
        </div>
      </div>

      {loadError && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2">
          <span>{loadError}</span>
          <button type="button" onClick={() => void loadVerification()} className="font-bold underline shrink-0">Retry</button>
        </div>
      )}

      {liveProfile?.rejectionReason && status === 'rejected' && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
          <strong className="font-bold">Previous Submission Declined: </strong>
          {liveProfile.rejectionReason}. You may submit a clearer document below.
        </div>
      )}

      {status === 'approved' ? (
        <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-emerald-200 dark:border-emerald-900 shadow-sm space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Verified Landlord Partner
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Your government identity and hostel ownership records are fully authenticated. The verified host gold shield badge is visible on all your active property listings.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 text-xs">
          {submitted ? (
            <div className="text-center py-8 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Verification Documents Submitted!
              </h3>
              <p className="text-xs text-slate-500">
                Our accreditation team reviews submissions within 24 hours. You can track progress right here.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Full Legal Name (as on Government ID)
                </label>
                <input
                  type="text"
                  required
                  disabled={submitting}
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Registered Business Name (Optional)
                </label>
                <input
                  type="text"
                  disabled={submitting}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Apex Living Properties Ltd"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Identity Document Type</label>
                  <select
                    value={idType}
                    disabled={submitting}
                    onChange={(e) => setIdType(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  >
                    <option value="NIN">National Identity Number (NIN Slip)</option>
                    <option value="International Passport">International Passport</option>
                    <option value="Driver's License">Driver's License (FRSC)</option>
                    <option value="Voter's Card">Permanent Voter's Card (INEC)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">ID / Slip Number</label>
                  <input
                    type="text"
                    required
                    disabled={submitting}
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="e.g. 89201948201"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Proof of Property Ownership or Authority
                </label>
                <select
                  value={ownershipDocType}
                  disabled={submitting}
                  onChange={(e) => setOwnershipDocType(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="Electricity Utility Bill">Electricity Utility Bill (KEDCO matching address)</option>
                  <option value="Deed of Assignment">Deed of Assignment</option>
                  <option value="Certificate of Occupancy (C of O)">Certificate of Occupancy (C of O)</option>
                  <option value="Power of Attorney / Management Mandate">Power of Attorney / Management Mandate</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Upload Document Scan / Photo (JPEG, PNG, or PDF, max 10 MB)
                </label>
                <input
                  type="file"
                  required
                  disabled={submitting}
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={handleFileChange}
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                />
                {fileName && <span className="text-[11px] text-emerald-600 block">Attached: {fileName}</span>}
              </div>

              {error && (
                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !file}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading Credentials...</span>
                  </>
                ) : (
                  <span>Submit Credentials for Review</span>
                )}
              </button>
            </form>
          )}
        </div>
      )}
      {submissions.length > 0 && (
        <div className="space-y-2.5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Submission History</h2>
          {submissions.map((sub) => (
            <div key={sub.id} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white capitalize">
                  {sub.documentType.replaceAll('_', ' ')} — {sub.fileName}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Submitted {new Date(sub.createdAt).toLocaleString()}
                </div>
                {sub.rejectionReason && (
                  <p className="mt-1 text-rose-600 dark:text-rose-400">Reason: {sub.rejectionReason}</p>
                )}
              </div>
              <Badge variant={sub.status === 'approved' ? 'success' : sub.status === 'rejected' ? 'danger' : 'warning'}>
                {sub.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
