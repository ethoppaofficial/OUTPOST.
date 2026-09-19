import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCheck, RefreshCw, Clock, ShieldAlert, Sparkles, ChevronDown } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { adminService } from '../../application/services/adminService';
import { reservationService } from '../../application/services/reservationService';

interface PersonaSwitcherProps {
  currentUserId: string;
  onPersonaChange: () => void;
}

export const PersonaSwitcher: React.FC<PersonaSwitcherProps> = ({ currentUserId, onPersonaChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const personas = [
    {
      id: 'user-student-1',
      name: 'Tunde Fashanu (Student - Verified)',
      role: 'student',
      badge: 'Verified Student',
      redirect: '/student/dashboard',
    },
    {
      id: 'user-student-3',
      name: 'Ibrahim Musa (Student - Pending)',
      role: 'student',
      badge: 'Pending Student',
      redirect: '/student/dashboard',
    },
    {
      id: 'user-landlord-1',
      name: 'Chief Emeka Okafor (Landlord - Verified)',
      role: 'landlord',
      badge: 'Approved Landlord',
      redirect: '/landlord/dashboard',
    },
    {
      id: 'user-landlord-2',
      name: 'Mrs. Folake Adeleke (Landlord - Pending)',
      role: 'landlord',
      badge: 'Pending Verification',
      redirect: '/landlord/dashboard',
    },
    {
      id: 'user-admin-1',
      name: 'Dr. Olamide Vance (Platform Administrator)',
      role: 'admin',
      badge: 'Super Admin',
      redirect: '/admin/dashboard',
    },
  ];

  const current = personas.find((p) => p.id === currentUserId) || personas[0];

  const handleSelect = (p: typeof personas[0]) => {
    authService.switchPersona(p.id);
    onPersonaChange();
    setIsOpen(false);
    navigate(p.redirect);
  };

  const handleRunExpiration = () => {
    const res = reservationService.runSevenDayExpirationCheck();
    setStatusMessage(`Processed: ${res.expiredCount} expired hold(s) auto-released.`);
    setTimeout(() => setStatusMessage(null), 3500);
    onPersonaChange();
  };

  const handleResetData = () => {
    if (window.confirm('Reset all demo properties, reservations, and accounts to clean initial seed data?')) {
      adminService.resetDatabase();
      onPersonaChange();
      setStatusMessage('Demo database re-seeded successfully.');
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-xl px-2.5 py-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400"
          title="Switch role persona for demonstration"
        >
          <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden sm:inline font-semibold">{current.name.split(' ')[0]}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-mono">
            {current.role}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Switch Test Account Persona
            </p>
          </div>

          <div className="py-1 max-h-64 overflow-y-auto">
            {personas.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className={`w-full text-left px-3 py-2 flex items-center justify-between text-xs transition ${
                  p.id === currentUserId
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="truncate pr-2">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-slate-400 capitalize">{p.role}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  {p.badge}
                </span>
              </button>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 px-3 pb-1 space-y-1">
            <button
              onClick={handleRunExpiration}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Trigger 7-Day Expiration Check</span>
            </button>

            <button
              onClick={handleResetData}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset to Seed Data</span>
            </button>

            {statusMessage && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-1.5 rounded-md text-center">
                {statusMessage}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
