import { FeedbackPolicyService } from './feedback-policy.service';

describe('FeedbackPolicyService', () => {
  let service: FeedbackPolicyService;

  beforeEach(() => {
    service = new FeedbackPolicyService();
  });

  it('defaults to immediate feedback', () => {
    expect(service.feedbackMode()).toBe('immediate');
    expect(service.isDeferred()).toBe(false);
  });

  it('setMode("deferred") defers feedback', () => {
    service.setMode('deferred');
    expect(service.feedbackMode()).toBe('deferred');
    expect(service.isDeferred()).toBe(true);
  });

  it('reset() restores immediate feedback', () => {
    service.setMode('deferred');
    service.reset();
    expect(service.feedbackMode()).toBe('immediate');
    expect(service.isDeferred()).toBe(false);
  });
});
