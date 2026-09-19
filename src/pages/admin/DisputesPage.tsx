import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, ArrowRight } from 'lucide-react';
import { reservationService } from '../../application/services/reservationService';
import { ReservationStatusBadge } from '../../components/ui/Badge';

export const DisputesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'holds' | 'receipts'>('holds');
  const reservations = reservationService.getAllReservations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Reservations & Dispute Resolution
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Monitor active 7-day holds, inspect receipt conflicts between students and hostel landlords, and arbitrate releases.
        </p>
      </div>

      <div className="space-y-4">
        {reservations.map((res) => (
          <div
            key={res.id}
            className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                  {res.reservationNumber}
                </span>
                <ReservationStatusBadge status={res.status} />
              </div>
              <div className="font-bold text-slate-900 dark:text-white text-sm">
                {res.propertyTitle} ({res.roomName})
              </div>
              <p className="text-slate-500">
                Student: <strong>{res.studentName}</strong> • Landlord: <strong>{res.landlordName}</strong> • Amount: <strong>₦{res.amount.toLocaleString()}</strong>
              </p>
              <div className="text-[11px] text-slate-400">
                Hold Deadline: {new Date(res.holdExpiresAt).toLocaleString()}
              </div>
            </div>

            <div className="text-right">
              <span className="font-mono font-bold text-emerald-600 text-sm block">
                ₦{res.amount.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-400">Escrow Hold Protected</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
