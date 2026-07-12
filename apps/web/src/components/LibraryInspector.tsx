import { useEffect, useState } from 'react';
import type { LibraryAsset, LibraryAssetMetadataPatch, LibraryCollection } from '@open-design/contracts';
import { Button, Input, Textarea } from '@open-design/components';

import { Icon } from './Icon';
import {
  assetTitle,
  badgeKind,
  formatBytes,
  formatDate,
  kindLabel,
  originProjectId,
} from './LibraryAssetMeta';
import styles from './LibraryInspector.module.css';
import { useT } from '../i18n';
import { LibraryPreviewStage } from './LibraryPreviewStage';

interface Props {
  asset: LibraryAsset | null;
  selection?: LibraryAsset[];
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onOpenFullscreen: () => void;
  onOpenProject: (projectId: string, fileName?: string) => void;
  onUseInDesign?: (asset: LibraryAsset) => void;
  collections?: LibraryCollection[];
  onUpdateMetadata?: (patch: LibraryAssetMetadataPatch) => void;
  onToggleCollection?: (collectionId: string, add: boolean) => void;
}

function hasLocalPreview(asset: LibraryAsset): boolean {
  return asset.storage === 'owned';
}


/** Persistent, selection-driven preview and metadata pane. */
export function LibraryInspector({
  asset,
  selection = [],
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onOpenFullscreen,
  onOpenProject,
  onUseInDesign,
  collections = [],
  onUpdateMetadata,
  onToggleCollection,
}: Props) {
  const t = useT();
  const [displayName, setDisplayName] = useState(asset?.displayName ?? '');
  const [note, setNote] = useState(asset?.note ?? '');
  useEffect(() => {
    setDisplayName(asset?.displayName ?? '');
    setNote(asset?.note ?? '');
  }, [asset?.id, asset?.displayName, asset?.note]);

  if (selection.length > 1) {
    const counts = new Map<string, number>();
    for (const selected of selection) {
      const label = kindLabel(badgeKind(selected));
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return (
      <div className={styles.selectionSummary}>
        <Icon name="layers-filled" size={24} />
        <div>
          <strong>{selection.length} resources selected</strong>
          <span>Batch actions apply to this selection. Preview remains tied to the active resource.</span>
        </div>
        <dl>
          {[...counts].map(([label, count]) => (
            <div key={label}><dt>{label}</dt><dd>{count}</dd></div>
          ))}
        </dl>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className={styles.empty}>
        <Icon name="eye" size={22} />
        <strong>{t('resources.selectPrompt')}</strong>
        <span>{t('resources.selectPromptDetail')}</span>
      </div>
    );
  }

  const title = assetTitle(asset);
  const projectId = originProjectId(asset);
  const dimensions = asset.width && asset.height ? `${asset.width}×${asset.height}` : null;

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div className={styles.heading}>
          <span>{kindLabel(badgeKind(asset))}</span>
          <h2 title={title}>{title}</h2>
        </div>
        <div className={styles.headActions}>
          {onUpdateMetadata ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={asset.favorite ? t('resources.favoriteRemove') : t('resources.favoriteAdd')}
              onClick={() => onUpdateMetadata({ favorite: !asset.favorite })}
            >
              <Icon name="star" size={16} />
            </Button>
          ) : null}
          {hasLocalPreview(asset) ? (
            <Button variant="ghost" size="icon" aria-label={t('resources.fullscreen')} onClick={onOpenFullscreen}>
              <Icon name="maximize" size={16} />
            </Button>
          ) : null}
        </div>
      </header>

      <div className={styles.stage}>
        <LibraryPreviewStage asset={asset} />
        <div className={styles.navigation}>
          <Button variant="ghost" size="icon" aria-label={t('resources.previous')} disabled={!hasPrev} onClick={onPrev}>
            <Icon name="chevron-left" size={17} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('resources.next')} disabled={!hasNext} onClick={onNext}>
            <Icon name="chevron-right" size={17} />
          </Button>
        </div>
      </div>

      <dl className={styles.facts}>
        {dimensions ? <><dt>{t('resources.dimensions')}</dt><dd>{dimensions}</dd></> : null}
        {asset.size ? <><dt>{t('resources.size')}</dt><dd>{formatBytes(asset.size)}</dd></> : null}
        <dt>{t('resources.captured')}</dt><dd>{formatDate(asset.capturedAt)}</dd>
        <dt>{t('resources.storage')}</dt><dd>{asset.storage === 'owned' ? t('resources.storageLocal') : t('resources.storageReference')}</dd>
        {asset.tags.length ? <><dt>{t('resources.tags')}</dt><dd>{asset.tags.join(', ')}</dd></> : null}
      </dl>

      {onUpdateMetadata ? (
        <div className={styles.editor}>
          <label>
            <span>{t('resources.displayName')}</span>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            <span>{t('resources.notes')}</span>
            <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <Button variant="ghost" onClick={() => onUpdateMetadata({ displayName, note })}>{t('resources.saveDetails')}</Button>
        </div>
      ) : null}

      {collections.length && onToggleCollection ? (
        <fieldset className={styles.collections}>
          <legend>{t('resources.collections')}</legend>
          {collections.map((collection) => {
            const checked = asset.collectionIds.includes(collection.id);
            return (
              <label key={collection.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggleCollection(collection.id, event.target.checked)}
                />
                <span>{collection.name}</span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      <div className={styles.actions}>
        {onUseInDesign && hasLocalPreview(asset) ? (
          <Button onClick={() => onUseInDesign(asset)}>{t('resources.useInDesign')}</Button>
        ) : null}
        {projectId ? (
          <Button variant="ghost" onClick={() => onOpenProject(projectId, asset.relPath)}>{t('resources.openProject')}</Button>
        ) : null}
        {asset.sourceUrl ? (
          <a className={styles.source} href={asset.sourceUrl} target="_blank" rel="noreferrer">
            {t('resources.openSource')} <Icon name="external-link" size={13} />
          </a>
        ) : null}
      </div>
    </div>
  );
}
