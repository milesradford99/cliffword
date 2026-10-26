import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const audioFilename = (text) => `${createHash('sha256').update(text.trim()).digest('hex')}.wav`;

// Only English vocabulary, examples and tagged occurrence forms. Never send
// paragraphs or imported source text to the generator.
export async function collectAudio(dir) {
  const read = async (file) => JSON.parse(await readFile(join(dir, file), 'utf8'));
  const { words } = await read('vocab.json');
  const texts = new Set();
  const add = (text) => { if (typeof text === 'string' && text.trim()) texts.add(text.trim()); };
  for (const word of words) {
    add(word.lemma);
    add(word.example);
  }
  let book;
  try { book = await read('story.json'); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    book = await read('book.json');
  }
  for (const chapter of book.chapters) {
    if (typeof chapter === 'string') {
      const data = await read(chapter);
      for (const p of data.paragraphs) for (const seg of p.segments) if (typeof seg === 'object') add(seg.form);
    } else {
      try {
        const ann = await read(`annotations/${chapter.id}.json`);
        for (const occurrence of ann.occurrences) add(occurrence.form);
      } catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
  }
  let pronunciations = {};
  try { pronunciations = await read('audio-pronunciations.json'); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return [...texts].sort().map((text) => {
    const phonemes = pronunciations[text];
    if (phonemes !== undefined && (typeof phonemes !== 'string' || !phonemes.trim())) {
      throw new Error(`Invalid pronunciation for ${JSON.stringify(text)}`);
    }
    return { text, file: audioFilename(text), ...(phonemes ? { phonemes } : {}) };
  });
}
