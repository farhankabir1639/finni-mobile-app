import PostHog from 'posthog-react-native';

let client: PostHog | null = null;

export function initAnalytics() {
  const key = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  if (!key) return;
  client = new PostHog(key, {
    host: 'https://us.i.posthog.com',
    disabled: __DEV__,
  });
}

export function identifyUser(userId: string, traits?: Record<string, string | number | boolean>) {
  client?.identify(userId, traits as any);
}

export function resetUser() {
  client?.reset();
}

export function trackEvent(event: string, properties?: Record<string, string | number | boolean>) {
  client?.capture(event, properties as any);
}

export function trackScreen(screen: string) {
  client?.screen(screen);
}
