import React from 'react';
import { getAvatarPreset } from '../../assets/avatars';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  name?: string;
  avatarUrl?: string | null;
  avatarPresetId?: string | null;
  size?: AvatarSize;
  className?: string;
  onClick?: () => void;
  title?: string;
}

const sizeClasses: Record<AvatarSize, { container: string; text: string }> = {
  sm: { container: 'w-6 h-6 min-w-6 min-h-6', text: 'text-[10px]' },
  md: { container: 'w-9 h-9 min-w-9 min-h-9', text: 'text-xs' },
  lg: { container: 'w-12 h-12 min-w-12 min-h-12', text: 'text-sm font-bold' },
  xl: { container: 'w-20 h-20 min-w-20 min-h-20', text: 'text-xl font-black' },
};

function getInitials(name?: string): string {
  if (!name || !name.trim()) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const backgroundColors = [
  'bg-emerald-600',
  'bg-indigo-600',
  'bg-purple-600',
  'bg-amber-600',
  'bg-sky-600',
  'bg-teal-600',
  'bg-rose-600',
  'bg-blue-600',
];

function getBackgroundColor(name?: string): string {
  if (!name) return backgroundColors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % backgroundColors.length;
  return backgroundColors[index];
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatarUrl,
  avatarPresetId,
  size = 'md',
  className = '',
  onClick,
  title,
}) => {
  const { container, text } = sizeClasses[size];
  const preset = getAvatarPreset(avatarPresetId || undefined);

  // 1. Uploaded photo has highest priority if valid
  if (avatarUrl && avatarUrl.trim()) {
    return (
      <img
        src={avatarUrl}
        alt={name || 'User avatar'}
        title={title || name}
        onClick={onClick}
        className={`rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700 shrink-0 ${container} ${className} ${
          onClick ? 'cursor-pointer hover:opacity-90 transition' : ''
        }`}
      />
    );
  }

  // 2. Preset SVG
  if (preset) {
    return (
      <img
        src={preset.svg}
        alt={preset.name}
        title={title || `${preset.name} (${name || 'Avatar'})`}
        onClick={onClick}
        className={`rounded-full shrink-0 ring-1 ring-slate-200 dark:ring-slate-700 shadow-xs ${container} ${className} ${
          onClick ? 'cursor-pointer hover:opacity-90 transition' : ''
        }`}
      />
    );
  }

  // 3. Fallback: Initials on a pleasant colored circle
  const initials = getInitials(name);
  const bgColor = getBackgroundColor(name);

  return (
    <div
      onClick={onClick}
      title={title || name}
      className={`rounded-full flex items-center justify-center font-bold text-white uppercase select-none shrink-0 ring-1 ring-white/20 shadow-xs ${bgColor} ${container} ${text} ${className} ${
        onClick ? 'cursor-pointer hover:opacity-90 transition' : ''
      }`}
    >
      {initials}
    </div>
  );
};
