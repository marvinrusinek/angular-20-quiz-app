import { Injectable, signal } from '@angular/core';

/**
 * Drives the brief "starting the quiz" loading overlay. IntroductionComponent
 * calls showForStart() when the user clicks "Start the Quiz!"; AppComponent
 * renders the overlay (the Google spinner) and it auto-hides after a short
 * guaranteed window, fading out to reveal the first question.
 *
 * Deliberately time-boxed: the quiz data is already cached by the time Start is
 * clicked, so there's no real fetch to wait on — this is a polished transition,
 * NOT a data-load indicator. Shown ONLY on Start (not on Next/Previous or while
 * browsing the Quiz Selection screen).
 */
@Injectable({ providedIn: 'root' })
export class QuizStartSpinnerService {
  private static readonly DEFAULT_MS = 600;

  private readonly _visible = signal(false);
  readonly visible = this._visible.asReadonly();
  private timer: ReturnType<typeof setTimeout> | null = null;

  showForStart(durationMs: number = QuizStartSpinnerService.DEFAULT_MS): void {
    this._visible.set(true);
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this._visible.set(false);
      this.timer = null;
    }, durationMs);
  }
}
