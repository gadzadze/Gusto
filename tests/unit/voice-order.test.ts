import { describe, expect, it } from "vitest";
import { normalizeResult, parseCatalog, SAMPLE_CATALOG, SYSTEM_INSTRUCTION } from "@/lib/voice/order-parse";
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
    expect(out.lines[0].candidates).toEqual([{ id: "p1", name: "Milk" }]);
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
