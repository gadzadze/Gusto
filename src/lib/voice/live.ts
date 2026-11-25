import { reconcileUnit, type CatalogItem, type UnitCheck } from "@/lib/voice/order-parse";

// Live voice mode (experiment): pure pieces. The instructions and the one tool the assistant may call, and the clean-up of
// what the model sends back. The model only ever proposes the order; units are settled by `reconcileUnit`, never by the model.

/** Checked against Google's model list on 2026-11-25 (`bidiGenerateContent`). Override with GEMINI_LIVE_MODEL. */
export const LIVE_MODEL = "gemini-3.8-live";

/** A live session closes by itself after this long: live audio is billed for as long as it is open. */
export const LIVE_MAX_SECONDS = 600;

export const SET_ORDER = "set_order";

export function liveSystemInstruction(items: CatalogItem[]): string {
  const catalogue = items.map((i) => `${i.id} | ${i.name} | ${i.unit}`).join("\n");
  return [
    "You are a voice assistant inside a wholesale ordering app in Georgia. The person talking is a restaurant or cafe buyer ordering from ONE supplier.",
    "Speak Georgian, politely (the formal 'თქვენ' form), in short sentences. One or two sentences per answer.",
    "Use ONLY the products in the catalogue below. Never invent a product, an id or a price (you do not know any prices).",
    `Whenever the order changes (a product added, removed, or a quantity corrected), call ${SET_ORDER} with the COMPLETE current order, not only the change.`,
    "In each line, productId is a catalogue id and quantity is the number said. spokenUnit is the unit exactly as the buyer said it (for example 'კილო', 'ცალი', 'ყუთი', 'გრამი'), never converted or corrected. Leave it out if no unit was said.",
    "If the buyer corrects themselves ('five kilos... no, six'), use the final value.",
    "If a name fits several products (for example just 'cheese' when there are two cheeses), ask which one BEFORE calling the tool. Do not guess.",
    `If the tool answer lists needs_attention, ask the buyer about each item in one short sentence, then call ${SET_ORDER} again with the corrected order.`,
    "If you hear no clear speech, only noise, music or a tone, say nothing and do not change the order. Never invent an order.",
    "If the buyer asks for something that is not in the catalogue (for example lemonade when only lemons exist), say you do not have it and ask whether they meant the closest product. Never swap a product silently.",
    "You cannot send the order, and you do not know what the screen looks like. Never describe the screen, a button or where to find one. When the buyer says they are done, read the order back briefly and say it is shown on the screen for them to check. If they ask where to send it, say this is a test and nothing is sent.",
    "",
    "Catalogue (id | name | unit):",
    catalogue,
  ].join("\n");
}

export const SET_ORDER_DECLARATION = {
  name: SET_ORDER,
  description: "Replace the whole current order with these lines. Call it with the complete order every time something changes.",
  parameters: {
    type: "OBJECT",
    properties: {
      lines: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            productId: { type: "STRING", description: "A catalogue id." },
            quantity: { type: "NUMBER", description: "The number said, in the unit said." },
            spokenUnit: { type: "STRING", description: "The unit exactly as the buyer said it. Omit when none was said." },
          },
          required: ["productId", "quantity"],
        },
      },
      deliveryDay: { type: "STRING", description: "The day the buyer wants delivery, as said. Omit when none was said." },
    },
    required: ["lines"],
  },
} as const;

/** The first message after the socket opens. Kept on the server so the instructions are built next to the rules. */
export function buildLiveSetup(items: CatalogItem[], model: string) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: liveSystemInstruction(items) }] },
      tools: [{ functionDeclarations: [SET_ORDER_DECLARATION] }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

export type LiveOrderLine = {
  productId: string;
  productName: string;
  /** Thousandths of the unit, null when the number was unusable. */
  quantityMilli: number | null;
  /** The unit the quantity is in (the catalogue's, unless it was a mismatch). */
  unit: string | null;
  spokenUnit: string | null;
  catalogUnit: string;
  unitCheck: UnitCheck;
};

export type SetOrderFeedback = {
  status: "saved";
  lines: number;
  needs_attention: { product: string; problem: "unit_mismatch" | "bad_quantity"; said?: string; sold_in?: string }[];
  unknown_ids: string[];
};

const MAX_LINES = 50;

/** Never trusts the model's arguments: ids must be in the catalogue, numbers are range-checked, units settled in code. */
export function applySetOrder(
  args: unknown,
  items: CatalogItem[],
): { lines: LiveOrderLine[]; deliveryDay: string | null; feedback: SetOrderFeedback } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const raw = Array.isArray(obj.lines) ? obj.lines.slice(0, MAX_LINES) : [];
  const lines = new Map<string, LiveOrderLine>();
  const unknown: string[] = [];
  const attention: SetOrderFeedback["needs_attention"] = [];
  for (const entry of raw) {
    const l = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const id = typeof l.productId === "string" ? l.productId : "";
    const product = byId.get(id);
    if (!product) {
      if (id) unknown.push(id.slice(0, 30));
      continue;
    }
    const q = typeof l.quantity === "number" && Number.isFinite(l.quantity) ? l.quantity : null;
    const spokenUnit = typeof l.spokenUnit === "string" && l.spokenUnit.trim() ? l.spokenUnit.trim().slice(0, 20) : null;
    const settled = reconcileUnit(q, spokenUnit, product.unit);
    if (settled.quantityMilli === null) attention.push({ product: product.name, problem: "bad_quantity" });
    if (settled.unitCheck === "mismatch") attention.push({ product: product.name, problem: "unit_mismatch", said: spokenUnit ?? "", sold_in: product.unit });
    // The last line for a product wins, so a repeated id corrects instead of doubling.
    lines.set(product.id, {
      productId: product.id,
      productName: product.name,
      quantityMilli: settled.quantityMilli,
      unit: settled.unit,
      spokenUnit,
      catalogUnit: product.unit,
      unitCheck: settled.unitCheck,
    });
  }
  const day = typeof obj.deliveryDay === "string" ? obj.deliveryDay.trim().slice(0, 80) : "";
  return {
    lines: [...lines.values()],
    deliveryDay: day || null,
    feedback: { status: "saved", lines: lines.size, needs_attention: attention, unknown_ids: unknown },
  };
}
