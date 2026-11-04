import { strFromU8, unzipSync } from "fflate";

// Pictures placed on the first sheet of an .xlsx, matched to rows. An .xlsx is a
// zip: the sheet points at a drawing, the drawing anchors each picture to a
// cell, and the picture itself is a file under xl/media. Floating pictures
// (Excel's default when pasting) are supported; "place in cell" pictures are not.

export type SheetImage = { row: number; name: string; mime: string; bytes: Uint8Array };

export type SheetImages = {
  /** The first picture found for each sheet row (0-based row index, header = 0). */
  byRow: Map<number, SheetImage>;
  /** Pictures that were not used: a format we can't read, or a second one in a row. */
  skipped: number;
};

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Largest .xlsx we try to unpack (the supplier is told to keep files small). */
export const MAX_XLSX_BYTES = 60 * 1024 * 1024;

type Rel = { id: string; target: string };

function relsOf(xml: string): Rel[] {
  const rels: Rel[] = [];
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    if (id && target) rels.push({ id, target });
  }
  return rels;
}

/** Resolves a relationship target against the folder of the file that holds it. */
function resolvePath(fromFile: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromFile.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function relsFile(path: string): string {
  const i = path.lastIndexOf("/");
  return `${path.slice(0, i + 1)}_rels/${path.slice(i + 1)}.rels`;
}

/** Reads the pictures of the first sheet. Returns an empty result for anything unexpected. */
export function extractSheetImages(buffer: ArrayBuffer | Uint8Array): SheetImages {
  const empty: SheetImages = { byRow: new Map(), skipped: 0 };
  try {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const textFiles = unzipSync(data, { filter: (f) => f.name.endsWith(".xml") || f.name.endsWith(".rels") });
    const text = (path: string): string | null => {
      const file = textFiles[path];
      return file ? strFromU8(file) : null;
    };

    // First sheet (in workbook order) -> its file.
    const workbook = text("xl/workbook.xml");
    const workbookRels = text("xl/_rels/workbook.xml.rels");
    if (!workbook || !workbookRels) return empty;
    const firstSheetRid = /<(?:\w+:)?sheet\b[^>]*?\br:id="([^"]+)"/.exec(workbook)?.[1];
    const sheetTarget = relsOf(workbookRels).find((r) => r.id === firstSheetRid)?.target;
    if (!sheetTarget) return empty;
    const sheetPath = resolvePath("xl/workbook.xml", sheetTarget);

    // Sheet -> drawing.
    const sheetRels = text(relsFile(sheetPath));
    const sheetXml = text(sheetPath);
    if (!sheetRels || !sheetXml) return empty;
    const drawingRid = /<(?:\w+:)?drawing\b[^>]*?\br:id="([^"]+)"/.exec(sheetXml)?.[1];
    const drawingTarget = relsOf(sheetRels).find((r) => r.id === drawingRid)?.target;
    if (!drawingTarget) return empty;
    const drawingPath = resolvePath(sheetPath, drawingTarget);
    const drawingXml = text(drawingPath);
    const drawingRels = text(relsFile(drawingPath));
    if (!drawingXml || !drawingRels) return empty;
    const mediaByRid = new Map(relsOf(drawingRels).map((r) => [r.id, resolvePath(drawingPath, r.target)]));

    // Each anchor holds the cell the picture starts in and a reference to the media file.
    const found: { row: number; col: number; media: string }[] = [];
    for (const m of drawingXml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:\w+:)?\1>/g)) {
      const block = m[0];
      const from = /<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/.exec(block)?.[1];
      const row = from ? /<(?:\w+:)?row>(\d+)</.exec(from)?.[1] : undefined;
      const col = from ? /<(?:\w+:)?col>(\d+)</.exec(from)?.[1] : undefined;
      const rid = /\bembed="([^"]+)"/.exec(block)?.[1];
      const media = rid ? mediaByRid.get(rid) : undefined;
      if (row !== undefined && media) found.push({ row: Number(row), col: Number(col ?? 0), media });
    }
    if (found.length === 0) return empty;
    found.sort((a, b) => a.row - b.row || a.col - b.col);

    const wanted = new Set(found.map((f) => f.media));
    const mediaFiles = unzipSync(data, { filter: (f) => wanted.has(f.name) });

    const byRow = new Map<number, SheetImage>();
    let skipped = 0;
    for (const f of found) {
      const ext = f.media.split(".").pop()?.toLowerCase() ?? "";
      const bytes = mediaFiles[f.media];
      const mime = MIME[ext];
      if (!bytes || !mime || byRow.has(f.row)) {
        skipped += 1;
        continue;
      }
      byRow.set(f.row, { row: f.row, name: f.media.split("/").pop() ?? f.media, mime, bytes });
    }
    return { byRow, skipped };
  } catch {
    return empty;
  }
}
