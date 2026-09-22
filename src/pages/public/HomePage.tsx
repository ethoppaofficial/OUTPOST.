import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, MapPin, CheckCircle2, ArrowRight, Users, Building, ShieldAlert } from 'lucide-react';
import { propertyService } from '../../application/services/propertyService';
import { PropertyCard } from '../../components/ui/PropertyCard';

export const HomePage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCampus, setSelectedCampus] = useState('All');
  const navigate = useNavigate();

  const featured = propertyService.searchProperties({ onlyApproved: true }).slice(0, 3);

  const campuses = [
    { label: 'All Kano Locations', value: 'All' },
    { label: 'Bayero University Kano (BUK) - New Campus', value: 'Bayero University Kano (BUK)' },
    { label: 'Dambare Settlement (Gwarzo Road)', value: 'Dambare' },
    { label: 'Rimin Gata Community', value: 'Rimin Gata' },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedCampus !== 'All') {
      if (selectedCampus === 'Dambare' || selectedCampus === 'Rimin Gata') {
        params.set('neighbourhood', selectedCampus);
      } else {
        params.set('university', selectedCampus);
      }
    }
    navigate(`/properties?${params.toString()}`);
  };

  return (
    <div className="space-y-12 sm:space-y-16">
      {/* Hero Section */}
      <section className="relative rounded-3xl overflow-hidden bg-slate-900 text-white p-6 sm:p-12 md:p-16 border border-slate-800 shadow-xl">
        <div className="relative z-10 max-w-3xl space-y-6">
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Vetted student housing near Bayero University Kano.
          </h1>

          <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-2xl font-normal">
            Discover verified student lodgings in Dambare and Rimin Gata along Gwarzo Road. No agent extortion, transparent 7-day payment holds, and peer-to-peer roommate compatibility.
          </p>

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
                placeholder="Search hostel name, Dambare, Rimin Gata, or amenity..."
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
            <span>Key BUK Settlements:</span>
            <button
              onClick={() => {
                navigate('/properties?neighbourhood=Dambare');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-emerald-900/40 hover:text-emerald-400 border border-slate-700 text-slate-300 transition"
            >
              Dambare (Opposite New Campus)
            </button>
            <button
              onClick={() => {
                navigate('/properties?neighbourhood=Rimin+Gata');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-emerald-900/40 hover:text-emerald-400 border border-slate-700 text-slate-300 transition"
            >
              Rimin Gata (off Gwarzo Rd)
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
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Physical & Deed Verification</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Every property listed on OUTPOST undergoes landlord identity validation (NIN/Driver's License) and on-site facility checks.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Roommate Compatibility Scoring</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Pair with fellow verified students based on documented sleep routines, neatness habits, study hours, and shared budget ranges.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Building className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">7-Day Reservation Hold & Receipt Invoicing</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Locks your room space for 7 days while you make direct bank transfer. Upload your transfer receipt for landlord signoff.
          </p>
        </div>
      </section>

      {/* Featured Verified Hostels */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Featured Verified Accommodations
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Top reviewed student hostels within walking distance of university gates
            </p>
          </div>
          <Link
            to="/properties"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            <span>View All</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {featured.map((prop) => (
            <PropertyCard key={prop.id} property={prop} />
          ))}
        </div>
      </section>
    </div>
  );
};
