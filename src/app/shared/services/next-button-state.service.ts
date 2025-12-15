import { Injectable, NgZone, OnDestroy } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  Observable,
  of,
  Subscription,
} from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class NextButtonStateService implements OnDestroy {
  private isButtonEnabledSubject = new BehaviorSubject<boolean>(false);
  public isButtonEnabled$ = this.isButtonEnabledSubject.asObservable();

  public nextButtonStyle: { [key: string]: string } = {
    opacity: '0.5',
    cursor: 'not-allowed',
    'pointer-events': 'auto', // always allow click events
  };

  private nextButtonStateSubscription?: Subscription;
  private initialized = false;
  private manualOverride: boolean | null = null;

  constructor(private ngZone: NgZone) { }

  ngOnDestroy(): void {
    this.cleanupNextButtonStateStream();
  }

  public initializeNextButtonStateStream(
    isAnswered$: Observable<boolean>,
    isLoading$: Observable<boolean>,
    isNavigating$: Observable<boolean>,
    interactionReady$?: Observable<boolean>,
  ): void {
    if (this.initialized) {
      console.warn('[🛑 initializeNextButtonStateStream] Already initialized');
      return;
    }
    this.initialized = true;

    const ready$ = interactionReady$ ?? of(true);

    this.nextButtonStateSubscription = combineLatest([
      isAnswered$,
      isLoading$,
      isNavigating$,
      ready$,
    ])
      .pipe(
        distinctUntilChanged(
          ([a1, b1, c1, d1], [a2, b2, c2, d2]) =>
            a1 === a2 && b1 === b2 && c1 === c2 && d1 === d2,
        ),
      )
      .subscribe(([isAnswered, isLoading, isNavigating, ready]) => {
        console.log(`[NextButtonState] Stream update: isAnswered=${isAnswered}, isLoading=${isLoading}, isNavigating=${isNavigating}, ready=${ready}`);
        const enabled = isAnswered && !isLoading && !isNavigating && !!ready;
        this.updateAndSyncNextButtonState(enabled);
      });
  }

  public cleanupNextButtonStateStream(): void {
    this.nextButtonStateSubscription?.unsubscribe();
    this.nextButtonStateSubscription = undefined;
    this.initialized = false;
  }

  public evaluateNextButtonState(
    isAnswered: boolean,
    isLoading: boolean,
    isNavigating: boolean,
  ): boolean {
    const shouldEnable = isAnswered && !isLoading && !isNavigating;
    this.updateAndSyncNextButtonState(shouldEnable);
    return shouldEnable;
  }

  public updateAndSyncNextButtonState(isEnabled: boolean): void {
    this.ngZone.run(() => {
      const effective =
        this.manualOverride !== null ? this.manualOverride : isEnabled;

      this.isButtonEnabledSubject.next(effective);

      this.nextButtonStyle = {
        opacity: effective ? '1' : '0.5',
        cursor: effective ? 'pointer' : 'not-allowed',
        'pointer-events': 'auto',
      };
    });
  }

  public setNextButtonState(enabled: boolean): void {
    this.manualOverride = enabled; // store override
    this.updateAndSyncNextButtonState(enabled); // reuse consistent logic
  }

  reset(): void {
    this.setNextButtonState(false);
  }
}
