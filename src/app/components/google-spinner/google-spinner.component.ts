import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Google-style loading spinner: four colored blocks (one per Google brand color
 * — blue / red / green / yellow) in a 2×2 grid that rotate together at a calm,
 * steady speed. Presentation-only and self-contained (no inputs) — drop it
 * inside any loading placeholder.
 */
@Component({
  selector: 'app-google-spinner',
  standalone: true,
  imports: [],
  templateUrl: './google-spinner.component.html',
  styleUrls: ['./google-spinner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GoogleSpinnerComponent {}
