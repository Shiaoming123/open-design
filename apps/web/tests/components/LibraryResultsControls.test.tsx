// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';

import {
  LibraryResultsControls,
  downloadLibraryAssets,
  sortLibraryAssets,
} from '../../src/components/LibraryResultsControls';

function asset(id: string, createdAt: number, sourceTitle: string, kind: LibraryAsset['kind'] = 'image'): LibraryAsset {
  return {
    id,
    kind,
    storage: 'owned',
    capturedAt: createdAt,
    archivedDate: '2024-01-01',
    contentHash: `hash-${id}`,
    favorite: false,
    collectionIds: [],
    tags: [],
    sources: [],
    createdAt,
    updatedAt: createdAt,
    sourceTitle,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Resources result controls', () => {
  it('sorts deterministically with id tie-breaks', () => {
    const assets = [asset('b', 20, 'Beta'), asset('a', 20, 'Alpha'), asset('c', 10, 'Alpha', 'video')];

    expect(sortLibraryAssets(assets, 'newest').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortLibraryAssets(assets, 'oldest').map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(sortLibraryAssets(assets, 'title').map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(sortLibraryAssets(assets, 'kind').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(assets.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('shows the result count, changes sorting, and removes one facet at a time', () => {
    const onSortChange = vi.fn();
    const removeKind = vi.fn();
    render(
      <LibraryResultsControls
        resultCount={27}
        sort="newest"
        onSortChange={onSortChange}
        facets={[{ id: 'kind', label: 'Images', onRemove: removeKind }]}
        selectedCount={0}
        exportBusy={false}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByText('27 resources')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort resources' }), { target: { value: 'title' } });
    expect(onSortChange).toHaveBeenCalledWith('title');
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Images' }));
    expect(removeKind).toHaveBeenCalledOnce();
  });

  it('exports fetched files with safe names and revokes every object URL', async () => {
    const clicked: string[] = [];
    const revoked: string[] = [];
    let sequence = 0;
    vi.stubGlobal('URL', {
      createObjectURL: () => `blob:${++sequence}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'a') return createElement(tag);
      const anchor = { href: '', download: '', click: () => clicked.push(anchor.download) };
      return anchor as unknown as HTMLAnchorElement;
    }) as typeof document.createElement);

    const result = await downloadLibraryAssets(
      [asset('a', 1, 'One'), asset('b', 2, 'Two')],
      async (item) => {
        if (item.id === 'a') return new File(['one'], '../safe-one.png', { type: 'image/png' });
        throw new Error('raw fetch failed');
      },
    );

    expect(result).toEqual({ downloaded: 1, failed: 1 });
    expect(clicked).toEqual(['safe-one.png']);
    expect(revoked).toEqual(['blob:1']);
  });
});
