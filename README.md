# cliffword

**读一个停不下来的中文故事，顺手记住里面的英文单词。**
Serialized Chinese stories with English target words woven in, plus recall exercises and next-day review. A static web app: no accounts, no backend, no AI at runtime.

> **Status: pre-alpha.** The reader works: library (built-in stories and 我的书库), chapter reader, word cards with local neural pronunciation, four modes (阅读, 英→中, 中→英, 迁移), next-day review, progress backup, and a local reading summary. All seven v0.1 acceptance steps pass. The first story is 《画皮》, a retelling of the 聊斋志异 tale. See [docs/SCOPE.md](docs/SCOPE.md) for what v0.1 will do and the check that proves it.

## Why

Word lists are easy to quit. A cliffhanger isn't. cliffword tests whether wanting to read the next chapter can be turned into English vocabulary that you still know the next day, and that works outside the story.

How it differs from similar tools:

- [JiaduReader 夹读](https://github.com/qqw666666qqw/mixreader) runs a dictionary over any Chinese book you upload and swaps in English words. cliffword ships stories written for the purpose and reviewed by a person. Every English word is tagged where it appears, with its meaning *in that sentence*, and then practised in both directions and in new English sentences.
- [Lute](https://github.com/LuteOrg/lute-v3) works the other way round: you read a full English text and look up the words you don't know.

## How content looks

A chapter paragraph is a list of plain Chinese text and tagged words:

```json
{
  "segments": [
    "警察在门把手上找到了新的",
    { "w": "evidence-n", "form": "evidence", "gloss": "证据" },
    "。"
  ]
}
```

The word itself lives once in `vocab.json`, with its pronunciation, part of speech and an English example sentence:

```json
{ "id": "evidence-n", "lemma": "evidence", "ipa": "/ˈevɪdəns/", "pos": "n.",
  "example": "There is no evidence that he was ever there." }
```

The format is documented in [docs/CONTENT.md](docs/CONTENT.md).

## Read your own books

Give your own Codex or Claude Code a book you have as a local `.txt` file, and it does the rest. Open the agent in this repo and say, for example:

> 用 cliffword-annotate 把这本书做成 cliffword：~/books/my-book.txt

Using the `cliffword-annotate` skill, the agent then:
1. imports the file into `library/`;
2. tags IELTS words from the bundled word list in every sentence: by default each sentence holds at least one English word (only very short ones like 嗯。 are exempt), so a long chapter gets proportionally more. Ask for fewer (“每一两句一个词”) and it imports with `--density 1-2`;
3. writes small annotation files next to your untouched text;
4. checks every word, form and Chinese meaning against the dictionary until the book passes;
5. generates pronunciation clips for every word, form and example sentence with Kokoro on your machine (`npm run audio -- library/<id>`, see below);
6. tells you to run `npm run serve` and open it from the 书架.

On the 书架 (bookshelf) every book has a cover in a grid, or a dense row in list view, with a progress bar and when you last read it. Search by title, category or id; filter by category and by 未读 / 在读 / 已读; sort by 最近阅读, 书名 (pinyin), 加入时间, 阅读进度, 篇幅 or 阅读状态, in either direction; and page through 12, 24, 48 or 96 books at a time. The shelf remembers its view, sort, filters and page. The ⋯ button on a cover sets its category or overrides its status, which otherwise follows your reading progress.

Your book stays on your machine: `library/` is gitignored, and no book text is downloaded or uploaded. The only download is the Kokoro model the first time you make audio. Only import texts you have the right to use.

## English pronunciation

Built-in words, inflected forms and example sentences ship with 24 kHz audio generated locally by [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M), using the American English `af_heart` voice at 0.9× speed. Click the existing 🔊 buttons to listen. Audio also works in browsers without speech synthesis. Closing a card, moving to the next review item, or navigating stops playback.

The reader remains a static app with no runtime dependencies or API keys. No model is downloaded in the browser, and no text is uploaded. If a clip is missing or playback fails, the app falls back to the device's English speech synthesis; its quality and availability vary by device. The existing IPA may describe British pronunciation while the audio is American. Synthesized pronunciation, especially short words and homographs, still needs listening review.

To add neural audio to an imported book, install [uv](https://docs.astral.sh/uv/getting-started/installation/) and run:

```bash
npm run audio -- library/<id>
```

This optional authoring command reads English vocabulary, original example sentences and tagged English forms; it does not read the book's source text. It downloads the pinned Python environment and about 340 MB of model/voice files on the first run, verifies the model files with SHA-256, then synthesizes locally on CPU. Later runs reuse intact clips. The model cache lives in `~/.cache/cliffword/tts` (`$XDG_CACHE_HOME` is respected); set `CLIFFWORD_TTS_MODELS` to override it. All generated book audio stays under `library/<id>/audio/`, which is gitignored along with the book. Refresh the reader after generation.

```bash
npm run audio                         # regenerate missing/stale built-in clips
npm run audio -- content/huapi --force # regenerate all clips in one book
```

Audio filenames hash the exact trimmed text, so changing a word or sentence cannot play an obsolete clip. The manifest records voice/model settings and audio checksums. Built-in clips are committed so readers need no Python setup; models and Python packages are authoring tools only. Audio generation is optional and is not part of serving, importing or testing the app. Model weights: Apache-2.0; [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx): MIT. No weights or third-party code are redistributed here.

For a mispronounced homograph, add an exact-text IPA override in the book's optional `audio-pronunciations.json`, then rerun generation. For example, `{"tear": "tˈɛɹ"}` makes the standalone verb mean “rip”, matching its example sentence, rather than “a teardrop”. Overrides are passed as Kokoro phonemes and recorded in the manifest; changing one regenerates that clip. This does not alter the story or displayed IPA. Audio is currently keyed by text within a book, so different pronunciations of the same spelling in one book require a future sense-aware audio format.

## Develop

Requires Node 20 or later. To read locally, run `npm run serve` and open http://127.0.0.1:4173.

```bash
npm install
```

```bash
npm test
```

`npm test` runs the content validator's unit tests and checks every story in `content/`.

```bash
npm run test:e2e
```

That runs the browser tests at phone and desktop sizes. Run `npx playwright install chromium` once first.

## License

Code: [MIT](LICENSE). Stories and word data in `content/`: [CC-BY-4.0](LICENSE-CONTENT). `data/ielts.json` is derived from [ECDICT](https://github.com/skywind3000/ECDICT) under the MIT license ([data/ECDICT-LICENSE](data/ECDICT-LICENSE)).

## Support

A hobby project, maintained on a best-effort basis with no SLA.
