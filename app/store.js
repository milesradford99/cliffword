// Learning state in localStorage. Every read and write is guarded: in a
// private window or with blocked storage the app keeps working in memory.

const KEY = 'cliffword:v1';
const VERSION = 1;

// Days until the next review after 0, 1, 2, … correct reviews in a row.
export const INTERVALS = [1, 3, 7, 14, 30];

// Word-level fields a review keeps. Never sentence or paragraph text, so
// a backup can't carry an imported book's content.
const REVIEW_FIELDS = ['lemma', 'form', 'gloss', 'accept', 'ipa', 'bookTitle', 'chapter', 'p', 'i'];

// Reading status on the shelf. Without an override it follows progress.
export const STATUSES = ['unread', 'reading', 'done'];

const empty = () => ({
  version: VERSION, saved: {}, positions: {}, answers: {}, errors: {}, reviews: {},
  stats: { nextChapter: {}, completed: {}, days: [] },
  // shelf: per book, a category and status the reader chose. prefs: shelf view and filters.
  shelf: {}, prefs: {},
});

export function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Start of the local day `days` after the day containing `ms` (DST-safe).
export function addDays(ms, days) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pick(meta = {}) {
  const out = {};
  for (const k of REVIEW_FIELDS) if (meta[k] !== undefined) out[k] = meta[k];
  return out;
}

function normalize(raw) {
  const base = empty();
  return { ...base, ...raw, stats: { ...base.stats, ...(raw?.stats ?? {}) } };
}

export function createStore(storage = globalThis.localStorage, now = () => Date.now()) {
  let persistent = true;
  let data = empty();
  try {
    const raw = storage?.getItem(KEY);
    if (raw) data = normalize(JSON.parse(raw));
  } catch {
    persistent = false;
  }

  function save() {
    try {
      storage?.setItem(KEY, JSON.stringify(data));
    } catch {
      persistent = false;
    }
  }

  function schedule(wordKey, meta, { reset }) {
    const existing = data.reviews[wordKey];
    if (existing && !reset) {
      Object.assign(existing, pick(meta));
      return;
    }
    data.reviews[wordKey] = { ...(existing ?? {}), ...pick(meta), dueAt: addDays(now(), 1), interval: 1, streak: 0 };
  }

  function addError(wordKey) {
    const e = (data.errors[wordKey] ??= { count: 0 });
    e.count += 1;
    e.lastAt = now();
  }

  return {
    get data() { return data; },
    get persistent() { return persistent; },

    isSaved: (wordKey) => Boolean(data.saved[wordKey]),
    // meta: what the 生词本 list and the review card show (lemma, gloss, book title, …).
    toggleSaved(wordKey, meta = {}) {
      if (data.saved[wordKey]) {
        delete data.saved[wordKey];
        if (!data.errors[wordKey]) delete data.reviews[wordKey];
      } else {
        data.saved[wordKey] = { ...pick(meta), savedAt: now() };
        schedule(wordKey, meta, { reset: false });
      }
      save();
      return Boolean(data.saved[wordKey]);
    },
    saved: () => data.saved,

    position: (bookKey) => data.positions[bookKey] ?? null,
    setPosition(bookKey, pos) {
      // at: when this book was last read, for the shelf's 最近阅读 sort.
      data.positions[bookKey] = { ...pos, at: now() };
      save();
    },

    answers: (wordKey) => data.answers[wordKey] ?? [],
    recordAnswer(wordKey, { mode, correct, given }, meta) {
      (data.answers[wordKey] ??= []).push({ mode, correct, given, at: now() });
      if (!correct) {
        addError(wordKey);
        schedule(wordKey, meta, { reset: true });
      }
      save();
    },
    errors: () => data.errors,

    due() {
      const t = now();
      return Object.entries(data.reviews)
        .filter(([, r]) => r.dueAt <= t)
        .sort((a, b) => a[1].dueAt - b[1].dueAt)
        .map(([key, r]) => ({ key, ...r, direction: r.streak % 2 === 0 ? 'en2zh' : 'zh2en' }));
    },
    reviewResult(wordKey, correct, mode, given) {
      const r = data.reviews[wordKey];
      if (!r) return;
      (data.answers[wordKey] ??= []).push({ mode: `review:${mode}`, correct, given, at: now() });
      if (correct) {
        r.streak += 1;
        r.interval = INTERVALS[Math.min(r.streak, INTERVALS.length - 1)];
      } else {
        r.streak = 0;
        r.interval = 1;
        addError(wordKey);
      }
      r.dueAt = addDays(now(), r.interval);
      r.lastAt = now();
      save();
    },

    // The reader's category for a book, or null to use the book's own.
    category: (bookKey) => data.shelf[bookKey]?.category ?? null,
    categories: () => [...new Set(Object.values(data.shelf).map((s) => s.category).filter(Boolean))],
    // 'unread' | 'reading' | 'done', from an override or from progress.
    status(bookKey, chapterCount) {
      const chosen = data.shelf[bookKey]?.status;
      if (STATUSES.includes(chosen)) return chosen;
      const done = data.stats.completed[bookKey]?.length ?? 0;
      if (chapterCount && done >= chapterCount) return 'done';
      return done || data.positions[bookKey] ? 'reading' : 'unread';
    },
    statusOverride: (bookKey) => data.shelf[bookKey]?.status ?? null,
    // category: '' or null resets to the book's own; status: null follows progress.
    setShelf(bookKey, { category, status }) {
      const entry = {};
      const name = typeof category === 'string' ? category.trim().slice(0, 40) : '';
      if (name) entry.category = name;
      if (STATUSES.includes(status)) entry.status = status;
      if (Object.keys(entry).length) data.shelf[bookKey] = entry;
      else delete data.shelf[bookKey];
      save();
    },
    pref: (name, fallback) => data.prefs[name] ?? fallback,
    setPref(name, value) {
      data.prefs[name] = value;
      save();
    },

    noteNextChapter(bookKey) {
      data.stats.nextChapter[bookKey] = (data.stats.nextChapter[bookKey] ?? 0) + 1;
      save();
    },
    noteVisit() {
      const today = dayKey(now());
      if (!data.stats.days.includes(today)) {
        data.stats.days.push(today);
        save();
      }
    },
    markComplete(bookKey, chapterId) {
      const done = (data.stats.completed[bookKey] ??= []);
      if (!done.includes(chapterId)) {
        done.push(chapterId);
        save();
      }
    },
    summary() {
      const answers = Object.values(data.answers).flat();
      const t = now();
      const reviews = Object.values(data.reviews);
      return {
        days: data.stats.days.length,
        chapters: Object.values(data.stats.completed).reduce((n, list) => n + list.length, 0),
        nextChapter: Object.values(data.stats.nextChapter).reduce((n, c) => n + c, 0),
        answered: answers.length,
        correct: answers.filter((a) => a.correct).length,
        due: reviews.filter((r) => r.dueAt <= t).length,
        upcoming: reviews.filter((r) => r.dueAt > t).length,
      };
    },

    isEmpty: () => !Object.keys(data.saved).length && !Object.keys(data.answers).length
      && !Object.keys(data.positions).length && !Object.keys(data.reviews).length && !Object.keys(data.shelf).length,
    exportJSON() {
      return `${JSON.stringify({ app: 'cliffword', version: VERSION, exportedAt: new Date(now()).toISOString(), data }, null, 2)}\n`;
    },
    importJSON(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('不是有效的备份文件（无法读取 JSON）。');
      }
      if (parsed?.app !== 'cliffword' || typeof parsed.data !== 'object' || parsed.data === null) {
        throw new Error('这不是 cliffword 的备份文件。');
      }
      if (parsed.version !== VERSION) throw new Error(`不支持这个备份文件版本（${parsed.version}）。`);
      data = normalize(parsed.data);
      save();
    },
  };
}
