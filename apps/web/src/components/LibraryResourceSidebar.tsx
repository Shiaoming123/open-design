import { useState } from 'react';
import type { LibraryAsset, LibraryCollection } from '@open-design/contracts';
import { Button, Input } from '@open-design/components';

import { Icon } from './Icon';
import { badgeKind, primarySource, type BadgeKind } from './LibraryAssetMeta';
import styles from './LibraryResourceSidebar.module.css';
import { useT } from '../i18n';

interface Props {
  assets: LibraryAsset[];
  kind: string;
  source: string;
  onKindChange: (kind: string) => void;
  onSourceChange: (source: string) => void;
  view: 'all' | 'favorites' | 'unsorted';
  collectionId: string;
  collections: LibraryCollection[];
  onViewChange: (view: 'all' | 'favorites' | 'unsorted') => void;
  onCollectionChange: (collectionId: string) => void;
  onCreateCollection: (name: string) => void;
}

const kinds: BadgeKind[] = ['image', 'element', 'design-system', 'video', 'html', 'font', 'color', 'text', 'url'];
const sources = [
  ['clipper', 'resources.sourceClipper'],
  ['manual-upload', 'resources.sourceUpload'],
  ['agent-task', 'resources.sourceAgent'],
  ['design-system', 'resources.sourceDesignSystem'],
  ['generated', 'resources.sourceGenerated'],
] as const;

const kindKeys: Record<BadgeKind, 'resources.kindImage' | 'resources.kindElement' | 'resources.kindDesignSystem' | 'resources.kindVideo' | 'resources.kindHtml' | 'resources.kindFont' | 'resources.kindColor' | 'resources.kindText' | 'resources.kindUrl'> = {
  image: 'resources.kindImage',
  element: 'resources.kindElement',
  'design-system': 'resources.kindDesignSystem',
  video: 'resources.kindVideo',
  html: 'resources.kindHtml',
  font: 'resources.kindFont',
  color: 'resources.kindColor',
  text: 'resources.kindText',
  url: 'resources.kindUrl',
};

/** Compact filter rail. Collection rows are supplied by the API in a follow-up state hook. */
export function LibraryResourceSidebar({
  assets,
  kind,
  source,
  onKindChange,
  onSourceChange,
  view,
  collectionId,
  collections,
  onViewChange,
  onCollectionChange,
  onCreateCollection,
}: Props) {
  const [newCollection, setNewCollection] = useState('');
  const t = useT();
  const kindCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const asset of assets) {
    const k = badgeKind(asset);
    kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
    const src = primarySource(asset);
    if (src) sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
  }

  return (
    <nav className={styles.root} aria-label="Resource views">
      <div className={styles.brand}>
        <span className={styles.eyebrow}>{t('resources.workspace')}</span>
        <strong>{t('resources.title')}</strong>
      </div>
      <div className={styles.group}>
        <button type="button" data-active={view === 'all' && !collectionId && !kind && !source} onClick={() => { onViewChange('all'); onCollectionChange(''); onKindChange(''); onSourceChange(''); }}>
          <Icon name="layers-filled" size={15} /><span>{t('resources.all')}</span><small>{assets.length}</small>
        </button>
        <button type="button" data-active={view === 'favorites'} onClick={() => { onViewChange('favorites'); onCollectionChange(''); }}>
          <Icon name="star" size={15} /><span>{t('resources.favorites')}</span><small>{assets.filter((asset) => asset.favorite).length}</small>
        </button>
        <button type="button" data-active={view === 'unsorted'} onClick={() => { onViewChange('unsorted'); onCollectionChange(''); }}>
          <Icon name="folder" size={15} /><span>{t('resources.unsorted')}</span><small>{assets.filter((asset) => !asset.collectionIds.length).length}</small>
        </button>
      </div>
      <div className={styles.group}>
        <h2>{t('resources.types')}</h2>
        {kinds.filter((value) => kindCounts.has(value)).map((value) => (
          <button key={value} type="button" data-active={kind === value} onClick={() => onKindChange(kind === value ? '' : value)}>
            <span>{t(kindKeys[value])}</span><small>{kindCounts.get(value)}</small>
          </button>
        ))}
      </div>
      <div className={styles.group}>
        <h2>{t('resources.sources')}</h2>
        {sources.filter(([value]) => sourceCounts.has(value)).map(([value, labelKey]) => (
          <button key={value} type="button" data-active={source === value} onClick={() => onSourceChange(source === value ? '' : value)}>
            <span>{t(labelKey)}</span><small>{sourceCounts.get(value)}</small>
          </button>
        ))}
      </div>
      <div className={styles.group}>
        <h2>{t('resources.collections')}</h2>
        {collections.map((collection) => (
          <button key={collection.id} type="button" data-active={collectionId === collection.id} onClick={() => { onCollectionChange(collection.id); onViewChange('all'); }}>
            <Icon name="folder" size={14} /><span>{collection.name}</span><small>{collection.assetCount}</small>
          </button>
        ))}
        <form
          className={styles.newCollection}
          onSubmit={(event) => {
            event.preventDefault();
            const name = newCollection.trim();
            if (!name) return;
            onCreateCollection(name);
            setNewCollection('');
          }}
        >
          <Input aria-label={t('resources.newCollectionName')} placeholder={t('resources.newCollection')} value={newCollection} onChange={(event) => setNewCollection(event.target.value)} />
          <Button variant="ghost" size="icon" aria-label={t('resources.createCollection')} disabled={!newCollection.trim()}><Icon name="plus" size={14} /></Button>
        </form>
      </div>
    </nav>
  );
}
