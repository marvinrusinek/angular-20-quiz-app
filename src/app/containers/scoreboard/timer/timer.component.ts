import { 
  ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone, OnDestroy,
  OnInit 
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

import { TimerService } from '../../../shared/services/features/timer.service';

enum TimerType {
  Countdown = 'countdown',
  Stopwatch = 'stopwatch'
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
  private timerTypeSub: Subscription | null = null;

  constructor(
    private timerService: TimerService,
    private cdRef: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.currentTimerType = this.timerService.isCountdown
      ? TimerType.Countdown
      : TimerType.Stopwatch;
      
    // Standard observable for async pipe
    this.timeLeft$ = this.timerService.elapsedTime$.pipe(
      map((elapsedTime) =>
        this.currentTimerType === TimerType.Countdown
          ? Math.max(this.timePerQuestion - elapsedTime, 0)
          : elapsedTime
      ),
    );
    
    // Subscribe to elapsed time and update display directly
    this.elapsedSub = this.timerService.elapsedTime$.subscribe((elapsed) => {
      this.updateDisplayTime(elapsed);
    });

    this.timerTypeSub = this.timerService.timerType$.subscribe((type) => {
      const nextType =
        type === 'countdown' ? TimerType.Countdown : TimerType.Stopwatch;
      if (this.currentTimerType !== nextType) {
        this.currentTimerType = nextType;
        this.updateDisplayTime(this.timerService.elapsedTime || 0);
      }
    });
    
    // Fallback: Poll TimerService every 500ms to ensure UI stays in sync
    this.ngZone.runOutsideAngular(() => {
      this.uiUpdateInterval = setInterval(() => {
        this.ngZone.run(() => {
          const elapsed = this.timerService.elapsedTime || 0;
          const newDisplayTime = this.getDisplayTime(elapsed);
          
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
    if (this.timerTypeSub) {
      this.timerTypeSub.unsubscribe();
    }
  }

  setTimerType(type: TimerType): void {
    if (this.currentTimerType !== type) {
      this.currentTimerType = type;
      this.timerService.setTimerType(
        type === TimerType.Countdown ? 'countdown' : 'stopwatch',
      );
      const elapsed = this.timerService.elapsedTime || 0;
      this.updateDisplayTime(elapsed);
    } else {
      console.log(`[TimerComponent] Timer type is already set to ${type}`);
    }
  }

  private updateDisplayTime(elapsed: number): void {
    this.displayTime = this.getDisplayTime(elapsed);
    this.cdRef.markForCheck();
  }

  private getDisplayTime(elapsed: number): number {
    return this.currentTimerType === TimerType.Countdown
      ? Math.max(this.timePerQuestion - elapsed, 0)
      : elapsed;
  }
}
