import GlobalToastOverlay from '@/components/common/GlobalToastOverlay';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export type ToastInput = {
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number;
  onPress?: () => void;
};

type ToastItem = ToastInput & {
  id: string;
};

type ToastContextType = {
  showToast: (toast: ToastInput) => string;
  successToast: (message: string, title?: string) => string;
  errorToast: (message: string, title?: string) => string;
  infoToast: (message: string, title?: string) => string;
  warningToast: (message: string, title?: string) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATION = Platform.OS === 'web' ? 3200 : 2400;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => () => clearToasts(), [clearToasts]);

  const showToast = useCallback((toast: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextToast: ToastItem = {
      id,
      type: toast.type ?? 'info',
      duration: toast.duration ?? DEFAULT_DURATION,
      ...toast,
    };

    setToasts(prev => [...prev, nextToast].slice(-4));

    const timer = setTimeout(() => {
      dismissToast(id);
    }, nextToast.duration);

    timersRef.current.set(id, timer);
    return id;
  }, [dismissToast]);

  const value = useMemo<ToastContextType>(() => ({
    showToast,
    successToast: (message: string, title = 'Success') => showToast({ type: 'success', title, message }),
    errorToast: (message: string, title = 'Action failed') => showToast({ type: 'error', title, message, duration: 4200 }),
    infoToast: (message: string, title = 'Info') => showToast({ type: 'info', title, message }),
    warningToast: (message: string, title = 'Heads up') => showToast({ type: 'warning', title, message }),
    dismissToast,
    clearToasts,
  }), [clearToasts, dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <GlobalToastOverlay toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}