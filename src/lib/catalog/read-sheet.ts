"use client";

import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import { MAX_IMPORT_ROWS, sheetFromCells, type RawSheet } from "@/lib/catalog/import";
import { extractSheetImages, MAX_XLSX_BYTES, type SheetImage } from "@/lib/catalog/sheet-images";

export type ReadSheetError = "unsupported" | "empty" | "too_many_rows" | "unreadable" | "too_large";

/** Parses a CSV or XLSX file in the browser. Only the cell text is sent to the server. */
export async function readSpreadsheet(file: File): Promise<RawSheet | ReadSheetError> {
  const result = await readSpreadsheetWithPhotos(file);
  return typeof result === "string" ? result : result.sheet;
}

export type SheetWithPhotos = {
  sheet: RawSheet;
  /** Picture for each data row (index into `sheet.rows`). */
  photos: Map<number, SheetImage>;
  /** Pictures found but not usable (unsupported format, or a second one in a row). */
  skippedPhotos: number;
};

const toText = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? "d" : String(v).trim());

/** Like readSpreadsheet, and for an .xlsx also the pictures placed in the product rows. */
export async function readSpreadsheetWithPhotos(file: File): Promise<SheetWithPhotos | ReadSheetError> {
  const name = file.name.toLowerCase();
  let cells: unknown[][];
  try {
    if (name.endsWith(".csv")) {
      const text = await file.text();
      // Delimiter auto-detected: Excel in Georgian locale often exports ";".
      const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
      cells = parsed.data;
    } else if (name.endsWith(".xlsx")) {
      if (file.size > MAX_XLSX_BYTES) return "too_large";
      cells = await readSheet(file);
    } else {
      return "unsupported";
    }
  } catch {
    return "unreadable";
  }
  const sheet = sheetFromCells(cells);
  if (sheet.headers.length === 0 || sheet.rows.length === 0) return "empty";
  if (sheet.rows.length > MAX_IMPORT_ROWS) return "too_many_rows";
  if (!name.endsWith(".xlsx")) return { sheet, photos: new Map(), skippedPhotos: 0 };

  // Blank rows are dropped from the sheet, so map each data row back to its row in the file.
  const keptRows: number[] = [];
  cells.forEach((row, i) => {
    if (row.some((c) => toText(c) !== "")) keptRows.push(i);
  });
  const { byRow, skipped } = extractSheetImages(await file.arrayBuffer());
  const photos = new Map<number, SheetImage>();
  let skippedPhotos = skipped;
  for (const [fileRow, image] of byRow) {
    const kept = keptRows.indexOf(fileRow);
    // Index 0 is the header; data rows start at 1.
    if (kept < 1) skippedPhotos += 1;
    else photos.set(kept - 1, image);
  }
  return { sheet, photos, skippedPhotos };
}
