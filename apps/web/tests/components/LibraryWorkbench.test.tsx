// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';

import { LibraryInspector } from '../../src/components/LibraryInspector';
import { LibraryWorkbenchLayout } from '../../src/components/LibraryWorkbenchLayout';
import { LibraryResourceSidebar } from '../../src/components/LibraryResourceSidebar';
import { LibraryPreviewStage } from '../../src/components/LibraryPreviewStage';

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

  it('uses one reusable preview stage for local HTML without granting same-origin access', () => {
    render(<LibraryPreviewStage asset={makeAsset({ kind: 'html' })} />);
    const frame = screen.getByTitle('Reference image');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('preserves the full color palette and raw-body fallbacks in the shared preview stage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('https://example.com/raw-body'));
    const { rerender } = render(
      <LibraryPreviewStage
        asset={makeAsset({ kind: 'color', palette: ['#112233', '#445566', '#778899'] })}
        variant="full"
      />,
    );
    expect(screen.getByText('#112233')).toBeTruthy();
    expect(screen.getByTitle('#445566')).toBeTruthy();
    expect(screen.getByTitle('#778899')).toBeTruthy();

    rerender(<LibraryPreviewStage asset={makeAsset({ kind: 'url', sourceUrl: undefined })} variant="full" />);
    expect(await screen.findByRole('link', { name: 'https://example.com/raw-body' })).toBeTruthy();
    fetchMock.mockRestore();
  });

  it('preserves the complete font specimen in full preview mode', () => {
    render(<LibraryPreviewStage asset={makeAsset({ kind: 'font' })} variant="full" />);
    expect(screen.getByText('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBeTruthy();
    expect(screen.getByText('abcdefghijklmnopqrstuvwxyz')).toBeTruthy();
    expect(screen.getByText('0123456789 & ! ? @ # $ %')).toBeTruthy();
    expect(screen.getAllByText('The quick brown fox jumps over the lazy dog.')).toHaveLength(2);
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

  it('shows a selection summary instead of previewing an arbitrary selected asset', () => {
    render(
      <LibraryInspector
        asset={makeAsset()}
        selection={[
          makeAsset({ id: 'asset-1', kind: 'image' }),
          makeAsset({ id: 'asset-2', kind: 'html', sourceTitle: 'Captured page' }),
        ]}
        hasPrev={false}
        hasNext={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onOpenFullscreen={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );

    expect(screen.getByText('2 resources selected')).toBeTruthy();
    expect(screen.getByText('Image')).toBeTruthy();
    expect(screen.getByText('HTML')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
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
