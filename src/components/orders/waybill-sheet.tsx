"use client";

import { Check, Copy, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  activateWaybillAction,
  closeWaybillAction,
  discardWaybillDraftAction,
  readWaybillAtRsAction,
  saveWaybillDraftAction,
} from "@/app/supplier/orders/[id]/waybill/actions";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Everything arrives as strings made on the server (display forms for reading, plain forms with a dot
// decimal for pasting into the RS.ge portal). The transport details the supplier types are remembered in
// this browser only: nothing is sent anywhere, and 202 stores nothing about the waybill.

export type SheetLine = {
  n: number;
  name: string;
  code: string;
  unit: string;
  qty: string;
  qtyPlain: string;
  price: string;
  pricePlain: string;
  vat: string;
  total: string;
  totalPlain: string;
};

export type SheetProps = {
  number: string;
  seller: { name: string; legalId: string };
  buyer: { name: string; legalId: string };
  delivery: { address: string; city: string; instructions: string; date: string; dateLabel: string };
  note: string;
  lines: SheetLine[];
  totals: { subtotal: string; vat: string; total: string };
  vatIncluded: boolean;
  /** RS.ge sending (phase 2): null = the integration is off for this company. */
  rs: null | { orderId: string; state: "not_connected" | "ready" | "draft" | "active" | "closed"; rsWaybillId: number | null; rsNumber: string; hasZeroVat: boolean };
};

const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => void listeners.delete(callback);
};
function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function useStored(key: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => readStored(key), () => "");
  return [
    value,
    (next) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage blocked: the value just isn't remembered */
      }
      listeners.forEach((callback) => callback());
    },
  ];
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      disabled={!text}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check className="text-brand" /> : <Copy />}
    </Button>
  );
}

function Row({ label, value, copy }: { label: string; value: string; copy?: string }) {
  const t = useTranslations("waybill");
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-words font-medium">{value || "-"}</p>
      </div>
      <CopyButton text={copy ?? value} label={`${t("copy")}: ${label}`} />
    </div>
  );
}

const RS_ERRORS = [
  "disabled", "not_owner", "not_connected", "invalid_credentials", "wrong_company", "rs_unreachable", "rs_rejected", "already_exists",
  "not_draft", "not_active", "invalid_transport", "rate_limited", "unit_unmapped", "vat_unsupported", "empty", "transport_missing", "invalid_amount",
];

/** The two deliberate steps of sending a waybill to RS.ge: save a draft, then (after checking it) activate. */
function RsPanel({ rs, transport, vatNote }: { rs: NonNullable<SheetProps["rs"]>; transport: { startAddress: string; driverName: string; driverId: string; vehicle: string }; vatNote: boolean }) {
  const t = useTranslations("waybill.rs");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [xml, setXml] = useState<string | null>(null);
  const fail = (code: string) => t(`errors.${(RS_ERRORS.includes(code) ? code : "unknown") as "unknown"}`);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(fail(result.error ?? "unknown"));
    });

  return (
    <section aria-labelledby="rs-title" className="space-y-3 glass p-4 print:hidden">
      <h2 id="rs-title" className="font-semibold">{t("title")}</h2>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {rs.state === "not_connected" ? (
        <p className="text-sm text-muted-foreground">
          {t("notConnected")}{" "}
          <Link href="/supplier/settings" className="font-medium text-brand underline-offset-2 hover:underline">{t("settingsLink")}</Link>
        </p>
      ) : null}
      {rs.state === "ready" ? (
        <>
          {vatNote ? <p className="text-xs text-muted-foreground">{t("vatNote")}</p> : null}
          <Button type="button" disabled={pending} onClick={() => run(() => saveWaybillDraftAction(rs.orderId, transport))}>
            {pending ? t("saving") : t("saveDraft")}
          </Button>
        </>
      ) : null}
      {rs.state === "draft" ? (
        <>
          <p className="text-sm">{t("draftSaved", { id: rs.rsWaybillId ?? 0 })}</p>
          {vatNote ? <p className="text-xs text-muted-foreground">{t("vatNote")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await readWaybillAtRsAction(rs.orderId);
                  if (result.ok) setXml(result.xml);
                  else setError(fail(result.error));
                })
              }
            >
              {t("check")}
            </Button>
            <ConfirmAction
              variant="default"
              size="default"
              label={t("activate")}
              message={t("activateConfirm")}
              confirmLabel={t("activate")}
              disabled={pending}
              onConfirm={() => run(() => activateWaybillAction(rs.orderId))}
            />
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => discardWaybillDraftAction(rs.orderId))}>
              {t("discard")}
            </Button>
          </div>
          {xml ? <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">{xml}</pre> : null}
        </>
      ) : null}
      {rs.state === "active" ? (
        <>
          <p className="text-sm font-medium">{t("active", { number: rs.rsNumber })}</p>
          <ConfirmAction
            size="default"
            label={t("close")}
            message={t("closeConfirm")}
            confirmLabel={t("close")}
            disabled={pending}
            onConfirm={() => run(() => closeWaybillAction(rs.orderId))}
          />
        </>
      ) : null}
      {rs.state === "closed" ? <p className="text-sm font-medium">{t("closed", { number: rs.rsNumber })}</p> : null}
    </section>
  );
}

export function WaybillSheet(props: SheetProps) {
  const t = useTranslations("waybill");
  const [start, setStart] = useStored("waybill:start");
  const [driver, setDriver] = useStored("waybill:driver");
  const [driverId, setDriverId] = useStored("waybill:driverId");
  const [vehicle, setVehicle] = useStored("waybill:vehicle");
  const [copiedAll, setCopiedAll] = useState(false);
  const { seller, buyer, delivery, lines } = props;

  const goodsTsv = lines.map((l) => [l.n, l.name, l.code, l.unit, l.qtyPlain, l.pricePlain, l.vat, l.totalPlain].join("\t")).join("\n");
  const everything = [
    `${t("seller")}: ${seller.name} (${seller.legalId})`,
    `${t("buyer")}: ${buyer.name} (${buyer.legalId})`,
    `${t("startAddress")}: ${start}`,
    `${t("endAddress")}: ${delivery.address}, ${delivery.city}`,
    `${t("date")}: ${delivery.date}`,
    `${t("driver")}: ${driver} ${driverId}`.trim(),
    `${t("vehicle")}: ${vehicle}`,
    "",
    goodsTsv,
  ].join("\n");

  return (
    <div className="max-w-3xl space-y-6">
      <p className="glass p-3 text-sm text-muted-foreground print:hidden">{t(props.rs ? "noticeRs" : "notice")}</p>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button
          type="button"
          onClick={async () => {
            if (await copyText(everything)) {
              setCopiedAll(true);
              window.setTimeout(() => setCopiedAll(false), 1500);
            }
          }}
        >
          {copiedAll ? <Check /> : <Copy />}
          {copiedAll ? t("copied") : t("copyAll")}
        </Button>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer />
          {t("print")}
        </Button>
      </div>

      <section className="grid gap-x-8 md:grid-cols-2">
        <div className="divide-y divide-border">
          <h2 className="pb-1 font-semibold">{t("seller")}</h2>
          <Row label={t("name")} value={seller.name} />
          <Row label={t("legalId")} value={seller.legalId} />
        </div>
        <div className="divide-y divide-border">
          <h2 className="pb-1 font-semibold">{t("buyer")}</h2>
          <Row label={t("name")} value={buyer.name} />
          <Row label={t("legalId")} value={buyer.legalId} />
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="font-semibold">{t("delivery")}</h2>
        <div className="divide-y divide-border">
          <Row label={t("endAddress")} value={`${delivery.address}, ${delivery.city}`} />
          <Row label={t("date")} value={delivery.dateLabel} copy={delivery.date} />
          {delivery.instructions ? <Row label={t("instructions")} value={delivery.instructions} /> : null}
          {props.note ? <Row label={t("note")} value={props.note} /> : null}
        </div>
      </section>

      <section className="space-y-3 glass p-4 print:border-0 print:p-0">
        <div>
          <h2 className="font-semibold">{t("transport")}</h2>
          <p className="text-sm text-muted-foreground print:hidden">{t("transportHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wb-start">{t("startAddress")}</Label>
            <Input id="wb-start" value={start} onChange={(e) => setStart(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wb-driver">{t("driver")}</Label>
            <Input id="wb-driver" value={driver} onChange={(e) => setDriver(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wb-driver-id">{t("driverId")}</Label>
            <Input id="wb-driver-id" value={driverId} inputMode="numeric" onChange={(e) => setDriverId(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wb-vehicle">{t("vehicle")}</Label>
            <Input id="wb-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} autoComplete="off" />
          </div>
        </div>
      </section>

      {props.rs ? <RsPanel rs={props.rs} transport={{ startAddress: start, driverName: driver, driverId, vehicle }} vatNote={props.rs.hasZeroVat} /> : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("goods")}</h2>
          <span className="print:hidden">
            <CopyButton text={goodsTsv} label={t("copyGoods")} />
          </span>
        </div>
        <div className="overflow-x-auto glass">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">{t("name")}</th>
                <th className="px-3 py-2 font-medium">{t("code")}</th>
                <th className="px-3 py-2 font-medium">{t("unit")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("qty")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("price")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("vat")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.n}>
                  <td className="px-3 py-2 tabular-nums">{l.n}</td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2">{l.code || "-"}</td>
                  <td className="px-3 py-2">{l.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.price}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.vat}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("subtotal")}</dt><dd className="tabular-nums">{props.totals.subtotal}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{t("vatTotal")}</dt><dd className="tabular-nums">{props.totals.vat}</dd></div>
          <div className="flex justify-between gap-4 font-semibold"><dt>{t("grandTotal")}</dt><dd className="tabular-nums">{props.totals.total}</dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">{t(props.vatIncluded ? "pricesInclude" : "pricesExclude")}</p>
      </section>
    </div>
  );
}
