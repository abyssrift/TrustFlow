import React, { createContext, useContext, useState, useCallback } from 'react';
import { GlobalAlertOverlay, AlertOptions } from '@/components/common/GlobalAlertOverlay';

interface AlertContextType {
  showAlert: (title: string, message: string, onConfirm?: () => void) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void, confirmText?: string, cancelText?: string) => void;
  hideAlert: () => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [alertOptions, setAlertOptions] = useState<AlertOptions | null>(null);

  const showAlert = useCallback((title: string, message: string, onConfirm?: () => void) => {
    setAlertOptions({ title, message, type: 'alert', onConfirm });
  }, []);

  const showConfirm = useCallback((
    title: string, 
    message: string, 
    onConfirm: () => void, 
    onCancel?: () => void,
    confirmText?: string,
    cancelText?: string
  ) => {
    setAlertOptions({ title, message, type: 'confirm', onConfirm, onCancel, confirmText, cancelText });
  }, []);

  const hideAlert = useCallback(() => {
    setAlertOptions(null);
  }, []);

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm, hideAlert }}>
      {children}
      {alertOptions && (
        <GlobalAlertOverlay 
          options={alertOptions} 
          onClose={hideAlert} 
        />
      )}
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
}
