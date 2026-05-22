import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SharedVisibilityService {
  // ── properties ──────────────────────────────────────────────────
  private pageVisibilitySubject = new Subject<boolean>();
  pageVisibility$ = this.pageVisibilitySubject.asObservable();

  // ── constructor / lifecycle ─────────────────────────────────────
  constructor() {
    document.addEventListener('visibilitychange', () => {
      this.pageVisibilitySubject.next(document.hidden);
    });
  }
}
