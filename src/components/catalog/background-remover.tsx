"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { MODELS } from "@/lib/image/background-removal/config";
import {
  detectCapability,
  RemovalFailure,
  removeBackground,
  type Capability,
  type Progress,
} from "@/lib/image/background-removal/client";

type Result = { file: File; url: string; coverage: number };

/**
 * "Remove background" for a chosen photo. Everything runs on the supplier's own
 * device (a small model, downloaded once and cached by the browser): the photo
 * is not sent anywhere. The supplier compares before and after and picks one.
 */
export function BackgroundRemover({ file, onUse, disabled }: { file: File | null; onUse: (file: File) => void; disabled?: boolean }) {
  const t = useTranslations("products.background");
  const [capability, setCapability] = useState<Capability | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const originalRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultUrl = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void detectCapability().then((c) => alive && setCapability(c));
    return () => {
      alive = false;
    };
  }, []);

  // A new photo clears the old comparison.
  const [seenFile, setSeenFile] = useState<File | null>(file);
  if (file !== seenFile) {
    setSeenFile(file);
    setResult(null);
    setError(null);
    setProgress(null);
  }
  useEffect(
    () => () => {
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      if (originalRef.current) URL.revokeObjectURL(originalRef.current);
    },
    [],
  );

  if (!file || capability === null) return null;
  if (!capability.supported) return <p className="text-sm text-muted-foreground">{t("unsupported")}</p>;
  const { variant, provider } = capability;

  const start = async () => {
    setError(null);
    setRunning(true);
    try {
      const cleaned = await removeBackground(file, variant, provider, setProgress);
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      const url = URL.createObjectURL(cleaned.file);
      resultUrl.current = url;
      if (originalRef.current) URL.revokeObjectURL(originalRef.current);
      originalRef.current = URL.createObjectURL(file);
      setOriginalUrl(originalRef.current);
      setResult({ file: cleaned.file, url, coverage: cleaned.coverage });
    } catch (e) {
      setError(t(`errors.${e instanceof RemovalFailure ? e.code : "failed"}`));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const stageText = progress
    ? progress.stage === "download"
      ? t("stage.download", { percent: Math.round((progress.ratio ?? 0) * 100) })
      : t(`stage.${progress.stage}`)
    : t("stage.load");
  const poor = result ? result.coverage < 0.03 || result.coverage > 0.97 : false;

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <figure className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {originalUrl ? <img src={originalUrl} alt={t("original")} className="aspect-square w-full rounded-md border border-border object-contain" /> : null}
              <figcaption className="text-xs text-muted-foreground">{t("original")}</figcaption>
            </figure>
            <figure className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.url} alt={t("cleaned")} className="aspect-square w-full rounded-md border border-border object-contain" />
              <figcaption className="text-xs text-muted-foreground">{t("cleaned")}</figcaption>
            </figure>
          </div>
          {poor ? <FormAlert tone="error">{t("poor")}</FormAlert> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                onUse(result.file);
                setResult(null);
              }}
            >
              {t("use")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setResult(null)}>
              {t("keep")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button type="button" variant="outline" disabled={disabled || running} onClick={start}>
            <Sparkles />
            {running ? t("running") : t("button")}
          </Button>
          {running ? (
            <div className="space-y-1" aria-live="polite">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-brand transition-[width]"
                  style={{ width: `${progress?.stage === "download" ? Math.round((progress.ratio ?? 0) * 100) : 100}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">{stageText}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(provider === "webgpu" ? "hint" : "hintSlow", { size: Math.round(MODELS[variant].bytes / 1_000_000) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
