"use client";

import { Check, Copy, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
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
      <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted-foreground print:hidden">{t("notice")}</p>

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

      <section className="space-y-3 rounded-xl border border-border p-4 print:border-0 print:p-0">
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

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("goods")}</h2>
          <span className="print:hidden">
            <CopyButton text={goodsTsv} label={t("copyGoods")} />
          </span>
        </div>
        <p className="text-xs text-muted-foreground print:hidden">{t("goodsHint")}</p>
        <div className="overflow-x-auto rounded-xl border border-border">
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
