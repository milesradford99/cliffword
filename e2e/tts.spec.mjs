import { test, expect } from '@playwright/test';
import { audioFilename } from '../scripts/lib/audio.mjs';

// Keep real HTMLAudioElement decoding/playback; observe it without replacing
// the audio engine. System speech is deterministic for the fallback checks.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__clips = [];
    window.__spoken = [];
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      window.__clips.push(audio);
      return audio;
    };
    Object.defineProperty(window, 'speechSynthesis', { value: {
      cancel() {},
      getVoices: () => [],
      speak(utterance) { window.__spoken.push(utterance.text); },
    } });
  });
});

async function openScholar(page) {
  await page.goto('/#/read/builtin/huapi/01');
  await page.getByRole('button', { name: /^scholar，书生/ }).first().click();
}

const clips = (page) => page.evaluate(() => window.__clips.map((a) => ({
  src: a.currentSrc || a.src, paused: a.paused, time: a.currentTime,
  duration: a.duration, error: a.error?.code,
})));

test('real word and sentence audio decode, replay interrupts, closing stops', async ({ page }) => {
  await openScholar(page);
  const card = page.locator('#word-card');
  await card.getByRole('button', { name: '朗读 scholar', exact: true }).click();
  await expect.poll(async () => (await clips(page))[0]?.time).toBeGreaterThan(0);
  expect((await clips(page))[0].src).toContain(`/content/huapi/audio/${audioFilename('scholar')}`);
  const sentence = page.waitForResponse((r) => r.url().endsWith(audioFilename('She is a respected scholar of Chinese history.')));
  await card.getByRole('button', { name: '朗读例句' }).click();
  expect((await sentence).headers()['content-type']).toBe('audio/wav');
  await expect.poll(async () => (await clips(page))[1]?.time).toBeGreaterThan(0);
  expect((await clips(page))[0].paused).toBe(true);
  expect((await clips(page))[1].duration).toBeGreaterThan(2);
  expect(await page.evaluate(() => window.__spoken)).toEqual([]);
  await card.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(async () => (await clips(page)).every((a) => a.paused)).toBe(true);
});

test('saved words use neural audio after a fresh page load', async ({ page }) => {
  await openScholar(page);
  await page.locator('#word-card').getByRole('button', { name: /收藏/ }).click();
  await page.goto('/#/saved');
  await page.reload();
  await page.getByRole('button', { name: '朗读 scholar', exact: true }).click();
  await expect.poll(async () => (await clips(page))[0]?.time).toBeGreaterThan(0);
  expect((await clips(page))[0].src).toContain('/content/huapi/audio/');
  await page.goto('/');
});

test('missing audio falls back to the system voice without breaking the card', async ({ page }) => {
  await page.route('**/audio/*.wav', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await openScholar(page);
  await page.getByRole('button', { name: '朗读 scholar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual(['scholar']);
  await expect(page.locator('#word-card')).toBeVisible();
});

test('imported book audio follows LIBRARY_DIR and navigation stops playback', async ({ page }) => {
  await page.goto('/#/read/library/demo/001');
  await page.getByRole('button', { name: /^letter，信/ }).first().click();
  await page.getByRole('button', { name: '朗读例句' }).click();
  await expect.poll(async () => (await clips(page))[0]?.time).toBeGreaterThan(0);
  expect((await clips(page))[0].src).toContain('/library/demo/audio/');
  // Hash navigation keeps the document alive, so we can verify cancellation.
  await page.evaluate(() => { location.hash = '#/'; });
  await expect.poll(async () => (await clips(page))[0]?.paused).toBe(true);
  expect(await page.evaluate(() => window.__spoken)).toEqual([]);
});
