// Bookshelf logic: search, filters, sorting and paging. DOM-free so
// node --test covers it. An entry is one book as the shelf sees it:
// { id, title, category, status, progress (0–1), chapters, lastReadAt, addedAt }.

export const SORTS = [
  { id: 'recent', label: '最近阅读', dir: 'desc' },
  { id: 'title', label: '书名', dir: 'asc' },
  { id: 'added', label: '加入时间', dir: 'desc' },
  { id: 'progress', label: '阅读进度', dir: 'desc' },
  { id: 'length', label: '篇幅（章数）', dir: 'desc' },
  { id: 'status', label: '阅读状态', dir: 'asc' },
];
export const PAGE_SIZES = [12, 24, 48, 96];

const STATUS_RANK = { reading: 0, unread: 1, done: 2 };
// Chinese titles sort by pinyin where the runtime supports it.
const collator = new Intl.Collator(['zh-CN-u-co-pinyin', 'zh-CN'], { numeric: true, sensitivity: 'base' });

const KEYS = {
  recent: (e) => e.lastReadAt,
  added: (e) => e.addedAt,
  progress: (e) => e.progress,
  length: (e) => e.chapters,
  status: (e) => STATUS_RANK[e.status],
};

export const sortById = (id) => SORTS.find((s) => s.id === id) ?? SORTS[0];

// Query matches title, category or id (an imported book's id is often pinyin).
export function filterShelf(entries, { query = '', category = null, status = null } = {}) {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => (!category || e.category === category)
    && (!status || e.status === status)
    && (!q || [e.title, e.category, e.id].some((s) => String(s ?? '').toLowerCase().includes(q))));
}

// Books without a value for the key (never opened, no import date) always
// go last, whichever the direction. Ties fall back to title, then input order.
export function sortShelf(entries, sortId, dir) {
  const sort = sortById(sortId);
  const sign = (dir ?? sort.dir) === 'asc' ? 1 : -1;
  const key = KEYS[sort.id];
  const valid = (v) => v != null && !Number.isNaN(v);
  return entries.map((e, i) => ({ e, i })).sort((x, y) => {
    if (!key) return sign * collator.compare(x.e.title, y.e.title) || x.i - y.i;
    const a = key(x.e);
    const b = key(y.e);
    if (valid(a) !== valid(b)) return valid(a) ? -1 : 1;
    if (valid(a) && a !== b) return (a < b ? -1 : 1) * sign;
    return collator.compare(x.e.title, y.e.title) || x.i - y.i;
  }).map(({ e }) => e);
}

export function paginate(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * size;
  return { items: items.slice(start, start + size), page: current, pages, total: items.length, from: items.length ? start + 1 : 0, to: Math.min(start + size, items.length) };
}

// Page numbers to show: first, last and current ± 1, with null for a gap.
// A gap of a single page shows that page instead.
export function pageList(page, pages) {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    const prev = out.at(-1);
    if (prev != null && n - prev === 2) out.push(n - 1);
    else if (prev != null && n - prev > 2) out.push(null);
    out.push(n);
  }
  return out;
}

// 今天 / 昨天 / 3 天前 / 2026-09-01, relative to `now`.
export function lastReadLabel(at, now = Date.now()) {
  if (!at) return null;
  const day = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.round((day(now) - day(at)) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Shelf state in the library URL (#/?q=…&cat=…&page=2), so Back returns to
// the same page and a filtered view can be bookmarked. Defaults are left out.
export const SHELF_DEFAULTS = { query: '', category: null, status: null, sort: 'recent', dir: null, page: 1, size: 24, view: 'grid' };
const PARAMS = { query: 'q', category: 'cat', status: 'status', sort: 'sort', dir: 'dir', page: 'page', size: 'size', view: 'view' };
const STATUS_IDS = Object.keys(STATUS_RANK);

// Only the keys present and valid in the URL; the caller keeps the rest.
export function shelfStateFromParams(params) {
  const state = {};
  const get = (key) => params.get(PARAMS[key]);
  if (get('query') != null) state.query = get('query').slice(0, 100);
  if (get('category')) state.category = get('category').slice(0, 40);
  if (STATUS_IDS.includes(get('status'))) state.status = get('status');
  if (SORTS.some((s) => s.id === get('sort'))) state.sort = get('sort');
  if (['asc', 'desc'].includes(get('dir'))) state.dir = get('dir');
  const page = Number.parseInt(get('page'), 10);
  if (page >= 1) state.page = page;
  const size = Number(get('size'));
  if (PAGE_SIZES.includes(size)) state.size = size;
  if (['grid', 'list'].includes(get('view'))) state.view = get('view');
  return state;
}

export function shelfParams(state) {
  const params = new URLSearchParams();
  for (const [key, name] of Object.entries(PARAMS)) {
    let value = state[key];
    if (key === 'dir' && value === sortById(state.sort).dir) value = null;
    if (value == null || value === '' || value === SHELF_DEFAULTS[key]) continue;
    params.set(name, String(value));
  }
  return params;
}
