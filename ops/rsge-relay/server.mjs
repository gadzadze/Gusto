// A tiny relay for RS.ge. RS.ge ties a service user to ONE fixed IP address, and the app's host (Vercel) has no
// fixed outgoing address, so the app sends its RS.ge SOAP calls here and this machine (which has a fixed IP, and
// is the address registered with RS.ge) forwards them. It does nothing else:
//  - only POST to "/", only with "Authorization: Bearer $RELAY_SECRET";
//  - the target is always services.rs.ge (never taken from the request);
//  - bodies are capped, forwarded as is and never logged (they contain RS.ge credentials).
// Run:  RELAY_SECRET=... node server.mjs   (Node 20+; put it behind HTTPS, e.g. a reverse proxy or a tunnel)
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const TARGET = "https://services.rs.ge/WayBillService/WayBillService.asmx";
const SECRET = process.env.RELAY_SECRET ?? "";
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BYTES = 256 * 1024;
if (SECRET.length < 32) {
  console.error("RELAY_SECRET must be at least 32 characters.");
  process.exit(1);
}

const authorized = (header) => {
  const given = Buffer.from(String(header ?? ""));
  const wanted = Buffer.from(`Bearer ${SECRET}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
};

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return void res.writeHead(200).end("ok");
  if (req.method !== "POST" || req.url !== "/" || !authorized(req.headers.authorization)) return void res.writeHead(404).end();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) return void res.writeHead(413).end();
    chunks.push(chunk);
  }
  try {
    const upstream = await fetch(TARGET, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: String(req.headers.soapaction ?? "") },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(20_000),
    });
    res.writeHead(upstream.status, { "Content-Type": "text/xml; charset=utf-8" }).end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.writeHead(502).end();
  }
}).listen(PORT, () => console.log(`RS.ge relay listening on :${PORT}`));
