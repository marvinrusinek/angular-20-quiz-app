import { computed, effect, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  // ── signals ─────────────────────────────────────────────────────
  readonly theme = signal<Theme>(this.loadInitialTheme());

  // ── computed ────────────────────────────────────────────────────
  readonly isDark = computed(() => this.theme() === 'dark');
  readonly icon = computed(() => this.isDark() ? 'light_mode' : 'dark_mode');
  readonly tooltip = computed(() => this.isDark() ? 'Switch to light mode' : 'Switch to dark mode');

  // ── properties ──────────────────────────────────────────────────
  private static readonly STORAGE_KEY = 'quiz-app-theme';

  // ── constructor / lifecycle ─────────────────────────────────────
  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-theme', t);
      try {
        localStorage.setItem(ThemeService.STORAGE_KEY, t);
      } catch {}
    });
  }

  // ── public methods ──────────────────────────────────────────────
  toggle(): void {
    this.theme.update(t => t === 'light' ? 'dark' : 'light');
  }

  // ── private methods ─────────────────────────────────────────────
  private loadInitialTheme(): Theme {
    try {
      const stored = localStorage.getItem(ThemeService.STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {}
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }
}