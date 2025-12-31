import { Injectable } from '@angular/core';
import {
  Resolve,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { Quiz } from '../../shared/models/Quiz.model';
import { QuizService } from './quiz.service';
import { QuizDataService } from './quizdata.service';

@Injectable({ providedIn: 'root' })
export class QuizResolverService implements Resolve<Quiz | UrlTree | null> {
  constructor(
    private quizDataService: QuizDataService,
    private quizService: QuizService,
    private router: Router,
  ) { }

  resolve(
    route: ActivatedRouteSnapshot,
    _state: RouterStateSnapshot,
  ): Observable<Quiz | UrlTree | null> {
    const quizId = route.params['quizId'];

    // 🚀 FAST PATH: If we already have the quiz loaded, don't re-fetch.
    // This prevents "cold observable" stutter or "waiting for data" hangs during Q1->Q2 nav.
    const activeQuiz = this.quizService.selectedQuiz;
    if (activeQuiz && activeQuiz.quizId === quizId) {
      console.log('[🚀 QuizResolver] Fast path: Quiz already loaded:', quizId);
      return of(activeQuiz);
    }

    return this.quizDataService.ensureQuizzesLoaded().pipe(
      switchMap(() => this.quizDataService.getQuiz(quizId)),
      map((quiz) => {
        if (!quiz) {
          console.error(`[❌ QuizResolver] Quiz not found for ID: ${quizId}`);
          return this.router.createUrlTree(['/quiz']);
        }
        console.log('[✅ QuizResolver] Quiz resolved (slow path):', quiz);
        return quiz;
      }),

      catchError((error) => {
        console.error('[❌ QuizResolverService failure]', error);
        return of(this.router.createUrlTree(['/quiz']));
      }),
    );
  }
}
