import { describe, expect, it } from "vitest";
import { applySetOrder, liveSystemInstruction, SET_ORDER_DECLARATION } from "@/lib/voice/live";
import { catalogueText, type CatalogItem } from "@/lib/voice/order-parse";
import { MAX_PHRASE_CHARS, normalizePhrase, phraseToLearn } from "@/lib/voice/phrases";

describe("phrases a buyer says", () => {
  it("are written down one way, whatever the case, spaces or punctuation", () => {
    expect(normalizePhrase("  ყველი. ")).toBe("ყველი");
    expect(normalizePhrase("Georgian  Cheese!")).toBe("georgian cheese");
    expect(normalizePhrase("x".repeat(200))).toHaveLength(MAX_PHRASE_CHARS);
  });

  it("are remembered only when they are a short name that differs from the product's own", () => {
    expect(phraseToLearn("ყველი", "სულგუნი")).toBe("ყველი");
    expect(phraseToLearn("სულგუნი", "სულგუნი")).toBeNull(); // same as the product name
    expect(phraseToLearn("ორი კილო ყველი 2", "სულგუნი")).toBeNull(); // a number came with it
    expect(phraseToLearn("ა", "სულგუნი")).toBeNull(); // too short
    expect(phraseToLearn("ერთი ორი სამი ოთხი ხუთი ექვსი", "სულგუნი")).toBeNull(); // a sentence, not a name
    expect(phraseToLearn(undefined, "სულგუნი")).toBeNull();
  });
});

describe("remembered phrases in the assistant's catalogue", () => {
  const items: CatalogItem[] = [
    { id: "p1", name: "სულგუნი", unit: "kg", aliases: ["ყველი", "ქართული ყველი"] },
    { id: "p2", name: "ნაღები", unit: "l" },
  ];

  it("appear as 'also said' only where there are any, and the prompt explains them", () => {
    expect(catalogueText(items)).toBe("p1 | სულგუნი | kg | also said: ყველი; ქართული ყველი\np2 | ნაღები | l");
    expect(liveSystemInstruction(items, "buyer")).toContain("An 'also said' list after a product");
  });

  it("the tool asks for the name as spoken, and it is passed on trimmed and capped, never trusted as an id", () => {
    const props = SET_ORDER_DECLARATION.parameters.properties.lines.items.properties as Record<string, unknown>;
    expect(props.spokenName).toBeDefined();
    const out = applySetOrder({ lines: [{ productId: "p1", quantity: 2, spokenUnit: "კილო", spokenName: `  ${"ყ".repeat(100)}  ` }, { productId: "p2", quantity: 1 }] }, items);
    expect(out.lines[0].spokenName).toHaveLength(60);
    expect(out.lines[1].spokenName).toBeNull();
  });
});
