const STORAGE_KEY = 'repolens:onboarding-complete';

export function isOnboardingComplete(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function completeOnboarding(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // The guide can still be dismissed for the current session if storage is unavailable.
  }
}
