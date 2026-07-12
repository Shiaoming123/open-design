import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@open-design/components';
import { Icon } from './Icon';
import { useT } from '../i18n';

import styles from './LibraryWorkbenchLayout.module.css';

interface Props {
  sidebar: ReactNode;
  children: ReactNode;
  inspector: ReactNode;
}

/** Stable three-pane shell for the Resources asset workbench. */
export function LibraryWorkbenchLayout({ sidebar, children, inspector }: Props) {
  const [mobile, setMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'filters' | 'inspector' | null>(null);
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const t = useT();

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 820px)');
    const sync = () => {
      setMobile(query.matches);
      if (!query.matches) setMobilePanel(null);
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!mobilePanel) return;
    const panel = mobilePanel === 'filters' ? sidebarRef.current : inspectorRef.current;
    const trigger = mobilePanel === 'filters' ? filtersTriggerRef.current : inspectorTriggerRef.current;
    if (!panel) return;
    const focusable = () => [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobilePanel(null);
        trigger?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [mobilePanel]);

  const closeMobilePanel = () => {
    const trigger = mobilePanel === 'filters' ? filtersTriggerRef.current : inspectorTriggerRef.current;
    setMobilePanel(null);
    trigger?.focus();
  };

  const filtersOpen = mobilePanel === 'filters';
  const inspectorOpen = mobilePanel === 'inspector';
  return (
    <div className={styles.root} data-testid="library-workbench">
      <div className={styles.mobileToolbar}>
        <Button ref={filtersTriggerRef} variant="ghost" aria-expanded={filtersOpen} aria-label={t('resources.showFilters')} onClick={() => setMobilePanel(filtersOpen ? null : 'filters')}>
          <Icon name="sliders" size={15} /> {t('resources.filters')}
        </Button>
        <Button ref={inspectorTriggerRef} variant="ghost" aria-expanded={inspectorOpen} aria-label={t('resources.showInspector')} onClick={() => setMobilePanel(inspectorOpen ? null : 'inspector')}>
          <Icon name="eye" size={15} /> {t('resources.preview')}
        </Button>
      </div>
      {mobile && mobilePanel ? <button type="button" className={styles.backdrop} tabIndex={-1} aria-label={mobilePanel === 'filters' ? t('resources.closeFilters') : t('resources.closeInspector')} onClick={closeMobilePanel} /> : null}
      <aside ref={sidebarRef} className={styles.sidebar} data-mobile-open={filtersOpen} aria-label={t('resources.filters')} aria-modal={mobile && filtersOpen ? true : undefined} role={mobile ? 'dialog' : undefined} inert={mobile && !filtersOpen}>
        <Button className={styles.drawerClose} variant="ghost" size="icon" aria-label={t('resources.closeFilters')} onClick={closeMobilePanel}>
          <Icon name="close" size={16} />
        </Button>
        {sidebar}
      </aside>
      <section className={styles.results} aria-label={t('resources.results')}>
        {children}
      </section>
      <aside ref={inspectorRef} className={styles.inspector} data-mobile-open={inspectorOpen} aria-label={t('resources.inspector')} aria-modal={mobile && inspectorOpen ? true : undefined} role={mobile ? 'dialog' : undefined} inert={mobile && !inspectorOpen}>
        <Button className={styles.drawerClose} variant="ghost" size="icon" aria-label={t('resources.closeInspector')} onClick={closeMobilePanel}>
          <Icon name="close" size={16} />
        </Button>
        {inspector}
      </aside>
    </div>
  );
}
