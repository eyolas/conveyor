import { useCallback, useState } from 'preact/hooks';

const STORAGE_KEY = 'conveyor:live-updates';

function readStored(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

/** Global live-updates state, persisted in localStorage. */
export function useLiveUpdates() {
  const [enabled, setEnabled] = useState(readStored);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  return { liveUpdates: enabled, toggleLiveUpdates: toggle };
}
