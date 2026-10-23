/**
 * @file uploadValidation.ts
 * @module application/utils/uploadValidation
 * @description Client-side file validation and object URL lifecycle management.
 *
 * Security Limitation & Boundaries:
 * - IMPORTANT: Client-side file checks are for fast user feedback only. They do NOT replace
 *   backend Supabase Storage bucket policy enforcement, MIME verification, or virus scanning.
 * - Files must still be authenticated and authorized via signed upload URLs or RLS storage policies.
 */

export interface FileValidationOptions {
  maxSizeMB: number;
  allowedMimeTypes: string[];
  allowedExtensions?: string[];
}

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedFileName?: string;
}

export const STUDENT_DOCUMENT_UPLOAD_RULES: FileValidationOptions = {
  maxSizeMB: 5,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.pdf'],
};

export const PAYMENT_RECEIPT_UPLOAD_RULES: FileValidationOptions = {
  maxSizeMB: 10,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.pdf'],
};

export const PROPERTY_IMAGE_UPLOAD_RULES: FileValidationOptions = {
  maxSizeMB: 10,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
};

export const CHAT_ATTACHMENT_UPLOAD_RULES: FileValidationOptions = {
  maxSizeMB: 10,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.txt'],
};

/**
 * Sanitizes a file name, removing path traversal sequences and control characters.
 */
export function sanitizeFileName(rawName: string): string {
  if (!rawName) return 'unnamed_file';
  // Strip path traversal and slashes
  const base = rawName.replace(/^.*[\\\/]/, '');
  // Replace dangerous or non-printable chars with underscores
  const clean = base.replace(/[^a-zA-Z0-9._\-]/g, '_');
  // Avoid leading dots or empty names
  return clean.replace(/^\.+/, '') || 'file';
}

/**
 * Validates a user-selected File against size and type constraints.
 */
export function validateUploadFile(
  file: File | null | undefined,
  options: FileValidationOptions
): FileValidationResult {
  if (!file) {
    return { isValid: false, error: 'Please select a file to upload.' };
  }

  // Reject 0-byte empty files
  if (file.size === 0) {
    return { isValid: false, error: 'The selected file is empty (0 bytes). Please choose a valid document.' };
  }

  // Reject files exceeding maximum size
  const maxBytes = options.maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      isValid: false,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the maximum allowed limit of ${options.maxSizeMB} MB.`,
    };
  }

  // Reject unsupported MIME types (explicitly disallow active HTML/SVG scripts)
  if (!options.allowedMimeTypes.includes(file.type.toLowerCase())) {
    return {
      isValid: false,
      error: `Unsupported file type (${file.type || 'unknown'}). Accepted formats: ${options.allowedExtensions?.join(', ') || options.allowedMimeTypes.join(', ')}.`,
    };
  }

  // Sanitize file name
  const sanitized = sanitizeFileName(file.name);

  return {
    isValid: true,
    sanitizedFileName: sanitized,
  };
}

/**
 * Safely creates an object URL and registers cleanup.
 */
export function createSafePreviewUrl(file: File): { url: string; revoke: () => void } {
  // Never create previews for SVG or HTML which could execute scripts
  if (file.type.includes('svg') || file.type.includes('html')) {
    return { url: '', revoke: () => {} };
  }
  const url = URL.createObjectURL(file);
  return {
    url,
    revoke: () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    },
  };
}
