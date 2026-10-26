# Content format

Each story is a folder in `content/`:

```
content/<story-id>/
  story.json
  vocab.json
  chapters/01.json, 02.json, …
```

All story text and word data is CC-BY-4.0. It must be original, or a new retelling of a public-domain source that `source` names.

## story.json

```json
{ "id": "huapi", "title": "画皮", "license": "CC-BY-4.0",
  "source": "A new retelling based on 《画皮》 from 蒲松龄《聊斋志异》 (public domain).",
  "level": "IELTS",
  "chapters": ["chapters/01.json", "chapters/02.json", "chapters/03.json"] }
```

`source` (where the story comes from), `level` (the exam level the target words are aimed at) and `category` (its default shelf category, e.g. `"志怪"`) are optional.

## vocab.json

There is one entry per **sense**, so the ID includes the part of speech: `suspect-v` and `suspect-n` are separate words.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable ID that occurrences point to. Never rename it once published, because learners' saved progress uses it. |
| `lemma` | yes | Dictionary form, e.g. `suspect`. |
| `ipa` | yes | Pronunciation, e.g. `/səˈspekt/`. |
| `pos` | yes | Part of speech: `n.`, `v.`, `adj.`, `adv.`, … |
| `example` | yes | A short, natural English sentence that is **not** from the story, containing the word. Used for the transfer exercise. |

## chapters/NN.json

```json
{
  "id": "01",
  "title": "门把手",
  "paragraphs": [
    { "segments": ["警察在门把手上找到了新的",
                   { "w": "evidence-n", "form": "evidence", "gloss": "证据" }, "。"] },
    { "segments": ["可是那天晚上，邻居家的灯一直没有亮。"], "hook": true }
  ]
}
```

A segment is either plain Chinese text or an **occurrence**:

| Field | Required | Meaning |
|---|---|---|
| `w` | yes | Vocab ID. |
| `form` | yes | The English as written here, which may be inflected (`suspected`). This is the answer for ZH→EN spelling. |
| `gloss` | yes | The Chinese meaning **in this sentence**. |
| `accept` | no | Other Chinese answers accepted for EN→ZH recall. Defaults to `[gloss]`. |

## Rules the validator enforces

Run `npm run validate`. It checks:

- Every occurrence points to an existing vocab ID, and every vocab entry occurs at least twice.
- A story uses 30–50 distinct target words.
- Every vocab entry has `lemma`, `ipa`, `pos` and an `example` that contains the word.
- Every occurrence has a `gloss` and an English `form`.
- The last paragraph of each chapter is marked `"hook": true`.

The validator can't check whether a gloss is *correct*, whether the story is good, or whether the target words are spread too densely. That needs a human reviewer.

## Imported books (`library/`, never committed)

`npm run import -- <file.txt>` reads a local UTF-8 or GBK/GB18030 text file and writes:

```
library/<book-id>/
  book.json            id, title, category (optional), level ("IELTS"), density, chapters
  source/001.txt, …    the chapter text as it was, one paragraph per line
```

`density` says how often a tagged word appears, relative to chapter length:

```json
"density": { "sentencesPerWord": { "min": 2, "max": 6 }, "maxPerWord": 6 }
```

On average a chapter has one tagged occurrence every `min`–`max` sentences, so a chapter of 120 sentences needs 20–60 tags and one of 600 sentences needs 100–300. `maxPerWord` caps how often one word is tagged in a chapter, so a long chapter needs more distinct words too. Set it at import with `--density 1-2` (one every one or two sentences); `--category 小说` sets the category. After editing `title` or `category` in `book.json`, run `npm run import -- --reindex`.

Sentences are counted on `。！？!?…` (with any closing quotes) and paragraph breaks. The older `{ "min": 8, "max": 15 }` fixed word count is reported as an error with the replacement to use.

Chapters are split on headings such as `第一章`, `第12回`, `Chapter 3`, `序章` or `番外`. A file with no headings is split into parts of about 3,000 characters, at paragraph breaks. URLs are refused: import never downloads anything.

Your own agent then runs the `cliffword-annotate` skill, which writes two kinds of file and nothing else:

- `vocab.json`, in the same format as above;
- `annotations/001.json`, …, each listing which Chinese phrase becomes a target word:

```json
{ "occurrences": [
  { "w": "evidence-n", "anchor": "证据", "nth": 2, "form": "evidence", "gloss": "证据" }
] }
```

An occurrence can also carry `glossNote`: a short reason the gloss differs from the dictionary's meanings in this sentence.

`anchor` must be an exact substring of that chapter's source text. `nth` (default 1) counts occurrences of the anchor across the whole chapter. The source text is never rewritten. Chapters are assembled in memory when they're validated or read.

`npm run validate:library` checks imported books with the same rules as built-in stories, with three changes:
- no total word range;
- no hook markup;
- each chapter's tagged occurrences must match its density, and no word may be tagged more than `maxPerWord` times in one chapter.

It also reports anchors that aren't found or that overlap, and chapters that aren't annotated yet.

For books at `level: "IELTS"` (the default), it also checks against `data/ielts.json`, the IELTS-tagged words from ECDICT:
- every vocab `lemma` must be on the list;
- every `form` must be the lemma or one of its listed forms;
- every `gloss` must agree with one of the dictionary's Chinese meanings for that word, unless it has a `glossNote`.

### Audio

Pronunciation clips come from `npm run audio -- library/<book-id>` (see the README's English pronunciation section). Once a book has `audio/manifest.json`, the validator reports every lemma, form or example sentence that has no clip, so a word added later doesn't silently fall back to the browser's voice.

To look words up yourself:
- `npm run words -- lookup <word>` shows a word's pronunciation, meanings and forms;
- `npm run words -- suggest <book> <chapter>` prints the chapter's sentence count and how many tags its density needs, then lists candidate words.

To rebuild the list from a newer ECDICT, run `node scripts/build-wordlist.mjs <ecdict.csv> <commit>`.
