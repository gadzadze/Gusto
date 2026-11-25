// Microphone capture for the live voice experiment (admin test page). Runs on the audio thread: takes whatever sample rate the
// device uses, resamples to 16 kHz mono with linear interpolation, and posts 100 ms chunks of 16-bit PCM to the page.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.carry = new Float32Array(0);
    this.t = 0;
    this.out = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    const src = new Float32Array(this.carry.length + channel.length);
    src.set(this.carry);
    src.set(channel, this.carry.length);
    let t = this.t;
    while (t + 1 < src.length) {
      const i = Math.floor(t);
      const f = t - i;
      this.out.push(src[i] * (1 - f) + src[i + 1] * f);
      t += this.ratio;
    }
    const keep = Math.floor(t);
    this.carry = src.slice(keep);
    this.t = t - keep;
    if (this.out.length >= 1600) {
      const pcm = new Int16Array(this.out.length);
      for (let i = 0; i < this.out.length; i++) {
        const s = Math.max(-1, Math.min(1, this.out[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this.out = [];
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCapture);
