// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { EntryNavRail } from '../../src/components/EntryNavRail';

afterEach(cleanup);

describe('Resources navigation', () => {
  it('shows the Resources destination and selects the library route', () => {
    const onViewChange = vi.fn();
    render(
      <I18nProvider>
        <EntryNavRail
          view="home"
          onViewChange={onViewChange}
          onNewProject={vi.fn()}
          open
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resources' }));
    expect(onViewChange).toHaveBeenCalledWith('library');
  });
});
