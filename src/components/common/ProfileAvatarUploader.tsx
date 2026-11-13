import React, { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Avatar } from './Avatar';
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
  subtitle = 'JPEG, PNG, or WebP (max 2 MB)',
  onUpdated,
}) => {
  const { currentUser, refreshAuthProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!currentUser) return null;

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
      setSuccess('Profile photo updated.');
      onUpdated?.();
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      if (uploadedPath) {
        await storageService.deletePublicMediaAsset('profile-pictures', uploadedPath).catch(() => {});
      }
      const normalized = normalizeError(err, 'Could not update profile photo.');
      setError(normalized.userMessage);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar
            name={currentUser.fullName || currentUser.email}
            avatarUrl={currentUser.avatarUrl}
            avatarPresetId={currentUser.avatarPresetId}
            size="lg"
          />
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={handleFileSelected}
            disabled={uploading}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
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
                <span>{currentUser.avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
              </>
            )}
          </button>
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
