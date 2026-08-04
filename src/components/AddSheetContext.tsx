import { createContext, useContext, useState, type ReactNode } from 'react';

interface AddSheetContextValue {
  isVisible: boolean;
  open: () => void;
  close: () => void;
}

const AddSheetContext = createContext<AddSheetContextValue | null>(null);

/**
 * Shared open/close state for the global add-recipe Sheet, owned by
 * `(tabs)/_layout.tsx` (which renders the Sheet itself) but triggerable
 * from any screen inside the tabs — e.g. Library's empty-state "Add a
 * recipe" action opens the same Sheet as the header's "Add" button,
 * rather than skipping straight to manual create.
 */
export function AddSheetProvider({ children }: { children: ReactNode }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <AddSheetContext.Provider
      value={{ isVisible, open: () => setIsVisible(true), close: () => setIsVisible(false) }}
    >
      {children}
    </AddSheetContext.Provider>
  );
}

export function useAddSheet(): AddSheetContextValue {
  const context = useContext(AddSheetContext);
  if (!context) {
    throw new Error('useAddSheet must be used within an AddSheetProvider');
  }
  return context;
}
