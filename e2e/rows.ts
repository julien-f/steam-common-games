import type { Page } from '@playwright/test';

// A data table's game rows, group headers left out.
export const rows = (page: Page) => page.locator('tbody tr:not(.dt-group-row)');
export const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
