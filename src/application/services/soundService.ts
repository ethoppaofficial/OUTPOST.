/**
 * @file soundService.ts
 * @module application/services/soundService
 * @description Synthesizes crisp, zero-dependency Web Audio API notification tones and landlord
 * payment/reservation reminder chimes, handling browser autoplay unlock automatically.
 */

import type { AppNotification } from '../../domain/types';

const SOUND_PREF_KEY = 'outpost_notification_sound_enabled';

class SoundService {
  private audioCtx: AudioContext | null = null;
  private unlockBound = false;
  private recentAlertTimestamps = new Map<string, number>();

  constructor() {
    if (typeof window !== 'undefined') {
      this.bindUserInteractionUnlock();
    }
  }

  public isSoundEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const saved = window.localStorage.getItem(SOUND_PREF_KEY);
      return saved === null ? true : saved !== 'false';
    } catch {
      return true;
    }
  }

  public setSoundEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore storage failures
    }
    if (enabled) {
      void this.unlockAudioContext();
    }
  }

  private getAudioContextConstructor(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null;
    return (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
      null
    );
  }

  private getOrCreateContext(): AudioContext | null {
    const AudioCtx = this.getAudioContextConstructor();
    if (!AudioCtx) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioCtx();
    }
    return this.audioCtx;
  }

  private bindUserInteractionUnlock(): void {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;

    const unlock = () => {
      void this.unlockAudioContext();
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  public async unlockAudioContext(): Promise<boolean> {
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      return ctx.state === 'running';
    } catch {
      return false;
    }
  }

  public isPaymentOrReservationNotification(notif?: Partial<AppNotification> | null): boolean {
    if (!notif) return false;
    const haystack = [
      notif.type,
      notif.title,
      notif.message,
      notif.link,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return /(payment|receipt|reservation|hold|invoice|booking|transfer)/.test(haystack);
  }

  private canEmitWithDedup(dedupKey?: string, cooldownMs = 2500): boolean {
    if (!dedupKey) return true;
    const now = Date.now();
    const last = this.recentAlertTimestamps.get(dedupKey) || 0;
    if (now - last < cooldownMs) {
      return false;
    }
    this.recentAlertTimestamps.set(dedupKey, now);
    if (this.recentAlertTimestamps.size > 100) {
      const oldestKey = this.recentAlertTimestamps.keys().next().value;
      if (oldestKey) this.recentAlertTimestamps.delete(oldestKey);
    }
    return true;
  }

  private playSequence(
    notes: Array<{
      frequency: number;
      startOffsetSec: number;
      durationSec: number;
      peakGain: number;
      type?: OscillatorType;
    }>
  ): boolean {
    if (!this.isSoundEnabled()) return false;
    try {
      const ctx = this.getOrCreateContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      if (ctx.state === 'suspended') {
        return false;
      }

      const baseTime = ctx.currentTime + 0.015;
      for (const note of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startAt = baseTime + note.startOffsetSec;
        const stopAt = startAt + note.durationSec;

        osc.type = note.type || 'sine';
        osc.frequency.setValueAtTime(note.frequency, startAt);

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.01, note.peakGain), startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(stopAt + 0.01);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Standard crisp two-note chime for incoming notifications.
   */
  public playNotificationTone(dedupKey?: string): boolean {
    if (!this.isSoundEnabled()) return false;
    if (!this.canEmitWithDedup(dedupKey)) return false;

    return this.playSequence([
      { frequency: 783.99, startOffsetSec: 0, durationSec: 0.14, peakGain: 0.14, type: 'sine' },
      { frequency: 987.77, startOffsetSec: 0.12, durationSec: 0.22, peakGain: 0.16, type: 'sine' },
    ]);
  }

  /**
   * Distinct warm double-chime reminder tone for landlord payment receipts & reservations.
   */
  public playLandlordReminderTone(dedupKey?: string): boolean {
    if (!this.isSoundEnabled()) return false;
    if (!this.canEmitWithDedup(dedupKey)) return false;

    return this.playSequence([
      { frequency: 523.25, startOffsetSec: 0, durationSec: 0.14, peakGain: 0.16, type: 'triangle' },
      { frequency: 659.25, startOffsetSec: 0.11, durationSec: 0.15, peakGain: 0.18, type: 'triangle' },
      { frequency: 783.99, startOffsetSec: 0.22, durationSec: 0.24, peakGain: 0.2, type: 'sine' },
      { frequency: 1046.5, startOffsetSec: 0.44, durationSec: 0.28, peakGain: 0.18, type: 'sine' },
    ]);
  }
}

export const soundService = new SoundService();
