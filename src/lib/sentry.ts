import * as Sentry from '@sentry/react-native';

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    enabled: !__DEV__,
    tracesSampleRate: 0.2,
    beforeSend(event) {
      if (event.breadcrumbs?.values) {
        event.breadcrumbs.values = event.breadcrumbs.values.map((b) => ({
          ...b,
          message: b.message?.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]'),
        }));
      }
      return event;
    },
  });
}

export function setSentryUser(userId: string) {
  Sentry.setUser({ id: userId });
}

export function clearSentryUser() {
  Sentry.setUser(null);
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (__DEV__) return;
  if (context) Sentry.setContext('extra', context);
  Sentry.captureException(error);
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'warning', context?: Record<string, unknown>) {
  if (__DEV__) return;
  if (context) Sentry.setContext('extra', context);
  Sentry.captureMessage(message, level);
}
