import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { LibraryAsset } from '@open-design/contracts';

interface LibrarySelection {
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  toggleOne: (id: string, index: number) => void;
  rangeTo: (index: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
}

/** Selection state whose range semantics follow the currently rendered order. */
export function useLibrarySelection(visibleAssets: LibraryAsset[]): LibrarySelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<number | null>(null);

  const toggleOne = useCallback((id: string, index: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = index;
  }, []);

  const rangeTo = useCallback((index: number) => {
    const anchor = anchorRef.current ?? index;
    const lower = Math.min(anchor, index);
    const upper = Math.max(anchor, index);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (let cursor = lower; cursor <= upper; cursor += 1) {
        const asset = visibleAssets[cursor];
        if (asset) next.add(asset.id);
      }
      return next;
    });
  }, [visibleAssets]);

  const selectAll = useCallback(
    () => setSelectedIds(new Set(visibleAssets.map((asset) => asset.id))),
    [visibleAssets],
  );
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, setSelectedIds, toggleOne, rangeTo, selectAll, clearSelection };
}
