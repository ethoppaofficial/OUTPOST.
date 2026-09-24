import React, { useState } from 'react';
import { Search, ShieldCheck, UserCheck, Lock, AlertCircle, MessageSquare } from 'lucide-react';
import { verificationService } from '../../application/services/verificationService';
import { VerificationBadge, Badge } from '../../components/ui/Badge';

export const UserSearchPage: React.FC = () => {
  const [regNumber, setRegNumber] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regNumber.trim()) return;
    const found = verificationService.searchStudentByRegNumber(regNumber.trim());
    setResult(found);
    setSearched(true);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Student Registration Number Lookup
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Verify peer matriculation credentials safely. For privacy protection, private contact numbers and personal emails are never disclosed.
        </p>
      </div>

      {/* Search Bar */}
      <form
        onSubmit={handleSearch}
        className="p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row gap-2"
      >
        <div className="flex-1 flex items-center gap-2 px-3 text-slate-800 dark:text-slate-200">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={regNumber}
            onChange={(e) => setRegNumber(e.target.value)}
            placeholder="Enter institutional matric / reg number (e.g. BUK/23/ENG/01492)..."
            className="w-full bg-transparent text-xs font-mono focus:outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
          />
        </div>

        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs whitespace-nowrap"
        >
          Verify Student
        </button>
      </form>

      {/* Case Study Quick Test Chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-600 dark:text-slate-400">Quick Test Records:</span>
        <button
          type="button"
          onClick={() => {
            setRegNumber('BUK/23/ENG/01492');
            const found = verificationService.searchStudentByRegNumber('BUK/23/ENG/01492');
            setResult(found);
            setSearched(true);
          }}
          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-300 font-mono text-[11px] border border-slate-200 dark:border-slate-700 transition"
        >
          BUK/23/ENG/01492 (Aliyu)
        </button>
        <button
          type="button"
          onClick={() => {
            setRegNumber('BUK/22/CHS/00812');
            const found = verificationService.searchStudentByRegNumber('BUK/22/CHS/00812');
            setResult(found);
            setSearched(true);
          }}
          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-300 font-mono text-[11px] border border-slate-200 dark:border-slate-700 transition"
        >
          BUK/22/CHS/00812 (Fatima)
        </button>
        <button
          type="button"
          onClick={() => {
            setRegNumber('BUK/24/FCS/02105');
            const found = verificationService.searchStudentByRegNumber('BUK/24/FCS/02105');
            setResult(found);
            setSearched(true);
          }}
          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-300 font-mono text-[11px] border border-slate-200 dark:border-slate-700 transition"
        >
          BUK/24/FCS/02105 (Ibrahim)
        </button>
      </div>

      {/* Privacy Notice */}
      <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 text-[11px] text-blue-800 dark:text-blue-300 flex items-start gap-2.5">
        <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
        <span>
          <strong>Data Privacy Protocol:</strong> In compliance with Nigerian student data protection guidelines, OUTPOST only returns validated enrolment status, programme, level, and verification badge. Direct phone and email remain private.
        </span>
      </div>

      {/* Result Card */}
      {searched && (
        <div className="space-y-4">
          {result ? (
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-md space-y-4 animate-in fade-in duration-150">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-base text-slate-700 dark:text-slate-200">
                    {result.fullName[0]}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {result.fullName}
                    </h3>
                    <div className="text-xs text-slate-400 font-mono">
                      {result.registrationNumber}
                    </div>
                  </div>
                </div>

                <VerificationBadge type="student" status={result.isProfileVerified} />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div>
                  <span className="text-slate-400 text-[11px] block">University</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{result.university}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] block">Campus</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{result.campus}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] block">Programme</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{result.programme}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] block">Study Level</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{result.studyLevel}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400 space-y-1">
              <AlertCircle className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="font-medium text-slate-600 dark:text-slate-300">
                No verified student found with registration number "{regNumber}"
              </p>
              <p className="text-[11px]">
                Please ensure you entered the exact matriculation format (e.g. BUK/22/SCI/01842).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
