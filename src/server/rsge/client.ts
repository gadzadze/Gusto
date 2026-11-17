import "server-only";
import { allBlocks, el, firstRaw, firstText, xmlEscape } from "@/lib/rsge-xml";

// A small client for RS.ge's WayBill SOAP service (https://services.rs.ge/WayBillService/WayBillService.asmx).
//
// RS.ge ties a service user to ONE fixed IP address, and Vercel's outgoing addresses are not fixed, so calls can
// go through a relay on a machine with a fixed address (ops/rsge-relay): set RSGE_RELAY_URL and RSGE_RELAY_SECRET.
// With no relay the calls go straight to RS.ge (fine for a machine with a fixed IP, and for tests with a fake
// transport). The transport is injectable so nothing in the tests touches the network.

export const RSGE_ENDPOINT = "https://services.rs.ge/WayBillService/WayBillService.asmx";
const NAMESPACE = "http://tempuri.org/";
const TIMEOUT_MS = 20_000;

export type RsCredentials = { su: string; sp: string };
/** Sends one SOAP action with its (already escaped) body elements and returns the response XML. */
export type RsTransport = (action: string, bodyXml: string) => Promise<string>;

export class RsError extends Error {
  constructor(
    public readonly code: "unreachable" | "rejected" | "bad_response",
    message: string,
  ) {
    super(message);
    this.name = "RsError";
  }
}

export function envelope(action: string, inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${action} xmlns="${NAMESPACE}">${inner}</${action}></soap:Body></soap:Envelope>`;
}

/** The real transport: through the relay when configured, else directly. Credentials are in the body, never in logs. */
export const defaultTransport: RsTransport = async (action, bodyXml) => {
  const relay = process.env.RSGE_RELAY_URL;
  const url = relay || RSGE_ENDPOINT;
  const headers: Record<string, string> = { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${NAMESPACE}${action}"` };
  if (relay) {
    const secret = process.env.RSGE_RELAY_SECRET;
    if (!secret) throw new RsError("unreachable", "RSGE_RELAY_SECRET is not set.");
    headers.Authorization = `Bearer ${secret}`;
  }
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body: envelope(action, bodyXml), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new RsError("unreachable", "RS.ge did not answer.");
  }
  const text = await response.text();
  if (!response.ok) throw new RsError("unreachable", `RS.ge answered with HTTP ${response.status}.`);
  return text;
};

const creds = (c: RsCredentials) => el("su", c.su) + el("sp", c.sp);

export type RsApi = ReturnType<typeof createRsApi>;

export function createRsApi(transport: RsTransport = defaultTransport) {
  return {
    /** Checks a service user. Returns the RS.ge taxpayer id and service-user id, or null when RS.ge refuses them. */
    async checkServiceUser(c: RsCredentials): Promise<{ payerId: number; serviceUserId: number } | null> {
      const xml = await transport("chek_service_user", creds(c));
      const ok = firstText(xml, "chek_service_userResult");
      if (ok === null) throw new RsError("bad_response", "Unexpected answer from RS.ge.");
      if (ok !== "true") return null;
      const payerId = Number(firstText(xml, "un_id"));
      const serviceUserId = Number(firstText(xml, "s_user_id"));
      if (!Number.isInteger(payerId) || !Number.isInteger(serviceUserId)) throw new RsError("bad_response", "Unexpected answer from RS.ge.");
      return { payerId, serviceUserId };
    },

    /** The tax id (and name) of the taxpayer a service user belongs to: proves the credentials are this company's. */
    async tinFromUnId(c: RsCredentials, unId: number): Promise<string | null> {
      const xml = await transport("get_tin_from_un_id", `${creds(c)}${el("un_id", unId)}`);
      const tin = firstText(xml, "get_tin_from_un_idResult");
      return tin && tin.length > 0 ? tin : null;
    },

    /** RS.ge's unit dictionary: id and name. */
    async units(c: RsCredentials): Promise<{ id: number; name: string }[]> {
      const xml = await transport("get_waybill_units", creds(c));
      return allBlocks(xml, "WAYBILL_UNIT").map((block) => ({ id: Number(firstText(block, "ID")), name: firstText(block, "NAME") ?? "" })).filter((u) => Number.isInteger(u.id));
    },

    /** Saves a waybill as a DRAFT in RS.ge (not yet in force). Returns RS.ge's id for it. */
    async saveWaybill(c: RsCredentials, waybillXml: string): Promise<number> {
      const xml = await transport("save_waybill", `${creds(c)}<waybill>${waybillXml}</waybill>`);
      const status = Number(firstText(xml, "STATUS"));
      const id = Number(firstText(xml, "ID"));
      // RS.ge answers a status; anything but a positive status with an id is a refusal (negative = an error code).
      if (!Number.isFinite(status) || status <= 0 || !Number.isInteger(id) || id <= 0) {
        throw new RsError("rejected", `RS.ge refused the waybill (status ${Number.isFinite(status) ? status : "unknown"}).`);
      }
      return id;
    },

    /** Activates a saved waybill (it is now in force). Returns RS.ge's waybill number. */
    async sendWaybill(c: RsCredentials, waybillId: number): Promise<string> {
      const xml = await transport("send_waybill", `${creds(c)}${el("waybill_id", waybillId)}`);
      const result = firstText(xml, "send_waybillResult");
      if (!result || /^-?\d+$/.test(result) && Number(result) <= 0) throw new RsError("rejected", `RS.ge did not activate the waybill (${result ?? "no answer"}).`);
      return result;
    },

    /** Closes a waybill (the goods arrived). */
    async closeWaybill(c: RsCredentials, waybillId: number): Promise<void> {
      const xml = await transport("close_waybill", `${creds(c)}${el("waybill_id", waybillId)}`);
      if (Number(firstText(xml, "close_waybillResult")) <= 0) throw new RsError("rejected", "RS.ge did not close the waybill.");
    },

    /** Deletes a DRAFT waybill. */
    async deleteWaybill(c: RsCredentials, waybillId: number): Promise<void> {
      const xml = await transport("del_waybill", `${creds(c)}${el("waybill_id", waybillId)}`);
      if (Number(firstText(xml, "del_waybillResult")) <= 0) throw new RsError("rejected", "RS.ge did not delete the waybill.");
    },

    /** The waybill as RS.ge stored it (its raw XML), so the supplier can check it before activating. */
    async getWaybill(c: RsCredentials, waybillId: number): Promise<string> {
      const xml = await transport("get_waybill", `${creds(c)}${el("waybill_id", waybillId)}`);
      const inner = firstRaw(xml, "get_waybillResult");
      return inner ?? xml;
    },
  };
}

export { xmlEscape };
