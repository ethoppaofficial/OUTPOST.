import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, UserCheck } from 'lucide-react';
import { useFirebase } from '../../application/context/FirebaseContext';

interface PersonaSwitcherProps {
  currentUserId: string;
  onPersonaChange: () => void;
}

export const PersonaSwitcher: React.FC<PersonaSwitcherProps> = ({ currentUserId, onPersonaChange }) => {
  const { currentUser } = useFirebase();
  const navigate = useNavigate();
  if (!currentUser) return null;
  const dashboard = currentUser.role === 'admin' ? '/admin/dashboard' : currentUser.role === 'landlord' ? '/landlord/dashboard' : '/student/dashboard';
  const title = currentUser.role === 'admin' ? 'Administrator workspace' : currentUser.role === 'landlord' ? 'Landlord workspace' : 'Student workspace';
  return (
    <button
      type="button"
      onClick={() => { onPersonaChange(); navigate(dashboard); }}
      title={`${title} · ${currentUserId}`}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-emerald-300"
    >
      <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
      <span className="capitalize">{currentUser.role} account</span>
      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
    </button>
  );
};
