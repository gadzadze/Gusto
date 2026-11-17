import { el } from "@/lib/rsge-xml";

// Builds the XML of a waybill for RS.ge's save_waybill from what 202 knows about a confirmed order.
//
// IMPORTANT: RS.ge's WSDL only says the waybill is "any XML"; the field names, codes and rounding below follow
// RS.ge's published waybill structure as far as it is known to us and have NOT yet been checked against RS.ge
// itself. That is why nothing is activated (sent into force) without a person pressing a separate button after the
// draft is saved, and why the whole integration is off unless RSGE_ENABLED=1. See docs/rsge-integration.md.

/** RS.ge waybill type: 2 = transportation (goods moved by a vehicle between two addresses). */
export const WAYBILL_TYPE_TRANSPORTATION = 2;
/** VAT type on a goods line: 0 = taxed at the standard rate, 2 = VAT-exempt. */
export const VAT_TAXED = 0;
export const VAT_EXEMPT = 2;

export type WaybillOrderLine = {
  name: string;
  /** Product code or barcode, if any. */
  code: string | null;
  /** Our unit key (piece, kg, bottle, ...). */
  unit: string;
  qtyMilli: number;
  /** Line total as priced (before or including VAT, see pricesIncludeVat) and the VAT of the line, in tetri. */
  lineTotalMinor: number;
  lineVatMinor: number;
  vatRateBp: number;
};

export type WaybillOrder = {
  buyerName: string;
  buyerLegalId: string;
  sellerLegalId: string;
  deliveryAddress: string;
  deliveryCity: string;
  /** "YYYY-MM-DD" the goods leave. */
  date: string;
  pricesIncludeVat: boolean;
  lines: WaybillOrderLine[];
};

export type WaybillTransport = { startAddress: string; driverName: string; driverId: string; vehicle: string };

export type RsUnit = { id: number; name: string };

export class WaybillBuildError extends Error {
  constructor(public readonly code: "unit_unmapped" | "vat_unsupported" | "empty" | "transport_missing" | "invalid_amount") {
    super(code);
    this.name = "WaybillBuildError";
  }
}

// What RS.ge may call our units. Matched against RS.ge's own dictionary (fetched per company), never assumed ids.
const UNIT_NAMES: Record<string, string[]> = {
  piece: ["ცალი"],
  kg: ["კგ", "კილოგრამი"],
  g: ["გრ", "გრამი"],
  l: ["ლიტრი", "ლ"],
  ml: ["მლ", "მილილიტრი"],
  box: ["ყუთი"],
  pack: ["შეკვრა", "შეფუთვა", "პაკეტი"],
  case: ["ყუთი"],
  bottle: ["ბოთლი"],
  jar: ["ქილა"],
  bag: ["ტომარა", "პარკი"],
  sack: ["ტომარა", "ტომარა (ტომრები)"],
  keg: ["კასრი"],
  pallet: ["პალეტი"],
  bunch: ["კონა"],
  roll: ["რულონი"],
  bucket: ["ვედრო"],
};
const OTHER_NAMES = ["სხვა"];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The RS.ge unit id for one of our units, with the free text RS.ge wants when the unit is "other". */
export function mapUnit(unit: string, dictionary: RsUnit[]): { id: number; text: string } {
  const byName = new Map(dictionary.map((u) => [norm(u.name), u.id]));
  for (const candidate of UNIT_NAMES[unit] ?? []) {
    const id = byName.get(norm(candidate));
    if (id !== undefined) return { id, text: "" };
  }
  for (const candidate of OTHER_NAMES) {
    const id = byName.get(norm(candidate));
    if (id !== undefined) return { id, text: UNIT_NAMES[unit]?.[0] ?? unit };
  }
  throw new WaybillBuildError("unit_unmapped");
}

const decimal = (minor: number, places = 2) => (minor / 100).toFixed(places);
const quantity = (milli: number) => (milli / 1000).toFixed(3).replace(/\.?0+$/, "");

/** Gross (VAT included) amount of a line in tetri, whatever way the supplier prices. */
function grossMinor(line: WaybillOrderLine, pricesIncludeVat: boolean): number {
  return pricesIncludeVat ? line.lineTotalMinor : line.lineTotalMinor + line.lineVatMinor;
}

export function buildWaybillXml(order: WaybillOrder, transport: WaybillTransport, units: RsUnit[]): string {
  if (order.lines.length === 0) throw new WaybillBuildError("empty");
  if (!transport.startAddress.trim() || !transport.vehicle.trim()) throw new WaybillBuildError("transport_missing");
  const goods = order.lines
    .map((line) => {
      if (line.vatRateBp !== 1800 && line.vatRateBp !== 0) throw new WaybillBuildError("vat_unsupported");
      if (line.qtyMilli <= 0) throw new WaybillBuildError("invalid_amount");
      const unit = mapUnit(line.unit, units);
      const gross = grossMinor(line, order.pricesIncludeVat);
      // Unit price is the gross amount per unit, to four places so amount and price agree as closely as possible.
      const price = (gross / 100 / (line.qtyMilli / 1000)).toFixed(4);
      return (
        "<GOODS>" +
        el("ID", 0) +
        el("W_NAME", line.name) +
        el("UNIT_ID", unit.id) +
        el("UNIT_TXT", unit.text) +
        el("QUANTITY", quantity(line.qtyMilli)) +
        el("PRICE", price) +
        el("AMOUNT", decimal(gross)) +
        el("BAR_CODE", line.code) +
        el("A_ID", 0) +
        el("VAT_TYPE", line.vatRateBp === 1800 ? VAT_TAXED : VAT_EXEMPT) +
        "</GOODS>"
      );
    })
    .join("");
  return (
    "<WAYBILL>" +
    `<GOODS_LIST>${goods}</GOODS_LIST>` +
    el("ID", 0) +
    el("TYPE", WAYBILL_TYPE_TRANSPORTATION) +
    el("BEGIN_DATE", `${order.date}T00:00:00`) +
    el("BUYER_TIN", order.buyerLegalId) +
    el("CHEK_BUYER_TIN", 1) +
    el("BUYER_NAME", order.buyerName) +
    el("START_ADDRESS", transport.startAddress) +
    el("END_ADDRESS", `${order.deliveryAddress}, ${order.deliveryCity}`) +
    el("DRIVER_TIN", transport.driverId) +
    el("CHEK_DRIVER_TIN", transport.driverId ? 1 : 0) +
    el("DRIVER_NAME", transport.driverName) +
    el("CAR_NUMBER", transport.vehicle) +
    el("TRANS_ID", 1) +
    el("STATUS", 0) +
    "</WAYBILL>"
  );
}
