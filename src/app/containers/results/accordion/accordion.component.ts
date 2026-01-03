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
import { QuizDataService } from '../../../shared/services/quizdata.service';
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
  // correctAnswers removed - we derive it per question
  results: Result = {
    userAnswers: [],
    elapsedTimes: [],
  };

  @ViewChild('accordion', { static: false })
  accordion!: MatAccordion;
  panelOpenState = false;
  isOpen = false;
  
  private destroy$ = new Subject<void>();
  private hasRetried = false;

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
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
      
      if (this.questions.length === 0 && !this.hasRetried) {
         console.warn('[ACCORDION] Questions empty, attempting force fetch...');
         this.hasRetried = true;
         // Use a small timeout to let other initializations settle
         setTimeout(() => {
           const id = this.quizService.quizId || 'dependency-injection';
           // Fallback to QuizDataService to ensure clarity (bypasses shuffling/state complexity)
           this.quizDataService.getQuestionsForQuiz(id).pipe(takeUntil(this.destroy$)).subscribe((qs) => {
             if (qs && qs.length > 0) {
               console.log('[ACCORDION] Loaded questions via QuizDataService fallback:', qs.length);
               this.questions = qs;
               
               // Re-calculate correct answers if needed? 
               // QuizService.correctAnswers might be map of indexes. 
               // We assume indexes match the fetched questions.
               this.cdr.markForCheck();
             }
           });
         }, 100);
      }
      
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
    question: QuizQuestion,
    userAnswers: any[],
    index: number,
  ): boolean {
    const correctAnswers = this.getCorrectOptionIndices(question);
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

  getCorrectOptionIndices(question: QuizQuestion): number[] {
    if (!question || !question.options) return [];
    return question.options
      .map((opt, index) => (opt.correct ? index + 1 : -1))
      .filter((idx) => idx !== -1);
  }

  formatOptionList(indices: number[]): string {
    if (!indices || indices.length === 0) return '';
    if (indices.length === 1) return `Option ${indices[0]}`;
    if (indices.length === 2) return `Options ${indices[0]} and ${indices[1]}`;
    const last = indices[indices.length - 1];
    const rest = indices.slice(0, -1).join(', ');
    return `Options ${rest}, and ${last}`;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
