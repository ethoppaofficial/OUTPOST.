import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, CheckCircle2, XCircle, Clock, MessageSquare, ArrowLeft } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { roommateService } from '../../application/services/roommateService';
import { VerificationBadge, Badge } from '../../components/ui/Badge';

export const RoommateRequestsPage: React.FC = () => {
  const session = authService.getSession();
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');
  const [refreshKey, setRefreshKey] = useState(0);

  const received = roommateService.getReceivedRequests(session.user.id);
  const sent = roommateService.getSentRequests(session.user.id);

  const handleAccept = (requestId: string) => {
    roommateService.acceptRoommateRequest(requestId);
    setRefreshKey((k) => k + 1);
  };

  const handleDecline = (requestId: string) => {
    roommateService.declineRoommateRequest(requestId);
    setRefreshKey((k) => k + 1);
  };

  const handleCancel = (requestId: string) => {
    roommateService.cancelRoommateRequest(requestId);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Roommate Requests
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Review invitations from students who want to team up for accommodations
          </p>
        </div>

        <Link
          to="/student/roommates"
          className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Browse Matching Roommates</span>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('received')}
          className={`flex-1 py-2 rounded-lg transition ${
            activeTab === 'received'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500'
          }`}
        >
          Received Requests ({received.length})
        </button>
        <button
          onClick={() => setActiveTab('sent')}
          className={`flex-1 py-2 rounded-lg transition ${
            activeTab === 'sent'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500'
          }`}
        >
          Sent Invitations ({sent.length})
        </button>
      </div>

      {/* List Content */}
      <div className="space-y-4">
        {activeTab === 'received' ? (
          received.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
              No received roommate requests currently.
            </div>
          ) : (
            received.map((req) => (
              <div
                key={req.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {req.senderName}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Sent {new Date(req.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <Badge
                    variant={req.status === 'accepted' ? 'success' : req.status === 'rejected' ? 'danger' : 'warning'}
                  >
                    {req.status.toUpperCase()}
                  </Badge>
                </div>

                {(req.note || req.message) && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl">
                    "{req.note || req.message}"
                  </p>
                )}

                {req.status === 'pending' && (
                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => handleDecline(req.id)}
                      className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-50"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => handleAccept(req.id)}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs"
                    >
                      Accept Roommate
                    </button>
                  </div>
                )}
              </div>
            ))
          )
        ) : sent.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
            You haven't sent any roommate invitations yet.
          </div>
        ) : (
          sent.map((req) => (
            <div
              key={req.id}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {req.receiverName || 'Student Roommate'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Invited {new Date(req.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <Badge
                  variant={req.status === 'accepted' ? 'success' : req.status === 'rejected' ? 'danger' : 'warning'}
                >
                  {req.status.toUpperCase()}
                </Badge>
              </div>

              {req.status === 'pending' && (
                <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => handleCancel(req.id)}
                    className="px-3 py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-medium"
                  >
                    Cancel Invitation
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
