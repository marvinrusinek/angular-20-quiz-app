import { ChangeDetectionStrategy, Component, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-back-to-top',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './back-to-top.component.html',
  styleUrls: ['./back-to-top.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BackToTopComponent {
  readonly isVisible = signal(false);

  // Listen to window scroll events
  @HostListener('window:scroll')
  onWindowScroll(): void {
    const yOffset = window.pageYOffset || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight;
    const winHeight = window.innerHeight;
    const nearBottom = (docHeight - (yOffset + winHeight)) < 50;
    this.isVisible.set(yOffset > 300 && nearBottom);
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
