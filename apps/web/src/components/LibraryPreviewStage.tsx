import { useEffect, useState } from 'react';
import type { LibraryAsset } from '@open-design/contracts';

import { libraryAssetRawUrl } from '../providers/registry';
import { assetTitle, colorOf, fontFamilyFor, kindLabel } from './LibraryAssetMeta';
import { Icon } from './Icon';
import styles from './LibraryPreviewStage.module.css';

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState('Loading…');
  useEffect(() => {
    let cancelled = false;
    void fetch(url).then((response) => response.ok ? response.text() : Promise.reject()).then(
      (value) => { if (!cancelled) setText(value); },
      () => { if (!cancelled) setText('Preview unavailable.'); },
    );
    return () => { cancelled = true; };
  }, [url]);
  return <pre className={styles.text}>{text}</pre>;
}

export function LibraryPreviewStage({ asset, autoplay = false }: { asset: LibraryAsset; autoplay?: boolean }) {
  const title = assetTitle(asset);
  const url = libraryAssetRawUrl(asset.id);
  if (asset.storage !== 'owned') {
    return <div className={styles.unavailable}><Icon name="eye-off" size={22} /><strong>Preview not captured</strong><span>Open the source to view this reference.</span></div>;
  }
  switch (asset.kind) {
    case 'image': return <img className={styles.media} src={url} alt={title} />;
    case 'video': return <video className={styles.media} src={url} controls autoPlay={autoplay} loop={autoplay} preload="metadata" playsInline />;
    case 'html':
    case 'design-system': return <iframe className={styles.frame} src={url} sandbox="allow-scripts" title={title} />;
    case 'font': {
      const family = fontFamilyFor(asset.id);
      return <div className={styles.font}><style>{`@font-face{font-family:"${family}";src:url("${url}");font-display:swap;}`}</style><strong style={{ fontFamily: `"${family}", sans-serif` }}>Ag</strong><span style={{ fontFamily: `"${family}", sans-serif` }}>The quick brown fox jumps over the lazy dog.</span></div>;
    }
    case 'color': {
      const color = colorOf(asset);
      return color ? <div className={styles.color} style={{ background: color }} aria-label={color}><code>{color}</code></div> : <TextPreview url={url} />;
    }
    case 'url':
      return asset.sourceUrl ? <div className={styles.unavailable}><Icon name="link" size={22} /><a href={asset.sourceUrl} target="_blank" rel="noreferrer">{asset.sourceUrl}</a></div> : <TextPreview url={url} />;
    case 'text': return <TextPreview url={url} />;
    default: return <div className={styles.unavailable}><Icon name="file-text" size={22} /><strong>{kindLabel(asset.kind)}</strong></div>;
  }
}
