import { getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { formatMoney, lineTotalMinor } from "@/lib/money";
import { IPhone } from "./iphone";
import { ConfirmDemo } from "./product-tour";

// Interface mock-ups for the landing page. Every business, product and amount
// is fictional and the page says so; amounts go through the same formatter the
// app uses.

const money = (minor: number) => formatMoney(minor, "GEL");

const CART = [
  { key: "sulguni", unit: "kg", base: 1850, price: 1665, qty: 2 },
  { key: "eggs", unit: "pack", base: 640, price: 576, qty: 3 },
  { key: "tomato", unit: "kg", base: 320, price: 320, qty: 5 },
  { key: "rice", unit: "kg", base: 360, price: 360, qty: 0 },
] as const;

const cartLines = CART.filter((l) => l.qty > 0).map((l) => ({
  ...l,
  total: lineTotalMinor(l.price, l.qty * 1000),
}));
const CART_TOTAL = cartLines.reduce((sum, l) => sum + l.total, 0);

type Status = "New" | "Confirmed" | "Delivered";
const STATUS_CLASS: Record<Status, string> = {
  New: "amber",
  Confirmed: "blue",
  Delivered: "green",
};

async function demoStrings() {
  const t = await getTranslations("landing");
  const unit = (u: "kg" | "pack") => t(`demo.${u}`);
  const status = (s: Status) => (
    <span className={`pill ${STATUS_CLASS[s]}`}>{t(`demo.status${s}`)}</span>
  );
  return { t, unit, status };
}

/** Hero: the supplier's order list with the buyer's phone in front of it. */
export async function HeroComposite() {
  const { t, unit, status } = await demoStrings();
  const orders: {
    no: string;
    who: "restaurant" | "cafe";
    status: Status;
    minor: number;
    fresh?: boolean;
  }[] = [
    {
      no: "GST-1044",
      who: "restaurant",
      status: "New",
      minor: 6658,
      fresh: true,
    },
    { no: "GST-1043", who: "cafe", status: "New", minor: 2640 },
    { no: "GST-1042", who: "restaurant", status: "Confirmed", minor: 18320 },
    { no: "GST-1041", who: "cafe", status: "Delivered", minor: 23640 },
    { no: "GST-1040", who: "restaurant", status: "Delivered", minor: 13329 },
  ];
  return (
    <div className="composite arrive a2" aria-hidden="true">
      <div className="dash">
        <div className="dash-top">
          <b>Gusto</b>
          <span>{t("demo.supplier")}</span>
        </div>
        <div className="dash-nav">
          <span>{t("dash.main")}</span>
          <span className="on">{t("dash.orders")}</span>
          <span>{t("dash.products")}</span>
          <span>{t("dash.customers")}</span>
          <span>{t("dash.prices")}</span>
        </div>
        <div className="dash-main">
          <div className="dash-title">
            <b>{t("dash.orders")}</b>
            <span className="mono">{t("demo.tag")}</span>
          </div>
          <div className="filters">
            <span className="on">{t("dash.all")}</span>
            <span>{t("dash.newCount")}</span>
            <span>{t("demo.statusConfirmed")}</span>
          </div>
          <div className="trow head">
            <span>{t("dash.colNumber")}</span>
            <span>{t("dash.colBuyer")}</span>
            <span>{t("dash.colStatus")}</span>
            <span className="amt">{t("dash.colTotal")}</span>
          </div>
          {orders.map((o) => (
            <div key={o.no} className={`trow${o.fresh ? " newrow" : ""}`}>
              <span className="num">{o.no}</span>
              <span>{t(`demo.${o.who}`)}</span>
              {status(o.status)}
              <span className="amt">{money(o.minor)}</span>
            </div>
          ))}
        </div>
      </div>

      <IPhone className="phone">
        <div className="p-top">
          <b>Gusto</b>
          <span>{t("demo.restaurant")}</span>
        </div>
        <div className="p-body">
          <p className="p-title">{t("demo.supplier")}</p>
          <span className="pill">{t("demo.yourPrices")}</span>
          <div style={{ marginTop: 6 }}>
            {cartLines.map((l) => (
              <div key={l.key} className="p-row">
                <div>
                  <b>{t(`demo.${l.key}`)}</b>
                  <small>{`${money(l.price)} / ${unit(l.unit)}`}</small>
                </div>
                <div className="p-step">
                  <span className="d">-</span>
                  <span>{l.qty}</span>
                  <span>+</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-bar">
          <div className="p-sum">
            <span>{`${t("demo.cart")} · ${cartLines.length}`}</span>
            <b>{money(CART_TOTAL)}</b>
          </div>
          <div className="p-btn">{t("demo.send")}</div>
        </div>
      </IPhone>
    </div>
  );
}

/** The four tour tabs, as server-rendered panels (a plain function: the page passes the result to the client tour). */
export async function buildTourViews() {
  const { t, unit, status } = await demoStrings();
  const prices: {
    key: "sulguni" | "butter" | "curd";
    base: number;
    price: number;
  }[] = [
    { key: "sulguni", base: 1850, price: 1665 },
    { key: "butter", base: 790, price: 711 },
    { key: "curd", base: 1150, price: 1035 },
  ];
  return [
    <div key="catalog" className="view-grid">
      <div>
        <h3>{t("tour.v1Title")}</h3>
        <p className="cap">{t("tour.v1Cap")}</p>
      </div>
      <div className="panel">
        <div className="panel-head">
          <span>{t("tour.priceList")}</span>
          <span className="pill">{t("suppliers.listRestaurant")}</span>
        </div>
        <div className="tbl">
          <div className="th">{t("tour.product")}</div>
          <div className="th c">{t("tour.base")}</div>
          <div className="th c">{t("tour.clientPrice")}</div>
          {prices.map((p) => (
            <Fragment key={p.key}>
              <div>{t(`demo.${p.key}`)}</div>
              <div className="c old">{money(p.base)}</div>
              <div className="c new">{money(p.price)}</div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>,

    <div key="invite" className="view-grid">
      <div>
        <h3>{t("tour.v2Title")}</h3>
        <p className="cap">{t("tour.v2Cap")}</p>
      </div>
      <div className="panel tint">
        <div className="bub">{t("tour.inviteText")}</div>
        <div className="link-card">
          <b>{t("tour.inviteCard")}</b>
          <span>{t("tour.inviteMeta")}</span>
        </div>
      </div>
    </div>,

    <div key="order" className="view-grid">
      <div>
        <h3>{t("tour.v3Title")}</h3>
        <p className="cap">{t("tour.v3Cap")}</p>
      </div>
      <div className="panel">
        <div className="panel-head">
          <span>{t("demo.restaurant")}</span>
          <span className="pill">{t("demo.cart")}</span>
        </div>
        {cartLines.map((l) => (
          <div key={l.key} className="crow">
            <div>
              {t(`demo.${l.key}`)}
              <small>{`${money(l.price)} / ${unit(l.unit)}`}</small>
            </div>
            <div className="q">{`${l.qty} ${unit(l.unit)}`}</div>
            <div className="s">{money(l.total)}</div>
          </div>
        ))}
        <div className="total">
          <span>{t("demo.total")}</span>
          <b>{money(CART_TOTAL)}</b>
        </div>
      </div>
    </div>,

    <div key="confirm" className="view-grid">
      <div>
        <h3>{t("tour.v4Title")}</h3>
        <p className="cap">{t("tour.v4Cap")}</p>
      </div>
      <div className="panel">
        <ConfirmDemo
          order="GST-1044"
          detail={`${t("demo.restaurant")} · ${money(CART_TOTAL)}`}
          statusNew={t("demo.statusNew")}
          statusConfirmed={t("demo.statusConfirmed")}
          confirm={t("tour.confirm")}
          undo={t("tour.undo")}
        />
        <div className="orow">
          <div>
            <b>GST-1042</b>
            <span className="m">{`${t("demo.restaurant")} · ${money(18320)}`}</span>
          </div>
          <div className="oact">{status("Confirmed")}</div>
        </div>
        <div className="orow">
          <div>
            <b>GST-1041</b>
            <span className="m">{`${t("demo.cafe")} · ${money(23640)}`}</span>
          </div>
          <div className="oact">{status("Delivered")}</div>
        </div>
      </div>
    </div>,
  ];
}

/** Supplier side: summary figures and the customer list. */
export async function SupplierMock() {
  const { t } = await demoStrings();
  const customers: {
    who: "restaurant" | "cafe" | "hotel";
    invited?: boolean;
    list: "listRestaurant" | "listBase" | "listHotel";
  }[] = [
    { who: "restaurant", list: "listRestaurant" },
    { who: "cafe", list: "listBase" },
    { who: "hotel", invited: true, list: "listHotel" },
  ];
  return (
    <div aria-hidden="true">
      <div className="stats">
        <div className="stat">
          <span>{t("suppliers.statPending")}</span>
          <b>2</b>
        </div>
        <div className="stat">
          <span>{t("suppliers.statWeek")}</span>
          <b>5</b>
        </div>
        <div className="stat">
          <span>{t("suppliers.statValue")}</span>
          <b>{money(64587)}</b>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <span>{t("suppliers.customers")}</span>
          <span className="ui-btn">{t("suppliers.invite")}</span>
        </div>
        <div className="crm head">
          <span>{t("suppliers.colBusiness")}</span>
          <span>{t("suppliers.colStatus")}</span>
          <span className="pl">{t("suppliers.colList")}</span>
        </div>
        {customers.map((c) => (
          <div key={c.who} className="crm">
            <span>{t(`demo.${c.who}`)}</span>
            <span className={`pill ${c.invited ? "amber" : "green"}`}>
              {t(c.invited ? "demo.statusInvited" : "demo.statusActive")}
            </span>
            <span className="pl">{t(`suppliers.${c.list}`)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Buyer side: the home screen on a phone. */
export async function BuyerPhone() {
  const { t, status } = await demoStrings();
  const recent = [
    { no: "GST-1040", items: 3, minor: 13329 },
    { no: "GST-1038", items: 2, minor: 4860 },
    { no: "GST-1035", items: 4, minor: 15210 },
  ];
  return (
    <div aria-hidden="true">
      <IPhone className="phone-lg">
        <div className="p-top">
          <b>Gusto</b>
          <span>{t("demo.restaurant")}</span>
        </div>
        <div className="p-body">
          <p className="p-title">{t("buyers.home")}</p>
          <p className="bsec">{t("buyers.current")}</p>
          <div className="bord">
            <div>
              <b>GST-1044</b>
              <small>{t("demo.supplier")}</small>
            </div>
            {status("New")}
          </div>
          <div className="bord">
            <div>
              <b>GST-1042</b>
              <small>{t("demo.supplier")}</small>
            </div>
            {status("Confirmed")}
          </div>
          <p className="bsec" style={{ marginTop: 18 }}>
            {t("buyers.recent")}
          </p>
          {recent.map((r) => (
            <div key={r.no} className="bord">
              <div>
                <b>{r.no}</b>
                <small>{`${r.items} ${t("demo.positions")} · ${money(r.minor)}`}</small>
              </div>
              <span className="reo">{t("demo.reorder")}</span>
            </div>
          ))}
        </div>
      </IPhone>
    </div>
  );
}

/** Trust band: what verifying a business looks like. */
export async function TrustCard() {
  const t = await getTranslations("landing");
  return (
    <div aria-hidden="true">
      <div className="vcard">
        <div className="vrow">
          <span>{t("trust.business")}</span>
          <b>{t("demo.restaurant")}</b>
        </div>
        <div className="vrow">
          <span>{t("trust.legalId")}</span>
          <span className="mono">954 267 721</span>
        </div>
        <div className="vrow">
          <span>{t("trust.invitedBy")}</span>
          <b>{t("demo.supplier")}</b>
        </div>
        <div className="vrow">
          <span>{t("trust.status")}</span>
          <span className="vpill">{t("trust.verified")}</span>
        </div>
      </div>
    </div>
  );
}
