import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export interface LiveUpdatesContextValue {
  liveUpdates: boolean;
  toggleLiveUpdates: () => void;
  refresh: () => void;
  onRefresh: (cb: () => void) => void;
}

export const LiveUpdatesContext = createContext<LiveUpdatesContextValue>({
  liveUpdates: true,
  toggleLiveUpdates: () => {},
  refresh: () => {},
  onRefresh: () => {},
});

export function useLiveUpdatesContext() {
  return useContext(LiveUpdatesContext);
}
