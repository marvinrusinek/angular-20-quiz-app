import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatAccordion, MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';

import { JoinPipe } from '../../../pipes/join.pipe';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { Result } from '../../../shared/models/Result.model';
import { QuizService } from '../../../shared/services/quiz.service';
import { TimerService } from '../../../shared/services/timer.service';

@Component({
  selector: 'codelab-results-accordion',
  standalone: true,
  imports: [CommonModule, MatExpansionModule, MatIconModule, JoinPipe],
  templateUrl: './accordion.component.html',
  styleUrls: ['./accordion.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccordionComponent implements OnInit, OnDestroy {
  questions: QuizQuestion[] = [];
  correctAnswers: number[] = [];
  results: Result = {
    userAnswers: [],
    elapsedTimes: [],
  };

  @ViewChild('accordion', { static: false })
  accordion!: MatAccordion;
  panelOpenState = false;
  isOpen = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private timerService: TimerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Initialize results in ngOnInit when service data is available
    this.results = {
      userAnswers: this.quizService.userAnswers,
      elapsedTimes: this.timerService.elapsedTimes,
    };

    this.quizService.questions$.pipe(takeUntil(this.destroy$)).subscribe((questions) => {
      this.questions = questions;
      this.cdr.markForCheck();
      
      // Update correct answers based on new questions
      // (This logic implies correct answers are static in QuizService or derived from questions)
      this.correctAnswers = Array.from(
        this.quizService.correctAnswers.values(),
      ).flat();
      
      console.log('[ACCORDION] questions updated:', this.questions?.length);
    });

    console.log('[ACCORDION] ngOnInit initial:', {
      userAnswers: this.results?.userAnswers,
      elapsedTimes: this.results?.elapsedTimes,
    });

    // Normalize userAnswers so Angular can always iterate
    if (this.results?.userAnswers) {
      this.results.userAnswers = this.results.userAnswers.map((ans) =>
        Array.isArray(ans) ? ans : [ans],
      );
    }
  }

  /* checkIfAnswersAreCorrect(correctAnswers: any, userAnswers: any, index: number): boolean {
    return !(
      !userAnswers[index] ||
      userAnswers[index].length === 0 ||
      userAnswers[index].find((answer: string) =>
        correctAnswers[index].answers[0].indexOf(answer) === -1
      )
    );
  } */
  checkIfAnswersAreCorrect(
    correctAnswers: number[],
    userAnswers: any[],
    index: number,
  ): boolean {
    const user = userAnswers[index];

    // Handle no answers case
    if (!user || (Array.isArray(user) && user.length === 0)) {
      return false;
    }

    // Normalize user answers to an array
    const userArr = Array.isArray(user) ? user : [user];

    // Normalize correct answers to an array
    const correctArr = Array.isArray(correctAnswers)
      ? correctAnswers
      : [correctAnswers];

    // Check if every user-selected answer is in the correct set,
    // and if counts match (no extra guesses)
    const allMatch = userArr.every((ans: number) => correctArr.includes(ans));
    const sameLength = userArr.length === correctArr.length;

    return allMatch && sameLength;
  }

  openAllPanels(): void {
    this.isOpen = true;
    (this.accordion as any).openAll();
  }
  closeAllPanels(): void {
    this.isOpen = false;
    (this.accordion as any).closeAll();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
