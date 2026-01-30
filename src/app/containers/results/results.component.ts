import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, HostListener
} from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { Subject } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';

import { FinalResult, ScoreAnalysisItem } from '../../shared/models/Final-Result.model';
import { BackToTopComponent } from '../../components/back-to-top/back-to-top.component';
import { AccordionComponent } from './accordion/accordion.component';
import { ChallengeComponent } from './challenge/challenge.component';
import { ReturnComponent } from './return/return.component';
import { StatisticsComponent } from './statistics/statistics.component';
import { SummaryReportComponent } from './summary-report/summary-report.component';

import { QUIZ_DATA } from '../../shared/quiz';
import { Quiz } from '../../shared/models/Quiz.model';
import { QuizStatus } from '../../shared/models/quiz-status.enum';
import { QuizService } from '../../shared/services/quiz.service';
import { QuizDataService } from '../../shared/services/quizdata.service';

@Component({
  selector: 'codelab-quiz-results',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatExpansionModule,
    MatIconModule,
    NgOptimizedImage, 
    BackToTopComponent,
    AccordionComponent,
    ChallengeComponent,
    ReturnComponent,
    StatisticsComponent,
    SummaryReportComponent
  ],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResultsComponent implements OnInit, OnDestroy {
  quizData: Quiz[] = QUIZ_DATA;
  quizId = '';
  indexOfQuizId = 0;
  menuOpen = false;
  activeSection: 'score' | 'report' | 'summary' | 'highscores' | 'resources' = 'score';
  
  finalResult: FinalResult | null = null;
  scoreAnalysis: ScoreAnalysisItem[] = [];

  showScrollIndicator = true;

  unsubscribe$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private activatedRoute: ActivatedRoute,
    private router: Router
  ) {
    this.quizService.setPreviousUserAnswersText(
      this.quizService.questions,
      this.quizService.userAnswers
    );
  }

  ngOnInit(): void {
    window.scrollTo(0, 0);
    this.fetchQuizIdFromParams();
    this.setCompletedQuiz();
    this.findQuizIndex();

    const snapshot = this.quizService.getFinalResultSnapshot();
    if (snapshot) {
      this.finalResult = snapshot;
      this.scoreAnalysis = snapshot.analysis;
      this.applyFinalResultSnapshot(snapshot);
      return;
    }

    // optional fallback
    this.quizService.finalResult$
      .pipe(take(1))
      .subscribe(r => {
        this.finalResult = r;
        this.scoreAnalysis = r?.analysis ?? [];
        if (r) {
          this.applyFinalResultSnapshot(r);
        }
      });
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    this.showScrollIndicator = window.scrollY < 100;
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  setActiveSection(section: 'score' | 'report' | 'summary' | 'highscores' | 'resources'): void {
    this.activeSection = section;
    this.closeMenu();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private fetchQuizIdFromParams(): void {
    this.activatedRoute.paramMap
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe((params) => {
        this.quizId = params.get('quizId') ?? '';
        this.setCompletedQuiz();
        this.findQuizIndex();
      });
  }

  private setCompletedQuiz(): void {
    if (this.quizId) {
      this.quizService.setCompletedQuizId(this.quizId);
      this.quizService.quizId = this.quizId;  // ensure service has correct ID for high scores
      this.quizService.setQuizStatus(QuizStatus.COMPLETED);
      
      // Update the quiz object's status so QuizSelectionComponent can show the icon
      this.quizDataService.updateQuizStatus(this.quizId, QuizStatus.COMPLETED);
    }
  }

  private findQuizIndex(): void {
    if (this.quizId) {
      this.indexOfQuizId = this.quizData.findIndex(
        (elem) => elem.quizId === this.quizId
      );
    }
  }

  private applyFinalResultSnapshot(snapshot: FinalResult): void {
    this.quizService.totalQuestions = snapshot.total;
    this.quizService.sendCorrectCountToResults(snapshot.correct);
  }

  selectQuiz(): void {
    this.quizService.resetAll();
    this.quizService.resetQuestions();
    this.quizId = '';
    this.indexOfQuizId = 0;
    this.router.navigate(['/select/']);
  }

  scrollDown(): void {
    window.scrollBy({ top: 500, behavior: 'smooth' });
  }
}