import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewEncapsulation 
} from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  BehaviorSubject, EMPTY, Observable, of, Subject, Subscription 
} from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';

import { SlideLeftToRightAnimation } from '../../animations/animations';
import { AnimationState } from '../../shared/models/AnimationState.type';
import { Quiz } from '../../shared/models/Quiz.model';
import { QuizRoutes } from '../../shared/models/quiz-routes.enum';
import { QuizStatus } from '../../shared/models/quiz-status.enum';
import { QuizSelectionParams } from '../../shared/models/QuizSelectionParams.model';
import { QuizTileStyles } from '../../shared/models/QuizTileStyles.model';
import { QuizService } from '../../shared/services/quiz.service';
import { QuizDataService } from '../../shared/services/quizdata.service';

@Component({
  selector: 'codelab-quiz-selection',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    NgOptimizedImage,
  ],
  templateUrl: './quiz-selection.component.html',
  styleUrls: ['./quiz-selection.component.scss'],
  animations: [SlideLeftToRightAnimation.slideLeftToRight],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuizSelectionComponent implements OnInit, OnDestroy {
  quizzes$: Observable<Quiz[]> = of([]);
  selectedQuiz: Quiz | null = null;
  currentQuestionIndex = 0;
  animationState$ = new BehaviorSubject<AnimationState>('none');
  selectionParams!: QuizSelectionParams;
  selectedQuizSubscription!: Subscription;
  unsubscribe$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeQuizSelection();
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
    this.selectedQuizSubscription?.unsubscribe();
  }

  private initializeQuizSelection(): void {
    this.currentQuestionIndex = this.quizService.currentQuestionIndex;
    this.selectionParams = this.quizService.returnQuizSelectionParams();
    
    // Load quizzes once – replaces constructor side-effect
    this.quizDataService.loadQuizzes().subscribe();

    // Use live observable to receive status updates
    this.quizzes$ = this.quizDataService.quizzes$;

    this.subscribeToSelectedQuiz();
  }

  private subscribeToSelectedQuiz(): void {
    this.selectedQuizSubscription = this.quizService.selectedQuiz$
      .pipe(
        takeUntil(this.unsubscribe$),
        catchError((error: unknown) => {
          if (error instanceof Error) {
            console.error('Error fetching selected quiz:', error.message);
          } else {
            console.error('Unexpected error fetching selected quiz:', error);
          }
          return EMPTY;  // completes the stream safely
        }),
      )
      .subscribe((quiz: Quiz | null) => {
        this.selectedQuiz = (quiz as Quiz) ?? null;
      });
  }

  async onSelect(quizId: string, index: number): Promise<void> {
    try {
      if (!quizId) {
        console.error('[navigateToQuestion] quizId is null or undefined');
        return;
      }

      this.quizService.quizId = quizId;
      this.quizService.setIndexOfQuizId(index);
      
      const currentQuiz = this.quizDataService.getCachedQuizById(quizId);
      
      // If quiz is completed, go to results instead of intro
      if (currentQuiz?.status === QuizStatus.COMPLETED) {
        await this.router.navigate([QuizRoutes.RESULTS, quizId]);
        return;
      }
      
      // Set status to STARTED if not already CONTINUE or COMPLETED
      if (!currentQuiz?.status || currentQuiz.status === QuizStatus.STARTED) {
        this.quizDataService.updateQuizStatus(quizId, QuizStatus.STARTED);
        this.quizService.setQuizStatus(QuizStatus.STARTED);
      }
      
      await this.router.navigate([QuizRoutes.INTRO, quizId]);
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error('Unexpected error:', error);
      }
    }
  }

  getQuizTileStyles(quiz: Quiz): QuizTileStyles {
    return {
      background: 'url(' + quiz.image + ') no-repeat center 10px',
      'background-size': '300px 210px'
    };
  }

  getLinkClass(quiz: Quiz): string[] {
    const classes = ['status-link'];
    switch (quiz.status) {
      case QuizStatus.STARTED:
        if (
          !this.selectionParams.quizCompleted ||
          quiz.quizId === this.selectionParams.startedQuizId ||
          quiz.quizId === this.selectionParams.continueQuizId ||
          quiz.quizId === this.selectionParams.completedQuizId
        ) {
          classes.push('link');
        }
        break;
    }
    return classes;
  }

  getTooltip(quiz: Quiz): string {
    switch (quiz.status) {
      case QuizStatus.STARTED:
        return 'Start';
      case QuizStatus.CONTINUE:
        return 'Continue';
      case QuizStatus.COMPLETED:
        return 'Completed';
      default:
        return '';
    }
  }

  shouldShowLink(quiz: Quiz): boolean {
    // Show the status icon if the quiz has any status set
    // OR if it's the completed quiz (based on selectionParams)
    const hasStatus = !!quiz.status;
    const isCompletedQuiz = quiz.quizId === this.selectionParams.completedQuizId;
    
    // Show icon if quiz has a status OR if it matches the completed quiz ID
    return hasStatus || isCompletedQuiz;
  }

  getLinkRouterLink(quiz: Quiz): string[] {
    const quizId = quiz.quizId;
    const currentQuestionIndexStr = `${this.currentQuestionIndex}`;

    switch (quiz.status) {
      case QuizStatus.STARTED:
        return [QuizRoutes.INTRO, quizId];
      case QuizStatus.CONTINUE:
        return [QuizRoutes.QUESTION, quizId, currentQuestionIndexStr];
      case QuizStatus.COMPLETED:
        return [QuizRoutes.RESULTS, quizId];
      default:
        return [];
    }
  }

  getIconClass(quiz: Quiz): string {
    switch (quiz.status) {
      case QuizStatus.STARTED:
        return 'play_arrow';  // Start icon
      case QuizStatus.CONTINUE:
        return 'fast_forward';  // Continue icon
      case QuizStatus.COMPLETED:
        return 'done';  // Completed checkmark
      default:
        return 'help_outline';  // Unknown state
    }
  }

  animationDoneHandler(): void {
    this.animationState$.next('none');
  }
}