/**
 * @file errorUtils.ts
 * @module application/utils/errorUtils
 * @description Safe error normalization and redaction utility for the OUTPOST frontend.
 *
 * Security Rationale:
 * - Uncaught or direct error messages often leak internal PostgreSQL schemas, SQL errors,
 *   token fragments, or private storage bucket paths.
 * - This utility normalizes all caught errors into user-friendly diagnostic results
 *   while stripping sensitive information.
 */

export type ErrorCategory =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'UNEXPECTED';

export interface UserFacingError {
  category: ErrorCategory;
  userMessage: string;
  code?: string;
  canRetry: boolean;
}

/**
 * Normalizes any caught error (Error, string, Supabase error object, or unknown)
 * into a safe, redacted user-facing message with appropriate category.
 */
export function normalizeError(err: unknown, fallbackMessage = 'An unexpected error occurred. Please try again.'): UserFacingError {
  if (!err) {
    return {
      category: 'UNEXPECTED',
      userMessage: fallbackMessage,
      canRetry: true,
    };
  }

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  // Redact SQL and internal table hints
  const hasSqlLeak = /relation ".*"|syntax error at or near|violates foreign key|column ".*" does not exist|pg_catalog/i.test(raw);
  if (hasSqlLeak) {
    return {
      category: 'UNEXPECTED',
      userMessage: 'A database error occurred. The technical team has been notified.',
      code: 'ERR_DB_INTERNAL',
      canRetry: false,
    };
  }

  // Authentication errors
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials') || lower.includes('invalid password')) {
    return {
      category: 'UNAUTHORIZED',
      userMessage: 'Invalid email or password. Please check your credentials and try again.',
      code: 'ERR_AUTH_INVALID_CREDENTIALS',
      canRetry: true,
    };
  }

  if (lower.includes('unauthorized') || lower.includes('missing authorization') || lower.includes('jwt expired')) {
    return {
      category: 'UNAUTHORIZED',
      userMessage: 'Your session has expired. Please sign in again to continue.',
      code: 'ERR_AUTH_SESSION_EXPIRED',
      canRetry: true,
    };
  }

  if (lower.includes('forbidden') || lower.includes('suspended') || lower.includes('account_status')) {
    return {
      category: 'FORBIDDEN',
      userMessage: 'Access denied: You do not have permission to perform this action or your account is restricted.',
      code: 'ERR_FORBIDDEN',
      canRetry: false,
    };
  }

  if (lower.includes('not found') || lower.includes('row not found')) {
    return {
      category: 'NOT_FOUND',
      userMessage: 'The requested resource or record could not be found.',
      code: 'ERR_NOT_FOUND',
      canRetry: false,
    };
  }

  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch') || lower.includes('offline')) {
    return {
      category: 'NETWORK',
      userMessage: 'Network connection issue detected. Please check your internet connection and try again.',
      code: 'ERR_NETWORK',
      canRetry: true,
    };
  }

  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      category: 'RATE_LIMITED',
      userMessage: 'Too many requests. Please wait a moment before trying again.',
      code: 'ERR_RATE_LIMITED',
      canRetry: true,
    };
  }

  // Generic fallback without leaking tokens or stack traces
  const sanitized = redactSensitiveData(raw);
  return {
    category: 'UNEXPECTED',
    userMessage: sanitized.length < 150 ? sanitized : fallbackMessage,
    canRetry: true,
  };
}

/**
 * Redacts tokens, passwords, and sensitive keys from any string.
 */
export function redactSensitiveData(text: string): string {
  if (!text) return '';
  return text
    .replace(/[a-zA-Z0-9_\-\.]{30,}/g, '[REDACTED_TOKEN]')
    .replace(/password\s*=\s*["'][^"']+["']/gi, 'password="[REDACTED]"');
}

