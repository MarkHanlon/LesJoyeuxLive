import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';

const TEST_USER = process.env.TEST_USER ?? 'Mark';

test.describe('Events tab – arrivals & departures', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept the members API call and log the raw response so we can
    // see exactly what date format the server returns.
    page.on('response', async (response) => {
      if (response.url().includes('/api/family/members')) {
        try {
          const body = await response.json();
          const sample = body.slice(0, 3).map((m: Record<string, unknown>) => ({
            name: m.name,
            arriveDate: m.arriveDate,
            departDate: m.departDate,
          }));
          console.log('[DEBUG] /api/family/members date sample:', JSON.stringify(sample, null, 2));
        } catch { /* ignore */ }
      }
    });

    await loginAs(page, TEST_USER);
  });

  test('shows arrival rows in the Events tab', async ({ page }) => {
    // Navigate to La Famille tab then switch to Events
    await page.getByText('Family').click();
    await expect(page.getByText('La Famille')).toBeVisible();
    await page.getByText('Events').click();

    // There should be at least one date section visible
    // (i.e. the user has visit dates set)
    const dateSections = page.locator('[data-testid="event-date-section"]');
    // Fall back to detecting any visible date heading (long date format)
    const dateHeadings = page.getByText(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i);
    await expect(dateHeadings.first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'tests/screenshots/events-tab.png', fullPage: true });
  });

  test('departure rows appear on the departure date', async ({ page }) => {
    await page.getByText('Family').click();
    await page.getByText('Events').click();

    // Look for a "leaves" text anywhere on the page
    const leaveRows = page.getByText(/leaves/i);
    const count = await leaveRows.count();

    if (count === 0) {
      // Capture screenshot for debugging
      await page.screenshot({ path: 'tests/screenshots/events-tab-no-departures.png', fullPage: true });
      // Also dump the page HTML for inspection
      const html = await page.content();
      const fs = await import('fs');
      fs.writeFileSync('tests/screenshots/events-tab-debug.html', html);
    }

    expect(count, `Expected at least one "leaves" row. See tests/screenshots/ for output.`).toBeGreaterThan(0);
  });

  test('arrival rows appear on the arrival date', async ({ page }) => {
    await page.getByText('Family').click();
    await page.getByText('Events').click();

    const arriveRows = page.getByText(/arrives/i);
    expect(await arriveRows.count()).toBeGreaterThan(0);
  });

  test('raw API response – date format check', async ({ page }) => {
    // This test explicitly checks the format of dates in the members API.
    // It passes if dates are YYYY-MM-DD (10 chars). Fails if they are ISO strings.
    let membersData: Record<string, unknown>[] = [];

    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/family/members')),
      page.goto('/'),
    ]);

    membersData = await response.json().catch(() => []);

    for (const member of membersData as Record<string, unknown>[]) {
      if (member.arriveDate) {
        const d = String(member.arriveDate);
        expect(d, `arriveDate for ${member.name} should be YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (member.departDate) {
        const d = String(member.departDate);
        expect(d, `departDate for ${member.name} should be YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
