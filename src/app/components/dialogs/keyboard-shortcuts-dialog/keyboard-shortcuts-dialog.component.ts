import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

/**
 * Presentational dialog listing the quiz keyboard shortcuts. It holds no state
 * and injects no services — it closes via the `mat-dialog-close` directive.
 * Open it with MatDialog (see CodelabQuizHeaderComponent) and pass
 * `ariaLabelledBy`/`ariaDescribedBy` so screen readers announce it correctly.
 */
@Component({
  selector: 'codelab-keyboard-shortcuts-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './keyboard-shortcuts-dialog.component.html',
  styleUrls: ['./keyboard-shortcuts-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KeyboardShortcutsDialogComponent {}
