import React, { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertCircle, Sparkles, RotateCcw } from 'lucide-react';
import { Avatar } from './Avatar';
import { AVATAR_PRESETS } from '../../assets/avatars';
import { useAuth } from '../../application/context/AuthContext';
import { storageService } from '../../application/services/storageService';
import { repository } from '../../infrastructure/repositories';
import {
  PROFILE_PICTURE_UPLOAD_RULES,
  validateUploadFile,
} from '../../application/utils/uploadValidation';
import { normalizeError } from '../../application/utils/errorUtils';

interface ProfileAvatarUploaderProps {
  title?: string;
  subtitle?: string;
  onUpdated?: () => void;
}

export const ProfileAvatarUploader: React.FC<ProfileAvatarUploaderProps> = ({
  title = 'Profile Photo',
  subtitle = 'Upload JPEG, PNG, or WebP (max 2 MB) or choose a preset avatar below',
  onUpdated,
}) => {
  const { currentUser, refreshAuthProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingPresetId, setSavingPresetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!currentUser) return null;

  const isBusy = uploading || savingPresetId !== null;
  const activePresetId =
    currentUser.avatarPresetId ||
    (currentUser.avatarUrl?.startsWith('preset:')
      ? currentUser.avatarUrl.slice('preset:'.length).trim()
      : undefined);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setSuccess(null);

    const validation = validateUploadFile(file, PROFILE_PICTURE_UPLOAD_RULES);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid profile image.');
      return;
    }

    setUploading(true);
    let uploadedPath: string | null = null;

    try {
      const uploadRes = await storageService.uploadProfilePicture(file, currentUser.id);
      uploadedPath = uploadRes.path;

      await repository.updateUserAvatarPersisted(
        currentUser.id,
        uploadRes.url,
        currentUser.avatarUrl
      );

      await refreshAuthProfile();
      setSuccess('Profile photo uploaded.');
      onUpdated?.();
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      console.error('[ProfileAvatarUploader] Profile photo update failed:', rawMsg);
      if (uploadedPath) {
        await storageService.deletePublicMediaAsset('profile-pictures', uploadedPath).catch(() => {});
      }
      if (/row-level security|permission denied|bucket|policy|not found/i.test(rawMsg)) {
        setError(
          'Storage upload policy could not save the file yet. Run the latest SQL migration in Supabase Dashboard > SQL Editor, or choose one of the preset avatars below.'
        );
      } else {
        const normalized = normalizeError(err, 'Could not update profile photo.');
        setError(normalized.userMessage);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSelectPreset = async (presetId: string | null) => {
    setError(null);
    setSuccess(null);
    setSavingPresetId(presetId || 'clear');

    try {
      await repository.updateUserAvatarPresetPersisted(
        currentUser.id,
        presetId,
        currentUser.avatarUrl
      );
      await refreshAuthProfile();
      setSuccess(presetId ? 'Preset profile avatar selected.' : 'Reverted to initials avatar.');
      onUpdated?.();
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      console.error('[ProfileAvatarUploader] Preset selection failed:', rawMsg);
      const normalized = normalizeError(err, 'Could not save preset avatar.');
      setError(normalized.userMessage);
    } finally {
      setSavingPresetId(null);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar
            name={currentUser.fullName || currentUser.email}
            avatarUrl={currentUser.avatarUrl}
            avatarPresetId={activePresetId}
            size="lg"
          />
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(currentUser.avatarUrl || activePresetId) && (
            <button
              type="button"
              onClick={() => void handleSelectPreset(null)}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Use Initials</span>
            </button>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={handleFileSelected}
            disabled={isBusy}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" />
                <span>{currentUser.avatarUrl && !currentUser.avatarUrl.startsWith('preset:') ? 'Change Photo' : 'Upload Photo'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preset Avatar Selector */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
          <span>Or choose a preset avatar</span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
          {AVATAR_PRESETS.map((preset) => {
            const isSelected =
              (!currentUser.avatarUrl || currentUser.avatarUrl.startsWith('preset:')) &&
              activePresetId === preset.id;
            const isSavingThis = savingPresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={isBusy}
                onClick={() => void handleSelectPreset(preset.id)}
                title={preset.name}
                aria-label={`Choose ${preset.name} preset avatar`}
                aria-pressed={isSelected}
                className={`group flex flex-col items-center gap-1 p-2 rounded-xl border transition cursor-pointer disabled:opacity-50 ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 ring-2 ring-emerald-500/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="relative">
                  <img
                    src={preset.svg}
                    alt={preset.name}
                    className="w-10 h-10 rounded-full ring-1 ring-slate-200 dark:ring-slate-700"
                  />
                  {isSavingThis && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50 text-white">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 truncate max-w-full">
                  {preset.name.split(' ')[1] || preset.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div role="status" className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}
    </div>
  );
};
