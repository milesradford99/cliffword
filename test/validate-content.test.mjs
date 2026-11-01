import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateStoryData, loadStory, validateAll } from '../scripts/validate-content.mjs';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const contentDir = fileURLToPath(new URL('../content', import.meta.url));

// Fixtures are tiny, so relax the per-story word count.
const small = { minWords: 1, maxWords: 50 };

async function validFixture() {
  return structuredClone(await loadStory(fixture('valid-story')));
}

function hasError(errors, pattern) {
  return errors.some((e) => pattern.test(e));
}

test('a valid story has no errors', async () => {
  assert.deepEqual(validateStoryData(await validFixture(), small), []);
});

test('rejects an occurrence of an unknown vocab id', async () => {
  const data = await validFixture();
  data.chapters[0].paragraphs[0].segments[1].w = 'nope-n';
  assert.ok(hasError(validateStoryData(data, small), /unknown vocab id "nope-n"/));
});

test('rejects vocab entries that never occur', async () => {
  const data = await validFixture();
  data.vocab.words.push({ id: 'orphan-n', lemma: 'orphan', ipa: '/ˈɔːfən/', pos: 'n.', example: 'The orphan smiled.' });
  assert.ok(hasError(validateStoryData(data, small), /"orphan-n" never occurs/));
});

test('rejects a word that occurs only once', async () => {
  const data = await validFixture();
  const segs = data.chapters[1].paragraphs[0].segments;
  data.chapters[1].paragraphs[0].segments = segs.filter((s) => s.w !== 'evidence-n');
  assert.ok(hasError(validateStoryData(data, small), /"evidence-n" occurs 1 time/));
});

test('rejects a chapter whose last paragraph is not a hook', async () => {
  const data = await validFixture();
  delete data.chapters[0].paragraphs.at(-1).hook;
  assert.ok(hasError(validateStoryData(data, small), /chapter "01".*hook/));
});

test('rejects an occurrence without a contextual gloss', async () => {
  const data = await validFixture();
  data.chapters[0].paragraphs[0].segments[1].gloss = '';
  assert.ok(hasError(validateStoryData(data, small), /missing gloss/));
});

test('rejects an English example that does not contain the word', async () => {
  const data = await validFixture();
  data.vocab.words[0].example = 'The police found nothing.';
  assert.ok(hasError(validateStoryData(data, small), /example .* does not contain/));
});

test('rejects a vocab entry missing part of speech', async () => {
  const data = await validFixture();
  delete data.vocab.words[0].pos;
  assert.ok(hasError(validateStoryData(data, small), /missing pos/));
});

test('rejects duplicate vocab ids', async () => {
  const data = await validFixture();
  data.vocab.words.push({ ...data.vocab.words[0] });
  assert.ok(hasError(validateStoryData(data, small), /duplicate vocab id/));
});

test('enforces the 30–50 target word range by default', async () => {
  assert.ok(hasError(validateStoryData(await validFixture()), /uses 2 target words, expected 30–50/));
});

// v0.1 acceptance: every built-in story must validate.
test('every story in content/ passes the validator', async () => {
  const results = await validateAll(contentDir);
  assert.ok(results.length > 0, 'no stories found in content/');
  for (const { dir, errors } of results) {
    assert.deepEqual(errors, [], `${dir} has content errors`);
  }
});

test('content/index.json lists exactly the story folders', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dirs = (await readdir(contentDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const index = JSON.parse(await readFile(`${contentDir}/index.json`, 'utf8'));
  assert.deepEqual([...index.stories].sort(), dirs);
});

test('every built-in word has definitions, in the word list or its own meanings', async () => {
  const { readFile } = await import('node:fs/promises');
  const { loadWordlist } = await import('../scripts/validate-content.mjs');
  const list = await loadWordlist();
  const { stories } = JSON.parse(await readFile(new URL('../content/index.json', import.meta.url), 'utf8'));
  for (const id of stories) {
    const { words } = JSON.parse(await readFile(new URL(`../content/${id}/vocab.json`, import.meta.url), 'utf8'));
    const bare = words.filter((w) => !w.meanings?.length && !list.has(w.lemma)).map((w) => w.lemma);
    assert.deepEqual(bare, [], `${id} has words with no definitions`);
  }
});
