// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';

vi.mock('../../src/components/plugins-home/useInView', () => ({
  useInView: () => ({ ref: { current: null }, inView: false }),
}));

const fetchLibraryAssets = vi.fn(async (): Promise<LibraryAsset[]> => []);
const fetchLibraryAsset = vi.fn(async (): Promise<LibraryAsset | null> => null);
const { deleteLibraryAsset, editLibraryAssetAsPage } = vi.hoisted(() => ({
  deleteLibraryAsset: vi.fn(async () => true),
  editLibraryAssetAsPage: vi.fn(),
}));
vi.mock('../../src/providers/registry', () => ({
  fetchLibraryAssets: (...args: unknown[]) => fetchLibraryAssets(...(args as [])),
  fetchLibraryAsset: (...args: unknown[]) => fetchLibraryAsset(...(args as [])),
  libraryAssetRawUrl: (id: string) => `/raw/${id}`,
  applyLibraryAsset: vi.fn(),
  deleteLibraryAsset,
  editLibraryAssetAsPage,
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

  it('keeps the preview inspector empty until the user activates a resource', async () => {
    render(<LibrarySection active onOpenProject={() => {}} />);

    await screen.findAllByText('A photo');

    expect(screen.getByRole('complementary', { name: 'Resource filters' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Resource results' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Preview inspector' })).toBeTruthy();
    expect(screen.getByText('Select a resource')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'A photo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'List' })).toBeTruthy();
  });

  it('marks the activated card independently from batch selection', async () => {
    fetchLibraryAssets.mockResolvedValue([
      makeAsset({ id: 'alpha', sourceTitle: 'Alpha' }),
      makeAsset({ id: 'beta', sourceTitle: 'Beta' }),
    ]);
    render(<LibrarySection active onOpenProject={() => {}} />);

    const alpha = await screen.findByRole('button', { name: 'Preview Alpha' });
    const beta = screen.getByRole('button', { name: 'Preview Beta' });
    fireEvent.click(alpha);
    expect(alpha.closest('[data-asset-card]')?.getAttribute('data-active')).toBe('true');

    fireEvent.click(beta, { ctrlKey: true });
    expect(beta.closest('[data-asset-card]')?.getAttribute('data-selected')).toBe('true');
    expect(alpha.closest('[data-asset-card]')?.getAttribute('data-active')).toBe('true');
  });

  it('uses a stable field table for list view and an intake-history landmark for timeline', async () => {
    render(<LibrarySection active onOpenProject={() => {}} />);
    await screen.findAllByText('A photo');

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('table', { name: 'Resource directory' })).toBeTruthy();
    for (const heading of ['Name', 'Type', 'Source', 'Captured', 'Size']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByRole('feed', { name: 'Intake history' })).toBeTruthy();
  });

  it('keeps direct resource actions available in list view', async () => {
    const onOpenProject = vi.fn();
    fetchLibraryAssets.mockResolvedValue([
      makeAsset({ id: 'project', sourceTitle: 'Project asset', originProjectId: 'project-1', relPath: 'cover.png' }),
      makeAsset({ id: 'page', kind: 'html', sourceTitle: 'Captured page', sourceUrl: 'https://example.com/page' }),
    ]);
    render(<LibrarySection active onOpenProject={onOpenProject} />);
    await screen.findByText('2 resources');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open project for Project asset' }));
    expect(onOpenProject).toHaveBeenCalledWith('project-1', 'cover.png');
    expect(screen.getByRole('link', { name: 'Source for Captured page' }).getAttribute('href')).toBe('https://example.com/page');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Captured page as page' }));
    expect(editLibraryAssetAsPage).toHaveBeenCalledWith('page');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Project asset' }));
    expect(deleteLibraryAsset).toHaveBeenCalledWith('project');
  });

  it('clears batch selection when filters change so the bar and inspector cannot drift', async () => {
    fetchLibraryAssets.mockResolvedValue([
      makeAsset({ id: 'alpha', sourceTitle: 'Alpha' }),
      makeAsset({ id: 'beta', sourceTitle: 'Beta' }),
    ]);
    render(<LibrarySection active onOpenProject={() => {}} />);
    const checks = await screen.findAllByRole('button', { name: 'Select asset' });
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByText('2 resources selected')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by kind' }), { target: { value: 'image' } });
    await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull());
    expect(screen.queryByText('2 resources selected')).toBeNull();
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
