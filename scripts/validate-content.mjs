// Validates story content against the rules in docs/CONTENT.md.
// Usage: node scripts/validate-content.mjs [content-dir]
//        node scripts/validate-content.mjs library --library
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAnnotations, splitParagraphs, splitSentences } from './lib/annotate.mjs';
import { collectAudio } from './lib/audio.mjs';
import { createWordlist } from './lib/wordlist.mjs';

const WORDLIST_PATH = fileURLToPath(new URL('../data/ielts.json', import.meta.url));
let defaultWordlist;

export async function loadWordlist(path = WORDLIST_PATH) {
  if (path === WORDLIST_PATH && defaultWordlist) return defaultWordlist;
  const list = createWordlist(await readJson(path));
  if (path === WORDLIST_PATH) defaultWordlist = list;
  return list;
}

const DEFAULTS = { minWords: 30, maxWords: 50, minOccurrences: 2, requireHook: true, density: null };
// Imported books: no total word range and no hook markup, but a density that
// scales with chapter length: on average one tagged word every
// sentencesPerWord.min–max sentences, and no word tagged more than
// maxPerWord times in one chapter. With everySentence, each sentence of at
// least MIN_SENTENCE_CHARS letters must hold a tagged word too.
export const DEFAULT_DENSITY = { sentencesPerWord: { min: 0.5, max: 1 }, maxPerWord: 8, everySentence: true };
// Shorter sentences (嗯。/ 好！/ “谁？”) rarely have room for a word.
export const MIN_SENTENCE_CHARS = 4;
const BOOK_DEFAULTS = { minWords: 0, maxWords: Infinity, requireHook: false };
const ENGLISH_FORM = /^[A-Za-z][A-Za-z' -]*$/;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadStory(dir) {
  const story = await readJson(join(dir, 'story.json'));
  const vocab = await readJson(join(dir, 'vocab.json'));
  const chapters = [];
  for (const file of story.chapters ?? []) chapters.push(await readJson(join(dir, file)));
  return { story, vocab, chapters };
}

function containsWord(sentence, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(sentence);
}

export function validateStoryData({ story, vocab, chapters }, options = {}) {
  const { minWords, maxWords, minOccurrences, requireHook, density } = { ...DEFAULTS, ...options };
  const errors = [];
  const words = new Map();

  if (!story.id) errors.push('story.json: missing id');
  if (!story.title) errors.push('story.json: missing title');
  if (!chapters.length) errors.push('story.json: no chapters');

  for (const word of vocab.words ?? []) {
    const at = `vocab "${word.id}"`;
    if (!word.id) { errors.push('vocab: entry without id'); continue; }
    if (words.has(word.id)) errors.push(`duplicate vocab id "${word.id}"`);
    words.set(word.id, word);
    for (const field of ['lemma', 'ipa', 'pos', 'example']) {
      if (!word[field]) errors.push(`${at}: missing ${field}`);
    }
  }

  const occurrences = new Map();
  for (const chapter of chapters) {
    const at = `chapter "${chapter.id}"`;
    const paragraphs = chapter.paragraphs ?? [];
    if (!paragraphs.length) errors.push(`${at}: no paragraphs`);
    else if (requireHook && paragraphs.at(-1).hook !== true) errors.push(`${at}: last paragraph must be marked "hook": true`);

    const inChapter = new Map();
    paragraphs.forEach((paragraph, p) => {
      for (const seg of paragraph.segments ?? []) {
        if (typeof seg === 'string') continue;
        const where = `${at} paragraph ${p + 1}`;
        if (!words.has(seg.w)) { errors.push(`${where}: unknown vocab id "${seg.w}"`); continue; }
        if (!seg.form || !ENGLISH_FORM.test(seg.form)) errors.push(`${where}: "${seg.w}" has invalid form "${seg.form ?? ''}"`);
        if (!seg.gloss) errors.push(`${where}: "${seg.w}" missing gloss`);
        if (seg.accept !== undefined && (!Array.isArray(seg.accept) || !seg.accept.length)) {
          errors.push(`${where}: "${seg.w}" accept must be a non-empty list`);
        }
        const list = occurrences.get(seg.w) ?? [];
        list.push(seg);
        occurrences.set(seg.w, list);
        inChapter.set(seg.w, (inChapter.get(seg.w) ?? 0) + 1);
      }
    });
    if (density && chapter.sentences?.length) errors.push(...checkDensity(at, chapter.sentences, inChapter, density));
  }

  for (const [id, word] of words) {
    const found = occurrences.get(id) ?? [];
    if (!found.length) { errors.push(`vocab "${id}" never occurs in the story`); continue; }
    if (found.length < minOccurrences) {
      errors.push(`vocab "${id}" occurs ${found.length} time(s), expected at least ${minOccurrences}`);
    }
    const forms = new Set([word.lemma, ...found.map((s) => s.form)].filter(Boolean));
    if (word.example && ![...forms].some((f) => containsWord(word.example, f))) {
      errors.push(`vocab "${id}": example "${word.example}" does not contain the word`);
    }
  }

  const used = [...occurrences.keys()].filter((id) => words.has(id)).length;
  if (used < minWords || used > maxWords) {
    errors.push(`story uses ${used} target words, expected ${minWords}–${maxWords}`);
  }
  return errors;
}

// How many tagged words a chapter of `sentences` sentences needs.
export function densityRange(sentences, { sentencesPerWord: { min, max } }) {
  const low = Math.max(1, Math.ceil(sentences / max));
  return { min: low, max: Math.max(low, Math.floor(sentences / min)) };
}

// Sentences the density counts: with everySentence, only those long enough
// to need a word.
export function countedSentences(sentences, density) {
  return density.everySentence ? sentences.filter((s) => s.chars >= MIN_SENTENCE_CHARS) : sentences;
}

function checkDensity(at, all, counts, density) {
  const errors = [];
  const counted = countedSentences(all, density);
  const sentences = Math.max(1, counted.length);
  const tags = [...counts.values()].reduce((n, c) => n + c, 0);
  const range = densityRange(sentences, density);
  const { min, max } = density.sentencesPerWord;
  if (tags < range.min || tags > range.max) {
    const every = tags ? `one every ${(sentences / tags).toFixed(1)} sentences` : 'none';
    errors.push(`${at} has ${sentences} sentences and ${tags} tagged words (${every}); expected one every ${min}–${max} sentences, i.e. ${range.min}–${range.max} tagged words`);
  }
  if (density.everySentence) {
    const bare = counted.filter((s) => !s.tagged);
    if (bare.length) {
      const sample = bare.slice(0, 5).map((s) => `paragraph ${s.p + 1} "${s.text.trim().slice(0, 12)}…"`).join('; ');
      errors.push(`${at}: ${bare.length} of ${counted.length} sentences have no tagged word, and every sentence needs one: ${sample}`);
    }
  }
  for (const [id, count] of counts) {
    if (count > density.maxPerWord) errors.push(`${at} tags "${id}" ${count} times, at most ${density.maxPerWord} per chapter: use more distinct words`);
  }
  return errors;
}

// book.json density, with defaults filled in. The old fixed { min, max }
// word count is reported, and the default density is used instead.
export function bookDensity(raw) {
  if (raw && raw.sentencesPerWord === undefined && (raw.min !== undefined || raw.max !== undefined)) {
    return {
      density: DEFAULT_DENSITY,
      error: `book.json: density { "min": ${raw.min}, "max": ${raw.max} } is a fixed word count per chapter, which doesn't scale with chapter length. Replace it with ${JSON.stringify(DEFAULT_DENSITY)} or another sentencesPerWord range`,
    };
  }
  const density = { ...DEFAULT_DENSITY, ...raw, sentencesPerWord: { ...DEFAULT_DENSITY.sentencesPerWord, ...raw?.sentencesPerWord } };
  const { min, max } = density.sentencesPerWord;
  // A sparser average than one per sentence can't also cover every sentence.
  density.everySentence = raw?.everySentence ?? max <= 1;
  if (!(min > 0 && max >= min) || !(density.maxPerWord >= 1)) {
    return { density: DEFAULT_DENSITY, error: `book.json: invalid density ${JSON.stringify(raw)}: sentencesPerWord needs 0 < min ≤ max, and maxPerWord at least 1` };
  }
  return { density, error: null };
}

// An imported book: book.json, vocab.json, untouched source/NNN.txt and the
// agent-written annotations/NNN.json. Chapters are assembled in memory.
export async function loadBook(dir) {
  const book = await readJson(join(dir, 'book.json'));
  const vocab = await readJson(join(dir, 'vocab.json')).catch(() => ({ words: [] }));
  const chapters = [];
  const errors = [];
  for (const { id, title } of book.chapters ?? []) {
    const source = await readFile(join(dir, 'source', `${id}.txt`), 'utf8');
    const annotations = await readJson(join(dir, 'annotations', `${id}.json`)).catch(() => null);
    if (!annotations) errors.push(`chapter "${id}" is not annotated yet`);
    const texts = splitParagraphs(source);
    const built = applyAnnotations(texts, annotations?.occurrences ?? []);
    errors.push(...built.errors.map((e) => `chapter "${id}": ${e}`));
    // Unannotated chapters are already reported; skip their density check.
    const sentences = annotations ? splitSentences(texts).map((s) => ({
      ...s, tagged: built.spans.some((t) => t.p === s.p && t.start < s.end && t.end > s.start),
    })) : [];
    chapters.push({ id, title, paragraphs: built.paragraphs, sentences });
  }
  return { story: book, vocab, chapters, errors };
}

// Imported books at a known level must use words from that level's list,
// in a real form of the word, with a meaning the dictionary agrees with
// (or a glossNote saying why this sentence needs a different one).
export function checkAgainstWordlist({ vocab, chapters }, list) {
  const errors = [];
  const lemmas = new Map((vocab.words ?? []).map((w) => [w.id, w.lemma]));
  for (const w of vocab.words ?? []) {
    if (w.lemma && !list.has(w.lemma)) errors.push(`vocab "${w.id}": "${w.lemma}" is not on the IELTS word list`);
  }
  for (const chapter of chapters) {
    chapter.paragraphs.forEach((paragraph, p) => {
      for (const seg of paragraph.segments) {
        if (typeof seg === 'string') continue;
        const lemma = lemmas.get(seg.w);
        if (!lemma || !list.has(lemma)) continue;
        const where = `chapter "${chapter.id}" paragraph ${p + 1}: "${seg.w}"`;
        if (!list.isFormOf(seg.form, lemma)) errors.push(`${where} form "${seg.form}" is not a form of "${lemma}"`);
        if (!seg.glossNote && !list.glossMatches(lemma, seg.gloss)) {
          const known = list.terms(lemma).slice(0, 6).join('、');
          errors.push(`${where} gloss "${seg.gloss}" doesn't match the dictionary (${known}). Fix the gloss, or add "glossNote" explaining the meaning in this sentence`);
        }
      }
    });
  }
  return errors;
}

export async function validateBook(dir, options = {}) {
  const data = await loadBook(dir);
  const { density, error } = options.density ? { density: options.density, error: null } : bookDensity(data.story.density);
  const errors = [...data.errors, ...(error ? [error] : []), ...validateStoryData(data, { ...BOOK_DEFAULTS, ...options, density })];
  errors.push(...await checkAudio(dir));
  // options.wordlist: a list from createWordlist, or false to skip (tests).
  if (options.wordlist !== false && String(data.story.level ?? 'IELTS').toUpperCase() === 'IELTS') {
    const list = options.wordlist ?? await loadWordlist().catch(() => null);
    if (!list) errors.push('data/ielts.json is missing or unreadable, so words and glosses could not be checked');
    else errors.push(...checkAgainstWordlist(data, list));
  }
  return errors;
}

// Audio is optional, but once a book has it every clip must be there, so
// a word added after `npm run audio` doesn't silently fall back.
async function checkAudio(dir) {
  const manifest = await readJson(join(dir, 'audio', 'manifest.json')).catch(() => null);
  if (!manifest?.files) return [];
  const missing = [];
  for (const { text, file } of await collectAudio(dir)) {
    if (!manifest.files[file] || !(await readFile(join(dir, 'audio', file)).then(() => true, () => false))) missing.push(text);
  }
  if (!missing.length) return [];
  const sample = missing.slice(0, 3).map((t) => `"${t}"`).join(', ');
  return [`audio is missing for ${missing.length} word(s) or example(s) (${sample}); run npm run audio -- library/${basename(dir)}`];
}

export async function validateAll(contentDir, options, { library = false } = {}) {
  const entries = await readdir(contentDir, { withFileTypes: true }).catch((err) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(contentDir, entry.name);
    try {
      const errors = library ? await validateBook(dir, options) : validateStoryData(await loadStory(dir), options);
      results.push({ dir, errors });
    } catch (err) {
      results.push({ dir, errors: [`could not load: ${err.message}`] });
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const library = args.includes('--library');
  const paths = args.filter((a) => !a.startsWith('--'));
  const contentDir = resolve(paths.at(-1) ?? (library ? 'library' : 'content'));
  // A single imported book (a folder with book.json) can be checked on its own.
  const single = library && await readFile(join(contentDir, 'book.json')).then(() => true, () => false);
  const results = single
    ? [{ dir: contentDir, errors: await validateBook(contentDir).catch((err) => [`could not load: ${err.message}`]) }]
    : await validateAll(contentDir, {}, { library });
  if (!results.length) {
    console.error(`No stories found in ${contentDir}`);
    process.exit(1);
  }
  let failed = false;
  for (const { dir, errors } of results) {
    if (errors.length) {
      failed = true;
      console.error(`✗ ${dir}`);
      for (const e of errors) console.error(`  - ${e}`);
    } else {
      console.log(`✓ ${dir}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
