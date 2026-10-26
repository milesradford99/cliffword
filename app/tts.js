// Prefer locally generated Kokoro audio. No text is sent to a speech service.
// The system voice is a fallback for books without an audio pack.
export async function audioFilename(text) {
  const bytes = new TextEncoder().encode(text.trim());
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}.wav`;
}

export function audioBase({ source, id } = {}) {
  if (!['builtin', 'library'].includes(source) || !id) return null;
  return `${source === 'builtin' ? 'content' : 'library'}/${encodeURIComponent(id)}/audio/`;
}

export function pickVoice(voices) {
  const english = voices.filter((v) => /^en(?:[-_]|$)/i.test(v.lang));
  const score = (v) => (/premium|enhanced|natural|neural/i.test(v.name) ? 8 : 0)
    + (v.localService ? 4 : 0) + (/^en[-_]US$/i.test(v.lang) ? 2 : 0) + (v.default ? 1 : 0);
  return english.sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Dependencies are injected so cancellation and fallback can be tested without
// a speaker, installed system voices, or a DOM.
export function createSpeaker({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  Audio = globalThis.Audio,
  filename = audioFilename,
} = {}) {
  let generation = 0;
  let playing = null;
  const supported = Boolean(Audio || (synth && Utterance));

  function stop() {
    generation += 1;
    if (playing) {
      playing.pause();
      playing.removeAttribute('src');
      playing.load();
      playing = null;
    }
    synth?.cancel();
  }

  async function speak(text, { rate = 0.9, book } = {}) {
    stop();
    const request = generation;
    if (typeof text !== 'string' || !text.trim() || !supported) return false;
    rate = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 0.9;
    const base = audioBase(book);
    if (Audio && base) {
      try {
        const file = await filename(text);
        if (request !== generation) return false;
        const audio = new Audio(base + file);
        playing = audio;
        // Packs are generated at 0.9; preserve pitch when changing speed.
        audio.playbackRate = rate / 0.9;
        audio.preservesPitch = true;
        await audio.play();
        return request === generation;
      } catch {
        // A missing pack, unsupported codec or rejected playback must not
        // prevent pronunciation. A superseded request must stay silent.
        if (request !== generation) return false;
        if (playing) {
          playing.pause();
          playing.removeAttribute('src');
          playing.load();
          playing = null;
        }
      }
    }
    if (request !== generation || !synth || !Utterance) return false;
    try {
      const utterance = new Utterance(text.trim());
      const voice = pickVoice(synth.getVoices());
      utterance.lang = voice?.lang ?? 'en-US';
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      synth.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  return { supported, speak, stop };
}

const speaker = createSpeaker();
export const ttsSupported = speaker.supported;
export const speak = speaker.speak;
export const stopSpeaking = speaker.stop;
