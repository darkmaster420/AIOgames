/**
 * Utility functions for authentication
 */

export function validateEmailOrUsername(input: string): {
  isValid: boolean;
  type: 'email' | 'username' | null;
  error?: string;
} {
  if (!input || !input.trim()) {
    return { isValid: false, type: null, error: 'Email or username is required' };
  }

  const trimmed = input.trim();

  // Check if it looks like an email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(trimmed)) {
    return { isValid: true, type: 'email' };
  }

  // Check if it's a valid username format
  const usernameRegex = /^[a-z0-9_]+$/i;
  if (usernameRegex.test(trimmed) && trimmed.length >= 3 && trimmed.length <= 24) {
    return { isValid: true, type: 'username' };
  }

  return { 
    isValid: false, 
    type: null, 
    error: 'Enter a valid email address or username (3-24 characters, letters, numbers, underscores only)' 
  };
}

export function normalizeLoginInput(input: string): string {
  return input.trim().toLowerCase();
}