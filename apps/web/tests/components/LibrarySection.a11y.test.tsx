// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';

vi.mock('../../src/components/plugins-home/useInView', () => ({
  useInView: () => ({ ref: { current: null }, inView: false }),
}));

const fetchLibraryAssets = vi.fn(async (): Promise<LibraryAsset[]> => []);
const fetchLibraryAsset = vi.fn(async (): Promise<LibraryAsset | null> => null);
vi.mock('../../src/providers/registry', () => ({
  fetchLibraryAssets: (...args: unknown[]) => fetchLibraryAssets(...(args as [])),
  fetchLibraryAsset: (...args: unknown[]) => fetchLibraryAsset(...(args as [])),
  libraryAssetRawUrl: (id: string) => `/raw/${id}`,
  applyLibraryAsset: vi.fn(),
  deleteLibraryAsset: vi.fn(),
  editLibraryAssetAsPage: vi.fn(),
  fetchDesignSystem: vi.fn(),
  fetchDesignSystems: vi.fn(async () => []),
  fetchLibraryAssetAsFile: vi.fn(),
  fetchLibraryCollections: vi.fn(async () => []),
  createLibraryCollection: vi.fn(),
  applyLibraryBatch: vi.fn(),
  updateLibraryAssetMetadata: vi.fn(),
}));

import { LibrarySection } from '../../src/components/LibrarySection';

function makeAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  const now = 1_700_000_000_000;
  return {
    id: over.id ?? 'asset-1',
    kind: 'image',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-01-01',
    contentHash: `hash-${over.id ?? 'asset-1'}`,
    favorite: false,
    collectionIds: [],
    tags: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
    sourceTitle: 'A photo',
    ...over,
  };
}

describe('LibrarySection accessibility', () => {
  beforeEach(() => {
    fetchLibraryAssets.mockReset().mockResolvedValue([makeAsset()]);
    fetchLibraryAsset.mockReset().mockResolvedValue(null);
    (globalThis as { EventSource?: unknown }).EventSource = class {
      addEventListener() {}
      close() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('gives the library filter selects accessible names', async () => {
    render(<LibrarySection active onOpenProject={() => {}} />);

    await screen.findAllByText('A photo');

    expect(screen.getByRole('combobox', { name: 'Filter by kind' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by source' })).toBeTruthy();
  });

  it('renders the Resources workbench with a persistent preview inspector', async () => {
    render(<LibrarySection active onOpenProject={() => {}} />);

    await screen.findAllByText('A photo');

    expect(screen.getByRole('complementary', { name: 'Resource filters' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Resource results' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Preview inspector' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'A photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'List' })).toBeTruthy();
  });

  it('wires result count, stable sorting, and removable filter facets into the workbench', async () => {
    fetchLibraryAssets.mockResolvedValue([
      makeAsset({ id: 'alpha', sourceTitle: 'Alpha', createdAt: 10, capturedAt: 10 }),
      makeAsset({ id: 'beta', sourceTitle: 'Beta', createdAt: 20, capturedAt: 20 }),
    ]);
    render(<LibrarySection active onOpenProject={() => {}} />);

    await screen.findByText('2 resources');
    expect(screen.getAllByRole('button', { name: /Preview (Alpha|Beta)/ }).map((button) => button.getAttribute('aria-label')))
      .toEqual(['Preview Beta', 'Preview Alpha']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort resources' }), { target: { value: 'title' } });
    expect(screen.getAllByRole('button', { name: /Preview (Alpha|Beta)/ }).map((button) => button.getAttribute('aria-label')))
      .toEqual(['Preview Alpha', 'Preview Beta']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by kind' }), { target: { value: 'image' } });
    const remove = await screen.findByRole('button', { name: 'Remove filter: Images' });
    fireEvent.click(remove);
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Filter by kind' }) as HTMLSelectElement).value).toBe(''));
  });
});
