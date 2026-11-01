// Table of contents logic: each chapter's progress, filtering, grouping for
// long books, and jumping. DOM-free so node --test covers it.

// Books longer than this are split into collapsible groups.
export const GROUP_SIZE = 50;
export const TOC_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'read', label: '已读' },
  { id: 'bookmarked', label: '书签' },
];

// chapters: [{ id, title }]. progress: chapter id → { paragraph, total }.
export function tocEntries(chapters, { completed = [], progress = {}, bookmarks = [], current = null } = {}) {
  const done = new Set(completed);
  const marked = new Set(bookmarks);
  return chapters.map(({ id, title }, i) => {
    const read = done.has(id);
    const saved = progress[id];
    // Never 100% until the chapter is finished.
    const percent = read ? 100 : saved?.total ? Math.min(99, Math.round((saved.paragraph / saved.total) * 100)) : 0;
    return {
      id, title, number: i + 1, read, percent, bookmarked: marked.has(id), current: id === current,
      state: read ? 'read' : saved || id === current ? 'reading' : 'unread',
    };
  });
}

// Whole-book progress counts partly read chapters too.
export function bookProgress(entries) {
  const read = entries.filter((e) => e.read).length;
  const sum = entries.reduce((n, e) => n + e.percent, 0);
  return { read, total: entries.length, percent: entries.length ? Math.round(sum / entries.length) : 0 };
}

export function filterToc(entries, { filter = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => (filter === 'all'
    || (filter === 'unread' && !e.read) || (filter === 'read' && e.read) || (filter === 'bookmarked' && e.bookmarked))
    && (!q || e.title.toLowerCase().includes(q) || String(e.number) === q));
}

// Groups of `size` by chapter number, so a group keeps its range when filtered.
export function groupToc(entries, size = GROUP_SIZE, total = entries.length) {
  if (total <= size) return entries.length ? [{ key: 'all', from: 1, to: total, entries }] : [];
  const groups = new Map();
  for (const e of entries) {
    const from = Math.floor((e.number - 1) / size) * size + 1;
    if (!groups.has(from)) groups.set(from, { key: String(from), from, to: Math.min(from + size - 1, total), entries: [] });
    groups.get(from).entries.push(e);
  }
  return [...groups.values()];
}

// The first unfinished chapter after `number`, wrapping round to the start.
export function nextUnread(entries, number = 0) {
  return entries.find((e) => !e.read && e.number > number) ?? entries.find((e) => !e.read) ?? null;
}

// "12" → that chapter's entry, or null when out of range.
export function chapterByNumber(entries, text) {
  return /^\d+$/.test(String(text).trim()) ? entries[Number(text) - 1] ?? null : null;
}
