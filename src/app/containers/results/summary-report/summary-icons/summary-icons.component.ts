import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { Quiz } from '../../../../shared/models/Quiz.model';
import { QuizMetadata } from '../../../../shared/models/QuizMetadata.model';

@Component({
  selector: 'codelab-summary-icons',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './summary-icons.component.html',
  styleUrls: ['./summary-icons.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SummaryIconsComponent {
  @Input() quiz: Quiz | null = null;
  @Input() quizMetadata: Partial<QuizMetadata> | null = null;
  @Input() quizPercentage = 0;
  @Input() codelabUrl = '';

  /**
   * Custom URI encoding that preserves % and / for better readability
   * in email and social media shares
   */
  private encodeShareText(text: string): string {
    return encodeURIComponent(text)
      .replace(/%25/g, '%')   // Restore % signs
      .replace(/%2F/g, '/');  // Restore forward slashes
  }

  get mailtoHref(): string {
    const { percentage, milestone, codelabUrl } = this.getShareValues();
    const subject = 'Try to beat my quiz score!';
    const body = `I scored ${percentage}% on this awesome quiz about Angular ${milestone}. Try to beat my score at ${codelabUrl}`;

    return `mailto:?subject=${encodeURIComponent(subject)}&body=${this.encodeShareText(body)}`;
  }

  get twitterHref(): string {
    const { percentage, milestone, codelabUrl } = this.getShareValues();
    const tweetText = `I scored ${percentage}/100 on this awesome quiz about Angular ${milestone}. Try to beat my score at`;

    return `https://twitter.com/intent/tweet?text=${this.encodeShareText(tweetText)}&hashtags=quiz&url=${encodeURIComponent(codelabUrl)}`;
  }

  private getShareValues(): {
    percentage: number;
    milestone: string;
    codelabUrl: string;
  } {
    const percentageSource =
      this.quizMetadata?.percentage ?? this.quizPercentage;

    return {
      percentage: Number.isFinite(percentageSource) ? percentageSource : 0,
      milestone: this.quiz?.milestone ?? '',
      codelabUrl: this.codelabUrl ?? ''
    };
  }
}