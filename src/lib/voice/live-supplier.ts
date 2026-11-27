import { GEORGIAN_LISTENING } from "@/lib/voice/order-parse";
import { GEORGIAN_SPEAKING } from "@/lib/voice/live";

// The supplier's assistant (pure pieces; the lookups run on the server, see server/assistant/supplier-tools.ts). It has no catalogue in
// its prompt: it asks the lookups. It never changes anything itself: every change is a proposal card the supplier taps.

export const SUPPLIER_DECLARATIONS = [
  { name: "list_pending_orders", description: "The orders waiting for this supplier's answer (oldest first) with buyer, total and age.", parameters: { type: "OBJECT", properties: {} } },
  { name: "list_orders", description: "Orders by tab: new (waiting), confirmed (to deliver), done (delivered, rejected, cancelled).", parameters: { type: "OBJECT", properties: { tab: { type: "STRING", enum: ["new", "confirmed", "done"] } } } },
  { name: "get_order", description: "One order by its number (the digits after GST-) with its lines.", parameters: { type: "OBJECT", properties: { number: { type: "NUMBER" } }, required: ["number"] } },
  { name: "list_customers", description: "This supplier's customers with status and price list.", parameters: { type: "OBJECT", properties: {} } },
  { name: "find_products", description: "Search this supplier's own products (name or code) with price, stock and whether visible. restock_only lists products with stock 0 or below, hidden_only the hidden ones. Returns the uuid needed by the propose tools.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, restock_only: { type: "BOOLEAN" }, hidden_only: { type: "BOOLEAN" } } } },
  { name: "loading_sheet", description: "What to load for one delivery day: totals per product for the confirmed orders. day is today, tomorrow, a date YYYY-MM-DD, or none (confirmed orders with no agreed day).", parameters: { type: "OBJECT", properties: { day: { type: "STRING" } } } },
  { name: "propose_confirm_orders", description: "Propose confirming pending orders as ordered. Nothing changes until the supplier taps the button on the card.", parameters: { type: "OBJECT", properties: { numbers: { type: "ARRAY", items: { type: "NUMBER" } } }, required: ["numbers"] } },
  { name: "propose_reject_order", description: "Propose rejecting one pending order with a reason the buyer will see. Ask for the reason if the supplier did not give one.", parameters: { type: "OBJECT", properties: { number: { type: "NUMBER" }, reason: { type: "STRING" } }, required: ["number", "reason"] } },
  { name: "propose_mark_delivered", description: "Propose marking confirmed orders as delivered.", parameters: { type: "OBJECT", properties: { numbers: { type: "ARRAY", items: { type: "NUMBER" } } }, required: ["numbers"] } },
  { name: "propose_set_active", description: "Propose hiding (active false) or showing (active true) products, by the uuids from find_products.", parameters: { type: "OBJECT", properties: { product_ids: { type: "ARRAY", items: { type: "STRING" } }, active: { type: "BOOLEAN" } }, required: ["product_ids", "active"] } },
  { name: "propose_set_price", description: "Propose a new base price (in the currency's main unit, e.g. 12.5) for one product, by its uuid from find_products.", parameters: { type: "OBJECT", properties: { product_id: { type: "STRING" }, price: { type: "NUMBER" } }, required: ["product_id", "price"] } },
  { name: "show_choices", description: "When it is unclear which of two to five things the supplier means, show them as buttons instead of asking aloud. Then wait for the pick.", parameters: { type: "OBJECT", properties: { question: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } } }, required: ["question", "options"] } },
] as const;

export const SUPPLIER_TOOL_NAMES: readonly string[] = SUPPLIER_DECLARATIONS.map((d) => d.name);

export function supplierSystemInstruction(): string {
  return [
    "You are a voice assistant inside a wholesale ordering app in Georgia. The person talking is a supplier (distributor or producer) managing their incoming orders, customers and products.",
    "Speak Georgian only. One or two sentences per answer.",
    GEORGIAN_SPEAKING,
    GEORGIAN_LISTENING,
    "Never answer from memory about orders, customers, products, prices or stock: call the lookup first, and only repeat what it returned. If a lookup finds nothing or fails, say so.",
    "Lookups show a card on screen. Do not read the whole list aloud: give the count and at most three of the most relevant items.",
    "You never change anything yourself. To confirm, reject or mark orders delivered, hide or show products, or change a price, call the matching propose_ tool: it only shows a card, and the supplier taps its button. Say in one short sentence that the card is ready to check, and never say that something was done before the supplier has tapped the button.",
    "Confirming means confirming exactly as ordered. If the supplier wants other quantities or a delivery day, say that this is done on the order's own screen and offer to open it.",
    "A rejection needs a reason the buyer will see. If none was given, ask for it before calling propose_reject_order.",
    "Order numbers are the digits after GST-. Find products with find_products first and pass its uuid to the propose tools. If a name fits several products, call show_choices instead of guessing.",
    "Changing prices is the riskiest request: always check the product first with find_products, and use the exact figure the supplier said.",
    "If you hear no clear speech, only noise, music or a tone, say nothing.",
  ].join("\n");
}

export function buildSupplierLiveSetup(model: string) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: supplierSystemInstruction() }] },
      tools: [{ functionDeclarations: [...SUPPLIER_DECLARATIONS] }],
      inputAudioTranscription: { languageCodes: ["ka-GE"] },
      outputAudioTranscription: {},
    },
  };
}
