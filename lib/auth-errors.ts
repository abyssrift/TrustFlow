import { AuthError } from '@supabase/supabase-js';

/**
 * Maps Supabase Auth errors to user-friendly messages.
 * @param error The AuthError object from Supabase
 * @returns A clean string message for the user
 */
export const getErrorMessage = (error: AuthError | Error | null): string => {
  if (!error) return 'An unknown error occurred.';

  // If it's a Supabase AuthError, it might have a specific code or message
  const message = error.message.toLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }

  if (message.includes('user already registered')) {
    return 'An account with this email already exists.';
  }

  if (message.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.';
  }

  if (message.includes('password should be at least')) {
    return 'Password must be at least 8 characters long.';
  }

  if (message.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }

  if (message.includes('network request failed')) {
    return 'Network error. Please check your internet connection.';
  }

  if (message.includes('rate limit exceeded')) {
    return 'Too many attempts. Please try again later.';
  }

  // Fallback to the original message but capitalized
  return error.message.charAt(0).toUpperCase() + error.message.slice(1);
};

/**
 * Validates basic email format
 */
export const isValidEmail = (email: string): boolean => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

/**
 * Validates password strength
 */
export const isStrongPassword = (password: string): boolean => {
  return password.length >= 8;
};
