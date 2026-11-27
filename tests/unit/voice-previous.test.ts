import { describe, expect, it } from "vitest";
import { liveSystemInstruction } from "@/lib/voice/live";
import { previousOrdersText } from "@/lib/voice/previous";

const items = [{ id: "p1", name: "სულგუნი", unit: "kg" }, { id: "p2", name: "ნაღები", unit: "l" }];

describe("the usual order", () => {
  it("is written per supplier with short ids, quantities and units, and skips suppliers without lines", () => {
    expect(
      previousOrdersText([
        { supplierName: "Vake Foods", lines: [{ id: "p1", qtyMilli: 2500, unit: "kg" }, { id: "p2", qtyMilli: 3000, unit: "l" }] },
        { supplierName: "Empty", lines: [] },
      ]),
    ).toBe("Vake Foods: p1 2.5 kg; p2 3 l");
  });

  it("is explained to the assistant only when there is one", () => {
    expect(liveSystemInstruction(items, "buyer")).not.toContain("same as last time");
    const text = liveSystemInstruction(items, "buyer", "Vake Foods: p1 2.5 kg");
    expect(text).toContain("same as last time");
    expect(text).toContain("Usual order per supplier (id quantity unit):\nVake Foods: p1 2.5 kg");
    expect(text).toContain("Never invent a usual order");
  });
});

describe("lookup tools", () => {
  it("are declared to a buyer's assistant only, with the rule to use them instead of guessing", async () => {
    const { buildLiveSetup, LOOKUP_DECLARATIONS } = await import("@/lib/voice/live");
    const buyer = buildLiveSetup(items, "m", "buyer").setup;
    const names = buyer.tools[0].functionDeclarations.map((d: { name: string }) => d.name);
    for (const d of LOOKUP_DECLARATIONS) expect(names).toContain(d.name);
    expect(names).toContain("set_order");
    expect(buildLiveSetup(items, "m", "test").setup.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual(["set_order"]);
    expect(buyer.systemInstruction.parts[0].text).toContain("never answer those from memory");
  });
});
