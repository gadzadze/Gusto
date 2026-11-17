# RS.ge e-waybills

Phase 1 (always on): the waybill **data sheet** per confirmed order, to copy into RS.ge. Nothing is sent.
Phase 2 (this document, **off by default**): 202 saves and activates the waybill at RS.ge itself.

## Status: built and tested against a fake RS.ge only

Everything below is unit- and integration-tested with a **fake** RS.ge. It has **not** been run against RS.ge. The
WSDL (`services.rs.ge/WayBillService/WayBillService.asmx?WSDL`) types the waybill as "any XML", so the field names,
codes and rounding in `src/lib/rsge-waybill.ts`, and the answer shapes in `src/server/rsge/client.ts`
(`STATUS`/`ID` of `save_waybill`, the number from `send_waybill`, the unit list), follow RS.ge's published structure
as far as it is known to us. **Before real use, run one supervised test with a real service user** and fix whatever
RS.ge's answers show.

## Safety design

- Off unless `RSGE_ENABLED=1` **and** `RSGE_ENCRYPTION_KEY` is set.
- The service user (username + password from the RS.ge portal) is stored **encrypted** (AES-256-GCM,
  `src/server/rsge/crypto.ts`), never logged, never shown again. Only a company **owner** connects or disconnects.
- On connect, RS.ge's tax id for the service user must equal the company's legal id (`get_tin_from_un_id`), so one
  company cannot use another's credentials.
- Two deliberate steps: **save draft** (nothing in force) -> the supplier can read what RS.ge stored -> **activate**.
- One waybill per order (unique index); the order's waybill row is locked while a call runs, so a double click cannot
  send twice; a draft that RS.ge saved but 202 could not record is deleted again.
- Anything unclear from RS.ge is treated as a refusal. What it cannot represent is refused, not guessed: an
  unknown unit, a VAT rate other than 18% / 0%, a missing vehicle or loading address.
- 0% VAT lines are sent as **VAT-exempt** (RS.ge has "zero-rated" and "exempt"; 202 stores one 0% rate). The UI says so.
- Every step is audited (`rsge.*`), without credentials.

## The fixed IP problem

RS.ge ties a service user to **one IP address** (the address is entered when the user is created, see the RS.ge
portal / `create_service_user`). The app runs on Vercel, whose outgoing addresses are not fixed. Options:

1. **A relay on a machine with a fixed IP** (`ops/rsge-relay/server.mjs`, ~60 lines, Node 20+): set
   `RSGE_RELAY_URL` (its HTTPS address) and `RSGE_RELAY_SECRET` (the same value as the relay's `RELAY_SECRET`, 32+
   characters) in Vercel. Register the relay machine's IP with RS.ge for each company's service user. The relay
   forwards only to `services.rs.ge`, only for callers with the secret, and never logs bodies.
2. A paid Vercel static-IP option, if the plan has it (not verified here).

Without `RSGE_RELAY_URL` the app calls RS.ge directly (fine on a machine with a fixed IP, and for tests).

## Environment

| Variable | Meaning |
|---|---|
| `RSGE_ENABLED` | `1` turns the integration on (settings card and the RS.ge panel on the waybill sheet). |
| `RSGE_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Losing it makes stored credentials unreadable (reconnect). |
| `RSGE_RELAY_URL`, `RSGE_RELAY_SECRET` | Optional relay (above). |

## First supervised test (checklist)

1. A real company with an RS.ge account creates a service user for the relay's IP.
2. Set the four variables, redeploy, connect in Settings (owner).
3. Confirm one small order, open its waybill sheet, fill the loading address / vehicle, **save draft**.
4. Open the draft in the RS.ge portal and compare every field (buyer, addresses, goods, units, quantity, price, amount,
   VAT type). Fix `rsge-waybill.ts` / `client.ts` for any difference; delete test drafts.
5. Only then activate one real waybill, and close it after delivery.
