import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, ArrowRight, Users, Building, AlertCircle, Loader2, Upload } from 'lucide-react';
import { useAuth } from '../../application/context/AuthContext';

export const HomePage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCampus, setSelectedCampus] = useState('All');
  const navigate = useNavigate();
  const { currentUser, loading, profileStatus, profileError, landlordProfile, signOut, refreshAuthProfile } = useAuth();

  const campuses = [
    { label: 'Off-campus', value: 'All' },
    { label: 'Dambare', value: 'Dambare' },
    { label: 'Rimin Gata', value: 'Rimin Gata' },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedCampus !== 'All') params.set('neighbourhood', selectedCampus);
    navigate(`/properties?${params.toString()}`);
  };

  const renderAuthBanner = () => {
    if (loading || profileStatus === 'profile_pending') {
      return (
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 px-3.5 py-2 text-xs text-slate-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
          <span>{profileStatus === 'profile_pending' ? 'Finalizing your OUTPOST account profile…' : 'Checking active session…'}</span>
        </div>
      );
    }

    if (profileStatus === 'profile_error') {
      return (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/50 p-4 text-xs text-rose-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <span>{profileError || 'We could not load your OUTPOST account profile.'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshAuthProfile()}
              className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-500"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-rose-400/50 px-3 py-1.5 font-semibold text-rose-200 hover:bg-rose-900/50"
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }

    if (currentUser?.role === 'student') {
      return (
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/student/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition"
          >
            Open Student Dashboard <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/student/verification"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500 transition"
          >
            <Upload className="h-3.5 w-3.5 text-emerald-400" />
            Matric Verification
          </Link>
          <Link
            to="/student/reservations"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500 transition"
          >
            My Reservations
          </Link>
        </div>
      );
    }

    if (currentUser?.role === 'landlord') {
      const verifStatus = landlordProfile?.verificationStatus || 'not_started';
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/landlord/dashboard"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition"
            >
              Open Landlord Hub <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/landlord/properties/new"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500 transition"
            >
              Post Property Listing
            </Link>
            <Link
              to="/landlord/verification"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-amber-400 transition"
            >
              Verification: <span className="capitalize">{verifStatus.replace('_', ' ')}</span>
            </Link>
          </div>
        </div>
      );
    }

    if (currentUser?.role === 'admin') {
      return (
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/admin/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition"
          >
            Open Admin Console <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/admin/verifications"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-purple-400 transition"
          >
            Verification Queue
          </Link>
          <Link
            to="/admin/properties"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-purple-400 transition"
          >
            Property Approvals
          </Link>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          to="/register"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition"
        >
          Create Student or Landlord Account <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 transition"
        >
          Sign in
        </Link>
      </div>
    );
  };

  return (
    <div className="space-y-12 sm:space-y-16">
      {/* Hero Section */}
      <section className="relative rounded-3xl overflow-hidden bg-slate-900 text-white p-6 sm:p-12 md:p-16 border border-slate-800 shadow-xl">
        <div className="relative z-10 max-w-3xl space-y-6">
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Find off-campus accommodation in Dambare and Rimin Gata.
          </h1>

          <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-2xl font-normal">
            {currentUser
              ? `Signed in as ${currentUser.fullName || currentUser.email} (${currentUser.role}). Explore verified listings, manage your reviews, or track activity around Bayero University Kano.`
              : 'Explore verified housing options, learn about the listing review process, and manage your off-campus search around Bayero University Kano.'}
          </p>

          {renderAuthBanner()}

          {/* Search Box */}
          <form
            onSubmit={handleSearch}
            className="p-2 sm:p-2.5 rounded-2xl bg-white dark:bg-slate-900/90 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-2 max-w-2xl"
          >
            <div className="flex-1 flex items-center gap-2 px-3 py-2 text-slate-800 dark:text-slate-200">
              <Search className="w-5 h-5 text-slate-400 flex-shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search accommodation, area, or amenity..."
                className="w-full bg-transparent text-sm focus:outline-none placeholder:text-slate-400 text-slate-900 dark:text-white"
              />
            </div>

            <select
              value={selectedCampus}
              onChange={(e) => setSelectedCampus(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-700 focus:outline-none"
            >
              {campuses.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition shadow-md whitespace-nowrap flex items-center justify-center gap-2"
            >
              Search Housing
            </button>
          </form>

          {/* Quick neighbourhood links */}
          <div className="pt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Explore:</span>
            <button
              onClick={() => {
                navigate('/properties?neighbourhood=Dambare');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-emerald-900/40 hover:text-emerald-400 border border-slate-700 text-slate-300 transition"
            >
              Dambare
            </button>
            <button
              onClick={() => {
                navigate('/properties?neighbourhood=Rimin+Gata');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-emerald-900/40 hover:text-emerald-400 border border-slate-700 text-slate-300 transition"
            >
              Rimin Gata
            </button>
          </div>


        </div>
      </section>

      {/* Trust Pillars */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Clear review status</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            OUTPOST is designed to distinguish listings that are awaiting review from those approved for student discovery.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Roommate discovery</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Students can record preferences and explore compatibility suggestions when signed in.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Building className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Reservation workflow</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Authenticated students can manage reservation requests and related status information.
          </p>
        </div>
      </section>


    </div>
  );
};
