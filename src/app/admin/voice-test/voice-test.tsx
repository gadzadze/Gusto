"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Mic, Square, Upload, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { encodeWav, VOICE_SAMPLE_RATE } from "@/lib/voice/wav";
import { parseVoiceOrderAction, type VoiceTestResult } from "./actions";

const MAX_RECORD_SECONDS = 60;

/** Decodes any audio the browser can play (webm, m4a, mp3, wav) to 16 kHz mono and re-encodes it as WAV. */
async function toWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * VOICE_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, VOICE_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const bytes = encodeWav(rendered.getChannelData(0));
    return new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
  } finally {
    void context.close();
  }
}

export function VoiceTest({ configured, sampleCatalog }: { configured: boolean; sampleCatalog: string }) {
  const t = useTranslations("admin.voiceTest");
  const [catalog, setCatalog] = useState(sampleCatalog);
  const [recording, setRecording] = useState(false);
  const [wav, setWav] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [problem, setProblem] = useState<"mic_denied" | "bad_audio" | null>(null);
  const [result, setResult] = useState<VoiceTestResult | null>(null);
  const [pending, startTransition] = useTransition();
  // One object URL per recording, released when it is replaced or the page closes (it used to be made on every render).
  const audioUrl = useMemo(() => (wav ? URL.createObjectURL(wav) : null), [wav]);
  useEffect(() => () => (audioUrl ? URL.revokeObjectURL(audioUrl) : undefined), [audioUrl]);
  const recorder = useRef<MediaRecorder | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function prepare(blob: Blob, name: string | null) {
    setResult(null);
    try {
      setWav(await toWav(blob));
      setFileName(name);
      setProblem(null);
    } catch {
      setWav(null);
      setProblem("bad_audio");
    }
  }

  async function start() {
    setProblem(null);
    setResult(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setProblem("mic_denied");
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (stopTimer.current) clearTimeout(stopTimer.current);
      setRecording(false);
      void prepare(new Blob(chunks, { type: rec.mimeType }), null);
    };
    recorder.current = rec;
    rec.start();
    setRecording(true);
    stopTimer.current = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_RECORD_SECONDS * 1000);
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function analyze() {
    if (!wav) return;
    const data = new FormData();
    data.set("audio", wav, "order.wav");
    data.set("catalog", catalog);
    startTransition(async () => setResult(await parseVoiceOrderAction(data)));
  }

  return (
    <div className="max-w-3xl space-y-6">
      {!configured ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("notConfigured")}
        </p>
      ) : null}

      <section className="space-y-2">
        <label htmlFor="voice-catalog" className="text-sm font-medium">
          {t("catalogLabel")}
        </label>
        <p className="text-xs text-muted-foreground">{t("catalogHint")}</p>
        <textarea
          id="voice-catalog"
          value={catalog}
          onChange={(e) => setCatalog(e.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full rounded-lg border border-input bg-card p-3 font-mono text-sm"
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <Button type="button" variant="outline" onClick={stop}>
              <Square aria-hidden /> {t("stop")}
            </Button>
          ) : (
            <Button type="button" onClick={start} disabled={pending}>
              <Mic aria-hidden /> {t("record")}
            </Button>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm md:min-h-9">
            <Upload className="size-4" aria-hidden />
            {t("upload")}
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void prepare(file, file.name);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {recording ? <p role="status" className="text-sm text-brand">{t("recordingNow", { seconds: MAX_RECORD_SECONDS })}</p> : null}
        {wav && !recording ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{fileName ? t("readyFile", { name: fileName }) : t("readyRecording")}</p>
            <audio controls src={audioUrl ?? undefined} className="w-full max-w-md" />
          </div>
        ) : null}
        {problem ? <p role="alert" className="text-sm text-danger">{t(`problems.${problem}`)}</p> : null}
        <Button type="button" onClick={analyze} loading={pending} loadingLabel={t("analyzing")} disabled={!wav || recording || !configured}>
          {t("analyze")}
        </Button>
      </section>

      {result ? <Result result={result} /> : null}
    </div>
  );
}

function Result({ result }: { result: VoiceTestResult }) {
  const t = useTranslations("admin.voiceTest");
  if (!result.ok) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-danger">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t(`errors.${result.error}`)}
      </p>
    );
  }
  return (
    <section className="space-y-4" aria-live="polite">
      <div>
        <h2 className="text-sm font-medium">{t("heard")}</h2>
        <p className="mt-1 rounded-lg border border-border bg-card p-3 text-base">{result.transcript || t("nothingHeard")}</p>
      </div>
      <div>
        <h2 className="text-sm font-medium">{t("proposed")}</h2>
        {result.lines.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("noLines")}</p>
        ) : (
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border bg-card">
            {result.lines.map((line, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
                <div className="min-w-0 flex-[1_1_12rem]">
                  <p className="font-medium">{line.productName ?? t("noMatch")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("said", { text: line.spoken })}
                    {line.candidates.length > 0 ? ` · ${t("maybe", { names: line.candidates.map((c) => c.name).join(", ") })}` : ""}
                  </p>
                </div>
                <p className="tabular-nums">
                  {line.qtyText ?? t("noQuantity")} {line.unit ?? ""}
                  {line.catalogUnit && line.unit && line.catalogUnit !== line.unit ? ` (${t("catalogUnit", { unit: line.catalogUnit })})` : ""}
                </p>
                <p className="text-xs text-muted-foreground">{t("confidence", { percent: Math.round(line.confidence * 100) })}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {result.deliveryDay ? <p className="text-sm">{t("delivery", { day: result.deliveryDay })}</p> : null}
      {result.questions.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium">{t("questions")}</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {result.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("stats", { model: result.model, seconds: (result.ms / 1000).toFixed(1), input: result.promptTokens ?? 0, output: result.outputTokens ?? 0 })}
      </p>
    </section>
  );
}
