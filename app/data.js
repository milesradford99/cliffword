// Loads built-in stories (content/) and imported books (library/).
// Imported chapters are assembled from untouched source text plus the
// agent's annotations, exactly as the validator does.
import { applyAnnotations, splitParagraphs } from '../scripts/lib/annotate.mjs';

async function get(url, as = 'json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === 'json' ? res.json() : res.text();
}

export async function listBuiltIn() {
  const { stories } = await get('content/index.json');
  return Promise.all(stories.map(async (id) => {
    const [story, vocab] = await Promise.all([get(`content/${id}/story.json`), get(`content/${id}/vocab.json`)]);
    return { source: 'builtin', id, title: story.title, category: story.category, note: story.source, chapters: story.chapters.length, words: vocab.words.length };
  }));
}

// null when there is no local library (e.g. on a hosted copy).
export async function listLibrary() {
  try {
    const { books } = await get('library/index.json');
    return books.map((b) => ({ source: 'library', ...b }));
  } catch {
    return null;
  }
}

const cache = new Map();

export function loadBook(source, id) {
  const key = `${source}/${id}`;
  if (!cache.has(key)) {
    const promise = (source === 'builtin' ? loadBuiltIn(id) : loadImported(id)).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

function byId(words) {
  return new Map(words.map((w) => [w.id, w]));
}

async function loadBuiltIn(id) {
  const base = `content/${encodeURIComponent(id)}/`;
  const [story, vocab] = await Promise.all([get(`${base}story.json`), get(`${base}vocab.json`)]);
  const chapters = await Promise.all(story.chapters.map((file) => get(base + file)));
  return {
    source: 'builtin', id, title: story.title, note: story.source,
    vocab: byId(vocab.words),
    chapters: chapters.map((c, i) => ({ id: c.id, title: `第${i + 1}章 ${c.title}`, load: async () => c })),
  };
}

async function loadImported(id) {
  const base = `library/${encodeURIComponent(id)}/`;
  const [book, vocab] = await Promise.all([get(`${base}book.json`), get(`${base}vocab.json`).catch(() => ({ words: [] }))]);
  const chapters = book.chapters.map(({ id: cid, title }) => {
    let loaded;
    return {
      id: cid,
      title,
      load: () => (loaded ??= (async () => {
        const [text, ann] = await Promise.all([
          get(`${base}source/${cid}.txt`, 'text'),
          get(`${base}annotations/${cid}.json`).catch(() => null),
        ]);
        const { paragraphs } = applyAnnotations(splitParagraphs(text), ann?.occurrences ?? []);
        return { id: cid, title, paragraphs, annotated: Boolean(ann) };
      })()),
    };
  });
  return { source: 'library', id, title: book.title, note: null, vocab: byId(vocab.words), chapters };
}
