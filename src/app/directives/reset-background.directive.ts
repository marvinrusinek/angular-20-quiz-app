import { Directive, Input, ElementRef, Renderer2, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { ResetBackgroundService } from '../shared/services/reset-background.service';

@Directive({
  selector: '[appResetBackground]',
  standalone: true
})
export class ResetBackgroundDirective implements OnDestroy {
  @Input() appResetBackground = false;
  private resetBackgroundSubscription: Subscription;

  constructor(
    private el: ElementRef,
    private renderer: Renderer2,
    private resetBackgroundService: ResetBackgroundService
  ) {
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
