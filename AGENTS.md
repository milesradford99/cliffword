# AGENTS.md

## Commands

- `npm test`: validator unit tests plus validation of all stories in `content/`.
- `npm run validate`: validate the stories only, printing every error.
- `npm run import -- <file.txt>`: split a local text file into `library/<id>/` (gitignored).
- `npm run validate:library [-- library/<id>]`: validate imported books (or one book), including the IELTS word list and gloss checks.
- `npm run words -- suggest <id> <chapter>` / `npm run words -- lookup <word>`: word-list helpers for annotating.
- `npm run audio [-- library/<id>]`: optionally generate local Kokoro audio (requires uv); no arguments generates built-in audio. Never commit library audio or model weights.
- `npm run serve`: serve the app at http://127.0.0.1:4173. Set `LIBRARY_DIR=<dir>` to serve another folder as `/library/`.
- `npm run test:e2e`: Playwright tests at 390×844 and 1280×800. It starts its own server on port 4174 with `LIBRARY_DIR=test/fixtures/library`.

## Gotchas

- No build step and no runtime dependencies. The app is plain HTML, CSS and ES modules served as static files. Don't add a bundler or framework without asking.
- Content is tagged per occurrence (`{ "w": vocabId, "form", "gloss" }`). Never generate it by global find-and-replace.
- `gloss` is the meaning *in that sentence*, not the dictionary headword meaning.
- Each vocab ID is one sense (`evidence-n`, not `evidence`).
- Stories must be original. Don't reproduce or paraphrase commercial stories, names or branding.
- Any AI-drafted story text or gloss needs human review before merge. Say so in the PR.
- When the user hands you a book, follow `.agents/skills/cliffword-annotate/SKILL.md` end to end, from import to validation to telling them how to read it.
- `data/ielts.json` is generated from ECDICT (MIT). Don't edit it by hand; rebuild it with `scripts/build-wordlist.mjs`. `.claude/skills/cliffword-annotate` is a symlink to it, so edit only the `.agents` copy. Never fetch book text from the web, and never commit `library/`.
- App code lives in `app/`: `main.js` (views and router), `data.js` (loading), `store.js` (localStorage, review schedule, export/import, stats), `shelf.js` (shelf search, sorting and paging), `check.js` (answer checking) and `tts.js`. `check.js`, `store.js` and `shelf.js` stay DOM-free so `node --test` can cover them.
- Render content with `textContent` only, never `innerHTML`: imported books are untrusted text.
- Review entries and backups keep word-level fields only (`REVIEW_FIELDS` in `store.js`), never sentence text, so a backup can't carry an imported book. Don't add context text to them.
- Learning state stays in the browser (localStorage), including shelf categories, read-status overrides and shelf view. Nothing is sent over the network, and fonts come from the device.
- Imported-book density is sentences per tagged word (`density.sentencesPerWord`), not a fixed word count, so it scales with chapter length. By default (`everySentence`) every sentence of 4+ letters must hold a tagged word.
