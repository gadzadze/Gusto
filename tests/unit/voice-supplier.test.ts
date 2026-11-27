import { describe, expect, it } from "vitest";
import { buildSupplierLiveSetup, SUPPLIER_DECLARATIONS, supplierSystemInstruction } from "@/lib/voice/live-supplier";

describe("supplier assistant prompt", () => {
  const text = supplierSystemInstruction();
  it("never changes anything itself and asks for a reason before rejecting", () => {
    expect(text).toContain("You never change anything yourself");
    expect(text).toContain("never say that something was done before the supplier has tapped");
    expect(text).toContain("A rejection needs a reason");
  });
  it("speaks Georgian and answers from lookups only", () => {
    expect(text).toContain("Speak Georgian only");
    expect(text).toContain("Never answer from memory");
  });
  it("declares only lookups, proposals and choices (no tool that changes data directly)", () => {
    const names = SUPPLIER_DECLARATIONS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(/^(list_|get_|find_|loading_|propose_|show_)/.test(n)).toBe(true);
    expect(names).not.toContain("set_order");
  });
  it("builds the setup with the tools and the instruction", () => {
    const setup = buildSupplierLiveSetup("m").setup;
    expect(setup.model).toBe("models/m");
    expect(setup.tools[0].functionDeclarations).toHaveLength(SUPPLIER_DECLARATIONS.length);
  });
});
