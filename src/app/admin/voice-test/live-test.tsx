"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRODUCT_UNITS, type ProductUnit } from "@/lib/catalog/units";
import { applySetOrder, SET_ORDER, type LiveOrderLine } from "@/lib/voice/live";
import { milliToInput } from "@/lib/quantity";
import { startLiveSessionAction } from "./actions";

// Live voice mode (experiment, admin only). The browser talks to Google's live endpoint with a one-use token from the server;
// the assistant answers by voice and may only call `set_order`. Nothing is stored and no real catalogue is involved.
const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

type Phase = "idle" | "connecting" | "live";
type Turn = { who: "you" | "assistant"; text: string };
type ErrorKey = "micDenied" | "startFailed" | "connectionLost" | "rate_limited" | "not_configured" | "key_rejected" | "bad_catalog" | "upstream" | "invalid" | "unknown";

function base64FromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function LiveTest({ catalog, configured }: { catalog: string; configured: boolean }) {
  const t = useTranslations("admin.voiceTest");
  const tu = useTranslations("unitNames");
  const locale = useLocale();
  const separator = locale === "en" ? "." : ",";
  const unitLabel = (code: string | null) => (code && (PRODUCT_UNITS as readonly string[]).includes(code) ? tu(code as ProductUnit) : (code ?? ""));

  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [order, setOrder] = useState<LiveOrderLine[]>([]);
  const [deliveryDay, setDeliveryDay] = useState<string | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const playCtx = useRef<AudioContext | null>(null);
  const playing = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStart = useRef(0);
  const turnsRef = useRef<Turn[]>([]);
  const boundary = useRef(true);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef(false);
  const live = useRef(false);

  function stopPlayback() {
    for (const source of playing.current) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    playing.current.clear();
    nextStart.current = 0;
  }

  function teardown() {
    closing.current = true;
    live.current = false;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopPlayback();
    ws.current?.close();
    ws.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void micCtx.current?.close();
    void playCtx.current?.close();
    micCtx.current = null;
    playCtx.current = null;
  }

  // Leaving the page ends the session (live audio is billed while it is open).
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addText(who: Turn["who"], text: string) {
    const list = turnsRef.current;
    const last = list[list.length - 1];
    if (last && last.who === who && !boundary.current) list[list.length - 1] = { who, text: last.text + text };
    else list.push({ who, text });
    boundary.current = false;
    setTurns([...list]);
  }

  function play(base64: string, mimeType: string) {
    const ctx = playCtx.current;
    if (!ctx) return;
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
    const raw = atob(base64);
    const samples = new Float32Array(raw.length / 2);
    for (let i = 0; i < samples.length; i++) {
      const lo = raw.charCodeAt(i * 2);
      const hi = raw.charCodeAt(i * 2 + 1);
      const v = (hi << 8) | lo;
      samples[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
    }
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    nextStart.current = Math.max(ctx.currentTime, nextStart.current);
    source.start(nextStart.current);
    nextStart.current += buffer.duration;
    playing.current.add(source);
    source.onended = () => playing.current.delete(source);
  }

  async function start() {
    setError(null);
    setTurns([]);
    setOrder([]);
    setDeliveryDay(null);
    turnsRef.current = [];
    boundary.current = true;
    closing.current = false;
    setPhase("connecting");
    // Audio contexts must be created inside the tap, or iPhones keep them suspended.
    const mic = new AudioContext();
    const out = new AudioContext();
    void mic.resume();
    void out.resume();
    micCtx.current = mic;
    playCtx.current = out;
    const fail = (key: ErrorKey) => {
      teardown();
      setError(key);
      setPhase("idle");
    };

    const session = await startLiveSessionAction(catalog);
    if (!session.ok) return fail(session.error === "invalid" || session.error === "bad_catalog" ? "bad_catalog" : (session.error as ErrorKey) ?? "startFailed");

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return fail("micDenied");
    }
    stream.current = media;
    try {
      await mic.audioWorklet.addModule("/voice-capture-worklet.js");
    } catch {
      return fail("startFailed");
    }
    const source = mic.createMediaStreamSource(media);
    const capture = new AudioWorkletNode(mic, "voice-capture");
    const mute = mic.createGain();
    mute.gain.value = 0;
    source.connect(capture);
    capture.connect(mute);
    mute.connect(mic.destination);
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const socket = ws.current;
      if (!live.current || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ realtimeInput: { audio: { data: base64FromBytes(new Uint8Array(event.data)), mimeType: "audio/pcm;rate=16000" } } }));
    };

    const socket = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(session.token)}`);
    ws.current = socket;
    socket.onopen = () => socket.send(JSON.stringify(session.setup));
    socket.onerror = () => {
      if (!closing.current) fail("connectionLost");
    };
    socket.onclose = () => {
      if (closing.current) return;
      const wasLive = live.current;
      teardown();
      setPhase("idle");
      if (wasLive) setError("connectionLost");
      else setError("startFailed");
    };
    // Messages are handled one after another, even though reading a binary frame is asynchronous.
    let queue: Promise<void> = Promise.resolve();
    socket.onmessage = (event: MessageEvent<string | Blob>) => {
      queue = queue.then(async () => {
        const text = typeof event.data === "string" ? event.data : await event.data.text();
        let message: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (message.setupComplete) {
          live.current = true;
          setPhase("live");
          stopTimer.current = setTimeout(() => {
            teardown();
            setPhase("idle");
          }, session.maxSeconds * 1000);
          return;
        }
        const content = message.serverContent;
        if (content) {
          if (content.interrupted) stopPlayback();
          if (content.inputTranscription?.text) addText("you", content.inputTranscription.text);
          if (content.outputTranscription?.text) addText("assistant", content.outputTranscription.text);
          for (const part of content.modelTurn?.parts ?? []) if (part.inlineData?.data) play(part.inlineData.data, part.inlineData.mimeType ?? "audio/pcm;rate=24000");
          if (content.turnComplete) boundary.current = true;
        }
        if (message.toolCall) {
          const responses = (message.toolCall.functionCalls ?? []).map((call: { id: string; name: string; args: unknown }) => {
            if (call.name !== SET_ORDER) return { id: call.id, name: call.name, response: { error: "unknown_tool" } };
            const applied = applySetOrder(call.args, session.items);
            setOrder(applied.lines);
            if (applied.deliveryDay) setDeliveryDay(applied.deliveryDay);
            return { id: call.id, name: call.name, response: applied.feedback };
          });
          socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
        }
      });
    };
  }

  function stop() {
    teardown();
    setPhase("idle");
  }

  return (
    <section className="space-y-4 border-t border-border pt-6" aria-labelledby="live-title">
      <div>
        <h2 id="live-title" className="text-base font-semibold">{t("live.title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("live.intro")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {phase === "idle" ? (
          <Button type="button" onClick={() => void start()} disabled={!configured}>
            <Mic aria-hidden /> {t("live.start")}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={stop}>
            <Square aria-hidden /> {t("live.stop")}
          </Button>
        )}
        {phase === "connecting" ? <p role="status" className="text-sm text-muted-foreground">{t("live.connecting")}</p> : null}
        {phase === "live" ? <p role="status" className="text-sm text-brand">{t("live.listening")}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("live.limit", { minutes: 10 })}</p>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error === "micDenied" ? t("problems.mic_denied") : error === "startFailed" || error === "connectionLost" ? t(`live.${error}`) : t(`errors.${error}`)}
        </p>
      ) : null}

      {turns.length > 0 || order.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
          <div aria-live="polite">
            <h3 className="text-sm font-medium">{t("live.conversation")}</h3>
            <ul className="mt-1 space-y-2">
              {turns.map((turn, i) => (
                <li key={i} className={turn.who === "you" ? "rounded-lg border border-border bg-card p-3 text-sm" : "rounded-lg bg-brand-soft p-3 text-sm"}>
                  <span className="block text-xs text-muted-foreground">{turn.who === "you" ? t("live.you") : t("live.assistant")}</span>
                  {turn.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">{t("live.orderTitle")}</h3>
            {order.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{t("live.orderEmpty")}</p>
            ) : (
              <ul className="mt-1 divide-y divide-border rounded-lg border border-border bg-card">
                {order.map((line) => (
                  <li key={line.productId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
                    <p className="min-w-0 flex-[1_1_10rem] font-medium">{line.productName}</p>
                    <p className="tabular-nums">
                      {line.quantityMilli === null ? t("noQuantity") : milliToInput(line.quantityMilli, separator)} {unitLabel(line.unit)}
                    </p>
                    {line.unitCheck === "mismatch" ? (
                      <p role="alert" className="flex basis-full items-start gap-2 text-sm text-danger">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {t("unitMismatch", { said: line.spokenUnit ?? "", catalogue: unitLabel(line.catalogUnit) })}
                      </p>
                    ) : null}
                    {line.unitCheck === "converted" ? <p className="basis-full text-xs text-muted-foreground">{t("unitConverted", { from: line.spokenUnit ?? "", to: unitLabel(line.unit) })}</p> : null}
                    {line.unitCheck === "assumed" ? <p className="basis-full text-xs text-muted-foreground">{t("unitAssumed", { unit: unitLabel(line.unit) })}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            {deliveryDay ? <p className="mt-2 text-sm">{t("delivery", { day: deliveryDay })}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
