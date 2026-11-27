import { catalogueText, GEORGIAN_LISTENING, reconcileUnit, type CatalogItem, type UnitCheck } from "@/lib/voice/order-parse";

// Live voice mode (experiment): pure pieces. The instructions and the one tool the assistant may call, and the clean-up of
// what the model sends back. The model only ever proposes the order; units are settled by `reconcileUnit`, never by the model.

/** Checked against Google's model list on 2026-11-25 (`bidiGenerateContent`). Override with GEMINI_LIVE_MODEL. */
export const LIVE_MODEL = "gemini-3.8-live";

/** A live session closes by itself after this long: live audio is billed for as long as it is open. */
export const LIVE_MAX_SECONDS = 600;

export const SET_ORDER = "set_order";

/**
 * How the assistant must speak. From the project's Georgian language skill (Shanidze's grammar): formal polite register, the noun stays
 * singular after a number, simple frames instead of invented forms. The sentences are given as exact patterns because a general
 * "speak correctly" did not stop invented words ("შეკვეთილი") or a read-back without quantities.
 */
export const GEORGIAN_SPEAKING = [
  "How you speak Georgian (correct, natural, spoken):",
  "- Formal polite register: 'თქვენ' with plural verb forms (გსურთ, გთხოვთ, გადაამოწმოთ). Short sentences, one idea each. Never translate word by word from English or Russian.",
  "- After a number the noun stays singular and the unit word does not change: ორი ყუთი ლუდი, სამი კილო კარაქი, ხუთი ბოთლი (never plural after a number).",
  "- Use these verbs for order actions and no others: დავამატე (added), წავშალე (removed), გავასწორე (corrected). Name the product in the nominative after the quantity, as in the patterns below.",
  "- If you are unsure of a Georgian form, do not invent one: use a simpler sentence or the list pattern.",
  "- Say numbers as words, never as digits, and keep them correct: 11 თერთმეტი, 15 თხუთმეტი, 20 ოცი, 25 ოცდახუთი, 40 ორმოცი, 100 ასი, 1,5 ერთნახევარი, 2,5 ორნახევარი.",
  "- Speak in your own natural spoken Georgian, not in headline style: use a short polite lead-in only when it helps (კარგით, გასაგებია), never repeat the same opening twice in a row, and never praise the buyer.",
  "Patterns (use them as they are when they fit):",
  "- Added: «დავამატე: ორი კილო სულგუნი.»",
  "- Removed: «წავშალე: ნაღები.»",
  "- Corrected: «გავასწორე: ექვსი კილო პომიდორი.»",
  "- Unit question: «ნაღები იყიდება ლიტრებით. რამდენი ლიტრი გსურთ?»",
  "- Which supplier: «სულგუნი ორივე მომწოდებელს აქვს. რომლისგან გსურთ: მომწოდებელი ა-სგან თუ მომწოდებელი ბ-სგან?»",
  "- Not in the catalogue: «კატალოგში ლიმონათი არ არის. ხომ არ გულისხმობთ ლიმონს?»",
  "- Did not understand: «ვერ გავიგე, გთხოვთ, გაიმეოროთ.»",
  "- Read-back at the end: first say «თქვენი შეკვეთა:», then list EVERY line with its quantity, product names in the nominative, in the form «სულგუნი: ორი კილო; კარაქი: სამი კილო.» (group by supplier when there are several: «მომწოდებელი ა: ... მომწოდებელი ბ: ...»), then say exactly «შეკვეთა ეკრანზეა, გთხოვთ, გადაამოწმოთ.»",
].join("\n");

export type LiveMode = "test" | "buyer";

/** The lookups a buyer's assistant has (see server/assistant/buyer-tools.ts). They only read: ordering stays with `set_order` and the review. */
export const LOOKUP_DECLARATIONS = [
  { name: "search_products", description: "Search the products this buyer can order, with their own prices, across all their suppliers. Use it for any question about a product, its price or its supplier.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "What to look for, in the buyer's words (a product name or part of it)." } }, required: ["query"] } },
  { name: "list_suppliers", description: "The suppliers this buyer is connected to, with minimum order, delivery area and terms.", parameters: { type: "OBJECT", properties: {} } },
  { name: "list_orders", description: "The buyer's recent orders with status, total and delivery day. Set open_only for orders still in progress.", parameters: { type: "OBJECT", properties: { open_only: { type: "BOOLEAN" } } } },
  { name: "get_order", description: "One order of this buyer by its number (the digits after GST-), with its lines, status and delivery day.", parameters: { type: "OBJECT", properties: { number: { type: "NUMBER" } }, required: ["number"] } },
  { name: "get_cart", description: "What is in this buyer's carts right now, per supplier, with totals.", parameters: { type: "OBJECT", properties: {} } },
  { name: "suggest_reorder", description: "Products this buyer reorders regularly whose usual gap has nearly passed (probably running low).", parameters: { type: "OBJECT", properties: {} } },
  { name: "propose_cart_change", description: "Propose changing the cart for one product. Nothing changes until the buyer taps the button on the card. mode add adds to what is in the cart, set replaces it, remove takes it out.", parameters: { type: "OBJECT", properties: { product_id: { type: "STRING", description: "The product id from the catalogue or from a search result." }, quantity: { type: "NUMBER" }, mode: { type: "STRING", enum: ["add", "set", "remove"] }, spoken_unit: { type: "STRING", description: "The unit exactly as the buyer said it, if any." } }, required: ["product_id", "quantity"] } },
  { name: "propose_reorder", description: "Propose putting a previous order of this buyer back in the cart (order again). Nothing changes until the buyer taps the button on the card.", parameters: { type: "OBJECT", properties: { number: { type: "NUMBER", description: "The order number, the digits after GST-." } }, required: ["number"] } },
  { name: "propose_regular_order", description: "Propose saving a previous order as a regular order with a weekday reminder (1 Monday to 7 Sunday). Nothing changes until the buyer taps the button on the card.", parameters: { type: "OBJECT", properties: { number: { type: "NUMBER" }, weekday: { type: "NUMBER" }, name: { type: "STRING" } }, required: ["number", "weekday"] } },
  { name: "show_choices", description: "When it is unclear which of two to five things the buyer means, show them as buttons instead of asking aloud. Then wait for the pick.", parameters: { type: "OBJECT", properties: { question: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } } }, required: ["question", "options"] } },
] as const;

export const LOOKUP_NAMES: readonly string[] = LOOKUP_DECLARATIONS.map((d) => d.name);

export function liveSystemInstruction(items: CatalogItem[], mode: LiveMode = "test", previous = ""): string {
  const catalogue = catalogueText(items);
  return [
    "You are a voice assistant inside a wholesale ordering app in Georgia. The person talking is a restaurant or cafe buyer ordering from ONE supplier.",
    "Speak Georgian only. One or two sentences per answer, except the final read-back.",
    GEORGIAN_SPEAKING,
    GEORGIAN_LISTENING,
    "Use ONLY the products in the catalogue below. Never invent a product, an id or a price (you do not know any prices).",
    "The catalogue may list several suppliers, and the same product can be sold by more than one (each with its own id). If the buyer names a supplier ('from supplier A'), use that supplier's ids. If they do not and several suppliers sell the product, ask which supplier BEFORE calling the tool. The order is kept separately for each supplier; never mix suppliers in one sentence of yours without saying which.",
    `Whenever the order changes (a product added, removed, or a quantity corrected), call ${SET_ORDER} with the COMPLETE current order, not only the change.`,
    "In each line, productId is a catalogue id and quantity is the number said. spokenUnit is the unit exactly as the buyer said it (for example 'კილო', 'ცალი', 'ყუთი', 'გრამი'), never converted or corrected. Leave it out if no unit was said. spokenName is the product name exactly as the buyer said it, without the number or the unit (for example 'ყველი' when they said 'ორი კილო ყველი').",
    "If the buyer corrects themselves ('five kilos... no, six'), use the final value.",
    "If a name fits several products (for example just 'cheese' when there are two cheeses), ask which one BEFORE calling the tool. Do not guess.",
    `If the tool answer lists needs_attention, ask the buyer about each item in one short sentence, then call ${SET_ORDER} again with the corrected order.`,
    "If you hear no clear speech, only noise, music or a tone, say nothing and do not change the order. Never invent an order.",
    "If the buyer asks for something that is not in the catalogue (for example lemonade when only lemons exist), say you do not have it and ask whether they meant the closest product. Never swap a product silently.",
    "After the read-back, stay silent unless the buyer changes the order or asks about it. No small talk and no goodbyes.",
    "You cannot send the order, and you do not know what the screen looks like. When the buyer says they are done, do the read-back from the patterns above and say nothing else about the screen.",
    mode === "test"
      ? "If the buyer asks about sending, a button, or where to click, answer exactly: «ეს ტესტია, არაფერი იგზავნება.» Never mention sending, buttons or pressing anything in any other way."
      : "If the buyer asks about sending, a button, or where to click, answer exactly: «გაგზავნამდე შეკვეთას ეკრანზე გადაამოწმებთ.» Never mention sending, buttons or pressing anything in any other way.",
    mode === "buyer"
      ? "You never change anything yourself. To change the cart, order again or save a regular order, call propose_cart_change, propose_reorder or propose_regular_order: they only show a card, and the buyer taps its button. Say in one short sentence what the card shows and that it needs their tap. When you are not sure which of a few products or orders the buyer means, call show_choices with their names instead of guessing or asking at length. You can also look up anything the buyer could see by hand with these tools: search_products (products and their prices at the buyer's own suppliers), list_suppliers, list_orders, get_order and get_cart. Use a tool for every question about a price, a product, a supplier, an order or the cart: never answer those from memory, and never guess. Answer in one or two short sentences with the facts the tool returned; the app shows the details on screen as a card, so do not read long lists aloud. set_order takes only ids from the catalogue below; for a product from a search that is not in the catalogue, use propose_cart_change with the id the search returned."
      : "",
    previous
      ? "When the buyer says 'the usual', 'same as last time' or 'as before', start from the usual order of that supplier listed below (copy its lines into the order), then apply what they change ('but no cream', 'double the tomatoes'). Say in one sentence what you copied. Never invent a usual order that is not listed."
      : "",
    "",
    "Catalogue (id | name | unit). An 'also said' list after a product is how this buyer usually names it: treat those words as that product.",
    catalogue,
    previous ? `\nUsual order per supplier (id quantity unit):\n${previous}` : "",
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
            spokenName: { type: "STRING", description: "The product name exactly as the buyer said it (the words, without the number or the unit). Omit when unsure." },
          },
          required: ["productId", "quantity"],
        },
      },
      deliveryDay: { type: "STRING", description: "The day the buyer wants delivery, as said. Omit when none was said." },
    },
    required: ["lines"],
  },
} as const;

/**
 * Words that bias the speech-to-text of what the buyer says (the on-screen transcript): product and supplier names, units and the
 * few action words. Without a language hint and these, short answers came out as "exhibir" or "I want to". The assistant itself hears
 * the audio directly, so this only affects the transcript the tester reads.
 */
export function liveVocabulary(items: CatalogItem[]): string[] {
  const words = new Set<string>();
  for (const item of items) {
    words.add(item.name);
    if (item.supplierName) words.add(item.supplierName);
  }
  for (const w of ["კილო", "კგ", "გრამი", "ლიტრი", "ცალი", "ყუთი", "კოლოფი", "შეკვრა", "ბოთლი", "ნახევარი", "კილონახევარი", "მინდა", "აღარ მინდა", "ვამთავრებ", "მომწოდებელი"]) words.add(w);
  return [...words].slice(0, 80);
}

/** The first message after the socket opens. Kept on the server so the instructions are built next to the rules. */
export function buildLiveSetup(items: CatalogItem[], model: string, mode: LiveMode = "test", previous = "") {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: liveSystemInstruction(items, mode, previous) }] },
      tools: [{ functionDeclarations: mode === "buyer" ? [SET_ORDER_DECLARATION, ...LOOKUP_DECLARATIONS] : [SET_ORDER_DECLARATION] }],
      inputAudioTranscription: { languageCodes: ["ka-GE"], customVocabulary: liveVocabulary(items) },
      outputAudioTranscription: {},
    },
  };
}

export type LiveOrderLine = {
  productId: string;
  productName: string;
  supplierName: string | null;
  /** Thousandths of the unit, null when the number was unusable. */
  quantityMilli: number | null;
  /** The unit the quantity is in (the catalogue's, unless it was a mismatch). */
  unit: string | null;
  spokenUnit: string | null;
  /** The product name as the buyer said it, so the app can remember how this buyer names things. */
  spokenName: string | null;
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
    const spokenName = typeof l.spokenName === "string" && l.spokenName.trim() ? l.spokenName.trim().slice(0, 60) : null;
    const settled = reconcileUnit(q, spokenUnit, product.unit);
    if (settled.quantityMilli === null) attention.push({ product: product.name, problem: "bad_quantity" });
    if (settled.unitCheck === "mismatch") attention.push({ product: product.name, problem: "unit_mismatch", said: spokenUnit ?? "", sold_in: product.unit });
    // The last line for a product wins, so a repeated id corrects instead of doubling.
    lines.set(product.id, {
      productId: product.id,
      productName: product.name,
      supplierName: product.supplierName ?? null,
      quantityMilli: settled.quantityMilli,
      unit: settled.unit,
      spokenUnit,
      spokenName,
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
