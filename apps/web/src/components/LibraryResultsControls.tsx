import type { LibraryAsset } from '@open-design/contracts';
import { Button } from '@open-design/components';

import { useT } from '../i18n';
import { fetchLibraryAssetAsFile } from '../providers/registry';
import { assetTitle, badgeKind } from './LibraryAssetMeta';
import { Icon } from './Icon';
import styles from './LibraryResultsControls.module.css';

export type LibrarySort = 'newest' | 'oldest' | 'title' | 'kind';

export interface LibraryFacet {
  id: string;
  label: string;
  onRemove: () => void;
}

interface Props {
  resultCount: number;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  facets: LibraryFacet[];
  selectedCount: number;
  exportBusy: boolean;
  onExport: () => void;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

/** Sort a copy and use the immutable asset id as the final deterministic tie-break. */
export function sortLibraryAssets(assets: LibraryAsset[], sort: LibrarySort): LibraryAsset[] {
  return [...assets].sort((left, right) => {
    let compared = 0;
    if (sort === 'newest') compared = right.createdAt - left.createdAt;
    else if (sort === 'oldest') compared = left.createdAt - right.createdAt;
    else if (sort === 'title') compared = compareText(assetTitle(left), assetTitle(right));
    else compared = compareText(badgeKind(left), badgeKind(right));
    return compared || compareText(left.id, right.id);
  });
}

function safeDownloadName(name: string): string {
  const leaf = name.split(/[\\/]/).pop()?.trim() ?? '';
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) || 'resource';
}

/**
 * Export through the same raw-asset fetch path used by Library hand-offs, then
 * release each temporary object URL immediately after the browser receives it.
 */
export async function downloadLibraryAssets(
  assets: LibraryAsset[],
  fetchFile: (asset: LibraryAsset) => Promise<File | null> = fetchLibraryAssetAsFile,
): Promise<{ downloaded: number; failed: number }> {
  let downloaded = 0;
  let failed = 0;
  // Keep peak memory bounded for large selections: fetch, hand off, and release
  // one resource before requesting the next.
  for (const asset of assets) {
    let file: File | null;
    try {
      file = await fetchFile(asset);
    } catch {
      failed += 1;
      continue;
    }
    if (!file) {
      failed += 1;
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeDownloadName(file.name);
      anchor.click();
      downloaded += 1;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { downloaded, failed };
}

/** Result metadata, deterministic sorting, removable facets, and safe export. */
export function LibraryResultsControls({
  resultCount,
  sort,
  onSortChange,
  facets,
  selectedCount,
  exportBusy,
  onExport,
}: Props) {
  const t = useT();
  return (
    <div className={styles.root}>
      <div className={styles.summary} aria-live="polite">
        {t('resources.resultCount').replace('{count}', String(resultCount))}
      </div>
      {facets.length ? (
        <div className={styles.facets} aria-label={t('resources.activeFilters')}>
          {facets.map((facet) => (
            <Button
              key={facet.id}
              variant="ghost"
              className={styles.facet}
              aria-label={`${t('resources.removeFilter')}: ${facet.label}`}
              onClick={facet.onRemove}
            >
              <span>{facet.label}</span>
              <Icon name="close" size={12} />
            </Button>
          ))}
        </div>
      ) : null}
      <div className={styles.actions}>
        <label className={styles.sort}>
          <span>{t('resources.sort')}</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value as LibrarySort)}>
            <option value="newest">{t('resources.sortNewest')}</option>
            <option value="oldest">{t('resources.sortOldest')}</option>
            <option value="title">{t('resources.sortTitle')}</option>
            <option value="kind">{t('resources.sortKind')}</option>
          </select>
        </label>
        {selectedCount ? (
          <Button variant="ghost" disabled={exportBusy} aria-busy={exportBusy} onClick={onExport}>
            <Icon name="download" size={14} />
            {exportBusy ? t('resources.exportingSelection') : t('resources.exportSelection')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
