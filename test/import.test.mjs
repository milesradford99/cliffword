import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitChapters, decodeText, importText, parseDensity } from '../scripts/import-text.mjs';
import { applyAnnotations, countSentences } from '../scripts/lib/annotate.mjs';
import { DEFAULT_DENSITY, densityRange, loadBook, validateBook } from '../scripts/validate-content.mjs';

const tmp = () => mkdtemp(join(tmpdir(), 'cliffword-'));

test('splits on Chinese chapter headings', () => {
  const chapters = splitChapters('第一章 开始\n他来了。\n\n第二章 结束\n他走了。\n');
  assert.deepEqual(chapters.map((c) => c.title), ['第一章 开始', '第二章 结束']);
  assert.equal(chapters[1].text, '他走了。');
});

test('keeps a long preface as its own chapter', () => {
  const preface = '序'.repeat(300);
  const chapters = splitChapters(`${preface}\n第1章 正文\n内容。`);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, '序');
});

test('chunks text without headings into parts at paragraph boundaries', () => {
  const para = '字'.repeat(1000);
  const chapters = splitChapters(Array(7).fill(para).join('\n'));
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].title, '第1部分');
  assert.ok(chapters.every((c) => !c.text.includes('字'.repeat(1001))));
});

test('decodes GB18030 text when it is not valid UTF-8', () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]); // 你好
  assert.equal(decodeText(gbk), '你好');
  assert.equal(decodeText(Buffer.from('﻿你好', 'utf8')), '你好');
});

test('refuses URLs: import only reads local files', async () => {
  await assert.rejects(importText('https://example.com/book/1', { libraryDir: await tmp() }), /local text file/);
});

test('writes source chapters and book.json, and will not overwrite', async () => {
  const dir = await tmp();
  const file = join(dir, 'book.txt');
  await writeFile(file, '第一章 甲\n一。\n第二章 乙\n二。\n');
  const lib = join(dir, 'library');
  const { bookDir } = await importText(file, { id: 'my-book', libraryDir: lib });
  const book = JSON.parse(await readFile(join(bookDir, 'book.json'), 'utf8'));
  assert.equal(book.chapters.length, 2);
  assert.deepEqual(book.density, DEFAULT_DENSITY);
  assert.equal(book.level, 'IELTS');
  assert.ok(!Number.isNaN(Date.parse(book.importedAt)));
  assert.equal(await readFile(join(bookDir, 'source', '002.txt'), 'utf8'), '二。\n');
  await assert.rejects(importText(file, { id: 'my-book', libraryDir: lib }), /already exists/);
});

test('applies anchors in order and honours nth', () => {
  const { paragraphs, errors } = applyAnnotations(['证据就是证据。', '没有证据。'], [
    { w: 'evidence-n', anchor: '证据', nth: 2, form: 'evidence', gloss: '证据' },
    { w: 'evidence-n', anchor: '证据', nth: 3, form: 'evidence', gloss: '证据' },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(paragraphs[0].segments, ['证据就是', { w: 'evidence-n', form: 'evidence', gloss: '证据' }, '。']);
  assert.deepEqual(paragraphs[1].segments, ['没有', { w: 'evidence-n', form: 'evidence', gloss: '证据' }, '。']);
});

test('reports anchors that are missing or overlap', () => {
  const { errors } = applyAnnotations(['他怀疑她。'], [
    { w: 'a', anchor: '证据', form: 'evidence', gloss: '证据' },
    { w: 'b', anchor: '怀疑她', form: 'suspect', gloss: '怀疑' },
    { w: 'c', anchor: '疑', form: 'doubt', gloss: '疑' },
  ]);
  assert.ok(errors.some((e) => /anchor "证据" #1 not found/.test(e)));
  assert.ok(errors.some((e) => /overlaps/.test(e)));
});

async function annotatedBook(occurrencesPerChapter, chapterText = '苹果和香蕉。') {
  const dir = await tmp();
  const file = join(dir, 'b.txt');
  await writeFile(file, `第一章 甲\n${chapterText}\n第二章 乙\n${chapterText}\n`);
  const { bookDir } = await importText(file, { id: 'b', libraryDir: join(dir, 'library') });
  await writeFile(join(bookDir, 'vocab.json'), JSON.stringify({ words: [
    { id: 'apple-n', lemma: 'apple', ipa: '/ˈæpl/', pos: 'n.', example: 'An apple a day.' },
    { id: 'banana-n', lemma: 'banana', ipa: '/bəˈnɑːnə/', pos: 'n.', example: 'A ripe banana.' },
  ] }));
  await mkdir(join(bookDir, 'annotations'));
  for (const [i, occ] of occurrencesPerChapter.entries()) {
    await writeFile(join(bookDir, 'annotations', `00${i + 1}.json`), JSON.stringify({ occurrences: occ }));
  }
  return bookDir;
}

const apple = { w: 'apple-n', anchor: '苹果', form: 'apple', gloss: '苹果' };
const banana = { w: 'banana-n', anchor: '香蕉', form: 'banana', gloss: '香蕉' };

// Each test chapter is one sentence with two tags: one every 0.5 sentences.
const dense = { sentencesPerWord: { min: 0.5, max: 2 }, maxPerWord: 6 };

test('validates an annotated book with its own density', async () => {
  const bookDir = await annotatedBook([[apple, banana], [apple, banana]]);
  assert.deepEqual(await validateBook(bookDir, { density: dense, wordlist: false }), []);
  const sparse = { sentencesPerWord: { min: 2, max: 6 }, maxPerWord: 6, everySentence: false };
  const tooDense = await validateBook(bookDir, { density: sparse, wordlist: false });
  assert.ok(tooDense.some((e) => /chapter "001" has 1 sentences and 2 tagged words \(one every 0\.5 sentences\); expected one every 2–6 sentences, i\.e\. 1–1 tagged words/.test(e)));
});

test('by default every sentence needs a tagged word, except very short ones', async () => {
  const text = '苹果很甜。好。香蕉也很甜。';
  const both = await annotatedBook([[apple, banana], [apple, banana]], text);
  assert.deepEqual(await validateBook(both, { wordlist: false }), []);

  const half = await annotatedBook([[apple], [apple, banana]], text);
  const errors = await validateBook(half, { wordlist: false });
  assert.ok(errors.some((e) => /chapter "001": 1 of 2 sentences have no tagged word, and every sentence needs one: paragraph 1 "香蕉也很甜。…"/.test(e)), errors.join('\n'));
  assert.ok(!errors.some((e) => /chapter "002"/.test(e)));
});

test('a sparser --density turns off the every-sentence rule', async () => {
  const dir = await tmp();
  const file = join(dir, 'b.txt');
  await writeFile(file, '第一章 甲\n一。\n');
  const { book } = await importText(file, { id: 'sparse', libraryDir: join(dir, 'library'), density: parseDensity('2-6') });
  assert.equal(book.density.everySentence, false);
  const { book: dense } = await importText(file, { id: 'dense', libraryDir: join(dir, 'library'), density: parseDensity('1') });
  assert.equal(dense.density.everySentence, true);
});

test('density scales with chapter length', () => {
  const density = { sentencesPerWord: { min: 1, max: 2 } };
  assert.deepEqual(densityRange(10, density), { min: 5, max: 10 });
  assert.deepEqual(densityRange(300, density), { min: 150, max: 300 });
  assert.deepEqual(densityRange(300, DEFAULT_DENSITY), { min: 300, max: 600 });
  assert.deepEqual(densityRange(1, DEFAULT_DENSITY), { min: 1, max: 2 });
});

test('counts sentences across Chinese and Western punctuation and paragraph breaks', () => {
  assert.equal(countSentences(['他来了。“你好！”她说。', '没有标点的一段', '……', 'Is it? Yes!']), 6);
});

test('no word may carry a whole chapter', async () => {
  const bookDir = await annotatedBook([[apple, banana], [apple, banana]]);
  const errors = await validateBook(bookDir, { density: { ...dense, maxPerWord: 0.5 }, wordlist: false });
  assert.ok(errors.some((e) => /tags "apple-n" 1 times, at most 0\.5 per chapter/.test(e)));
});

test('the old fixed word count is reported with the fix', async () => {
  const bookDir = await annotatedBook([[apple, banana], [apple, banana]]);
  const book = JSON.parse(await readFile(join(bookDir, 'book.json'), 'utf8'));
  await writeFile(join(bookDir, 'book.json'), JSON.stringify({ ...book, density: { min: 8, max: 15 } }));
  const errors = await validateBook(bookDir, { wordlist: false });
  assert.ok(errors.some((e) => /fixed word count per chapter.*sentencesPerWord/.test(e)));
});

test('parses --density', () => {
  assert.deepEqual(parseDensity('1-2'), { min: 1, max: 2 });
  assert.deepEqual(parseDensity('3'), { min: 3, max: 3 });
  assert.throws(() => parseDensity('2-1'), /Invalid --density/);
  assert.throws(() => parseDensity('a'), /Invalid --density/);
});

test('reports chapters that are not annotated yet', async () => {
  const bookDir = await annotatedBook([[apple, banana]]);
  const errors = await validateBook(bookDir, { density: dense, wordlist: false });
  assert.ok(errors.some((e) => /chapter "002" is not annotated yet/.test(e)));
});

test('loadBook keeps the source text unchanged', async () => {
  const bookDir = await annotatedBook([[apple], [banana]]);
  const { chapters } = await loadBook(bookDir);
  const text = chapters[0].paragraphs[0].segments.map((s) => (typeof s === 'string' ? s : s.gloss)).join('');
  assert.equal(text, '苹果和香蕉。');
});

test('import keeps library/index.json listing every book', async () => {
  const dir = await tmp();
  const lib = join(dir, 'library');
  for (const id of ['b-two', 'a-one']) {
    const file = join(dir, `${id}.txt`);
    await writeFile(file, '第一章 甲\n一。\n');
    await importText(file, { id, libraryDir: lib });
  }
  const index = JSON.parse(await readFile(join(lib, 'index.json'), 'utf8'));
  assert.deepEqual(index.books.map((b) => b.id), ['a-one', 'b-two']);
  assert.equal(index.books[0].chapters, 1);
  assert.ok(index.books[0].addedAt);
});

test('imported books must use IELTS words, real forms and dictionary-backed glosses', async () => {
  const { createWordlist } = await import('../scripts/lib/wordlist.mjs');
  const list = createWordlist({ words: {
    apple: { ipa: '/ˈæpl/', zh: ['n. 苹果'], forms: ['apples'] },
    banana: { ipa: '/bəˈnɑːnə/', zh: ['n. 香蕉'], forms: ['bananas'] },
  } });
  const opts = { density: dense, wordlist: list };
  const ok = await annotatedBook([[apple, banana], [apple, banana]]);
  assert.deepEqual(await validateBook(ok, opts), []);

  const badGloss = await annotatedBook([[{ ...apple, gloss: '梨' }, banana], [apple, banana]]);
  assert.ok((await validateBook(badGloss, opts)).some((e) => /gloss "梨" doesn't match the dictionary \(苹果\)/.test(e)));

  const noted = await annotatedBook([[{ ...apple, gloss: '梨', glossNote: 'test: deliberate' }, banana], [apple, banana]]);
  assert.deepEqual(await validateBook(noted, opts), []);

  const badForm = await annotatedBook([[{ ...apple, form: 'appled' }, banana], [apple, banana]]);
  assert.ok((await validateBook(badForm, opts)).some((e) => /form "appled" is not a form of "apple"/.test(e)));

  const offList = createWordlist({ words: { apple: { ipa: '', zh: ['n. 苹果'], forms: [] } } });
  assert.ok((await validateBook(ok, { ...opts, wordlist: offList })).some((e) => /"banana" is not on the IELTS word list/.test(e)));
});

test('once a book has audio, every word, form and example needs a clip', async () => {
  const dir = join(await tmp(), 'demo');
  await cp(new URL('./fixtures/library/demo', import.meta.url), dir, { recursive: true });
  assert.ok(!(await validateBook(dir, { wordlist: false })).some((e) => /audio/.test(e)));

  const vocab = JSON.parse(await readFile(join(dir, 'vocab.json'), 'utf8'));
  vocab.words[0].example = 'She wrote a long letter home.';
  await writeFile(join(dir, 'vocab.json'), JSON.stringify(vocab));
  const errors = await validateBook(dir, { wordlist: false });
  assert.ok(errors.some((e) => /audio is missing for 1 word\(s\) or example\(s\) \("She wrote a long letter home\."\); run npm run audio -- library\/demo/.test(e)));
});
