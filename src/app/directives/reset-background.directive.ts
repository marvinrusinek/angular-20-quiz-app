import { Directive, ElementRef, inject, Renderer2, OnDestroy, input } from '@angular/core';
import { Subscription } from 'rxjs';

import { ResetBackgroundService } from '../shared/services/ui/reset-background.service';

@Directive({
  selector: '[appResetBackground]',
  standalone: true
})
export class ResetBackgroundDirective implements OnDestroy {
  // ── injects ─────────────────────────────────────────────────────
  private readonly resetBackgroundService = inject(ResetBackgroundService);
  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);

  // ── inputs ──────────────────────────────────────────────────────
  readonly appResetBackground = input(false);

  // ── remaining variables ─────────────────────────────────────────
  private resetBackgroundSubscription: Subscription;

  constructor() {
    this.resetBackgroundSubscription =
      this.resetBackgroundService.shouldResetBackground$.subscribe((value) => {
        if (value) {
          this.resetBackground();
        }
      });
  }

  ngOnDestroy(): void {
    this.resetBackgroundSubscription?.unsubscribe();
  }

  private resetBackground(): void {
    this.renderer.setStyle(this.el.nativeElement, 'background-color', 'white');
  }
}
