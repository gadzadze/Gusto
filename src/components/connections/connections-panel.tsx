"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  decideConnectionRequestAction,
  findBusinessAction,
  sendConnectionRequestAction,
  setFindableAction,
  withdrawConnectionRequestAction,
} from "@/app/connections/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { LookupResult } from "@/server/domain/connections/connections";

export type RequestView = {
  id: string;
  name: string;
  city: string;
  message: string | null;
  /** Already formatted on the server. */
  expires: string;
  offeredListName: string | null;
};

type Props = {
  role: "supplier" | "buyer";
  findable: boolean;
  incoming: RequestView[];
  outgoing: RequestView[];
  /** A supplier's own lists (empty for a buyer). */
  priceLists: { id: string; name: string; isDefault: boolean }[];
  /** Where "invite instead" goes. */
  inviteHref: string;
};

type Note = { tone: "error" | "success"; text: string } | null;

/**
 * Finding another business by its identification code and connecting with it like a friend request:
 * requests received (approve or decline), the lookup and request form, requests sent, and the switch
 * that lets this business be found. Everything is decided again on the server.
 */
export function ConnectionsPanel({ role, findable, incoming, outgoing, priceLists, inviteHref }: Props) {
  const t = useTranslations("connections.errors");
  const errorText = (code: string) => t(`${(["invalid_code", "not_active", "not_found", "already_connected", "already_pending", "declined_recently", "blocked", "request_not_pending", "invalid_list", "rate_limited"].includes(code) ? code : "unknown") as "unknown"}`);

  return (
    <div className="space-y-6">
      {incoming.length > 0 ? <Incoming rows={incoming} role={role} priceLists={priceLists} errorText={errorText} /> : null}
      <Finder role={role} priceLists={priceLists} inviteHref={inviteHref} errorText={errorText} />
      {outgoing.length > 0 ? <Outgoing rows={outgoing} errorText={errorText} /> : null}
      <FindableSwitch initial={findable} errorText={errorText} />
    </div>
  );
}

function Incoming({ rows, role, priceLists, errorText }: { rows: RequestView[]; role: "supplier" | "buyer"; priceLists: Props["priceLists"]; errorText: (c: string) => string }) {
  const t = useTranslations("connections.incoming");
  return (
    <section id="requests" className="scroll-mt-20 space-y-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-4" aria-labelledby="incoming-title">
      <h2 id="incoming-title" className="font-semibold">{t("title")} ({rows.length})</h2>
      <ul className="space-y-3">
        {rows.map((row) => (
          <IncomingRow key={row.id} row={row} role={role} priceLists={priceLists} errorText={errorText} t={t} />
        ))}
      </ul>
    </section>
  );
}

function IncomingRow({ row, role, priceLists, errorText, t }: { row: RequestView; role: "supplier" | "buyer"; priceLists: Props["priceLists"]; errorText: (c: string) => string; t: ReturnType<typeof useTranslations<"connections.incoming">> }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const [done, setDone] = useState<"approved" | "declined" | null>(null);
  const [list, setList] = useState<string>("");
  function decide(approve: boolean) {
    setNote(null);
    startTransition(async () => {
      const result = await decideConnectionRequestAction({ requestId: row.id, approve, priceListId: role === "supplier" && approve && list ? list : null });
      if (result.ok) setDone(approve ? "approved" : "declined");
      else setNote({ tone: "error", text: errorText(result.error) });
    });
  }
  return (
    <li className="space-y-2 rounded-lg bg-surface p-3">
      <div>
        <p className="font-medium">{t("from", { name: row.name, city: row.city })}</p>
        {row.message ? <p className="mt-1 whitespace-pre-line text-sm">{row.message}</p> : null}
        {row.offeredListName ? <p className="text-sm text-muted-foreground">{t("offered", { list: row.offeredListName })}</p> : null}
        <p className="text-xs text-muted-foreground">{t("expires", { date: row.expires })}</p>
      </div>
      {note ? <FormAlert tone={note.tone}>{note.text}</FormAlert> : null}
      {done ? (
        <FormAlert tone="success">{t(done)}</FormAlert>
      ) : (
        <>
          {role === "supplier" ? (
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor={`list-${row.id}`}>{t("listLabel")}</Label>
              <Select id={`list-${row.id}`} value={list} onChange={(event) => setList(event.target.value)}>
                <option value="">{priceLists.some((p) => p.isDefault) ? t("listDefault") : t("listNone")}</option>
                {priceLists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => decide(true)}>{t("approve")}</Button>
            <Button variant="outline" disabled={pending} onClick={() => decide(false)}>{t("decline")}</Button>
          </div>
        </>
      )}
    </li>
  );
}

function Finder({ role, priceLists, inviteHref, errorText }: { role: "supplier" | "buyer"; priceLists: Props["priceLists"]; inviteHref: string; errorText: (c: string) => string }) {
  const t = useTranslations("connections");
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  function search(event: React.FormEvent) {
    event.preventDefault();
    setNote(null);
    setResult(null);
    startTransition(async () => {
      const response = await findBusinessAction(code);
      if (response.ok) setResult(response.result);
      else setNote({ tone: "error", text: errorText(response.error) });
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-labelledby="finder-title">
      <h2 id="finder-title" className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t(`hint.${role}`)}</p>
      <form onSubmit={search} className="flex max-w-md items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="connection-code">{t("codeLabel")}</Label>
          <Input
            id="connection-code"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            maxLength={20}
            placeholder={t("codePlaceholder")}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending || code.trim() === ""}>
          <Search />
          {pending ? t("searching") : t("search")}
        </Button>
      </form>
      {note ? <FormAlert tone={note.tone}>{note.text}</FormAlert> : null}
      {result ? <Result role={role} result={result} priceLists={priceLists} inviteHref={inviteHref} errorText={errorText} /> : null}
    </section>
  );
}

function Result({ role, result, priceLists, inviteHref, errorText }: { role: "supplier" | "buyer"; result: LookupResult; priceLists: Props["priceLists"]; inviteHref: string; errorText: (c: string) => string }) {
  const t = useTranslations("connections");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const [message, setMessage] = useState("");
  const [list, setList] = useState("");
  const [sent, setSent] = useState<null | "sent" | "connected">(null);

  if (result.state === "self") return <FormAlert tone="warning">{t("self")}</FormAlert>;
  if (result.state === "not_found") {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
        <p className="font-medium">{t("notFound.title")}</p>
        <p className="text-sm text-muted-foreground">{t("notFound.body")}</p>
        <Button asChild variant="outline" size="sm">
          <Link href={inviteHref}>{t(role === "supplier" ? "notFound.inviteSupplier" : "notFound.inviteBuyer")}</Link>
        </Button>
      </div>
    );
  }

  function send() {
    if (result.state !== "found") return;
    setNote(null);
    startTransition(async () => {
      const response = await sendConnectionRequestAction({ targetOrgId: result.orgId, message, priceListId: role === "supplier" && list ? list : null });
      if (response.ok) setSent(response.status);
      else setNote({ tone: "error", text: errorText(response.error) });
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <p className="font-medium">{result.name}</p>
        <p className="text-sm text-muted-foreground">{result.city} · {t("found.approved")}</p>
      </div>
      {sent ? (
        <FormAlert tone="success">{t(sent === "sent" ? "send.sent" : "send.connected", { name: result.name })}</FormAlert>
      ) : result.relation === "none" ? (
        <>
          {note ? <FormAlert tone={note.tone}>{note.text}</FormAlert> : null}
          {role === "supplier" ? (
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="offer-list">{t("send.listLabel")}</Label>
              <Select id="offer-list" value={list} onChange={(event) => setList(event.target.value)}>
                <option value="">{priceLists.some((p) => p.isDefault) ? t("send.listDefault") : t("send.listNone")}</option>
                {priceLists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="request-message">{t("send.messageLabel")}</Label>
            <textarea
              id="request-message"
              value={message}
              maxLength={300}
              rows={2}
              placeholder={t("send.messagePlaceholder")}
              onChange={(event) => setMessage(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 sm:text-sm"
            />
          </div>
          <Button disabled={pending} onClick={send}>{t("send.button")}</Button>
        </>
      ) : (
        <p className="text-sm">{t(`relation.${result.relation}`)}</p>
      )}
    </div>
  );
}

function Outgoing({ rows, errorText }: { rows: RequestView[]; errorText: (c: string) => string }) {
  const t = useTranslations("connections.outgoing");
  return (
    <section className="space-y-2 rounded-xl border border-border p-4" aria-labelledby="outgoing-title">
      <h2 id="outgoing-title" className="font-semibold">{t("title")}</h2>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <OutgoingRow key={row.id} row={row} errorText={errorText} t={t} />
        ))}
      </ul>
    </section>
  );
}

function OutgoingRow({ row, errorText, t }: { row: RequestView; errorText: (c: string) => string; t: ReturnType<typeof useTranslations<"connections.outgoing">> }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div>
        <p className="text-sm font-medium">{t("waiting", { name: row.name, city: row.city })}</p>
        <p className="text-xs text-muted-foreground">{t("expires", { date: row.expires })}</p>
        {note ? <FormAlert tone={note.tone}>{note.text}</FormAlert> : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await withdrawConnectionRequestAction(row.id);
            if (!result.ok) setNote({ tone: "error", text: errorText(result.error) });
          })
        }
      >
        {t("withdraw")}
      </Button>
    </li>
  );
}

function FindableSwitch({ initial, errorText }: { initial: boolean; errorText: (c: string) => string }) {
  const t = useTranslations("connections.findable");
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  return (
    <section className="space-y-2 rounded-xl border border-border p-4" aria-labelledby="findable-title">
      <h2 id="findable-title" className="font-semibold">{t("title")}</h2>
      {note ? <FormAlert tone={note.tone}>{note.text}</FormAlert> : null}
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
          onChange={(event) => {
            const next = event.target.checked;
            setOn(next);
            setNote(null);
            startTransition(async () => {
              const result = await setFindableAction(next);
              if (result.ok) setNote({ tone: "success", text: t("saved") });
              else {
                setOn(!next);
                setNote({ tone: "error", text: errorText(result.error) });
              }
            });
          }}
        />
        <span>
          <span className="block font-medium">{t("label")}</span>
          <span className="block text-sm text-muted-foreground">{t("hint")}</span>
        </span>
      </label>
    </section>
  );
}
