"use client";

import { useEffect, useRef, useState } from "react";
import { applySetOrder, SET_ORDER, type LiveOrderLine } from "@/lib/voice/live";
import type { CatalogItem } from "@/lib/voice/order-parse";

// The browser half of live voice: one WebSocket to Google's live endpoint with a one-use token from the server, microphone capture
// (AudioWorklet, 16 kHz), playback of the assistant's voice with barge-in, and the assistant's only tool, `set_order`.
// Shared by the admin test page and the buyer's assistant. Nothing here is stored.
const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export type LivePhase = "idle" | "connecting" | "live";
export type LiveTurn = { who: "you" | "assistant"; text: string };
export type LiveSession = { token: string; setup: unknown; items: CatalogItem[]; maxSeconds: number };
export type LiveStartResult = { ok: true; session: LiveSession } | { ok: false; error: string };

/** How many bars the level strip holds. */
export const LEVEL_BARS = 40;
/** The longest typed command that is sent. */
const MAX_TYPED_CHARS = 300;

function base64FromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function useLiveVoice(getSession: () => Promise<LiveStartResult>) {
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [order, setOrder] = useState<LiveOrderLine[]>([]);
  const [deliveryDay, setDeliveryDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));

  const ws = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const playCtx = useRef<AudioContext | null>(null);
  const playing = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStart = useRef(0);
  const turnsRef = useRef<LiveTurn[]>([]);
  const boundary = useRef(true);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const level = useRef(0);
  const closing = useRef(false);
  const live = useRef(false);
  // Typed lines written before the session is ready are sent the moment it is.
  const pendingText = useRef<string[]>([]);

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
    setSpeaking(false);
  }

  function teardown() {
    closing.current = true;
    live.current = false;
    pendingText.current = [];
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (meterTimer.current) clearInterval(meterTimer.current);
    stopTimer.current = null;
    meterTimer.current = null;
    stopPlayback();
    ws.current?.close();
    ws.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void micCtx.current?.close();
    void playCtx.current?.close();
    micCtx.current = null;
    playCtx.current = null;
    level.current = 0;
    setLevels(Array(LEVEL_BARS).fill(0));
  }

  // Leaving the page ends the session (live audio is billed while it is open).
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addText(who: LiveTurn["who"], text: string) {
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
    setSpeaking(true);
    source.onended = () => {
      playing.current.delete(source);
      if (playing.current.size === 0) setSpeaking(false);
    };
  }

  /** Writes a command instead of speaking it. Shown as the buyer's own line, answered like a spoken one. */
  function sendText(raw: string) {
    const text = raw.trim().slice(0, MAX_TYPED_CHARS);
    if (!text) return;
    boundary.current = true;
    addText("you", text);
    boundary.current = true;
    const socket = ws.current;
    if (live.current && socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ realtimeInput: { text } }));
    else pendingText.current.push(text);
  }

  /** `mic: false` starts a session for typing only: no microphone permission is asked. */
  async function start(options: { mic?: boolean } = {}): Promise<LiveSession | null> {
    const useMic = options.mic !== false;
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
    const fail = (key: string) => {
      teardown();
      setError(key);
      setPhase("idle");
      return null;
    };

    const started = await getSession();
    if (!started.ok) return fail(started.error);
    const session = started.session;

    if (useMic) {
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
        const pcm = new Int16Array(event.data);
        let sum = 0;
        for (let i = 0; i < pcm.length; i += 4) sum += (pcm[i] / 0x8000) ** 2;
        level.current = Math.min(1, Math.sqrt(sum / Math.max(1, pcm.length / 4)) * 5);
        const socket = ws.current;
        if (!live.current || !socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ realtimeInput: { audio: { data: base64FromBytes(new Uint8Array(event.data)), mimeType: "audio/pcm;rate=16000" } } }));
      };
      // One bar per tick; the strip scrolls like a tape, so it needs no animation loop.
      meterTimer.current = setInterval(() => setLevels((prev) => [...prev.slice(1), level.current]), 90);

    }

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
      setError(wasLive ? "connectionLost" : "startFailed");
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
          for (const text of pendingText.current.splice(0)) socket.send(JSON.stringify({ realtimeInput: { text } }));
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
    return session;
  }

  function stop() {
    teardown();
    setPhase("idle");
  }

  return { phase, turns, order, deliveryDay, error, speaking, levels, start, stop, sendText, clearError: () => setError(null) };
}
