// Splits a local text file you already have into chapters under library/<id>/.
// The text is copied as-is; nothing is fetched, and library/ is gitignored.
// Usage: npm run import -- <file.txt> [--id my-book] [--title 书名] [--category 分类]
//                          [--density 0.5-1] [--force]
//        npm run import -- --reindex   (rebuild library/index.json after editing a book.json)
//   --density: on average one tagged word every <min>-<max> sentences. The
//   default, 0.5-1, also needs a tagged word in every sentence.
import { readFile, writeFile, mkdir, rm, access, readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DENSITY } from './validate-content.mjs';

const DEFAULT_LIBRARY = fileURLToPath(new URL('../library', import.meta.url));
const HEADING = /^(第[0-9０-９零〇一二两三四五六七八九十百千万]+[章回节卷集部篇]|chapter\s+\d+|序章|序言|楔子|引子|尾声|后记|番外)(\s.*|[：:].*)?$/i;
const PART_CHARS = 3000;
const MIN_PREFACE_CHARS = 200;

export function decodeText(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('gb18030').decode(buffer);
  }
  return text.replace(/^﻿/, '');
}

export function splitChapters(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const chapters = [];
  let preface = [];
  let current = null;
  for (const line of lines) {
    if (line.length <= 40 && HEADING.test(line)) {
      current = { title: line, lines: [] };
      chapters.push(current);
    } else if (line) {
      (current ? current.lines : preface).push(line);
    }
  }

  if (!chapters.length) return chunkParts(preface);
  const prefaceText = preface.join('\n');
  if (prefaceText.length >= MIN_PREFACE_CHARS) chapters.unshift({ title: '序', lines: preface });
  else if (preface.length) chapters[0].lines.unshift(...preface);
  return chapters.map(({ title, lines: l }) => ({ title, text: l.join('\n') }));
}

function chunkParts(paragraphs) {
  const parts = [];
  let buf = [];
  let size = 0;
  for (const p of paragraphs) {
    if (size && size + p.length > PART_CHARS) {
      parts.push(buf);
      buf = [];
      size = 0;
    }
    buf.push(p);
    size += p.length;
  }
  if (buf.length) parts.push(buf);
  return parts.map((l, i) => ({ title: `第${i + 1}部分`, text: l.join('\n') }));
}

function defaultId(file, text) {
  const slug = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || `book-${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
}

// "1-2" or "3" → { min, max } sentences per tagged word.
export function parseDensity(text) {
  const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(String(text).trim());
  const min = m && Number(m[1]);
  const max = m && Number(m[2] ?? m[1]);
  if (!m || !(min > 0) || max < min) throw new Error(`Invalid --density "${text}": use <min>-<max> sentences per word, e.g. 1-2`);
  return { min, max };
}

export async function importText(file, { id, title, category, density, libraryDir = DEFAULT_LIBRARY, force = false } = {}) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file)) {
    throw new Error('Import only reads a local text file you already have. URLs are not supported.');
  }
  const text = decodeText(await readFile(file));
  const bookId = id ?? defaultId(file, text);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(bookId)) throw new Error(`Invalid book id "${bookId}": use a-z, 0-9 and -`);

  const bookDir = join(resolve(libraryDir), bookId);
  const exists = await access(bookDir).then(() => true, () => false);
  if (exists && !force) throw new Error(`${bookDir} already exists. Pass --force to replace it.`);
  if (exists) await rm(bookDir, { recursive: true });

  const chapters = splitChapters(text);
  if (!chapters.length) throw new Error(`No text found in ${file}`);
  await mkdir(join(bookDir, 'source'), { recursive: true });
  const width = Math.max(3, String(chapters.length).length);
  const entries = [];
  for (const [i, chapter] of chapters.entries()) {
    const chapterId = String(i + 1).padStart(width, '0');
    await writeFile(join(bookDir, 'source', `${chapterId}.txt`), `${chapter.text}\n`);
    entries.push({ id: chapterId, title: chapter.title });
  }
  const book = {
    id: bookId,
    title: title ?? basename(file, extname(file)),
    ...(category ? { category } : {}),
    importedAt: new Date().toISOString(),
    level: 'IELTS',
    density: density ? { ...DEFAULT_DENSITY, sentencesPerWord: density, everySentence: density.max <= 1 } : DEFAULT_DENSITY,
    chapters: entries,
  };
  await writeFile(join(bookDir, 'book.json'), `${JSON.stringify(book, null, 2)}\n`);
  await updateLibraryIndex(libraryDir);
  return { bookDir, book };
}

// The reader is served statically and can't list folders, so keep an index.
export async function updateLibraryIndex(libraryDir = DEFAULT_LIBRARY) {
  const books = [];
  for (const entry of await readdir(libraryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const book = await readFile(join(libraryDir, entry.name, 'book.json'), 'utf8').then(JSON.parse, () => null);
    if (book) {
      books.push({
        id: book.id, title: book.title, chapters: book.chapters.length,
        ...(book.category ? { category: book.category } : {}),
        ...(book.importedAt ? { addedAt: book.importedAt } : {}),
      });
    }
  }
  books.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(join(libraryDir, 'index.json'), `${JSON.stringify({ books }, null, 2)}\n`);
  return books;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const id = opt('id');
  const title = opt('title');
  const category = opt('category');
  const densityArg = opt('density');
  const force = args.includes('--force');
  const file = args.find((a) => !a.startsWith('--'));
  if (args.includes('--reindex') && !file) {
    const books = await updateLibraryIndex();
    console.log(`Indexed ${books.length} book(s) in library/index.json`);
    process.exit(0);
  }
  if (!file) {
    console.error('Usage: npm run import -- <file.txt> [--id my-book] [--title 书名] [--category 分类] [--density 0.5-1] [--force]');
    process.exit(1);
  }
  try {
    const density = densityArg === undefined ? undefined : parseDensity(densityArg);
    const { bookDir, book } = await importText(file, { id, title, category, density, force });
    console.log(`Imported ${book.chapters.length} chapters into ${bookDir}`);
    console.log(`Next: ask your agent to run the cliffword-annotate skill on "${book.id}".`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
