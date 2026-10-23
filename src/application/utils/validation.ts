/**
 * @file validation.ts
 * @module application/utils/validation
 * @description Comprehensive runtime validators for user inputs across OUTPOST.
 *
 * Security Rationale:
 * - TypeScript types only exist at compile time; runtime inputs from forms, URL query params,
 *   and API responses must be verified to prevent injection, corrupted state, or unexpected NaN behavior.
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates email addresses against standard RFC 5322 format.
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Email address is required.' };
  }
  const trimmed = email.trim();
  if (trimmed.length > 254) {
    return { isValid: false, error: 'Email address exceeds maximum length of 254 characters.' };
  }
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: 'Please enter a valid email address (e.g., student@buk.edu.ng).' };
  }
  return { isValid: true };
}

/**
 * Validates password strength (min 8 chars, at least one uppercase, lowercase, and number).
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || typeof password !== 'string') {
    return { isValid: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { isValid: false, error: 'Password exceeds maximum length of 128 characters.' };
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  if (!hasUpper || !hasLower || !hasDigit) {
    return {
      isValid: false,
      error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number.',
    };
  }
  return { isValid: true };
}

/**
 * Validates Nigerian phone numbers (e.g. +234 801 234 5678, 08012345678).
 */
export function validatePhoneNumber(phone: string): ValidationResult {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, error: 'Phone number is required.' };
  }
  const cleaned = phone.replace(/[\s\-()]/g, '');
  const ngPhoneRegex = /^(?:\+234|234|0)(?:70|80|81|90|91)\d{8}$/;
  if (!ngPhoneRegex.test(cleaned)) {
    return {
      isValid: false,
      error: 'Please enter a valid Nigerian mobile phone number (e.g., 08012345678 or +2348012345678).',
    };
  }
  return { isValid: true };
}

/**
 * Validates BUK student registration or matriculation numbers.
 */
export function validateRegistrationNumber(regNo: string): ValidationResult {
  if (!regNo || typeof regNo !== 'string') {
    return { isValid: false, error: 'Registration number is required.' };
  }
  const trimmed = regNo.trim();
  if (trimmed.length < 4 || trimmed.length > 30) {
    return { isValid: false, error: 'Registration number must be between 4 and 30 characters.' };
  }
  // Allow alphanumeric characters with forward slashes and hyphens (standard Nigerian uni formats)
  if (!/^[A-Za-z0-9/\-_]+$/.test(trimmed)) {
    return { isValid: false, error: 'Registration number contains invalid characters.' };
  }
  return { isValid: true };
}

/**
 * Validates monetary amounts (NGN), preventing negative or non-finite values.
 */
export function validateAmount(amount: unknown, fieldName = 'Amount'): ValidationResult {
  if (amount === undefined || amount === null || amount === '') {
    return { isValid: false, error: `${fieldName} is required.` };
  }
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(num) || isNaN(num)) {
    return { isValid: false, error: `${fieldName} must be a valid number.` };
  }
  if (num <= 0) {
    return { isValid: false, error: `${fieldName} must be greater than zero.` };
  }
  if (num > 100_000_000) {
    return { isValid: false, error: `${fieldName} exceeds maximum allowable threshold.` };
  }
  return { isValid: true };
}

/**
 * Validates text length within minimum and maximum bounds.
 */
export function validateTextLength(
  text: string,
  min: number,
  max: number,
  fieldName: string
): ValidationResult {
  const trimmed = (text || '').trim();
  if (trimmed.length < min) {
    return { isValid: false, error: `${fieldName} must be at least ${min} characters.` };
  }
  if (trimmed.length > max) {
    return { isValid: false, error: `${fieldName} cannot exceed ${max} characters.` };
  }
  return { isValid: true };
}

/**
 * Validates group capacity for shared accommodation cohorts (2 to 6 students).
 */
export function validateGroupCapacity(capacity: unknown): ValidationResult {
  const num = Number(capacity);
  if (!Number.isFinite(num) || num < 2 || num > 6) {
    return { isValid: false, error: 'Group capacity must be between 2 and 6 members for student cohorts.' };
  }
  return { isValid: true };
}

/**
 * Validates safe numeric query parameter, preventing NaN or negative values.
 */
export function parseSafeNumber(val: string | null | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) && !isNaN(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Sanitizes and validates query parameters against allowed keys and safe character limits.
 */
export function validateQueryParams(
  params: Record<string, string | undefined>,
  allowedKeys: string[]
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const key of allowedKeys) {
    const val = params[key];
    if (typeof val === 'string') {
      const trimmed = val.trim();
      // Filter out dangerous characters and enforce length bounds
      if (trimmed.length > 0 && trimmed.length <= 100 && !/[<>'"\\]/.test(trimmed)) {
        sanitized[key] = trimmed;
      }
    }
  }
  return sanitized;
}

