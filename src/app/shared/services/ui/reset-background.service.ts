import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ResetBackgroundService {
  // ── properties ──────────────────────────────────────────────────
  private shouldResetBackgroundSource = new Subject<boolean>();
  shouldResetBackground$ = this.shouldResetBackgroundSource.asObservable();

  // ── public methods ──────────────────────────────────────────────
  setShouldResetBackground(value: boolean): void {
    this.shouldResetBackgroundSource.next(value);
  }
}
