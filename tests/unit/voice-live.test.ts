import { describe, expect, it } from "vitest";
import { parseCatalog } from "@/lib/voice/order-parse";
import { applySetOrder, buildLiveSetup, liveSystemInstruction, liveVocabulary, LIVE_MODEL, SET_ORDER } from "@/lib/voice/live";

const items = [
  { id: "p04", name: "კარაქი", unit: "kg" },
  { id: "p16", name: "ნაღები", unit: "l" },
  { id: "p07", name: "ქათმის ფილე", unit: "box" },
];

describe("buildLiveSetup", () => {
  it("asks for audio answers, transcripts and exactly one tool, with the catalogue in the instructions", () => {
    const { setup } = buildLiveSetup(items, LIVE_MODEL);
    expect(setup.model).toBe(`models/${LIVE_MODEL}`);
    expect(setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(setup.tools[0].functionDeclarations.map((f) => f.name)).toEqual([SET_ORDER]);
    expect(setup.systemInstruction.parts[0].text).toContain("p16 | ნაღები | l");
  });

  it("tells the model not to invent orders, not to convert units and not to send the order", () => {
    const text = liveSystemInstruction(items);
    expect(text).toContain("Never invent an order");
    expect(text).toContain("never converted");
    expect(text).toContain("cannot send the order");
    // A real test run: the assistant told the tester a send button was on the screen when there was none.
    // Scripted sentences work where a general ban did not: the model kept telling testers to press a send button.
    expect(text).toContain("შეკვეთა ეკრანზეა, გთხოვთ, გადაამოწმოთ.");
    expect(text).toContain("ეს ტესტია, არაფერი იგზავნება.");
    expect(text).toContain("Never mention sending, buttons or pressing");
    expect(text).toContain("Never swap a product silently");
  });
});

describe("applySetOrder", () => {
  it("settles units in code and reports a mismatch back to the model", () => {
    const out = applySetOrder({ lines: [{ productId: "p16", quantity: 3, spokenUnit: "ცალი" }, { productId: "p04", quantity: 200, spokenUnit: "გრამი" }] }, items);
    expect(out.lines.find((l) => l.productId === "p16")).toMatchObject({ unitCheck: "mismatch", quantityMilli: 3000 });
    expect(out.lines.find((l) => l.productId === "p04")).toMatchObject({ unitCheck: "converted", quantityMilli: 200, unit: "kg" });
    expect(out.feedback.needs_attention).toEqual([{ product: "ნაღები", problem: "unit_mismatch", said: "ცალი", sold_in: "l" }]);
  });

  it("drops unknown ids, keeps the last line per product, and ignores nonsense", () => {
    const out = applySetOrder({ lines: [{ productId: "zzz", quantity: 1 }, { productId: "p04", quantity: 2 }, { productId: "p04", quantity: 5 }, null, { productId: "p07", quantity: -1 }] }, items);
    expect(out.feedback.unknown_ids).toEqual(["zzz"]);
    expect(out.lines.map((l) => [l.productId, l.quantityMilli])).toEqual([["p04", 5000], ["p07", null]]);
    expect(out.feedback.needs_attention).toContainEqual({ product: "ქათმის ფილე", problem: "bad_quantity" });
  });

  it("copes with a missing or malformed argument object", () => {
    expect(applySetOrder(undefined, items).lines).toEqual([]);
    expect(applySetOrder({ lines: "x" }, items).feedback.lines).toBe(0);
    expect(applySetOrder({ lines: [], deliveryDay: "ხვალ" }, items).deliveryDay).toBe("ხვალ");
  });
});

describe("two suppliers", () => {
  const items = parseCatalog("@sa | Supplier A\np1 | Cheese | kg\n@sb | Supplier B\nq1 | Cheese | kg\nq2 | Eggs | piece").items;

  it("puts each supplier's catalogue under its name and tells the assistant to ask which supplier", () => {
    const text = liveSystemInstruction(items);
    expect(text).toContain("Supplier: Supplier A\np1 | Cheese | kg");
    expect(text).toContain("Supplier: Supplier B\nq1 | Cheese | kg");
    expect(text).toContain("ask which supplier BEFORE calling the tool");
  });

  it("keeps each order line on the supplier of its product id", () => {
    const out = applySetOrder({ lines: [{ productId: "p1", quantity: 2, spokenUnit: "kg" }, { productId: "q2", quantity: 12 }] }, items);
    expect(out.lines.map((l) => [l.productId, l.supplierName])).toEqual([["p1", "Supplier A"], ["q2", "Supplier B"]]);
  });
});

describe("Georgian instructions", () => {
  it("teach the assistant the speaking patterns and the way buyers really talk", () => {
    const text = liveSystemInstruction(items);
    expect(text).toContain("the noun stays singular");
    expect(text).toContain("დავამატე: ორი კილო სულგუნი");
    expect(text).toContain("EVERY line with its quantity");
    expect(text).toContain("ორნახევარი"); // listening notes
    expect(text).toContain("Never guess a number or a product");
  });
});

describe("transcript hints", () => {
  const suppliers = parseCatalog("@sa | Supplier A\np1 | კარაქი | kg\n@sb | Supplier B\nq1 | კარაქი | kg\nq2 | ნაღები | l").items;

  it("asks for Georgian and biases recognition toward product and supplier names, once each", () => {
    const { setup } = buildLiveSetup(suppliers, LIVE_MODEL);
    expect(setup.inputAudioTranscription.languageCodes).toEqual(["ka-GE"]);
    const words = setup.inputAudioTranscription.customVocabulary;
    expect(words).toContain("ნაღები");
    expect(words).toContain("Supplier B");
    expect(words.filter((w) => w === "კარაქი")).toHaveLength(1);
    expect(words).toContain("ვამთავრებ");
  });

  it("keeps the vocabulary short", () => {
    const many = parseCatalog(Array.from({ length: 150 }, (_, i) => `p${i} | პროდუქტი ${i} | kg`).join("\n")).items;
    expect(liveVocabulary(many).length).toBeLessThanOrEqual(80);
  });

  it("tells the assistant to stay quiet after the read-back", () => {
    expect(liveSystemInstruction(suppliers)).toContain("No small talk and no goodbyes");
  });
});
