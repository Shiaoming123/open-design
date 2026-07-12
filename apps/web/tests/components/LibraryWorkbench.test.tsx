// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';

import { LibraryInspector } from '../../src/components/LibraryInspector';
import { LibraryWorkbenchLayout } from '../../src/components/LibraryWorkbenchLayout';
import { LibraryResourceSidebar } from '../../src/components/LibraryResourceSidebar';

function makeAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  const now = 1_700_000_000_000;
  return {
    id: 'asset-1',
    kind: 'image',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-01-01',
    contentHash: 'hash-1',
    favorite: false,
    collectionIds: [],
    tags: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
    sourceTitle: 'Reference image',
    ...over,
  };
}

afterEach(cleanup);

describe('Resources workbench', () => {
  it('exposes the filters, result workspace, and preview inspector as three named regions', () => {
    render(
      <LibraryWorkbenchLayout
        sidebar={<p>All resources</p>}
        inspector={<p>Preview content</p>}
      >
        <p>Result grid</p>
      </LibraryWorkbenchLayout>,
    );

    expect(screen.getByRole('complementary', { name: 'Resource filters' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Resource results' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Preview inspector' })).toBeTruthy();
  });

  it('provides explicit mobile controls for the filter and inspector drawers', () => {
    render(
      <LibraryWorkbenchLayout sidebar={<p>Filters</p>} inspector={<p>Inspector</p>}>
        <p>Results</p>
      </LibraryWorkbenchLayout>,
    );

    const filters = screen.getByRole('button', { name: 'Show filters' });
    const inspector = screen.getByRole('button', { name: 'Show preview inspector' });
    fireEvent.click(filters);
    expect(filters.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(inspector);
    expect(filters.getAttribute('aria-expanded')).toBe('false');
    expect(inspector.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close preview inspector' }));
    expect(inspector.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps external references as links when no local preview exists', () => {
    render(
      <LibraryInspector
        asset={makeAsset({ storage: 'referenced', sourceUrl: 'https://example.com/case-study' })}
        hasPrev={false}
        hasNext={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onOpenFullscreen={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );

    expect(screen.getByText('Preview not captured')).toBeTruthy();
    const source = screen.getByRole('link', { name: 'Open source' });
    expect(source.getAttribute('href')).toBe('https://example.com/case-study');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('provides adjacent navigation and fullscreen preview for a local asset', () => {
    const onNext = vi.fn();
    const onOpenFullscreen = vi.fn();
    render(
      <LibraryInspector
        asset={makeAsset()}
        hasPrev={false}
        hasNext
        onPrev={vi.fn()}
        onNext={onNext}
        onOpenFullscreen={onOpenFullscreen}
        onOpenProject={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: 'Reference image' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next resource' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open fullscreen preview' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onOpenFullscreen).toHaveBeenCalledOnce();
  });

  it('edits metadata, favorite state, and flat collection membership from the inspector', () => {
    const onUpdateMetadata = vi.fn();
    const onToggleCollection = vi.fn();
    render(
      <LibraryInspector
        asset={makeAsset()}
        hasPrev={false}
        hasNext={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onOpenFullscreen={vi.fn()}
        onOpenProject={vi.fn()}
        collections={[{ id: 'c1', name: 'Editorial', assetCount: 0, createdAt: 1, updatedAt: 1 }]}
        onUpdateMetadata={onUpdateMetadata}
        onToggleCollection={onToggleCollection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Hero reference' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Use the spacing rhythm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Editorial' }));

    expect(onUpdateMetadata).toHaveBeenCalledWith({ favorite: true });
    expect(onUpdateMetadata).toHaveBeenCalledWith({ displayName: 'Hero reference', note: 'Use the spacing rhythm' });
    expect(onToggleCollection).toHaveBeenCalledWith('c1', true);
  });

  it('makes favorites, unsorted, and collections real filter destinations', () => {
    const onViewChange = vi.fn();
    const onCollectionChange = vi.fn();
    render(
      <LibraryResourceSidebar
        assets={[makeAsset({ favorite: true })]}
        kind=""
        source=""
        view="all"
        collectionId=""
        collections={[{ id: 'c1', name: 'Editorial', assetCount: 1, createdAt: 1, updatedAt: 1 }]}
        onKindChange={vi.fn()}
        onSourceChange={vi.fn()}
        onViewChange={onViewChange}
        onCollectionChange={onCollectionChange}
        onCreateCollection={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Favorites/ }));
    fireEvent.click(screen.getByRole('button', { name: /Unsorted/ }));
    fireEvent.click(screen.getByRole('button', { name: /Editorial/ }));
    expect(onViewChange).toHaveBeenNthCalledWith(1, 'favorites');
    expect(onViewChange).toHaveBeenNthCalledWith(2, 'unsorted');
    expect(onCollectionChange).toHaveBeenCalledWith('c1');
  });
});
