import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookProgress, chapterByNumber, filterToc, groupToc, nextUnread, tocEntries } from '../app/toc.js';
import { createStore } from '../app/store.js';
import { gradeMeaning, lineHasGloss } from '../app/check.js';

const chapters = ['序', '第一章 雨夜', '第二章 来信', '第三章 真相'].map((title, i) => ({ id: `00${i + 1}`, title }));
const state = {
  completed: ['001'], progress: { '002': { paragraph: 5, total: 10 } }, bookmarks: ['003'], current: '002',
};

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

test('each chapter reports its state and progress', () => {
  const [a, b, c, d] = tocEntries(chapters, state);
  assert.deepEqual([a.state, a.percent, a.read], ['read', 100, true]);
  assert.deepEqual([b.state, b.percent, b.current], ['reading', 50, true]);
  assert.deepEqual([c.state, c.percent, c.bookmarked], ['unread', 0, true]);
  assert.equal(d.number, 4);
});

test('an unfinished chapter never shows 100%', () => {
  const [e] = tocEntries(chapters, { progress: { '001': { paragraph: 10, total: 10 } } });
  assert.equal(e.percent, 99);
});

test('book progress counts partly read chapters', () => {
  assert.deepEqual(bookProgress(tocEntries(chapters, state)), { read: 1, total: 4, percent: 38 });
  assert.deepEqual(bookProgress([]), { read: 0, total: 0, percent: 0 });
});

test('filters by state and bookmark, and searches title or number', () => {
  const all = tocEntries(chapters, state);
  const ids = (o) => filterToc(all, o).map((e) => e.id);
  assert.deepEqual(ids({ filter: 'unread' }), ['002', '003', '004']);
  assert.deepEqual(ids({ filter: 'read' }), ['001']);
  assert.deepEqual(ids({ filter: 'bookmarked' }), ['003']);
  assert.deepEqual(ids({ query: '来信' }), ['003']);
  assert.deepEqual(ids({ query: '4' }), ['004']);
});

test('long books group by chapter number, and filtering keeps the ranges', () => {
  const long = Array.from({ length: 120 }, (_, i) => ({ id: String(i + 1), title: `第${i + 1}回` }));
  const all = tocEntries(long, { completed: ['1', '60'] });
  assert.deepEqual(groupToc(all).map((g) => [g.from, g.to, g.entries.length]), [[1, 50, 50], [51, 100, 50], [101, 120, 20]]);
  assert.deepEqual(groupToc(filterToc(all, { filter: 'read' }), undefined, 120).map((g) => [g.from, g.to, g.entries.length]), [[1, 50, 1], [51, 100, 1]]);
  assert.equal(groupToc(tocEntries(chapters))[0].key, 'all');
  assert.deepEqual(groupToc([]), []);
});

test('next unread looks ahead, then wraps round', () => {
  const all = tocEntries(chapters, { completed: ['002', '004'] });
  assert.equal(nextUnread(all, 2).id, '003');
  assert.equal(nextUnread(all, 3).id, '001');
  assert.equal(nextUnread(tocEntries(chapters, { completed: chapters.map((c) => c.id) })), null);
});

test('jumps by chapter number only when it exists', () => {
  const all = tocEntries(chapters);
  assert.equal(chapterByNumber(all, ' 3 ').id, '003');
  for (const bad of ['0', '9', 'x', '']) assert.equal(chapterByNumber(all, bad), null);
});

test('the store keeps per-chapter progress, marks and bookmarks, and they survive a backup', () => {
  const store = createStore(memoryStorage(), () => 1000);
  store.setPosition('b', { chapter: '001', chapterNumber: 1, paragraph: 4, total: 8 });
  store.setPosition('b', { chapter: '002', chapterNumber: 2, paragraph: 1, total: 8 });
  assert.deepEqual(store.chapterProgress('b')['001'], { paragraph: 4, total: 8, at: 1000 });
  assert.equal(store.position('b').total, undefined);

  store.setChaptersRead('b', ['001', '002'], true);
  assert.deepEqual(store.completedChapters('b'), ['001', '002']);
  store.setChaptersRead('b', ['001'], false);
  assert.deepEqual(store.completedChapters('b'), ['002']);
  assert.equal(store.chapterProgress('b')['001'], undefined);
  assert.equal(store.toggleBookmark('b', '002'), true);

  const copy = createStore(memoryStorage());
  copy.importJSON(store.exportJSON());
  assert.deepEqual(copy.bookmarks('b'), ['002']);
  assert.equal(copy.chapterProgress('b')['002'].paragraph, 1);

  store.resetProgress('b');
  assert.equal(store.position('b'), null);
  assert.deepEqual(store.completedChapters('b'), []);
  assert.deepEqual(store.bookmarks('b'), ['002']);
  assert.equal(store.toggleBookmark('b', '002'), false);
});

test('recall accepts any real definition, and finds the gloss line', () => {
  const lines = ['n. 学者, 读书人, 书生', '[教] 奖学金获得者'];
  const seg = { gloss: '书生' };
  assert.deepEqual(gradeMeaning('书生', seg, lines), { correct: true, other: false });
  assert.deepEqual(gradeMeaning(' 学者。', seg, lines), { correct: true, other: true });
  assert.deepEqual(gradeMeaning('奖学金获得者', seg, lines), { correct: true, other: true });
  assert.deepEqual(gradeMeaning('苹果', seg, lines), { correct: false, other: false });
  assert.deepEqual(gradeMeaning('', seg, lines), { correct: false, other: false });
  // Without the dictionary, the sentence's own meaning still counts.
  assert.deepEqual(gradeMeaning('书生', seg), { correct: true, other: false });
  assert.equal(lineHasGloss(lines[0], '书生'), true);
  assert.equal(lineHasGloss(lines[1], '书生'), false);
});
