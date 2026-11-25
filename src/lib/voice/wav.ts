// Encodes mono samples as a 16-bit PCM WAV file. The browser records in whatever format it likes
// (webm, mp4) and speech APIs differ in what they accept, so we always send plain WAV.

export const VOICE_SAMPLE_RATE = 16_000;
/** About 95 seconds of 16 kHz mono 16-bit audio; one spoken order is a few seconds. */
export const MAX_WAV_BYTES = 3_000_000;

export function encodeWav(samples: Float32Array, sampleRate: number = VOICE_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true); // PCM block size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** True when the bytes start like a WAV file (checked again on the server, never trusted from the browser). */
export function looksLikeWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  const tag = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  return tag(0) === "RIFF" && tag(8) === "WAVE";
}
