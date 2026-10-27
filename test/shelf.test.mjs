import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterShelf, lastReadLabel, pageList, paginate, sortShelf } from '../app/shelf.js';

const books = [
  { id: 'hong-lou-meng', title: '红楼梦', category: '小说', status: 'reading', progress: 0.1, chapters: 120, lastReadAt: 300, addedAt: 10 },
  { id: 'huapi', title: '画皮', category: '内置故事', status: 'done', progress: 1, chapters: 3, lastReadAt: 100, addedAt: null },
  { id: 'a-q', title: '阿Q正传', category: '小说', status: 'unread', progress: 0, chapters: 9, lastReadAt: null, addedAt: 30 },
  { id: 'xi-you-ji', title: '西游记', category: '小说', status: 'reading', progress: 0.5, chapters: 100, lastReadAt: 200, addedAt: 20 },
];
const titles = (list) => list.map((b) => b.title);

test('search matches title, category or id, case-insensitively', () => {
  assert.deepEqual(titles(filterShelf(books, { query: '西游' })), ['西游记']);
  assert.deepEqual(titles(filterShelf(books, { query: 'HONG' })), ['红楼梦']);
  assert.deepEqual(titles(filterShelf(books, { query: '内置' })), ['画皮']);
  assert.deepEqual(titles(filterShelf(books, { query: '小说', status: 'reading' })), ['红楼梦', '西游记']);
  assert.deepEqual(filterShelf(books, { query: '  ' }).length, 4);
});

test('sorts by recent reading, never-read books last in either direction', () => {
  assert.deepEqual(titles(sortShelf(books, 'recent')), ['红楼梦', '西游记', '画皮', '阿Q正传']);
  assert.deepEqual(titles(sortShelf(books, 'recent', 'asc')), ['画皮', '西游记', '红楼梦', '阿Q正传']);
});

test('sorts by added date, progress, length and status', () => {
  assert.deepEqual(titles(sortShelf(books, 'added')), ['阿Q正传', '西游记', '红楼梦', '画皮']);
  assert.deepEqual(titles(sortShelf(books, 'progress')), ['画皮', '西游记', '红楼梦', '阿Q正传']);
  assert.deepEqual(titles(sortShelf(books, 'length', 'asc')), ['画皮', '阿Q正传', '西游记', '红楼梦']);
  assert.equal(sortShelf(books, 'status')[0].status, 'reading');
  assert.equal(sortShelf(books, 'status').at(-1).status, 'done');
});

test('title sort is stable, reversible and falls back for unknown sorts', () => {
  const asc = titles(sortShelf(books, 'title'));
  assert.deepEqual(titles(sortShelf(books, 'title', 'desc')), [...asc].reverse());
  assert.deepEqual(titles(sortShelf(books, 'nonsense')), titles(sortShelf(books, 'recent')));
});

test('paginates and clamps the page into range', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  assert.deepEqual(paginate(items, 1, 24), { items: items.slice(0, 24), page: 1, pages: 3, total: 50, from: 1, to: 24 });
  assert.deepEqual(paginate(items, 3, 24).items, [48, 49]);
  assert.equal(paginate(items, 9, 24).page, 3);
  assert.equal(paginate(items, 0, 24).page, 1);
  assert.deepEqual(paginate([], 4, 24), { items: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
});

test('page list keeps first, last and neighbours, with gaps', () => {
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(1, 5), [1, 2, null, 5]);
  assert.deepEqual(pageList(4, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageList(6, 12), [1, null, 5, 6, 7, null, 12]);
  assert.deepEqual(pageList(3, 12), [1, 2, 3, 4, null, 12]);
});

test('last-read labels are relative to the local day', () => {
  const now = new Date('2026-10-27T09:00:00').getTime();
  assert.equal(lastReadLabel(null, now), null);
  assert.equal(lastReadLabel(new Date('2026-10-27T01:00:00').getTime(), now), '今天');
  assert.equal(lastReadLabel(new Date('2026-10-26T23:00:00').getTime(), now), '昨天');
  assert.equal(lastReadLabel(new Date('2026-10-20T12:00:00').getTime(), now), '7 天前');
  assert.equal(lastReadLabel(new Date('2026-08-01T12:00:00').getTime(), now), '2026-08-01');
});

test('shelf state round-trips through the URL, leaving defaults out', async () => {
  const { shelfParams, shelfStateFromParams, SHELF_DEFAULTS } = await import('../app/shelf.js');
  assert.equal(shelfParams(SHELF_DEFAULTS).toString(), '');
  assert.equal(shelfParams({ ...SHELF_DEFAULTS, sort: 'title', dir: 'asc' }).toString(), 'sort=title');
  const state = { query: '西游', category: '小说', status: 'reading', sort: 'length', dir: 'asc', page: 3, size: 48, view: 'list' };
  const params = shelfParams(state);
  assert.equal(params.toString(), 'q=%E8%A5%BF%E6%B8%B8&cat=%E5%B0%8F%E8%AF%B4&status=reading&sort=length&dir=asc&page=3&size=48&view=list');
  assert.deepEqual(shelfStateFromParams(params), state);
});

test('invalid URL values are ignored', async () => {
  const { shelfStateFromParams } = await import('../app/shelf.js');
  assert.deepEqual(shelfStateFromParams(new URLSearchParams('status=lost&sort=x&dir=up&page=-2&size=7&view=table')), {});
  assert.deepEqual(shelfStateFromParams(new URLSearchParams('page=2abc')), { page: 2 });
});

test('reading history without a time sorts after timed reads but before never-read books', () => {
  const list = [{ title: '甲', lastReadAt: null }, { title: '乙', lastReadAt: 0 }, { title: '丙', lastReadAt: 500 }];
  assert.deepEqual(titles(sortShelf(list, 'recent')), ['丙', '乙', '甲']);
});
