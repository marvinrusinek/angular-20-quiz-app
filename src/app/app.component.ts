import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';

import { GoogleSpinnerComponent } from './components/google-spinner/google-spinner.component';
import { QuizStartSpinnerService } from './shared/services/ui/quiz-start-spinner.service';

@Component({
  selector: 'codelab-root',
  standalone: true,
  imports: [RouterOutlet, GoogleSpinnerComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  questionIndexKey = '';
  showOutlet = true;
  outletKey = '';

  // Drives the brief "Start the Quiz!" loading overlay (set by IntroductionComponent).
  readonly startSpinner = inject(QuizStartSpinnerService);

  constructor(private router: Router) {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.outletKey = this.router.url;
      const segments = this.router.url.split('/');
      const maybeIndex = segments[segments.length - 1];
      this.questionIndexKey = isNaN(+maybeIndex) ? '' : maybeIndex;

      // Force destroy and recreate router-outlet
      if (this.showOutlet) {
        this.showOutlet = false;
        setTimeout(() => {
          this.showOutlet = true;
        }, 0);
      }
    });
  }
}
