"use client";

import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import { MAX_IMPORT_ROWS, sheetFromCells, type RawSheet } from "@/lib/catalog/import";

export type ReadSheetError = "unsupported" | "empty" | "too_many_rows" | "unreadable";

/** Parses a CSV or XLSX file in the browser. Only the cell text is sent to the server. */
export async function readSpreadsheet(file: File): Promise<RawSheet | ReadSheetError> {
  const name = file.name.toLowerCase();
  let cells: unknown[][];
  try {
    if (name.endsWith(".csv")) {
      const text = await file.text();
      // Delimiter auto-detected: Excel in Georgian locale often exports ";".
      const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
      cells = parsed.data;
    } else if (name.endsWith(".xlsx")) {
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
  return sheet;
}
