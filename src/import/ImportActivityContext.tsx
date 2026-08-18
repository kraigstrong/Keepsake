import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ImportActivityContextValue {
  version: number;
  notifyImportCompleted: () => void;
}

const ImportActivityContext = createContext<ImportActivityContextValue | null>(null);

// A screen (Library) that's already mounted and focused when a
// background import completes (Share Extension drain, outbox retry —
// both fire from app/_layout.tsx's AppState-driven lifecycle, entirely
// independent of whatever screen is on top) has no navigation event to
// react to, so its own focus-triggered refresh never fires. version
// bumping on completion gives it something to react to instead — found
// via live testing, 2026-08-14: a completed import's toast showed with
// the new recipe still missing from Library until navigating away and
// back.
export function ImportActivityProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const notifyImportCompleted = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ version, notifyImportCompleted }),
    [version, notifyImportCompleted],
  );

  return <ImportActivityContext.Provider value={value}>{children}</ImportActivityContext.Provider>;
}

export function useImportActivity(): ImportActivityContextValue {
  const context = useContext(ImportActivityContext);
  if (!context) {
    throw new Error('useImportActivity must be used within an ImportActivityProvider');
  }
  return context;
}
