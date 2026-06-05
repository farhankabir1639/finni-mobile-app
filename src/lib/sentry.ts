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
      // Strip sensitive fields from extra context
      if (event.contexts?.extra) {
        const sanitized = { ...event.contexts.extra };
        delete sanitized.email;
        delete sanitized.password;
        delete sanitized.token;
        delete sanitized.access_token;
        delete sanitized.refresh_token;
        delete sanitized.userMessage;
        delete sanitized.transactionData;
        event.contexts.extra = sanitized;
      }
      // Scrub breadcrumb data that may contain PII
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (b.data?.url) {
            b.data.url = b.data.url.replace(/key=[^&]+/, 'key=***');
          }
          return b;
        });
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

const SENSITIVE_KEYS = ['email', 'password', 'token', 'access_token', 'refresh_token', 'userMessage', 'transactionData'];

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...context };
  for (const key of SENSITIVE_KEYS) delete sanitized[key];
  return sanitized;
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (__DEV__) return;
  if (context) Sentry.setContext('extra', sanitizeContext(context));
  Sentry.captureException(error);
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'warning', context?: Record<string, unknown>) {
  if (__DEV__) return;
  if (context) Sentry.setContext('extra', sanitizeContext(context));
  Sentry.captureMessage(message, level);
}
