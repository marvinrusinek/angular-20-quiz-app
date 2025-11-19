import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UserPreferenceService {
  private highlightPreference = false;
  public feedbackMode: 'immediate' | 'lenient' = 'lenient';

  setHighlightPreference(value: boolean): void {
    this.highlightPreference = value;
  }

  getHighlightPreference(): boolean {
    return this.highlightPreference;
  }

  setFeedbackMode(mode: 'immediate' | 'lenient'): void {
    this.feedbackMode = mode;
    localStorage.setItem('feedbackMode', mode);
  }
}