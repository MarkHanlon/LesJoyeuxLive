import { type Page, expect } from '@playwright/test';

/** Log in as a named user. The user must already be approved in the database. */
export async function loginAs(page: Page, name: string) {
  await page.goto('/');

  // Wait for the name entry screen
  const nameInput = page.getByPlaceholder(/your name/i);
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await nameInput.fill(name);
  await page.keyboard.press('Enter');

  // Wait until we're past the loading state and land on the tabs
  await expect(page.getByText('La Famille')).toBeVisible({ timeout: 15_000 });
}

/** Switch to the Events in-page tab on the La Famille screen */
export async function openEventsTab(page: Page) {
  const eventsTab = page.getByRole('button', { name: 'Events' });
  // Also matches Text components rendered as buttons
  const eventsText = page.getByText('Events').first();
  await (await eventsTab.count() ? eventsTab : eventsText).tap();
}
