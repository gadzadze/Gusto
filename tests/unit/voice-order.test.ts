import { describe, expect, it } from "vitest";
import { catalogueText, normalizeResult, parseCatalog, reconcileUnit, SAMPLE_CATALOG, SYSTEM_INSTRUCTION } from "@/lib/voice/order-parse";
import { encodeWav, looksLikeWav, VOICE_SAMPLE_RATE } from "@/lib/voice/wav";

describe("parseCatalog", () => {
  it("reads the bundled sample without a single bad line", () => {
    const { items, badLines } = parseCatalog(SAMPLE_CATALOG);
    expect(badLines).toEqual([]);
    expect(items.length).toBeGreaterThan(20);
  });

  it("skips blanks and comments and reports malformed or duplicate lines", () => {
    const { items, badLines } = parseCatalog("# note\n\na | Milk | l\nb | Cheese\na | Again | kg\nc d | Bad id | kg");
    expect(items.map((i) => i.id)).toEqual(["a"]);
    expect(badLines).toEqual([4, 5, 6]);
  });
});

describe("parseCatalog with suppliers", () => {
  const text = ["# note", "@sa | Supplier A", "p1 | Milk | l", "p2 | Cheese | kg", "@sb | Supplier B", "q1 | Milk | l", "q2 | Eggs | piece"].join("\n");

  it("attaches each product to the supplier above it and lists the suppliers", () => {
    const { items, suppliers, badLines } = parseCatalog(text);
    expect(badLines).toEqual([]);
    expect(suppliers).toEqual([{ id: "sa", name: "Supplier A" }, { id: "sb", name: "Supplier B" }]);
    expect(items.map((i) => [i.id, i.supplierName])).toEqual([["p1", "Supplier A"], ["p2", "Supplier A"], ["q1", "Supplier B"], ["q2", "Supplier B"]]);
  });

  it("reports a repeated supplier id, a nameless supplier and a product id used twice across suppliers", () => {
    const bad = parseCatalog(["@sa | A", "p1 | Milk | l", "@sa | A again", "@sb |", "@sc | C", "p1 | Milk | l"].join("\n"));
    expect(bad.badLines).toEqual([3, 4, 6]);
  });

  it("keeps the old single-list format working: no suppliers, no supplier on items", () => {
    const { items, suppliers } = parseCatalog("p1 | Milk | l");
    expect(suppliers).toEqual([]);
    expect(items[0].supplierName).toBeUndefined();
  });

  it("the bundled sample has two suppliers that share some products", () => {
    const { items, suppliers, badLines } = parseCatalog(SAMPLE_CATALOG);
    expect(badLines).toEqual([]);
    expect(suppliers.length).toBe(2);
    const names = (id: string) => items.filter((i) => i.supplierId === id).map((i) => i.name);
    const shared = names("sa").filter((n) => names("sb").includes(n));
    expect(shared.length).toBeGreaterThanOrEqual(3);
  });

  it("groups the catalogue text by supplier for the model, and says nothing about suppliers for a plain list", () => {
    expect(catalogueText(parseCatalog(text).items)).toContain("Supplier: Supplier B\nq1 | Milk | l");
    expect(catalogueText(parseCatalog("p1 | Milk | l").items)).toBe("p1 | Milk | l");
  });
});

describe("normalizeResult", () => {
  const items = [
    { id: "p1", name: "Milk", unit: "l" },
    { id: "p2", name: "Cheese", unit: "kg" },
  ];

  it("turns quantities into milli-units and keeps real ids", () => {
    const out = normalizeResult(
      {
        transcript: "ორნახევარი კილო ყველი",
        lines: [{ spoken: "ყველი", productId: "p2", candidates: [], quantity: 2.5, unit: "kg", confidence: 0.9 }],
        deliveryDay: "tomorrow",
        questions: [],
      },
      items,
    );
    expect(out.lines[0]).toMatchObject({ productId: "p2", productName: "Cheese", quantityMilli: 2500, catalogUnit: "kg" });
    expect(out.deliveryDay).toBe("tomorrow");
  });

  it("never trusts the model: unknown ids, bad numbers and odd shapes are neutralised", () => {
    const out = normalizeResult(
      {
        transcript: 5,
        lines: [
          { spoken: "x", productId: "p999", candidates: ["p1", "nope"], quantity: -3, unit: "kg", confidence: 7 },
          { spoken: "y", productId: "p1", candidates: [], quantity: 1e9, unit: null, confidence: "high" },
          null,
        ],
        questions: ["", "Which one?"],
      },
      items,
    );
    expect(out.transcript).toBe("");
    expect(out.lines[0]).toMatchObject({ productId: null, quantityMilli: null, confidence: 1 });
    expect(out.lines[0].candidates).toEqual([{ id: "p1", name: "Milk", supplierName: null }]);
    expect(out.lines[1]).toMatchObject({ productId: "p1", quantityMilli: null, confidence: 0 });
    expect(out.questions).toEqual(["Which one?"]);
  });

  it("copes with a non-object answer", () => {
    expect(normalizeResult("nonsense", items)).toEqual({ transcript: "", lines: [], deliveryDay: null, questions: [] });
  });
});

describe("encodeWav", () => {
  it("writes a valid 16-bit mono header and clamps samples", () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 2]), VOICE_SAMPLE_RATE);
    expect(bytes.length).toBe(44 + 8);
    expect(looksLikeWav(bytes)).toBe(true);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(VOICE_SAMPLE_RATE);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(32767);
  });

  it("rejects bytes that are not a WAV file", () => {
    expect(looksLikeWav(new Uint8Array(100))).toBe(false);
    expect(looksLikeWav(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("instructions", () => {
  it("tell the model not to invent an order when nothing was said (a bare tone once came back as 'two kilos of cheese')", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Never invent an order");
  });
});

describe("reconcileUnit", () => {
  it("accepts the same unit in any spelling", () => {
    expect(reconcileUnit(3, "კილო", "kg")).toEqual({ quantityMilli: 3000, unit: "kg", unitCheck: "ok" });
    expect(reconcileUnit(2, "ყუთი", "box")).toMatchObject({ unitCheck: "ok", quantityMilli: 2000 });
  });

  it("converts grams to kilos and millilitres to litres", () => {
    expect(reconcileUnit(500, "გრამი", "kg")).toEqual({ quantityMilli: 500, unit: "kg", unitCheck: "converted" });
    expect(reconcileUnit(1500, "ml", "l")).toEqual({ quantityMilli: 1500, unit: "l", unitCheck: "converted" });
  });

  it("flags pieces for a product sold in litres instead of guessing", () => {
    expect(reconcileUnit(3, "ცალი", "l")).toEqual({ quantityMilli: 3000, unit: "ცალი", unitCheck: "mismatch" });
    expect(reconcileUnit(3, "ბეღელი", "kg")).toMatchObject({ unitCheck: "mismatch" });
  });

  it("assumes the catalogue's unit when none was said, and says nothing about a missing product", () => {
    expect(reconcileUnit(4, null, "kg")).toEqual({ quantityMilli: 4000, unit: "kg", unitCheck: "assumed" });
    expect(reconcileUnit(4, "kg", null)).toEqual({ quantityMilli: 4000, unit: "kg", unitCheck: "none" });
  });

  it("rejects a quantity that is missing or out of range", () => {
    expect(reconcileUnit(null, "kg", "kg").quantityMilli).toBeNull();
    expect(reconcileUnit(-1, "kg", "kg").quantityMilli).toBeNull();
    expect(reconcileUnit(1e9, "kg", "kg").quantityMilli).toBeNull();
  });
});

describe("suppliers in the one-shot answer", () => {
  it("names the supplier of a matched product and of each candidate", () => {
    const items = parseCatalog("@sa | A\np1 | Cheese | kg\n@sb | B\nq1 | Cheese | kg").items;
    const out = normalizeResult({ transcript: "x", lines: [{ spoken: "cheese", productId: null, candidates: ["p1", "q1"], quantity: 2, unit: "kg", confidence: 0.6 }, { spoken: "cheese from B", productId: "q1", candidates: [], quantity: 1, unit: "kg", confidence: 0.9 }], deliveryDay: null, questions: [] }, items);
    expect(out.lines[0].candidates).toEqual([{ id: "p1", name: "Cheese", supplierName: "A" }, { id: "q1", name: "Cheese", supplierName: "B" }]);
    expect(out.lines[1].supplierName).toBe("B");
  });
  it("tells the model to ask which supplier when several sell the product", () => {
    expect(SYSTEM_INSTRUCTION).toContain("asking which supplier");
  });
});

describe("one-shot instructions", () => {
  it("include the spoken forms buyers use, so the transcript and quantities are read the way they are said", () => {
    expect(SYSTEM_INSTRUCTION).toContain("კილონახევარი");
    expect(SYSTEM_INSTRUCTION).toContain("კოლოფი");
  });
});
