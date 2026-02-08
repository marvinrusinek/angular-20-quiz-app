import { Injectable } from '@angular/core';
import { Howl, Howler } from 'howler';

import { SelectedOption } from '../../models/SelectedOption.model';

@Injectable({ providedIn: 'root' })
export class SoundService {
  private sounds: Record<string, Howl> = {};
  private playedMap = new Map<number, Set<number>>();

  // Track which (questionIndex, optionId) pairs played sound
  private playedSoundOptions: Set<string> = new Set();

  constructor() {
    this.ensureSoundsReady();
  }

  initializeSounds(): void {
    const commonConfig = {
      html5: false, // Use Web Audio API (low latency) - works great with jsDelivr
      format: ['mp3'],
      preload: true,
      onload: () => console.log('[SoundService] ✅ Sound loaded successfully'),
      onloaderror: (_id: number, err: any) => console.error('[SoundService] ❌ Load Error:', err),
      onplay: (_id: number) => console.log('[SoundService] ▶️ Sound playing (id:', _id, ')'),
      onplayerror: (_id: number, err: any) => console.error('[SoundService] ⚠️ Play Error:', _id, err)
    };

    // Use jsDelivr CDN to serve proper MIME types (audio/mpeg) and CORS headers for GitHub files
    const baseUrl = 'https://cdn.jsdelivr.net/gh/marvinrusinek/angular-10-quiz-app@master/src/assets/sounds';

    this.sounds['correct'] = new Howl({
      src: [`${baseUrl}/correct.mp3`],
      ...commonConfig
    });

    this.sounds['incorrect'] = new Howl({
      src: [`${baseUrl}/incorrect.mp3`],
      ...commonConfig
    });
  }

  // Play a sound only once per (questionIndex + optionId)
  playOnceForOption(option: SelectedOption): void {
    const qIndex = option.questionIndex ?? -1;
    const optId = option.optionId;
    
    console.log(`[SoundService] playOnceForOption: Q${qIndex} Opt=${optId} Selected=${option.selected}`);

    // Only play if it's being SELECTED
    if (option.selected === false) {
      console.log(`[SoundService] Skipping unselect.`);
      return;
    }

    // Determine which sound to play and play the correct sound
    const soundName = option.correct ? 'correct' : 'incorrect';
    this.play(soundName);
  }

  play(soundName: string): void {
    console.log(`[SoundService] Requesting: ${soundName}`);
    this.resumeAudioContextIfSuspended();

    const sound = this.sounds[soundName];
    if (!sound) {
      console.warn(`[SoundService] ⚠️ Sound "${soundName}" not initialized.`);
      return;
    }
    
    console.log(`[SoundService] Sound State: ${sound.state()}`);

    try {
      sound.stop();
      const id = sound.play();
      console.log(`[SoundService] ✅ Play triggered, ID: ${id}`);
    } catch (error) {
      console.error(`[SoundService] ❌ Play exception:`, error);
    }
  }

  // True if already played a sound for this option
  hasPlayed(qIdx: number, optId: number): boolean {
    return this.playedMap.get(qIdx)?.has(optId) ?? false;
  }

  // Mark that now played a sound
  markPlayed(qIdx: number, optId: number): void {
    if (!this.playedMap.has(qIdx)) this.playedMap.set(qIdx, new Set<number>());
    this.playedMap.get(qIdx)!.add(optId);
  }

  public reset(): void {
    this.playedSoundOptions.clear();

    // Stop and unload all existing Howl instances FIRST
    for (const sound of Object.values(this.sounds)) {
      try {
        sound.stop();
        sound.unload();
      } catch (error) {
        console.warn('[SoundService] Error stopping/unloading sound:', error);
      }
    }

    this.sounds = {};

    // Ensure audio context is resumed before recreating sounds
    this.resumeAudioContextIfSuspended();

    this.playedMap.clear();

    // Small delay to ensure audio context is ready
    setTimeout(() => {
      this.initializeSounds();  // recreate fresh Howl instances
    }, 100);
  }

  resumeAudioContextIfSuspended(): void {
    try {
      const ctx = (Howler as any).ctx as AudioContext;

      if (ctx && ctx.state === 'suspended') {
        ctx
          .resume()
          .then(() => {
            console.log('[🔊 AudioContext resumed]');
          })
          .catch((error) => {
            console.error('[Failed to resume AudioContext]', error);
          });
      }
    } catch (error) {
      console.warn('[Error accessing AudioContext]:', error);
    }
  }

  // Method to ensure sounds are ready after restart
  ensureSoundsReady(): void {
    if (!this.sounds['correct'] || !this.sounds['incorrect']) {
      this.initializeSounds();
    }
  }

  clearPlayedOptionsForQuestion(questionIndex: number): void {
    const keysToDelete = [...this.playedSoundOptions].filter((key) =>
      key.startsWith(`${questionIndex}-`)
    );
    for (const key of keysToDelete) {
      this.playedSoundOptions.delete(key);
    }
  }
}