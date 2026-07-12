// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';

import { useLibrarySelection } from '../../src/components/useLibrarySelection';

function asset(id: string): LibraryAsset {
  return {
    id,
    kind: 'image',
    storage: 'owned',
    capturedAt: 1,
    archivedDate: '2024-01-01',
    contentHash: `hash-${id}`,
    favorite: false,
    collectionIds: [],
    tags: [],
    sources: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('useLibrarySelection', () => {
  it('uses the visible stable order for toggle, range, all, and clear operations', () => {
    const visible = [asset('b'), asset('a'), asset('c')];
    const { result } = renderHook(() => useLibrarySelection(visible));

    act(() => result.current.toggleOne('b', 0));
    act(() => result.current.rangeTo(1));
    expect([...result.current.selectedIds]).toEqual(['b', 'a']);

    act(() => result.current.selectAll());
    expect([...result.current.selectedIds]).toEqual(['b', 'a', 'c']);

    act(() => result.current.clearSelection());
    expect(result.current.selectedIds.size).toBe(0);
  });
});
