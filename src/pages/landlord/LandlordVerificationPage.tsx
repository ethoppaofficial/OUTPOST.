import React, { useState } from 'react';
import { ShieldCheck, Upload, CheckCircle2, Clock, FileText, AlertCircle } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { verificationService } from '../../application/services/verificationService';
import { VerificationBadge } from '../../components/ui/Badge';

export const LandlordVerificationPage: React.FC = () => {
  const session = authService.getSession();
  const profile = authService.getCurrentLandlordProfile();

  const [legalName, setLegalName] = useState(profile?.legalName || session.displayName);
  const [businessName, setBusinessName] = useState(profile?.businessName || '');
  const [idType, setIdType] = useState('NIN');
  const [idNumber, setIdNumber] = useState('');
  const [ownershipDocType, setOwnershipDocType] = useState('Electricity Utility Bill');
  const [submitted, setSubmitted] = useState(false);

  const status = profile?.verificationStatus || 'pending';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    verificationService.submitLandlordVerification({
      landlordId: session.user.id,
      legalName: legalName.trim(),
      businessName: businessName.trim() || undefined,
      idType,
      idNumber: idNumber.trim() || 'NIN-8291048291',
      idDocumentUrl: 'https://outpost-storage.ng/docs/landlord_nin.pdf',
      proofOfOwnershipUrl: 'https://outpost-storage.ng/docs/property_deed.pdf',
      ownershipDocType,
    });

    setSubmitted(true);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Landlord Credential Verification
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Build trust with university students by verifying your legal identity and accommodation ownership
          </p>
        </div>

        <VerificationBadge type="landlord" status={status} />
      </div>

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
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Registered Business Name (Optional)
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Apex Living Properties Ltd"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Identity Document Type</label>
                  <select
                    value={idType}
                    onChange={(e) => setIdType(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
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
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="e.g. 89201948201"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Proof of Property Ownership or Authority
                </label>
                <select
                  value={ownershipDocType}
                  onChange={(e) => setOwnershipDocType(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Electricity Utility Bill">Electricity Utility Bill (EKEDC / IBEDC matching address)</option>
                  <option value="Deed of Assignment">Deed of Assignment</option>
                  <option value="Certificate of Occupancy (C of O)">Certificate of Occupancy (C of O)</option>
                  <option value="Power of Attorney / Management Mandate">Power of Attorney / Management Mandate</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Upload Document Scan / Photo
                </label>
                <input
                  type="file"
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md transition"
              >
                Submit Credentials for Review
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
