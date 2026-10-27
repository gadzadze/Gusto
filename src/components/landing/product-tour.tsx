"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const STEP_MS = 5500;

/**
 * Four-tab product tour. Plays on its own until the visitor clicks a tab; the
 * panels are rendered by the server and passed in, so nothing here formats data.
 */
export function ProductTour({ label, tabs, views }: { label: string; tabs: string[]; views: ReactNode[] }) {
  const [tab, setTab] = useState(0);
  const [auto, setAuto] = useState(true);
  const autoRef = useRef(true);

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const id = window.setInterval(() => {
      if (autoRef.current && !reduce.matches) setTab((v) => (v + 1) % tabs.length);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [tabs.length]);

  return (
    <div className="win">
      <div className="tabs" role="tablist" aria-label={label}>
        {tabs.map((name, i) => {
          const on = tab === i;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              id={`tour-tab-${i}`}
              aria-selected={on}
              aria-controls="tour-panel"
              className={`tab${on ? " on" : ""}`}
              onClick={() => {
                setTab(i);
                setAuto(false);
              }}
            >
              <span className="n">{`0${i + 1}`}</span>
              <span className="t">{name}</span>
              {on ? <span className={auto ? "prog" : "bar-static"} /> : null}
            </button>
          );
        })}
      </div>
      <div className="stage" role="tabpanel" id="tour-panel" aria-labelledby={`tour-tab-${tab}`}>
        <div key={tab} className="view">
          {views[tab]}
        </div>
      </div>
    </div>
  );
}

/** The fourth tour view: a real button that confirms the demo order. */
export function ConfirmDemo({
  order,
  detail,
  statusNew,
  statusConfirmed,
  confirm,
  undo,
}: {
  order: string;
  detail: string;
  statusNew: string;
  statusConfirmed: string;
  confirm: string;
  undo: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <div className="orow">
      <div>
        <b>{order}</b>
        <span className="m">{detail}</span>
      </div>
      <div className="oact">
        <span className={`pill ${done ? "blue" : "amber"}`}>{done ? statusConfirmed : statusNew}</span>
        <button type="button" className={`obtn${done ? " ghost" : ""}`} onClick={() => setDone((v) => !v)}>
          {done ? undo : confirm}
        </button>
      </div>
    </div>
  );
}
