# cliffword — v0.1 scope

**One line:** serialized Chinese stories with English target words woven in, plus recall exercises and next-day review, as a static web app. It ships with a built-in story and lets you annotate your own local books with your own coding agent.

**Who it's for:** Chinese-speaking learners preparing for English exams (CET-4/6, IELTS, 考研) who quit word lists but will keep reading a good story.

**The question v0.1 answers:** does story motivation turn into English vocabulary that is still there the next day and works outside the story? Engagement and learning are measured separately.

## In scope (v0.1)

- **Built-in content:** 1 storyline, 《画皮》: a new modern-Chinese retelling of the 聊斋志异 tale (public domain), written for this project. 3 chapters, 30–50 IELTS-level target words. Each target word is tagged *where it appears* with a stable vocab ID, its form there, part of speech, its meaning in that context, accepted answers, and one short English example sentence. No global find-and-replace.
- **Reader:** library → chapter reader → word card (IPA, POS, contextual meaning, the original sentence, browser TTS, save).
- **Modes on the same passage:**
  - annotated reading;
  - EN→ZH meaning recall (English shown, gloss hidden);
  - ZH→EN spelling recall (gloss shown, English typed);
  - transfer: fill a target word into a new English sentence.
- **Learning state** in localStorage: reading position, saved words, answers, errors, review due dates. Next-day review of errors and saved words. JSON export and import.
- **Engagement signals**, kept local only: chapter completions, voluntary "next chapter" clicks, return-visit days. They can go into the export for a pilot, but are never sent anywhere.
- Works on mobile and desktop. No build step, no backend, no accounts, no AI at runtime.
- **Your own books, annotated by your own agent:** `npm run import -- <file.txt>` splits a local text file into chapters under `library/` (gitignored). The `cliffword-annotate` skill (Codex: `.agents/skills/`, Claude Code: `.claude/skills/`) then has *your* agent write an annotation file per chapter: IELTS words by default, with at least one tagged word in every sentence by default. It runs the validator until the result is clean, then makes pronunciation clips locally with Kokoro. The reader shows these books on the 书架, in the category 我的书库 unless the reader picks another.

## Non-goals

- Fetching, scraping or downloading books from websites. Import only reads text files you already have on your machine.
- Committing, bundling or sharing imported books. `library/` is gitignored and progress exports leave its text out.
- Dictionary find-and-replace with no agent or review step. [JiaduReader](https://github.com/qqw666666qqw/mixreader) already does that.
- Accounts, sync, payments, activation codes.
- Generating content with AI at runtime. AI may help draft offline, but every word is reviewed by a person before it ships.
- Reproducing or paraphrasing any copyrighted story, names or branding in `content/`. Built-in stories are original or based on public-domain sources.
- Claims of learning outcomes that a pilot can't support.

## Acceptance check (machine-runnable)

`npm test` passes. It runs:

1. **Content validator** (`node scripts/validate-content.mjs`): every occurrence references an existing vocab ID; the story has 30–50 distinct target words; each word has a POS, a contextual meaning, ≥1 accepted answer and an English example; each word appears in ≥2 chapters or ≥2 times; no orphan vocab entries; every chapter ends with a hook line, marked as such in the data.
2. **End-to-end test** (Playwright, run at 390×844 and 1280×800 viewports):
   1. Open the library and start chapter 1.
   2. Open a word card and save the word.
   3. In EN→ZH mode, answer one question wrong and one right.
   4. In ZH→EN mode, answer one question wrong.
   5. Reload: the reading position, saved word and errors are restored.
   6. Advance the clock by a day: the errors are due in review.
   7. Export, clear storage, import: the state matches.

## Content license

Code: MIT. Stories and word data in `content/`: CC-BY-4.0. Imported books under `library/` keep whatever rights they already had, and the project never distributes them.
