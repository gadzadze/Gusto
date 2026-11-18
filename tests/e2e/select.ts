import type { Locator } from "@playwright/test";

/**
 * Chooses an option in the app's Select. The visible control is a button (role "combobox"); the real <select>
 * sits next to it, hidden. Selecting on that one fires the same change event the menu does.
 */
export async function selectIn(combobox: Locator, option: string | { label: string }): Promise<void> {
  await combobox.locator("xpath=..").locator("select").selectOption(option);
}
