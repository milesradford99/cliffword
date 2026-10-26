---
name: cliffword-annotate
description: Turn a book the user gives you (a local .txt file) into a cliffword book end to end. Import it into library/, pick IELTS words from the bundled word list (8–15 per chapter), write annotation files, validate words and glosses against the dictionary, and tell the user how to read it. Use when the user hands over a book file, asks to add, import, annotate or prepare a book for cliffword, or names a book under library/.
---

# cliffword-annotate

The user gives you a book file. You do the whole job: import, annotate every chapter, validate, and tell them how to read it. Only ask when you're blocked or for the single size check below.

## Boundaries (always)

- **Local files only.** Work on a file the user already has on this machine (a path they give, or a file they attach). Never fetch, download, scrape or search the web for book text, even if asked. If you're given a URL or only a title, ask for the local `.txt` file instead.
- **Never copy the text.** Don't write the book's text into any file other than what `npm run import` creates, and don't paste chapters into chat. Quote at most a short phrase when pointing at an anchor.
- **Never commit or share** `library/`. It's gitignored, so don't `git add -f` it, move it into `content/`, or upload it.
- **What you write:** after import, only `library/<id>/vocab.json` and `library/<id>/annotations/<chapter>.json`. Leave `source/` and `book.json` alone, except `level` and `density` in `book.json` when the user asks for them.

## Step 1: import

```bash
npm run import -- "<path-to-file.txt>" --id <short-ascii-id> --title "<书名>"
```

- **id:** lowercase letters, digits and `-`, ideally pinyin or English for the title (`hong-lou-meng`, `my-novel`). If it already exists, ask before passing `--force`, or pick another id.
- **title:** the book's own title if you can tell it from the file name or first line, otherwise the file name.
- **What it does:** UTF-8 and GBK are detected automatically, and chapters are split on headings such as 第一章 or 第12回. With no headings, the text is cut into parts of about 3,000 characters.

Then read `library/<id>/book.json`, which lists the chapters, `level` and `density`.

**One size check:** if the book has more than 100 chapters, annotate the first 20, report, and ask whether to continue. Otherwise do every chapter without stopping.

## Step 2: annotate each chapter, in order

For chapter `<ch>`:

1. **Get candidates:** `npm run words -- suggest <id> <ch>`. Each JSON line is an IELTS word whose dictionary meaning appears in this chapter: `lemma`, `ipa`, `zh` (its meanings), `anchor` (the Chinese phrase found), `count`, and `inBook` (true if the word is already in `vocab.json`).
2. **Read the chapter:** `library/<id>/source/<ch>.txt`, to judge each candidate in context. Read only this chapter.

   Suggestions are a starting point, not a limit. They miss phrases the book words differently from the dictionary (恶鬼 rather than 怪物), and they can include poor matches where a rare English word's main meaning is an everyday Chinese word (*nought* for 没有). You can also choose a word you know fits: confirm it with `npm run words -- lookup <word>` (it must not print `"onList":false`), and check that the gloss you'll use matches one of its `zh` meanings.
3. **Choose `density.min`–`density.max` distinct words** (8–15 by default):
   - **Prefer `inBook: true` words.** Every word must occur at least twice in the book, and reuse across chapters helps learners most.
   - **Pick only where the English fits that sentence:** the meaning is right, and the sentence still reads naturally with the English word in place. Skip names, 成语 and set phrases, and anchors inside a longer word with a different meaning (e.g. `信` inside `相信`).
   - **Avoid very basic words** (good, go, big) even if the list has them. The target is band 5.5–7.5.
   - **Spread** the words through the chapter.
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
6. **Validate the book:** `npm run validate:library -- library/<id>`. Fix every error in this chapter (at most 3 rounds). While later chapters are pending, two messages are expected and can be ignored for now: `chapter "…" is not annotated yet`, and `occurs 1 time(s)` for a word that later chapters can reuse.

## Step 3: finish

1. Run `npm run validate:library -- library/<id>` until it's clean, at most 3 rounds. For a word that still occurs only once, tag it a second time where it fits, or remove it from that chapter and from `vocab.json`.
2. Report briefly:
   - the book id and title;
   - chapters annotated, the total number of distinct words, and the range per chapter;
   - how many glosses needed a `glossNote`;
   - anything skipped and why.
3. If `uv` is available, run `npm run audio -- library/<id>` to generate local neural pronunciation for the vocabulary, occurrence forms and English examples. This downloads model files once, then synthesizes on the machine; book text is never uploaded. If `uv` is unavailable or generation fails, report that the book currently uses the system voice and give the command for adding neural audio later. Never commit the audio under `library/`.
4. Tell the user how to read it, and offer to start the server:

   ```bash
   npm run serve
   ```

   Open http://127.0.0.1:4173. The book is under **我的书库**.

The validator checks that:
- every word is on the IELTS list;
- every form is a real form of its word;
- every gloss matches the dictionary or carries a note;
- anchors exist and don't overlap;
- each chapter's density is in range;
- every word occurs at least twice.

It can't judge whether a sentence still reads well. Keep that in mind while choosing, and mention any spots you were unsure about.
