import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnInit
} from '@angular/core';

@Component({
  selector: 'app-scroll-down-indicator',
  standalone: true,
  template: `
    @if (showIndicator) {
      <div class="scroll-indicator" (click)="scrollDown()">
        <i class="material-icons">keyboard_arrow_down</i>
      </div>
    }
  `,
  styleUrls: ['./scroll-down-indicator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScrollDownIndicatorComponent implements OnInit {
  @Input() targetSelector = '';
  showIndicator = false;

  constructor(private cdRef: ChangeDetectorRef) {}

  ngOnInit(): void {
    setTimeout(() => this.check(), 300);
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.check();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.check();
  }

  check(): void {
    const el = this.targetSelector
      ? document.querySelector(this.targetSelector)
      : document.documentElement;
    if (!el) {
      this.showIndicator = false;
      return;
    }
    const rect = el.getBoundingClientRect();
    const shouldShow = (rect.bottom - window.innerHeight) > 80;
    if (this.showIndicator !== shouldShow) {
      this.showIndicator = shouldShow;
      this.cdRef.detectChanges();
    }
  }

  scrollDown(): void {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    });
  }
}
