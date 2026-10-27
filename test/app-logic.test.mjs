import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMeaning, checkSpelling, transferPrompt, hintFor } from '../app/check.js';
import { createStore } from '../app/store.js';

const seg = { w: 'suspect-v', form: 'suspected', gloss: '怀疑', accept: ['怀疑', '猜想'] };
const word = { id: 'suspect-v', lemma: 'suspect', example: 'I suspected that something was wrong.' };

test('meaning recall accepts the gloss and accept list, ignoring spaces and punctuation', () => {
  assert.equal(checkMeaning(' 怀疑。', seg), true);
  assert.equal(checkMeaning('猜想', seg), true);
  assert.equal(checkMeaning('相信', seg), false);
  assert.equal(checkMeaning('', seg), false);
});

test('meaning recall falls back to the gloss when accept is absent', () => {
  assert.equal(checkMeaning('证据', { gloss: '证据' }), true);
});

test('spelling recall wants the form as written, case-insensitive', () => {
  assert.equal(checkSpelling('Suspected ', seg), true);
  assert.equal(checkSpelling('suspect', seg), false);
});

test('hint shows the first letter and the length', () => {
  assert.equal(hintFor('suspected'), 's________');
  assert.equal(hintFor("o'clock"), "o'_____");
});

test('transfer blanks the word in the English example', () => {
  const p = transferPrompt(word, ['suspected']);
  assert.equal(p.before, 'I ');
  assert.equal(p.answer, 'suspected');
  assert.equal(p.after, ' that something was wrong.');
});

test('transfer returns null when the example lacks the word', () => {
  assert.equal(transferPrompt({ lemma: 'grief', example: 'No match here.' }, []), null);
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('store saves words, answers, errors and position, and survives a reload', () => {
  const storage = memoryStorage();
  const a = createStore(storage, () => 1000);
  a.toggleSaved('builtin/huapi/scholar-n');
  a.setPosition('builtin/huapi', { chapter: '02', paragraph: 3 });
  a.recordAnswer('builtin/huapi/scholar-n', { mode: 'en2zh', correct: false, given: '学者' });
  a.recordAnswer('builtin/huapi/scholar-n', { mode: 'en2zh', correct: true, given: '书生' });
  a.noteNextChapter('builtin/huapi');

  const b = createStore(storage, () => 2000);
  assert.equal(b.isSaved('builtin/huapi/scholar-n'), true);
  assert.deepEqual(b.position('builtin/huapi'), { chapter: '02', paragraph: 3, at: 1000 });
  assert.equal(b.errors()['builtin/huapi/scholar-n'].count, 1);
  assert.equal(b.answers('builtin/huapi/scholar-n').length, 2);
  assert.equal(b.data.stats.nextChapter['builtin/huapi'], 1);

  b.toggleSaved('builtin/huapi/scholar-n');
  assert.equal(createStore(storage).isSaved('builtin/huapi/scholar-n'), false);
});

test('store works in memory when storage throws', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const s = createStore(broken);
  s.toggleSaved('x');
  assert.equal(s.isSaved('x'), true);
  assert.equal(s.persistent, false);
});

test('shelf status follows progress unless the reader sets one', () => {
  const store = createStore(memoryStorage());
  const key = 'library/demo';
  assert.equal(store.status(key, 2), 'unread');
  store.setPosition(key, { chapter: '001', chapterNumber: 1, paragraph: 0 });
  assert.equal(store.status(key, 2), 'reading');
  store.markComplete(key, '001');
  store.markComplete(key, '002');
  assert.equal(store.status(key, 2), 'done');
  store.setShelf(key, { status: 'unread' });
  assert.equal(store.status(key, 2), 'unread');
  assert.equal(store.statusOverride(key), 'unread');
  store.setShelf(key, { status: null });
  assert.equal(store.status(key, 2), 'done');
});

test('shelf categories are trimmed, listed once, reset when blank, and survive a backup', () => {
  const store = createStore(memoryStorage());
  store.setShelf('builtin/huapi', { category: '  志怪 ' });
  store.setShelf('library/a', { category: '志怪', status: 'done' });
  assert.equal(store.category('builtin/huapi'), '志怪');
  assert.deepEqual(store.categories(), ['志怪']);
  store.setShelf('builtin/huapi', { category: '' });
  assert.equal(store.category('builtin/huapi'), null);
  assert.equal('builtin/huapi' in store.data.shelf, false);

  const restored = createStore(memoryStorage());
  restored.importJSON(store.exportJSON());
  assert.equal(restored.category('library/a'), '志怪');
  assert.equal(restored.status('library/a', 3), 'done');
});

test('reading position records when the book was last read', () => {
  let t = 1000;
  const store = createStore(memoryStorage(), () => t);
  store.setPosition('library/demo', { chapter: '001', chapterNumber: 1, paragraph: 0 });
  assert.equal(store.position('library/demo').at, 1000);
  t = 5000;
  store.setPosition('library/demo', { chapter: '002', chapterNumber: 2, paragraph: 3 });
  assert.equal(store.position('library/demo').at, 5000);
});
