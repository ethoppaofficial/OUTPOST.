import owlSvg from './owl.svg';
import foxSvg from './fox.svg';
import bookSvg from './book.svg';
import gradcapSvg from './gradcap.svg';
import houseSvg from './house.svg';
import planetSvg from './planet.svg';
import leafSvg from './leaf.svg';
import lightningSvg from './lightning.svg';

export interface AvatarPreset {
  id: string;
  name: string;
  svg: string;
  bgColor: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'owl', name: 'Wise Owl', svg: owlSvg, bgColor: '#6366f1' },
  { id: 'fox', name: 'Curious Fox', svg: foxSvg, bgColor: '#f97316' },
  { id: 'book', name: 'Scholar Book', svg: bookSvg, bgColor: '#0284c7' },
  { id: 'gradcap', name: 'Graduate Cap', svg: gradcapSvg, bgColor: '#10b981' },
  { id: 'house', name: 'Campus Hostel', svg: houseSvg, bgColor: '#0d9488' },
  { id: 'planet', name: 'Cosmic Planet', svg: planetSvg, bgColor: '#8b5cf6' },
  { id: 'leaf', name: 'Green Haven', svg: leafSvg, bgColor: '#15803d' },
  { id: 'lightning', name: 'Energy Spark', svg: lightningSvg, bgColor: '#eab308' },
];

export function getAvatarPreset(presetId?: string): AvatarPreset | undefined {
  if (!presetId) return undefined;
  return AVATAR_PRESETS.find((p) => p.id === presetId);
}
