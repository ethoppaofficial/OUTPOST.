import React, { useEffect, useState } from 'react';
import { Save, Settings2 } from 'lucide-react';
import { adminService } from '../../application/services/adminService';
import { useAdminData } from '../../application/hooks/useAdminData';
import { AdminStatusBar } from '../../components/admin/AdminStatusBar';

type SettingsState = {
  reservationHoldDays: number;
  receiptReviewDeadlineHours: string;
  notificationsEnabled: boolean;
  maintenanceMode: boolean;
  studentVerificationRequired: boolean;
  landlordVerificationRequired: boolean;
  propertyVerificationRequired: boolean;
};

const defaults: SettingsState = {
  reservationHoldDays: 7,
  receiptReviewDeadlineHours: '',
  notificationsEnabled: true,
  maintenanceMode: false,
  studentVerificationRequired: true,
  landlordVerificationRequired: true,
  propertyVerificationRequired: true,
};

export const AdminSettingsPage: React.FC = () => {
  const {
    data: savedData,
    loading,
    refreshing,
    error: loadError,
    isLive,
    lastUpdatedAt,
    refresh,
  } = useAdminData<Record<string, unknown>>(() => adminService.getSettings());

  const [settings, setSettings] = useState<SettingsState>(defaults);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!savedData) return;
    setSettings({
      reservationHoldDays: Number(savedData.reservationHoldDays ?? defaults.reservationHoldDays),
      receiptReviewDeadlineHours:
        savedData.receiptReviewDeadlineHours == null ? '' : String(savedData.receiptReviewDeadlineHours),
      notificationsEnabled: savedData.notificationsEnabled !== false,
      maintenanceMode: savedData.maintenanceMode === true,
      studentVerificationRequired: savedData.studentVerificationRequired !== false,
      landlordVerificationRequired: savedData.landlordVerificationRequired !== false,
      propertyVerificationRequired: savedData.propertyVerificationRequired !== false,
    });
  }, [savedData]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        reservationHoldDays: settings.reservationHoldDays,
        notificationsEnabled: settings.notificationsEnabled,
        maintenanceMode: settings.maintenanceMode,
        studentVerificationRequired: settings.studentVerificationRequired,
        landlordVerificationRequired: settings.landlordVerificationRequired,
        propertyVerificationRequired: settings.propertyVerificationRequired,
      };
      if (settings.receiptReviewDeadlineHours !== '') {
        payload.receiptReviewDeadlineHours = Number(settings.receiptReviewDeadlineHours);
      }
      await adminService.saveSettings(payload);
      await refresh();
      setSuccess('Settings saved to PostgreSQL platform_settings and audited.');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof SettingsState, value: boolean) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Platform settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Changes persist to <span className="font-mono text-xs">public.platform_settings</span> and write an entry to <span className="font-mono text-xs">audit_logs</span>.
        </p>
      </header>

      <AdminStatusBar
        isLive={isLive}
        loading={loading}
        refreshing={refreshing}
        error={loadError}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={() => void refresh()}
      />

      {saveError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {saveError}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {success}
        </div>
      )}

      {loading && !savedData ? (
        <p className="text-sm text-slate-500">Loading settings…</p>
      ) : loadError ? null : (
        <form
          onSubmit={save}
          className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-7"
        >
          <div className="flex items-center gap-2 font-bold">
            <Settings2 className="h-4 w-4 text-emerald-600" /> Operational configuration
          </div>
          <label className="block text-sm font-semibold">
            Reservation hold period (days)
            <input
              type="number"
              min={1}
              max={7}
              required
              value={settings.reservationHoldDays}
              onChange={(event) =>
                setSettings((current) => ({ ...current, reservationHoldDays: Number(event.target.value) }))
              }
              className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800 sm:max-w-xs"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Stored policy value; active reservation hold creation enforces up to 7 days.
            </span>
          </label>
          <label className="block text-sm font-semibold">
            Receipt review deadline (hours)
            <input
              type="number"
              min={1}
              max={720}
              value={settings.receiptReviewDeadlineHours}
              onChange={(event) =>
                setSettings((current) => ({ ...current, receiptReviewDeadlineHours: event.target.value }))
              }
              placeholder="Not configured"
              className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800 sm:max-w-xs"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Stored inside platform_settings.settings JSONB for audit consistency.
            </span>
          </label>
          <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            {(
              [
                ['notificationsEnabled', 'Enable admin decision notifications'],
                ['maintenanceMode', 'Maintenance mode for protected Student/Landlord pages'],
                ['studentVerificationRequired', 'Require student verification'],
                ['landlordVerificationRequired', 'Require landlord verification'],
                ['propertyVerificationRequired', 'Require property verification'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-4 text-sm">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(event) => toggle(key, event.target.checked)}
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
            ))}
          </div>
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Maintenance mode and admin decision notifications are actively enforced. Verification requirement flags are stored and audited.
          </p>
          <button
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      )}
    </div>
  );
};
