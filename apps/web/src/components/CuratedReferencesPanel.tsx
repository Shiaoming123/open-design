import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CuratedReferenceHit } from '@open-design/contracts';
import { fetchCuratedReference, recommendCuratedReferences, searchCuratedReferences } from '../providers/registry';
import styles from './CuratedReferencesPanel.module.css';

export function CuratedReferencesPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CuratedReferenceHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<CuratedReferenceHit | null>(null);

  const run = async (mode: 'search' | 'recommend') => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setDetail(null);
    try {
      const response = mode === 'search'
        ? await searchCuratedReferences({ query: query.trim() })
        : await recommendCuratedReferences({ profile: { goal: query.trim() } });
      setResults(response.results);
    } catch (caught) {
      setResults([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await run('search');
  };

  const showDetail = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      setDetail((await fetchCuratedReference(id))?.reference ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.root} aria-label="Curated references">
      <div className={styles.intro}>
        <div>
          <h2>Curated references</h2>
          <p>Search the private, accepted case library without mixing it into runtime uploads.</p>
        </div>
        <span>Top 8 · deterministic</span>
      </div>
      <form className={styles.search} onSubmit={submit}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try: editorial launch poster"
          aria-label="Search curated references"
        />
        <button type="submit" disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button type="button" disabled={loading || !query.trim()} onClick={() => void run('recommend')}>
          Recommend
        </button>
      </form>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.grid}>
        {results.map((hit) => (
          <article key={hit.id} className={styles.card}>
            <div className={styles.meta}><span>{hit.libraryId}</span><span>{hit.score}</span></div>
            <h3>{hit.title}</h3>
            <p>{hit.snippet}</p>
            <div className={styles.tags}>
              {hit.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <small>Matched: {hit.matchedFields.join(', ') || 'profile diversity'}</small>
            <button type="button" aria-label={`Details for ${hit.title}`} onClick={() => void showDetail(hit.id)}>Details</button>
          </article>
        ))}
      </div>
      {detail ? (
        <section className={styles.card} role="region" aria-label="Reference detail">
          <h3>{detail.title}</h3>
          <p>{detail.snippet}</p>
          {detail.sourcePath ? <small>{detail.sourcePath}</small> : null}
          {detail.previewPath ? <small>{detail.previewPath}</small> : null}
        </section>
      ) : null}
      {!loading && !error && query && results.length === 0
        ? <p className={styles.empty}>No accepted references matched.</p>
        : null}
    </section>
  );
}
