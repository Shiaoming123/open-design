import { useEffect, useState } from 'react';
import type { LibraryAsset } from '@open-design/contracts';

import { libraryAssetRawUrl } from '../providers/registry';
import { assetTitle, colorOf, fontFamilyFor, kindLabel } from './LibraryAssetMeta';
import { Icon } from './Icon';
import styles from './LibraryPreviewStage.module.css';

function useRawText(url: string, enabled = true) {
  const [state, setState] = useState({ text: '', loading: enabled, error: false });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ text: '', loading: true, error: false });
    void fetch(url).then((response) => response.ok ? response.text() : Promise.reject()).then(
      (text) => { if (!cancelled) setState({ text, loading: false, error: false }); },
      () => { if (!cancelled) setState({ text: '', loading: false, error: true }); },
    );
    return () => { cancelled = true; };
  }, [enabled, url]);
  return state;
}

function TextPreview({ url }: { url: string }) {
  const { text, loading, error } = useRawText(url);
  return <pre className={styles.text}>{loading ? 'Loading…' : error ? 'Preview unavailable.' : text}</pre>;
}

function FullFontPreview({ asset, url }: { asset: LibraryAsset; url: string }) {
  const family = fontFamilyFor(asset.id);
  return <div className={styles.fontFull} style={{ fontFamily: `"${family}", sans-serif` }}>
    <style>{`@font-face{font-family:"${family}";src:url("${url}");font-display:swap;}`}</style>
    <p className={styles.fontHero}>Ag</p>
    <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p><p>abcdefghijklmnopqrstuvwxyz</p><p>0123456789 &amp; ! ? @ # $ %</p>
    <p className={styles.fontPangram}>The quick brown fox jumps over the lazy dog.</p>
    <p>The quick brown fox jumps over the lazy dog.</p>
  </div>;
}

function ColorPreview({ asset, url, full }: { asset: LibraryAsset; url: string; full: boolean }) {
  const needsText = !asset.palette?.length;
  const { text, loading } = useRawText(url, needsText);
  const value = colorOf(asset, text);
  if (loading && !value) return <div className={styles.unavailable}>Loading…</div>;
  if (!value) return <div className={styles.unavailable}>No color value available.</div>;
  const palette = asset.palette?.length ? asset.palette : [value];
  return <div className={full ? styles.colorFull : styles.color} style={{ background: value }} aria-label={value}>
    <code>{value}</code>
    {full && palette.length > 1 ? <div className={styles.palette}>{palette.map((color, index) => <span key={`${color}-${index}`} title={color} style={{ background: color }} />)}</div> : null}
  </div>;
}

function UrlPreview({ asset, url }: { asset: LibraryAsset; url: string }) {
  const { text, loading } = useRawText(url, !asset.sourceUrl);
  const href = asset.sourceUrl || text.trim();
  if (loading && !href) return <div className={styles.unavailable}>Loading…</div>;
  if (!href) return <div className={styles.unavailable}>No link available.</div>;
  return <div className={styles.url}><Icon name="link" size={32} /><a href={href} target="_blank" rel="noreferrer">{href}</a><a href={href} target="_blank" rel="noreferrer">Open in new tab →</a></div>;
}

export function LibraryPreviewStage({ asset, autoplay = false, variant = 'compact' }: { asset: LibraryAsset; autoplay?: boolean; variant?: 'compact' | 'full' }) {
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
      if (variant === 'full') return <FullFontPreview asset={asset} url={url} />;
      return <div className={styles.font}><style>{`@font-face{font-family:"${family}";src:url("${url}");font-display:swap;}`}</style><strong style={{ fontFamily: `"${family}", sans-serif` }}>Ag</strong><span style={{ fontFamily: `"${family}", sans-serif` }}>The quick brown fox jumps over the lazy dog.</span></div>;
    }
    case 'color': return <ColorPreview asset={asset} url={url} full={variant === 'full'} />;
    case 'url': return <UrlPreview asset={asset} url={url} />;
    case 'text': return <TextPreview url={url} />;
    default: return <div className={styles.unavailable}><Icon name="file-text" size={22} /><strong>{kindLabel(asset.kind)}</strong></div>;
  }
}
