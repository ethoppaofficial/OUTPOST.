/**
 * @file urlUtils.ts
 * @module application/utils/urlUtils
 * @description URL sanitization, safe internal redirection, and external link validation.
 *
 * Security Rationale:
 * - Prevents Open Redirect vulnerabilities by strictly constraining post-login redirection
 *   to internal application paths.
 * - Prevents JavaScript URI injection in anchors or external links.
 */

/**
 * Validates that a target path is an internal application route.
 * Prevents open redirect attacks (e.g., `//evil.com`, `javascript:...`, `https:...`).
 */
export function getSafeInternalRedirect(targetPath: string | null | undefined, defaultFallback = '/'): string {
  if (!targetPath || typeof targetPath !== 'string') {
    return defaultFallback;
  }

  const trimmed = targetPath.trim();

  // Must begin with a single slash and NOT double slash (protocol-relative URL)
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return defaultFallback;
  }

  // Reject dangerous schemes or backslashes
  if (/[\\{}<>\r\n]|javascript:|data:|vbscript:/i.test(trimmed)) {
    return defaultFallback;
  }

  return trimmed;
}

/**
 * Validates external directions/maps URLs (e.g. Google Maps or OpenStreetMap).
 * Only HTTPS URLs are permitted.
 */
export function isSafeExternalHttpUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Safe external anchor props with tabnabbing defense.
 */
export const SAFE_EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;
