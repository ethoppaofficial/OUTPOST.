import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bed, ArrowLeft, Plus, Minus, ShieldCheck, Clock, CheckCircle2 } from 'lucide-react';
import { propertyService } from '../../application/services/propertyService';
import { reservationService } from '../../application/services/reservationService';
import { Reservation } from '../../domain/types';

export const ManageAvailabilityPage: React.FC = () => {
  const { propertyId } = useParams<{ propertyId: string }>();
  const [property, setProperty] = useState(() => propertyService.getPropertyById(propertyId || ''));
  const [reservations, setReservations] = useState<Reservation[]>(() =>
    reservationService.getLandlordReservations(property?.landlordId || '')
      .filter((r) => r.propertyId === propertyId)
  );

  const [message, setMessage] = useState<string | null>(null);

  if (!property) {
    return <div className="text-center py-12 text-slate-500">Property not found.</div>;
  }

  const handleUpdateCapacity = (roomId: string, change: number) => {
    const updatedRooms = property.rooms.map((room) => {
      if (room.id === roomId) {
        const nextAvail = Math.max(0, room.availableSpaces + change);
        return {
          ...room,
          availableSpaces: nextAvail,
          totalCapacity: Math.max(nextAvail, room.totalCapacity + change),
        };
      }
      return room;
    });

    const newTotalAvail = updatedRooms.reduce((acc, r) => acc + r.availableSpaces, 0);
    const newTotalCap = updatedRooms.reduce((acc, r) => acc + r.totalCapacity, 0);

    const updated = propertyService.updateProperty(property.id, {
      rooms: updatedRooms,
      availableSpaces: newTotalAvail,
      totalCapacity: newTotalCap,
    });

    if (updated) {
      setProperty(updated);
      setMessage('Inventory spaces updated successfully.');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        to="/landlord/properties"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Properties</span>
      </Link>

      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Manage Room Spaces & Availability
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {property.title} • {property.neighbourhood}, {property.campus}
        </p>
      </div>

      {message && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 text-xs">
          {message}
        </div>
      )}

      {/* Rooms inventory cards */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Room Inventory Tiers</h2>
        {property.rooms.map((room) => (
          <div
            key={room.id}
            className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-emerald-600 uppercase">{room.type}</span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{room.name}</h3>
              <p className="text-xs text-slate-500">₦{room.pricePerSession.toLocaleString()} / session</p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs text-slate-400 block">Available Spaces</span>
                <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                  {room.availableSpaces} <span className="text-xs text-slate-400 font-normal">of {room.totalCapacity}</span>
                </span>
              </div>

              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                  onClick={() => handleUpdateCapacity(room.id, -1)}
                  disabled={room.availableSpaces <= 0}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40"
                  aria-label="Decrease space"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleUpdateCapacity(room.id, 1)}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                  aria-label="Increase space"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Active Holds on this property */}
      <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Student Holds & Bookings</h2>

        {reservations.length === 0 ? (
          <div className="p-6 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
            No active student holds for this property.
          </div>
        ) : (
          <div className="space-y-3">
            {reservations.map((res) => (
              <div
                key={res.id}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">{res.studentName}</div>
                  <div className="text-[11px] text-slate-400 font-mono">Hold: {res.reservationNumber} • {res.roomName}</div>
                </div>

                <div className="text-right">
                  <span className="font-semibold text-emerald-600">₦{res.amount.toLocaleString()}</span>
                  <div className="text-[10px] text-slate-400">Status: {res.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
