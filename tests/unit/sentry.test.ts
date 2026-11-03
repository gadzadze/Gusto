import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { afterEach, describe, expect, it } from "vitest";
import { sentryOptions } from "@/lib/sentry-config";
import { sentryDsn, sentryIngestOrigin } from "@/lib/sentry-dsn";
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from "@/lib/sentry-scrub";

const INVITE_TOKEN = "q3Vf8b2Zk0hXw9Lr5Tn1Yc7Ud4Pa6Jg8Se2Mo3Ki0Bx"; // 43 chars, like a real one
const UUID = "0b7c2d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e";

describe("scrubText", () => {
  it("removes email addresses", () => {
    expect(scrubText("duplicate key: (buyer@restaurant.ge) already exists")).toBe("duplicate key: ([email]) already exists");
  });

  it("removes URL-encoded email addresses", () => {
    expect(scrubText("who=owner%40cafe.ge&x=1")).toBe("who=[email]&x=1");
  });

  it("removes token-like strings and JWTs", () => {
    expect(scrubText(`bad token ${INVITE_TOKEN} given`)).toBe("bad token [token] given");
    expect(scrubText("auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc-DEF_123 failed")).toBe("auth [token] failed");
  });

  it("keeps record ids and ordinary words", () => {
    const text = `order ${UUID} not found for supplier`;
    expect(scrubText(text)).toBe(text);
  });
});

describe("scrubUrl", () => {
  it("drops the query string and hash (magic-link token_hash, OAuth code)", () => {
    expect(scrubUrl("https://app.example/auth/confirm?token_hash=abc123&type=email")).toBe("https://app.example/auth/confirm");
    expect(scrubUrl("/auth/callback?code=xyz#frag")).toBe("/auth/callback");
  });

  it("replaces the invitation token in the path, however short", () => {
    expect(scrubUrl(`https://app.example/invite/${INVITE_TOKEN}`)).toBe("https://app.example/invite/[token]");
    expect(scrubUrl("/invite/short")).toBe("/invite/[token]");
    expect(scrubUrl("/invite/[token]")).toBe("/invite/[token]");
  });

  it("leaves normal routes alone", () => {
    expect(scrubUrl("https://app.example/o/1001")).toBe("https://app.example/o/1001");
    expect(scrubUrl("/supplier/products")).toBe("/supplier/products");
  });
});

describe("scrubEvent", () => {
  function event(): ErrorEvent {
    return {
      type: undefined,
      message: "failed for owner@cafe.ge",
      transaction: `GET /invite/${INVITE_TOKEN}`,
      user: { id: "u1", email: "owner@cafe.ge", ip_address: "203.0.113.7" },
      extra: { body: "everything the user typed" },
      request: {
        method: "POST",
        url: `https://app.example/invite/${INVITE_TOKEN}?next=/x`,
        cookies: { "sb-access-token": "secret" },
        headers: { cookie: "sb-access-token=secret", authorization: "Bearer secret" },
        data: { password: "hunter2hunter2" },
        query_string: "token_hash=abc",
      },
      contexts: { nextjs: { request_path: `/auth/confirm?who=owner%40cafe.ge&token_hash=abc`, router_kind: "App Router" } },
      exception: { values: [{ type: "Error", value: "no row for owner@cafe.ge" }] },
      breadcrumbs: [{ category: "fetch", message: "to owner@cafe.ge", data: { url: "/auth/confirm?token_hash=abc", status_code: 200 } }],
    };
  }

  it("keeps the error, the route and the method", () => {
    const out = scrubEvent(event());
    expect(out.request).toEqual({ method: "POST", url: "https://app.example/invite/[token]" });
    expect(out.exception?.values?.[0].type).toBe("Error");
  });

  it("removes cookies, headers, bodies, query strings, user and extras", () => {
    const out = scrubEvent(event());
    const serialized = JSON.stringify(out);
    for (const secret of ["secret", "hunter2", "203.0.113.7", "everything the user typed", "token_hash", INVITE_TOKEN, "owner@cafe.ge"]) {
      expect(serialized, secret).not.toContain(secret);
    }
    expect(out.user).toBeUndefined();
    expect(out.extra).toBeUndefined();
  });

  it("scrubs the request path Next.js adds as its own context, and keeps the route", () => {
    const out = scrubEvent(event());
    expect(out.contexts?.nextjs).toEqual({ request_path: "/auth/confirm", router_kind: "App Router" });
  });

  it("scrubs breadcrumbs but keeps their status codes", () => {
    const out = scrubEvent(event());
    expect(out.breadcrumbs?.[0]).toMatchObject({ message: "to [email]", data: { url: "/auth/confirm", status_code: 200 } });
  });
});

describe("scrubBreadcrumb", () => {
  it("drops console arguments and bodies", () => {
    const crumb: Breadcrumb = { category: "console", message: "x", data: { arguments: [{ password: "p" }], body: "b", level: "log" } };
    const out = scrubBreadcrumb(crumb);
    expect(out.data).toEqual({ level: "log" });
  });
});

describe("sentry configuration", () => {
  const saved = process.env.NEXT_PUBLIC_SENTRY_DSN;
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = saved;
  });

  it("is off without a DSN, so nothing is ever sent", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(sentryDsn()).toBeNull();
    expect(sentryOptions()).toBeNull();
    process.env.NEXT_PUBLIC_SENTRY_DSN = "   ";
    expect(sentryOptions()).toBeNull();
  });

  it("sends errors only, with no tracing and no default PII, through the scrubber", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://abc123@o1.ingest.de.sentry.io/42";
    const options = sentryOptions();
    expect(options).not.toBeNull();
    expect(options?.tracesSampleRate).toBe(0);
    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.beforeSend).toBe(scrubEvent);
    expect(options?.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it("derives the CSP origin from the DSN and tolerates junk", () => {
    expect(sentryIngestOrigin("https://abc123@o1.ingest.de.sentry.io/42")).toBe("https://o1.ingest.de.sentry.io");
    expect(sentryIngestOrigin("not a url")).toBeNull();
    expect(sentryIngestOrigin(null)).toBeNull();
  });
});
