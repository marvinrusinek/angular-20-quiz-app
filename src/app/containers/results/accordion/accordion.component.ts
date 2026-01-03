import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatAccordion, MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';

import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { Result } from '../../../shared/models/Result.model';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
import { TimerService } from '../../../shared/services/timer.service';

@Component({
  selector: 'codelab-results-accordion',
  standalone: true,
  imports: [CommonModule, MatExpansionModule, MatIconModule],
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
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Initialize results in ngOnInit when service data is available
    this.results = {
      userAnswers: this.quizService.userAnswers,
      elapsedTimes: this.timerService.elapsedTimes,
    };
    console.log('[ACCORDION] Init userAnswers:', JSON.stringify(this.quizService.userAnswers));

    this.quizService.questions$.pipe(takeUntil(this.destroy$)).subscribe((questions) => {
      this.questions = questions;
      this.cdr.markForCheck();
      
      if (this.questions.length === 0 && !this.hasRetried) {
         console.warn('[ACCORDION] Questions empty, attempting force fetch...');
         this.hasRetried = true;
         // Use a small timeout to let other initializations settle
         setTimeout(() => {
            // Priority: URL params > Service State
            let id = this.route.snapshot.paramMap.get('quizId') || 
                     this.route.parent?.snapshot.paramMap.get('quizId');
            
            if (!id) {
              id = this.quizService.quizId;
            } else {
              // Sync service state if it's currently empty or different
              if (this.quizService.quizId !== id) {
                console.log(`[ACCORDION] Syncing service quizId to URL param: ${id}`);
                this.quizService.quizId = id;
              }
            }

           if (!id) {
             console.error('[ACCORDION] Could not determine quizId from route params.');
             return;
           }

           // Fallback to QuizDataService to ensure clarity (bypasses shuffling/state complexity)
           this.quizDataService.getQuestionsForQuiz(id).pipe(takeUntil(this.destroy$)).subscribe((qs) => {
             if (qs && qs.length > 0) {
               console.log('[ACCORDION] Loaded questions via QuizDataService fallback:', qs.length);
               this.questions = qs;
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
        Array.isArray(ans) ? ans : (ans !== null && ans !== undefined ? [ans] : []),
      );
    }
  }

  checkIfAnswersAreCorrect(
    question: QuizQuestion,
    userAnswers: any[],
    index: number,
  ): boolean {
    const userIds = userAnswers[index];
    if (!userIds || (Array.isArray(userIds) && userIds.length === 0)) return false;

    // Convert IDs to visual indices for comparison
    const userIndices = this.getUserAnswerIndices(question, userIds);
    const correctIndices = this.getCorrectOptionIndices(question);

    if (userIndices.length !== correctIndices.length) return false;

    // Check if every user index is in correct indices
    return userIndices.every((ui) => correctIndices.includes(ui));
  }

  getUserAnswerIndices(question: QuizQuestion, userIds: number | number[]): number[] {
    if (!question || !question.options || !userIds) return [];
    
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    
    return ids
      .map(id => {
         // Find index of option with this optionId
         // Find index of option with this optionId, safe-matching strings or numbers
         const idx = question.options.findIndex(opt => String(opt.optionId) === String(id));
         if (idx === -1) {
             console.warn(`[getUserAnswerIndices] ID mismatch for Q "${question.questionText?.substring(0, 15)}...". Looking for ID: ${id}. Available Options:`, question.options.map(o => o.optionId));
         }
         return idx >= 0 ? idx + 1 : -1;
      })
      .filter(idx => idx !== -1)
      .sort((a, b) => a - b);
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
