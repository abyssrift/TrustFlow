import React, { createContext, useCallback, useContext, useState } from 'react';

// pingedTasks maps task_id → timestamp (Date.now()) of when the ping arrived.
// Entries are removed when the user clicks that specific task card.
type PingHighlightContextType = {
  pingedTasks: Map<string, number>;
  addPingedTask: (id: string) => void;
  removePingedTask: (id: string) => void;
  clearPingedTasks: () => void;
};

const PingHighlightContext = createContext<PingHighlightContextType>({
  pingedTasks: new Map(),
  addPingedTask: () => {},
  removePingedTask: () => {},
  clearPingedTasks: () => {},
});

export function PingHighlightProvider({ children }: { children: React.ReactNode }) {
  const [pingedTasks, setPingedTasks] = useState<Map<string, number>>(new Map());

  const addPingedTask = useCallback((id: string) => {
    setPingedTasks(prev => new Map([...prev, [id, Date.now()]]));
  }, []);

  const removePingedTask = useCallback((id: string) => {
    setPingedTasks(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearPingedTasks = useCallback(() => {
    setPingedTasks(new Map());
  }, []);

  return (
    <PingHighlightContext.Provider value={{ pingedTasks, addPingedTask, removePingedTask, clearPingedTasks }}>
      {children}
    </PingHighlightContext.Provider>
  );
}

export const usePingHighlight = () => useContext(PingHighlightContext);
