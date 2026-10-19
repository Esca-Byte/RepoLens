import { beforeEach, describe, expect, it } from 'vitest';
import { completeOnboarding, isOnboardingComplete } from './onboarding';

describe('onboarding state', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts incomplete and can be completed locally', () => {
    expect(isOnboardingComplete()).toBe(false);
    completeOnboarding();
    expect(isOnboardingComplete()).toBe(true);
  });
});
