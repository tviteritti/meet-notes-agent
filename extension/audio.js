export class Resampler {
  constructor(fromRate) {
    this.ratio = fromRate / 16000;
    this.carry = new Float32Array(0);
    this.pos = 0;
  }

  process(input) {
    if (!input?.length) return new Float32Array(0);
    const merged = new Float32Array(this.carry.length + input.length);
    merged.set(this.carry, 0);
    merged.set(input, this.carry.length);
    const out = [];
    let pos = this.pos;
    while (pos + 1 < merged.length) {
      const index = Math.floor(pos);
      const frac = pos - index;
      out.push(merged[index] * (1 - frac) + merged[index + 1] * frac);
      pos += this.ratio;
    }
    this.carry = merged.slice(Math.floor(pos));
    this.pos = pos - Math.floor(pos);
    return Float32Array.from(out);
  }
}

export function encodeWav(samples) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return bytes;
}

export function pcmToBase64(pcm) {
  const bytes = new Uint8Array(encodeWav(pcm));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function createPhraseCapture(onPhrase) {
  const rate = 16000;
  const maxPre = rate * 0.25;
  const silenceLimit = rate * 0.45;
  const maxLen = rate * 6;
  const minSpeech = rate * 0.4;
  let pre = [];
  let preCount = 0;
  let buf = [];
  let bufCount = 0;
  let silence = 0;
  let speech = 0;
  let active = false;
  let startedAt = 0;

  function flush() {
    if (!active) return;
    if (speech >= minSpeech) {
      const take = Math.min(bufCount, Math.max(speech, bufCount - Math.floor(silence * 0.5)));
      const pcm = new Float32Array(take);
      let offset = 0;
      for (const chunk of buf) {
        const copy = Math.min(chunk.length, take - offset);
        pcm.set(chunk.subarray(0, copy), offset);
        offset += copy;
        if (offset >= take) break;
      }
      const t0 = startedAt;
      onPhrase(pcm, t0, t0 + Math.round((pcm.length / rate) * 1000));
    }
    active = false;
    buf = [];
    bufCount = 0;
    silence = 0;
    speech = 0;
  }

  return {
    push(samples) {
      if (!samples.length) return;
      let energy = 0;
      for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
      const voiced = Math.sqrt(energy / samples.length) > 0.012;

      if (!active) {
        pre.push(samples);
        preCount += samples.length;
        while (preCount > maxPre && pre.length) preCount -= pre.shift().length;
        if (!voiced) return;
        active = true;
        startedAt = Date.now() - Math.round((preCount / rate) * 1000);
        buf = pre;
        bufCount = preCount;
        pre = [];
        preCount = 0;
        speech = samples.length;
        silence = 0;
        return;
      }

      buf.push(samples);
      bufCount += samples.length;
      if (voiced) {
        speech += samples.length;
        silence = 0;
      } else silence += samples.length;
      if (silence >= silenceLimit || bufCount >= maxLen) flush();
    },
    flush,
  };
}
