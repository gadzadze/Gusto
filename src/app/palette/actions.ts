"use server";

import { requireOrg } from "@/server/auth/guards";
import { searchPalette, type PaletteResult } from "@/server/domain/search/palette";

/** Palette search for the acting company (buyer or supplier area; the admin area has no entity search). */
export async function paletteSearchAction(query: string): Promise<PaletteResult[]> {
  const ctx = await requireOrg();
  if (typeof query !== "string") return [];
  try {
    return await searchPalette(ctx, query);
  } catch {
    return []; // over the rate limit or a hiccup: the palette just shows its commands
  }
}
