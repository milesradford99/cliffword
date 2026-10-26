import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { audioFilename, audioBase, createSpeaker, pickVoice } from '../app/tts.js';
import { collectAudio, audioFilename as generatorFilename } from '../scripts/lib/audio.mjs';

const book = { source: 'builtin', id: 'huapi' };
const voice = { name: 'Samantha Enhanced', lang: 'en-US', localService: true };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness({ play, filename, audio = true, system = true } = {}) {
  const clips = [], utterances = [];
  let cancelled = 0;
  class Audio {
    constructor(src) { this.src = src; clips.push(this); }
    play() { return play?.(this) ?? Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() { this.released = true; }
  }
  class Utterance { constructor(text) { this.text = text; } }
  const speaker = createSpeaker({
    Audio: audio ? Audio : null, Utterance: system ? Utterance : null,
    synth: system ? { cancel() { cancelled++; }, getVoices: () => [voice], speak(u) { utterances.push(u); } } : null,
    filename: filename ?? (async () => 'clip.wav'),
  });
  return { ...speaker, clips, utterances, cancelled: () => cancelled };
}

test('browser and generator use identical content-addressed audio names', async () => {
  for (const text of ['scholar', "Don't hesitate to contact me.", '  fled  ']) {
    assert.equal(await audioFilename(text), generatorFilename(text));
  }
  assert.notEqual(await audioFilename('tear'), await audioFilename('tears'));
  assert.equal(audioBase(book), 'content/huapi/audio/');
  assert.equal(audioBase({ source: 'library', id: 'my book' }), 'library/my%20book/audio/');
  assert.equal(audioBase({ source: 'https://evil.example', id: 'x' }), null);
});

test('plays neural audio without requiring browser speech synthesis', async () => {
  const s = harness({ system: false });
  assert.equal(s.supported, true);
  assert.equal(await s.speak('scholar', { book }), true);
  assert.equal(s.clips[0].src, 'content/huapi/audio/clip.wav');
  assert.equal(s.clips[0].playbackRate, 1);
  assert.equal(s.clips[0].preservesPitch, true);
});

test('missing/corrupt audio and autoplay rejection fall back to a system voice', async () => {
  for (const name of ['NotSupportedError', 'NotAllowedError']) {
    const s = harness({ play: () => Promise.reject(Object.assign(new Error(name), { name })) });
    assert.equal(await s.speak('scholar', { book }), true);
    assert.equal(s.clips[0].released, true);
    assert.equal(s.utterances[0].text, 'scholar');
    assert.equal(s.utterances[0].voice, voice);
    assert.equal(s.utterances[0].rate, 0.9);
  }
});

test('a slow older request cannot start or fall back after a new click', async () => {
  const old = deferred();
  const s = harness({ filename: (text) => text === 'old' ? old.promise : Promise.resolve('new.wav') });
  const pending = s.speak('old', { book });
  await s.speak('new', { book });
  old.resolve('old.wav');
  assert.equal(await pending, false);
  assert.equal(s.clips.length, 1);
  assert.equal(s.utterances.length, 0);
  assert.match(s.clips[0].src, /new.wav$/);
});

test('stop releases playback and cancels both pending decoding and system fallback', async () => {
  const playback = deferred();
  const s = harness({ play: () => playback.promise });
  const pending = s.speak('scholar', { book });
  await Promise.resolve();
  s.stop();
  playback.reject(new Error('aborted'));
  assert.equal(await pending, false);
  assert.equal(s.clips[0].released, true);
  assert.equal(s.utterances.length, 0);
  assert.equal(s.cancelled(), 2);
});

test('repeated playback interrupts the previous clip', async () => {
  const s = harness();
  await s.speak('first', { book });
  await s.speak('second', { book, rate: 1.2 });
  assert.equal(s.clips[0].released, true);
  assert.equal(s.clips[1].playbackRate, 1.2 / 0.9);
});

test('unavailable media, digest failure, empty input and no book degrade safely', async () => {
  const s = harness({ audio: false, system: false });
  assert.equal(s.supported, false);
  assert.equal(await s.speak('scholar', { book }), false);
  const fallback = harness({ filename: async () => { throw new Error('no crypto'); } });
  assert.equal(await fallback.speak('scholar', { book }), true);
  assert.equal(await fallback.speak(''), false);
  assert.equal(await fallback.speak(null), false);
  assert.equal(await fallback.speak('unknown'), true);
  assert.equal(fallback.clips.length, 0);
});

test('voice selection prefers enhanced English over an arbitrary first voice', () => {
  const basic = { name: 'Basic', lang: 'en-US', localService: true };
  assert.equal(pickVoice([{ name: 'Chinese', lang: 'zh-CN' }, basic, voice]), voice);
  assert.equal(pickVoice([]), null);
});

test('collects inflected occurrence forms, lemmas and examples without book prose', async () => {
  const entries = await collectAudio('content/huapi');
  assert.ok(entries.some((e) => e.text === 'fled'));
  assert.ok(entries.some((e) => e.text === 'flee'));
  assert.ok(entries.some((e) => e.text === 'Thousands of people had to flee the flood.'));
  assert.equal(entries.find((e) => e.text === 'tear').phonemes, 'tˈɛɹ');
  assert.ok(entries.every((e) => !/[\u3400-\u9fff]/u.test(e.text)));
  const imported = await collectAudio('test/fixtures/library/demo');
  assert.deepEqual(imported.map((e) => e.text), ['I trust him to keep his promise.', 'She wrote a long letter to her grandmother.', 'letter', 'trust']);
});

test('every built-in pronunciation has an intact, non-silent 24kHz PCM audio clip', async () => {
  const { stories } = JSON.parse(await readFile('content/index.json', 'utf8'));
  for (const id of stories) {
    const dir = `content/${id}`;
    const manifest = JSON.parse(await readFile(`${dir}/audio/manifest.json`, 'utf8'));
    const entries = await collectAudio(dir);
    assert.equal(Object.keys(manifest.files).length, entries.length);
    for (const { file, text, phonemes } of entries) {
      const data = await readFile(`${dir}/audio/${file}`);
      assert.equal(data.toString('ascii', 0, 4), 'RIFF');
      assert.equal(data.toString('ascii', 8, 12), 'WAVE');
      assert.equal(data.readUInt32LE(24), 24000);
      assert.equal(data.readUInt16LE(34), 16);
      assert.ok(data.length > 10000);
      assert.equal(manifest.files[file].text, text);
      assert.equal(manifest.files[file].phonemes, phonemes);
      assert.equal(createHash('sha256').update(data).digest('hex'), manifest.files[file].sha256);
      let peak = 0;
      for (let i = 44; i + 1 < data.length; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
      assert.ok(peak > 100, `${text} is silent`);
    }
  }
});
