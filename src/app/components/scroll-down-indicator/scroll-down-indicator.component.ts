import {
  ChangeDetectionStrategy, Component, input, OnInit, signal
} from '@angular/core';

@Component({
  selector: 'app-scroll-down-indicator',
  standalone: true,
  template: `
    @if (showIndicator()) {
      <div class="scroll-indicator" (click)="scrollDown()">
        <i class="material-icons">keyboard_arrow_down</i>
      </div>
    }
  `,
  styleUrls: ['./scroll-down-indicator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:scroll)': 'onScroll()',
    '(window:resize)': 'onResize()'
  }
})
export class ScrollDownIndicatorComponent implements OnInit {
  targetSelector = input<string>('');
  readonly showIndicator = signal(false);

  ngOnInit(): void {
    setTimeout(() => this.check(), 300);
  }

  onScroll(): void {
    this.check();
  }

  onResize(): void {
    this.check();
  }

  check(): void {
    const el = this.targetSelector
      ? document.querySelector(this.targetSelector())
      : document.documentElement;
    if (!el) {
      this.showIndicator.set(false);
      return;
    }
    const rect = el.getBoundingClientRect();
    const shouldShow = (rect.bottom - window.innerHeight) > 20;
    this.showIndicator.set(shouldShow);
  }

  scrollDown(): void {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    });
  }
}
