// Module-level toast bridge so non-React code (lib/*) can surface a toast.
// ToastProvider registers its showToast here on mount; callers use toast()/
// toastError()/toastWarning(). No-op until the provider mounts (SSR/tests).
import type { ToastInput } from '@/contexts/ToastContext';

let handler: ((t: ToastInput) => void) | null = null;

export function registerToastHandler(fn: ((t: ToastInput) => void) | null) {
  handler = fn;
}

export function toast(input: ToastInput) {
  handler?.(input);
}

export function toastError(message: string, title = 'Action failed') {
  handler?.({ type: 'error', title, message, duration: 4200 });
}

export function toastWarning(message: string, title = 'Heads up') {
  handler?.({ type: 'warning', title, message });
}
