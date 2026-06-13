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

// Sentry can only title a real Error. Supabase/Postgrest errors are plain
// objects ({ message, details, hint, code }), so passing them straight to
// captureException yields the useless "Object captured as exception with keys:
// message". Wrap them into a real Error that carries the actual message + code.
function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    const message = typeof o.message === 'string' && o.message ? o.message : JSON.stringify(o);
    const err = new Error(message) as Error & { code?: string; details?: string; hint?: string };
    const code = typeof o.code === 'string' ? o.code : undefined;
    if (code) { err.code = code; err.name = `SupabaseError(${code})`; }
    else { err.name = 'NonError'; }
    if (typeof o.details === 'string') err.details = o.details;
    if (typeof o.hint === 'string') err.hint = o.hint;
    return err;
  }
  return new Error(String(error));
}

export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'error',
) {
  if (__DEV__) return;
  const err = toError(error);
  // withScope keeps level + context scoped to THIS event (setContext is global
  // and would otherwise leak the previous error's context onto later events).
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    if (context) scope.setContext('extra', sanitizeContext(context));
    Sentry.captureException(err);
  });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'warning', context?: Record<string, unknown>) {
  if (__DEV__) return;
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    if (context) scope.setContext('extra', sanitizeContext(context));
    Sentry.captureMessage(message);
  });
}
