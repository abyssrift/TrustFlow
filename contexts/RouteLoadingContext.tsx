import React, { createContext, useCallback, useContext } from 'react';

const RouteLoadingContext = createContext<{ suppressNext: () => void }>({ suppressNext: () => {} });

export function RouteLoadingProvider({
  children,
  suppressRef,
}: {
  children: React.ReactNode;
  suppressRef: React.MutableRefObject<boolean>;
}) {
  const suppressNext = useCallback(() => {
    suppressRef.current = true;
  }, [suppressRef]);

  return (
    <RouteLoadingContext.Provider value={{ suppressNext }}>
      {children}
    </RouteLoadingContext.Provider>
  );
}

export const useSuppressRouteLoading = () => useContext(RouteLoadingContext);
