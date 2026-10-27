---
name: cliffword-annotate
description: Turn a book the user gives you (a local .txt file) into a cliffword book end to end. Import it into library/, pick IELTS words from the bundled word list at the book's word density (by default one tagged word every 2–6 sentences, so long chapters get proportionally more), write annotation files, validate words and glosses against the dictionary, generate pronunciation audio locally with Kokoro, and tell the user how to read it. Use when the user hands over a book file, asks to add, import, annotate or prepare a book for cliffword, or names a book under library/.
---

# cliffword-annotate

The user gives you a book file. You do the whole job: import, annotate every chapter, validate, generate audio, and tell them how to read it. Only ask when you're blocked or for the single size check below.

## Boundaries (always)

- **Local files only.** Work on a file the user already has on this machine (a path they give, or a file they attach). Never fetch, download, scrape or search the web for book text, even if asked. If you're given a URL or only a title, ask for the local `.txt` file instead.
- **Never copy the text.** Don't write the book's text into any file other than what `npm run import` creates, and don't paste chapters into chat. Quote at most a short phrase when pointing at an anchor.
- **Never commit or share** `library/`. It's gitignored, so don't `git add -f` it, move it into `content/`, or upload it.
- **What you write:** after import, only `library/<id>/vocab.json` and `library/<id>/annotations/<chapter>.json`, plus `library/<id>/audio/` through `npm run audio`. Leave `source/` and `book.json` alone, except `level`, `density` and `category` in `book.json` when the user asks for them. After changing `title` or `category` there, run `npm run import -- --reindex` so the shelf picks it up.

## Step 1: import

```bash
npm run import -- "<path-to-file.txt>" --id <short-ascii-id> --title "<书名>" [--density <min>-<max>] [--category "<分类>"]
```

- **id:** lowercase letters, digits and `-`, ideally pinyin or English for the title (`hong-lou-meng`, `my-novel`). If it already exists, ask before passing `--force`, or pick another id.
- **title:** the book's own title if you can tell it from the file name or first line, otherwise the file name.
- **density:** how often a tagged word appears, as sentences per tagged word. The default is `2-6`: on average one English word every 2 to 6 sentences. If the user asks for a density, translate it: “每一两句一个词” → `--density 1-2`; “每句都要有” → `--density 1-1`; “少一点” → `--density 4-10`. Because it counts sentences, a long chapter needs proportionally more words, not the same fixed number.
- **category:** only if the user names one (小说, 志怪, 历史…). It shows on the 书架, where the reader can also change it.
- **What it does:** UTF-8 and GBK are detected automatically, and chapters are split on headings such as 第一章 or 第12回. With no headings, the text is cut into parts of about 3,000 characters.

Then read `library/<id>/book.json`, which lists the chapters, `level` and `density`: `{ "sentencesPerWord": { "min": 2, "max": 6 }, "maxPerWord": 6 }`. If an older book still has `{ "min": 8, "max": 15 }` (a fixed word count), replace it with that default, or with the range the user asked for.

**One size check:** if the book has more than 100 chapters, annotate the first 20, report, and ask whether to continue. Otherwise do every chapter without stopping.

## Step 2: annotate each chapter, in order

For chapter `<ch>`:

1. **Get candidates:** `npm run words -- suggest <id> <ch>`. The first JSON line is the chapter's budget: `sentences`, and `tagsNeeded` (`min`–`max` tagged occurrences this chapter needs at the book's density) and `maxPerWord`. For a dense book or a long chapter, add `--limit 200` to see more candidates. Each following JSON line is an IELTS word whose dictionary meaning appears in this chapter: `lemma`, `ipa`, `zh` (its meanings), `anchor` (the Chinese phrase found), `count`, and `inBook` (true if the word is already in `vocab.json`).
2. **Read the chapter:** `library/<id>/source/<ch>.txt`, to judge each candidate in context. Read only this chapter.

   Suggestions are a starting point, not a limit. They miss phrases the book words differently from the dictionary (恶鬼 rather than 怪物), and they can include poor matches where a rare English word's main meaning is an everyday Chinese word (*nought* for 没有). You can also choose a word you know fits: confirm it with `npm run words -- lookup <word>` (it must not print `"onList":false`), and check that the gloss you'll use matches one of its `zh` meanings.
3. **Choose words until the chapter has `tagsNeeded.min`–`tagsNeeded.max` tagged occurrences** (aim for the middle):
   - **Count occurrences, not distinct words.** Each tag is one occurrence. A word may be tagged several times in a chapter, but at most `maxPerWord` times, so you need at least `tagsNeeded.min / maxPerWord` distinct words. Repeating a word two or three times in a chapter is good for learning.
   - **Keep the rhythm even.** The density is an average over the chapter: place roughly one tag every `sentencesPerWord` sentences rather than bunching them in one scene and leaving long stretches bare.
   - **Prefer `inBook: true` words.** Every word must occur at least twice in the book, and reuse across chapters helps learners most.
   - **Pick only where the English fits that sentence:** the meaning is right, and the sentence still reads naturally with the English word in place. Skip names, 成语 and set phrases, and anchors inside a longer word with a different meaning (e.g. `信` inside `相信`).
   - **Avoid very basic words** (good, go, big) even if the list has them. The target is band 5.5–7.5.
4. **Add new words to `vocab.json`.** Get `ipa` from `npm run words -- lookup <lemma>` and copy it:

   ```json
   { "words": [
     { "id": "evidence-n", "lemma": "evidence", "ipa": "/ˈevɪdəns/", "pos": "n.",
       "example": "There is no evidence that he was ever there." }
   ] }
   ```

   - `id` is `<lemma>-<pos>`, one per sense.
   - `example` is a short, natural English sentence that you write yourself. It must not come from the book, and it must contain the lemma or a form you use.
5. **Write `annotations/<ch>.json`:**

   ```json
   { "occurrences": [
     { "w": "evidence-n", "anchor": "证据", "nth": 2, "form": "evidence", "gloss": "证据" }
   ] }
   ```

   - `anchor` is an exact substring of the chapter.
   - `nth` says which occurrence of that anchor in the chapter (from 1, counted across the whole chapter).
   - `form` is the English as it should read there, possibly inflected (`fled`). It must be a real form of the lemma.
   - `gloss` is the Chinese meaning **in this sentence**, usually the anchor itself.
   - If that meaning isn't one of the dictionary's (`zh`), first try a gloss that is. If the context really needs a different meaning, add `"glossNote": "<short reason>"`.
6. **Validate the book:** `npm run validate:library -- library/<id>`. Fix every error in this chapter (at most 3 rounds). A density error says how many tagged words the chapter has and how many it needs; add or remove tags to land inside the range. While later chapters are pending, two messages are expected and can be ignored for now: `chapter "…" is not annotated yet`, and `occurs 1 time(s)` for a word that later chapters can reuse.

## Step 3: validate the whole book

Run `npm run validate:library -- library/<id>` until it's clean, at most 3 rounds. For a word that still occurs only once, tag it a second time where it fits, or remove it from that chapter and from `vocab.json`.

## Step 4: pronunciation audio with Kokoro

Generate a clip for every lemma, every form used and every example sentence with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), an open-weight text-to-speech model that runs on this machine. This step is part of the job, not an extra:

```bash
npm run audio -- library/<id>
```

- **Needs [uv](https://docs.astral.sh/uv/getting-started/installation/).** The first run sets up a pinned Python environment and downloads about 340 MB of model and voice files (checked by SHA-256) into `~/.cache/cliffword/tts`. Only the model is downloaded: no text leaves the machine, and only word-level English (lemmas, forms, your example sentences) is spoken, never book text.
- **Voice:** American English `af_heart` at 0.9× speed, the same as the built-in stories.
- **It's incremental:** intact clips are reused. Run it again whenever `vocab.json` or an annotation changes; once a book has `audio/manifest.json`, the validator reports any word, form or example without a clip.
- **Homographs:** if a word is spoken with the wrong sense (e.g. *tear*), add an exact-text IPA override to `library/<id>/audio-pronunciations.json` (`{"tear": "tˈɛɹ"}`) and run it again.
- **If `uv` is missing or generation fails** (offline, unsupported platform), don't block on it: the reader falls back to the browser's voice. Say so in the report and give the command for adding audio later.
- Never commit `library/<id>/audio/`.

Then run `npm run validate:library -- library/<id>` once more; it must be clean.

## Step 5: report

1. Report briefly:
   - the book id and title;
   - chapters annotated, the total number of distinct words, total tagged occurrences, and the density you hit (sentences per tagged word, lowest to highest chapter);
   - how many glosses needed a `glossNote`;
   - the audio: number of clips and the voice, or why it was skipped;
   - anything skipped and why.
2. Tell the user how to read it, and offer to start the server:

   ```bash
   npm run serve
   ```

   Open http://127.0.0.1:4173. The book is on the **书架**, in the category **我的书库** unless you set another. The reader can recategorise it or mark it 未读 / 在读 / 已读 with the ⋯ button on its cover.

The validator checks that:
- every word is on the IELTS list;
- every form is a real form of its word;
- every gloss matches the dictionary or carries a note;
- anchors exist and don't overlap;
- each chapter's tagged occurrences match its density (sentences per tagged word), and no word is tagged more than `maxPerWord` times in one chapter;
- every word occurs at least twice;
- once a book has audio, every word, form and example has a clip.

It can't judge whether a sentence still reads well. Keep that in mind while choosing, and mention any spots you were unsure about.
