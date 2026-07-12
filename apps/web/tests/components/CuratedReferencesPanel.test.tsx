// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { searchCuratedReferences } = vi.hoisted(() => ({ searchCuratedReferences: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ searchCuratedReferences }));
import { CuratedReferencesPanel } from '../../src/components/CuratedReferencesPanel';

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
    searchCuratedReferences.mockResolvedValue({ query: 'poster', total: 1, results: [{ id:'poster:one', kind:'case-study', libraryId:'poster', status:'accepted', title:'Swiss Poster', snippet:'Grid-led launch poster', tags:['grid'], roles:['reference'], score:20, matchedFields:['title','tags'] }] });
    render(<CuratedReferencesPanel />);
    search();
    expect(await screen.findByRole('heading', { name: 'Swiss Poster' })).toBeInTheDocument();
    expect(screen.getByText('Matched: title, tags')).toBeInTheDocument();
    await waitFor(() => expect(searchCuratedReferences).toHaveBeenCalledWith({ query: 'poster' }));
  });
});
