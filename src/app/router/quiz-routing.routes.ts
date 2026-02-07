import { Routes } from '@angular/router';

import { IntroductionComponent } from
    '../containers/introduction/introduction.component';
import { QuizComponent } from '../containers/quiz/quiz.component';
import { QuizSelectionComponent } from
    '../containers/quiz-selection/quiz-selection.component';
import { ResultsComponent } from '../containers/results/results.component';

import { QuizResolverService } from '../shared/services/flow/quiz-resolver.service';
import { QuizGuard } from './guards/quiz-guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'quiz',
    pathMatch: 'full'
  },
  {
    path: 'quiz',
    component: QuizSelectionComponent
  },
  {
    path: 'quiz/intro/:quizId',
    component: IntroductionComponent
  },
  {
    path: 'quiz/question/:quizId/:questionIndex',
    component: QuizComponent,
    canActivate: [QuizGuard],
    resolve: { quizData: QuizResolverService },
    runGuardsAndResolvers: 'always'
  },
  {
    path: 'quiz/results/:quizId',
    component: ResultsComponent
  },

  // Backward compatibility redirects
  { path: 'select', redirectTo: 'quiz', pathMatch: 'full' },
  { path: 'intro/:quizId', redirectTo: 'quiz/intro/:quizId', pathMatch: 'full' },
  { path: 'question/:quizId/:questionIndex', redirectTo: 'quiz/question/:quizId/:questionIndex', pathMatch: 'full' },
  { path: 'results/:quizId', redirectTo: 'quiz/results/:quizId', pathMatch: 'full' }
];
