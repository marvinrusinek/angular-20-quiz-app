import { Injectable } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { Quiz } from '../../models/Quiz.model';
import { QuizDataService } from '../data/quizdata.service';

/**
 * Handles route parameter parsing and route-based quiz data resolution.
 * Extracted from QuizComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizRouteService {

  constructor(
    private quizDataService: QuizDataService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // ROUTE QUESTION NUMBER (1-based)
  // ═══════════════════════════════════════════════════════════════

  getRouteQuestionNumber(
    activatedRoute: ActivatedRoute,
    router: Router
  ): number | null {
    const parseNum = (raw: string | null): number | null => {
      if (raw == null) {
        return null;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return null;
      }
      const qn = Math.trunc(n);
      return qn >= 1 ? qn : null;
    };

    const fromCurrent = parseNum(
      activatedRoute.snapshot.paramMap.get('questionIndex')
    );
    if (fromCurrent !== null) {
      return fromCurrent;
    }

    const walk = (snapshot: any): number | null => {
      if (!snapshot) {
        return null;
      }
      const found = parseNum(snapshot.paramMap?.get?.('questionIndex') ?? null);
      if (found !== null) {
        return found;
      }
      for (const child of snapshot.children ?? []) {
        const childFound = walk(child);
        if (childFound !== null) {
          return childFound;
        }
      }
      return null;
    };

    const fromTree = walk(router.routerState.snapshot.root);
    if (fromTree !== null) {
      return fromTree;
    }

    const m = router.url.match(/\/(\d+)(?:\/)?(?:\?|$)/);
    if (m) {
      const fromUrl = parseNum(m[1]);
      if (fromUrl !== null) {
        return fromUrl;
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // ROUTE QUESTION INDEX (0-based)
  // ═══════════════════════════════════════════════════════════════

  getRouteQuestionIndex(
    activatedRoute: ActivatedRoute,
    router: Router
  ): number {
    const toIndex = (raw: string | null): number | null => {
      if (raw == null) {
        return null;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return null;
      }
      return Math.max(0, Math.trunc(n) - 1);
    };

    const fromCurrent = toIndex(
      activatedRoute.snapshot.paramMap.get('questionIndex')
    );
    if (fromCurrent !== null) {
      return fromCurrent;
    }

    const walk = (snapshot: any): number | null => {
      if (!snapshot) {
        return null;
      }
      const found = toIndex(snapshot.paramMap?.get?.('questionIndex') ?? null);
      if (found !== null) {
        return found;
      }
      for (const child of snapshot.children ?? []) {
        const childFound = walk(child);
        if (childFound !== null) {
          return childFound;
        }
      }
      return null;
    };

    const fromTree = walk(router.routerState.snapshot.root);
    if (fromTree !== null) {
      return fromTree;
    }

    const fromUrl = (() => {
      const m = router.url.match(/\/(\d+)(?:\?|$)/);
      if (!m) {
        return null;
      }
      return toIndex(m[1]);
    })();
    if (fromUrl !== null) {
      return fromUrl;
    }

    return 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // HANDLE ROUTE PARAMS (quiz data resolution)
  // ═══════════════════════════════════════════════════════════════

  handleRouteParams(
    params: ParamMap
  ): Observable<{ quizId: string; questionIndex: number; quizData: Quiz }> {
    const quizId = params.get('quizId');
    const questionIndex = Number(params.get('questionIndex'));

    if (!quizId) {
      console.error('Quiz ID is missing.');
      return throwError(() => new Error('Quiz ID is required'));
    }

    if (isNaN(questionIndex)) {
      console.error('Invalid question index:', params.get('questionIndex'));
      return throwError(() => new Error('Invalid question index'));
    }

    return this.quizDataService.getQuizzes().pipe(
      map((quizzes: Quiz[]) => {
        const quizData = quizzes.find((quiz) => quiz.quizId === quizId);
        if (!quizData) {
          throw new Error(`Quiz with ID "${quizId}" not found.`);
        }
        return { quizId, questionIndex, quizData };
      }),
      catchError((error: Error) => {
        console.error('Error processing quiz data:', error);
        return throwError(() => new Error('Failed to process quiz data'));
      })
    );
  }
}
