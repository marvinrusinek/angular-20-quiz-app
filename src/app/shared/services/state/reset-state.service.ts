import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ResetStateService {
  // ── properties ──────────────────────────────────────────────────
  private resetStateSource = new Subject<void>();
  resetState$ = this.resetStateSource.asObservable();

  private resetFeedbackSource = new Subject<void>();
  resetFeedback$ = this.resetFeedbackSource.asObservable();

  // ── public methods ──────────────────────────────────────────────
  triggerResetState(): void {
    this.resetStateSource.next();
  }

  triggerResetFeedback(): void {
    this.resetFeedbackSource.next();
  }
}
