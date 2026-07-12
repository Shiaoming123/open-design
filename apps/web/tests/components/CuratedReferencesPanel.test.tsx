// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchCuratedReference, recommendCuratedReferences, searchCuratedReferences } = vi.hoisted(() => ({
  fetchCuratedReference: vi.fn(),
  recommendCuratedReferences: vi.fn(),
  searchCuratedReferences: vi.fn(),
}));
vi.mock('../../src/providers/registry', () => ({
  fetchCuratedReference,
  recommendCuratedReferences,
  searchCuratedReferences,
}));
import { CuratedReferencesPanel } from '../../src/components/CuratedReferencesPanel';

const hit = { id:'poster:one', kind:'case-study', libraryId:'poster', status:'accepted', title:'Swiss Poster', snippet:'Grid-led launch poster', tags:['grid'], roles:['reference'], sourcePath:'poster/one.json', score:20, matchedFields:['title','tags'] };

function search(query = 'poster') {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CuratedReferencesPanel', () => {
  it('shows loading while a search is pending', async () => {
    searchCuratedReferences.mockReturnValue(new Promise(() => {}));
    render(<CuratedReferencesPanel />);
    search();
    expect(await screen.findByRole('button', { name: 'Searching…' })).toBeDisabled();
  });

  it('surfaces provider errors', async () => {
    searchCuratedReferences.mockRejectedValue(new Error('References unavailable'));
    render(<CuratedReferencesPanel />);
    search();
    expect(await screen.findByRole('alert')).toHaveTextContent('References unavailable');
  });

  it('shows an empty result state', async () => {
    searchCuratedReferences.mockResolvedValue({ query: 'poster', results: [], total: 0 });
    render(<CuratedReferencesPanel />);
    search();
    expect(await screen.findByText('No accepted references matched.')).toBeInTheDocument();
  });

  it('renders compact result evidence', async () => {
    searchCuratedReferences.mockResolvedValue({ query: 'poster', total: 1, results: [hit] });
    render(<CuratedReferencesPanel />);
    search();
    expect(await screen.findByRole('heading', { name: 'Swiss Poster' })).toBeInTheDocument();
    expect(screen.getByText('Matched: title, tags')).toBeInTheDocument();
    await waitFor(() => expect(searchCuratedReferences).toHaveBeenCalledWith({ query: 'poster' }));
  });

  it('offers recommendations through the shared recommendation API', async () => {
    recommendCuratedReferences.mockResolvedValue({ profile: { goal: 'poster' }, total: 1, results: [hit] });
    render(<CuratedReferencesPanel />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'poster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recommend' }));
    expect(await screen.findByRole('heading', { name: 'Swiss Poster' })).toBeInTheDocument();
    expect(recommendCuratedReferences).toHaveBeenCalledWith({ profile: { goal: 'poster' } });
  });

  it('opens result detail through the shared detail API', async () => {
    searchCuratedReferences.mockResolvedValue({ query: 'poster', total: 1, results: [hit] });
    fetchCuratedReference.mockResolvedValue({ reference: { ...hit, score: 0, matchedFields: [] } });
    render(<CuratedReferencesPanel />);
    search();
    fireEvent.click(await screen.findByRole('button', { name: 'Details for Swiss Poster' }));
    expect(await screen.findByRole('region', { name: 'Reference detail' })).toHaveTextContent('poster/one.json');
    expect(fetchCuratedReference).toHaveBeenCalledWith('poster:one');
  });
});
