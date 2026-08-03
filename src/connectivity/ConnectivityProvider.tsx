import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ConnectivityContextValue {
  isOnline: boolean;
}

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

// isInternetReachable is nullable (unknown yet, e.g. right at startup) —
// treated as reachable rather than offline, so a brand-new app launch
// doesn't flash an incorrect offline banner before NetInfo's first real
// reading arrives.
function isOnlineFromState(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

export interface ConnectivityProviderProps {
  children: ReactNode;
  // Fires on the offline -> online transition only, not on every "online"
  // event NetInfo reports — the natural place to trigger a resync
  // (execution-plan.md's "connectivity states" / incremental sync).
  onReconnect?: () => void;
}

export function ConnectivityProvider({ children, onReconnect }: ConnectivityProviderProps) {
  const [isOnline, setIsOnline] = useState(true);
  const wasOnlineRef = useRef(true);
  const onReconnectRef = useRef(onReconnect);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const nowOnline = isOnlineFromState(state);
      if (nowOnline && !wasOnlineRef.current) {
        onReconnectRef.current?.();
      }
      wasOnlineRef.current = nowOnline;
      setIsOnline(nowOnline);
    });
    return unsubscribe;
  }, []);

  return (
    <ConnectivityContext.Provider value={{ isOnline }}>{children}</ConnectivityContext.Provider>
  );
}

export function useConnectivity(): ConnectivityContextValue {
  const context = useContext(ConnectivityContext);
  if (!context) {
    throw new Error('useConnectivity must be used within a ConnectivityProvider');
  }
  return context;
}
