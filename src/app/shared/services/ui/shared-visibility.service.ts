import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SharedVisibilityService {
  private pageVisibilitySubject = new Subject<boolean>();
  pageVisibility$ = this.pageVisibilitySubject.asObservable();

  constructor() {
    document.addEventListener('visibilitychange', () => {
      this.pageVisibilitySubject.next(document.hidden);
    });
  }
}
