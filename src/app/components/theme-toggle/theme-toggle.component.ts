import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ThemeService } from '../../shared/services/ui/theme.service';

@Component({
  selector: 'codelab-theme-toggle',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="theme-toggle-btn"
      (click)="themeService.toggle()"
      [matTooltip]="themeService.tooltip()"
      matTooltipPosition="below"
      aria-label="Toggle dark/light mode"
    >
      <mat-icon>{{ themeService.icon() }}</mat-icon>
    </button>
  `,
  styles: [`
    :host {
      display: block;
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 10;
    }

    .theme-toggle-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 50%;
      background: var(--theme-toggle-bg);
      color: var(--theme-toggle-color);
      cursor: pointer;
      transition: background 0.3s ease, color 0.3s ease, transform 0.2s ease;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
    }

    .theme-toggle-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
    }

    .theme-toggle-btn mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
  `]
})
export class ThemeToggleComponent {
  constructor(public themeService: ThemeService) {}
}
