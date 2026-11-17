import { describe, expect, it, vi } from "vitest";
import { buildWaybillXml, mapUnit, WaybillBuildError, type WaybillOrder } from "@/lib/rsge-waybill";
import { allBlocks, el, firstText, xmlEscape } from "@/lib/rsge-xml";

vi.mock("server-only", () => ({}));

const units = [
  { id: 1, name: "ცალი" },
  { id: 2, name: "კგ" },
  { id: 9, name: "ბოთლი" },
  { id: 99, name: "სხვა" },
];
const order: WaybillOrder = {
  buyerName: 'Café "Lemon" & Co <1>',
  buyerLegalId: "404987654",
  sellerLegalId: "205123456",
  deliveryAddress: "Rustaveli Ave 12",
  deliveryCity: "Tbilisi",
  date: "2026-11-19",
  pricesIncludeVat: true,
  lines: [{ name: "Saperavi 0.75 l", code: "WN-001", unit: "bottle", qtyMilli: 24000, lineTotalMinor: 43200, lineVatMinor: 6590, vatRateBp: 1800 }],
};
const transport = { startAddress: "Warehouse 1", driverName: "Giorgi", driverId: "01010101010", vehicle: "AB-123-CD" };

describe("xml helpers", () => {
  it("escapes everything it writes and reads it back", () => {
    expect(xmlEscape(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
    expect(el("X", "<tag>")).toBe("<X>&lt;tag&gt;</X>");
    expect(el("X", null)).toBe("<X></X>");
    expect(firstText("<a><b>1 &amp; 2</b></a>", "b")).toBe("1 & 2");
    expect(firstText('<s:a xmlns:s="x"><s:b>7</s:b></s:a>', "b")).toBe("7");
    expect(allBlocks("<r><i>1</i><i>2</i></r>", "i")).toEqual(["1", "2"]);
  });
  it("drops control characters that XML cannot carry", () => {
    expect(xmlEscape("a\u0000b\u0008c")).toBe("abc");
  });
});

describe("waybill xml", () => {
  it("maps units from RS.ge's own dictionary and falls back to 'other' with the unit as text", () => {
    expect(mapUnit("bottle", units)).toEqual({ id: 9, text: "" });
    expect(mapUnit("kg", units)).toEqual({ id: 2, text: "" });
    expect(mapUnit("keg", units)).toEqual({ id: 99, text: "კასრი" });
    expect(() => mapUnit("keg", units.filter((u) => u.id !== 99))).toThrow(WaybillBuildError);
  });

  it("builds an escaped waybill with gross amounts and the right VAT type", () => {
    const xml = buildWaybillXml(order, transport, units);
    expect(xml).toContain("<BUYER_NAME>Café &quot;Lemon&quot; &amp; Co &lt;1&gt;</BUYER_NAME>");
    expect(xml).toContain("<BUYER_TIN>404987654</BUYER_TIN>");
    expect(xml).toContain("<END_ADDRESS>Rustaveli Ave 12, Tbilisi</END_ADDRESS>");
    expect(xml).toContain("<QUANTITY>24</QUANTITY>");
    expect(xml).toContain("<AMOUNT>432.00</AMOUNT>");
    expect(xml).toContain("<PRICE>18.0000</PRICE>");
    expect(xml).toContain("<UNIT_ID>9</UNIT_ID>");
    expect(xml).toContain("<VAT_TYPE>0</VAT_TYPE>");
    expect(xml).toContain("<STATUS>0</STATUS>");
  });

  it("adds VAT on top when the supplier prices without VAT, and treats a 0% line as exempt", () => {
    const net = buildWaybillXml({ ...order, pricesIncludeVat: false }, transport, units);
    expect(net).toContain("<AMOUNT>497.90</AMOUNT>"); // 432.00 + 65.90
    const exempt = buildWaybillXml({ ...order, lines: [{ ...order.lines[0], vatRateBp: 0, lineVatMinor: 0 }] }, transport, units);
    expect(exempt).toContain("<VAT_TYPE>2</VAT_TYPE>");
  });

  it("refuses what it cannot represent instead of guessing", () => {
    const fail = (o: WaybillOrder, t = transport) => {
      try {
        buildWaybillXml(o, t, units);
      } catch (e) {
        return (e as WaybillBuildError).code;
      }
      return "no error";
    };
    expect(fail({ ...order, lines: [] })).toBe("empty");
    expect(fail({ ...order, lines: [{ ...order.lines[0], vatRateBp: 500 }] })).toBe("vat_unsupported");
    expect(fail({ ...order, lines: [{ ...order.lines[0], qtyMilli: 0 }] })).toBe("invalid_amount");
    expect(fail(order, { ...transport, vehicle: " " })).toBe("transport_missing");
    expect(fail({ ...order, lines: [{ ...order.lines[0], unit: "keg" }] }, transport)).toBe("no error"); // "other" exists in the dictionary
  });
});

describe("secrets and the RS.ge client", () => {
  it("round-trips a secret and refuses tampering", async () => {
    process.env.RSGE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { sealSecret, openSecret } = await import("@/server/rsge/crypto");
    const sealed = sealSecret("pä$$word");
    expect(sealed).not.toContain("pä$$word");
    expect(openSecret(sealed)).toBe("pä$$word");
    expect(sealSecret("x")).not.toBe(sealSecret("x")); // fresh nonce every time
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openSecret(parts.join("."))).toThrow();
  });

  it("talks to RS.ge through an injectable transport and treats unclear answers as refusals", async () => {
    const { createRsApi, RsError } = await import("@/server/rsge/client");
    const calls: [string, string][] = [];
    const answers: Record<string, string> = {
      chek_service_user: "<r><chek_service_userResult>true</chek_service_userResult><un_id>77</un_id><s_user_id>5</s_user_id></r>",
      save_waybill: "<r><save_waybillResult><RESULT><STATUS>1</STATUS><ID>4242</ID></RESULT></save_waybillResult></r>",
      send_waybill: "<r><send_waybillResult>0123456789</send_waybillResult></r>",
      close_waybill: "<r><close_waybillResult>1</close_waybillResult></r>",
    };
    const api = createRsApi(async (action, body) => {
      calls.push([action, body]);
      return answers[action] ?? "<r/>";
    });
    const creds = { su: "user&1", sp: "pw<2>" };
    expect(await api.checkServiceUser(creds)).toEqual({ payerId: 77, serviceUserId: 5 });
    expect(calls[0][1]).toBe("<su>user&amp;1</su><sp>pw&lt;2&gt;</sp>");
    expect(await api.saveWaybill(creds, "<WAYBILL></WAYBILL>")).toBe(4242);
    expect(await api.sendWaybill(creds, 4242)).toBe("0123456789");
    await expect(api.closeWaybill(creds, 4242)).resolves.toBeUndefined();

    answers.chek_service_user = "<r><chek_service_userResult>false</chek_service_userResult><un_id>0</un_id><s_user_id>0</s_user_id></r>";
    expect(await api.checkServiceUser(creds)).toBeNull();
    answers.save_waybill = "<r><save_waybillResult><RESULT><STATUS>-1</STATUS></RESULT></save_waybillResult></r>";
    await expect(api.saveWaybill(creds, "<WAYBILL/>")).rejects.toBeInstanceOf(RsError);
    answers.send_waybill = "<r><send_waybillResult>-5</send_waybillResult></r>";
    await expect(api.sendWaybill(creds, 1)).rejects.toBeInstanceOf(RsError);
    answers.close_waybill = "<r><close_waybillResult>0</close_waybillResult></r>";
    await expect(api.closeWaybill(creds, 1)).rejects.toBeInstanceOf(RsError);
    await expect(createRsApi(async () => "<nothing/>").checkServiceUser(creds)).rejects.toBeInstanceOf(RsError);
  });
});
