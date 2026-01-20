import { 
  ChangeDetectionStrategy, ChangeDetectorRef, Component, 
  NgZone, OnDestroy, OnInit 
} from '@angular/core';
import { AsyncPipe, CommonModule, DecimalPipe } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

import { TimerService } from '../../../shared/services/timer.service';

enum TimerType {
  Countdown = 'countdown',
  Stopwatch = 'stopwatch',
}

@Component({
  selector: 'codelab-scoreboard-timer',
  standalone: true,
  imports: [CommonModule, MatMenuModule, DecimalPipe],
  templateUrl: './timer.component.html',
  styleUrls: ['./timer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimerComponent implements OnInit, OnDestroy {
  timerType = TimerType;
  timePerQuestion = 30;
  currentTimerType = TimerType.Countdown;

  timeLeft$!: Observable<number>;
  
  // Direct display value for reliability
  displayTime = 30;
  private uiUpdateInterval: any = null;
  private elapsedSub: Subscription | null = null;

  constructor(
    private timerService: TimerService,
    private cdRef: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    // Standard observable for async pipe
    this.timeLeft$ = this.timerService.elapsedTime$.pipe(
      map((elapsedTime) =>
        this.currentTimerType === TimerType.Countdown
          ? Math.max(this.timePerQuestion - elapsedTime, 0)
          : elapsedTime,
      ),
    );
    
    // Subscribe to elapsed time and update display directly
    this.elapsedSub = this.timerService.elapsedTime$.subscribe((elapsed) => {
      this.displayTime = Math.max(this.timePerQuestion - elapsed, 0);
      this.cdRef.markForCheck();
    });
    
    // Fallback: Poll TimerService every 500ms to ensure UI stays in sync
    this.ngZone.runOutsideAngular(() => {
      this.uiUpdateInterval = setInterval(() => {
        this.ngZone.run(() => {
          const elapsed = this.timerService.elapsedTime || 0;
          const newDisplayTime = Math.max(this.timePerQuestion - elapsed, 0);
          
          if (this.displayTime !== newDisplayTime) {
            this.displayTime = newDisplayTime;
            this.cdRef.markForCheck();
          }
        });
      }, 500);
    });
  }
  
  ngOnDestroy(): void {
    if (this.uiUpdateInterval) {
      clearInterval(this.uiUpdateInterval);
    }
    if (this.elapsedSub) {
      this.elapsedSub.unsubscribe();
    }
  }

  setTimerType(type: TimerType): void {
    if (this.currentTimerType !== type) {
      this.currentTimerType = type;
    } else {
      console.log(`[TimerComponent] Timer type is already set to ${type}`);
    }
  }
}
