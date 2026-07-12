import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
  const assets = Array.from({ length: 500 }, (_, index) => ({
    id: `resource-${index}`,
    kind: 'image',
    storage: 'owned',
    capturedAt: 1_700_000_000_000 + index,
    archivedDate: '2024-01-01',
    contentHash: `hash-${index}`,
    favorite: false,
    collectionIds: [],
    tags: [],
    sources: [],
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
    sourceTitle: `Responsive resource ${index}`,
  }));
  await page.route('**/api/library/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/library/assets') {
      await route.fulfill({ json: { assets, nextCursor: null } });
    } else if (url.pathname === '/api/library/collections') {
      await route.fulfill({ json: { collections: [] } });
    } else if (url.pathname === '/api/library/events') {
      await route.fulfill({ contentType: 'text/event-stream', body: '' });
    } else if (url.pathname.endsWith('/raw')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" />' });
    } else {
      await route.fallback();
    }
  });
});

test('[P1] Resources keeps real three-pane scroll geometry and a bounded result window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/library', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading Open Design…').waitFor({ state: 'hidden', timeout: T.long });
  await expect(page.getByText('500 resources')).toBeVisible();

  const geometry = await page.getByTestId('library-workbench').evaluate((root) => {
    const filters = root.querySelector<HTMLElement>('[aria-label="Resource filters"]')!;
    const results = root.querySelector<HTMLElement>('[aria-label="Resource results"]')!;
    const inspector = root.querySelector<HTMLElement>('[aria-label="Preview inspector"]')!;
    const rr = results.getBoundingClientRect();
    return {
      rootBottom: root.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
      ordered: filters.getBoundingClientRect().right <= rr.left && rr.right <= inspector.getBoundingClientRect().left,
      filtersOverflow: getComputedStyle(filters).overflowY,
      resultsOverflow: getComputedStyle(results).overflowY,
      inspectorOverflow: getComputedStyle(inspector).overflowY,
      resultsScrollable: results.scrollHeight > results.clientHeight,
    };
  });
  expect(geometry.ordered).toBe(true);
  expect(geometry.rootBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect([geometry.filtersOverflow, geometry.resultsOverflow, geometry.inspectorOverflow]).toEqual(['auto', 'auto', 'auto']);
  expect(geometry.resultsScrollable).toBe(true);
  await expect(page.locator('[data-asset-card]')).toHaveCount(200);

  const results = page.getByRole('region', { name: 'Resource results' });
  await results.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole('button', { name: 'Load 200 more resources' })).toBeVisible();
});

test('[P1] Resources exposes touch selection without horizontal batch overflow', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/library', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading Open Design…').waitFor({ state: 'hidden', timeout: T.long });
  await expect(page.getByText('500 resources')).toBeVisible();

  const checks = page.getByRole('button', { name: 'Select asset' });
  await expect(checks.first()).toBeVisible();
  expect(await checks.first().evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))).toBeGreaterThan(0.9);
  await checks.nth(0).click();
  await checks.nth(1).click();
  await expect(page.getByText('2 selected')).toBeVisible();

  const overflow = await page.getByTestId('library-selection-bar').evaluate((bar) => ({
    bar: bar.scrollWidth - bar.clientWidth,
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.bar).toBeLessThanOrEqual(1);
  expect(overflow.page).toBeLessThanOrEqual(1);
});
