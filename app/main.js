// cliffword reader: bookshelf, chapter reader, word card and recall modes.
// Hash routes: #/  ·  #/saved  ·  #/read/<source>/<book>/<chapter>?mode=<mode>
import { listBuiltIn, listLibrary, loadBook } from './data.js';
import { createStore, STATUSES } from './store.js';
import {
  filterShelf, lastReadLabel, pageList, paginate, PAGE_SIZES, SHELF_DEFAULTS, shelfParams, shelfStateFromParams, SORTS, sortById, sortShelf,
} from './shelf.js';
import { checkMeaning, checkSpelling, hintFor, transferPrompt } from './check.js';
import { speak, stopSpeaking, ttsSupported } from './tts.js';

const MODES = [
  { id: 'read', label: '阅读' },
  { id: 'en2zh', label: '英→中' },
  { id: 'zh2en', label: '中→英' },
  { id: 'transfer', label: '迁移' },
];

const STATUS_LABEL = { unread: '未读', reading: '在读', done: '已读' };
// A book's category until the reader picks one: its own, else where it came from.
const SOURCE_CATEGORY = { builtin: '内置故事', library: '我的书库' };

const store = createStore();
const app = document.getElementById('app');
const wordDialog = document.getElementById('word-card');
const answerDialog = document.getElementById('answer');
const shelfDialog = document.getElementById('shelf-edit');

// Answers given this session, keyed by occurrence, so quiz chips show results.
const sessionAnswers = new Map();
let scrollHandler = null;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const bookKey = (book) => `${book.source}/${book.id}`;
const wordKey = (book, w) => `${bookKey(book)}/${w}`;

function parseRoute() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  if (parts[0] === 'read' && parts.length >= 3) {
    return { view: 'read', source: parts[1], id: parts[2], chapter: parts[3] ?? null, mode: params.get('mode') ?? 'read', fromStart: params.get('from') === 'start' };
  }
  if (parts[0] === 'saved') return { view: 'saved' };
  if (parts[0] === 'review') return { view: 'review' };
  return { view: 'library' };
}

function readHref(source, id, chapter, mode = 'read') {
  const base = `#/read/${encodeURIComponent(source)}/${encodeURIComponent(id)}/${encodeURIComponent(chapter)}`;
  return mode === 'read' ? base : `${base}?mode=${mode}`;
}

async function render() {
  stopSpeaking();
  if (wordDialog.open) wordDialog.close();
  if (answerDialog.open) answerDialog.close();
  if (scrollHandler) removeEventListener('scroll', scrollHandler);
  scrollHandler = null;
  const route = parseRoute();
  try {
    if (route.view === 'read') await renderReader(route);
    else if (route.view === 'saved') renderSaved();
    else if (route.view === 'review') await renderReview();
    else await renderLibrary();
  } catch (err) {
    app.replaceChildren(h('main', { class: 'page' },
      h('p', { class: 'notice', text: `加载失败：${err.message}` }),
      h('p', {}, h('a', { href: '#/', text: '返回书库' }))));
  }
}

/* ---------- Library ---------- */

const shelfCategory = (book) => store.category(bookKey(book)) ?? book.category ?? SOURCE_CATEGORY[book.source];
const shelfStatus = (book) => store.status(bookKey(book), book.chapters);

// Each title gets its own cover colour, so the grid reads at a glance.
function coverHue(title) {
  let hue = 0;
  for (const ch of title) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return hue;
}

// One book as the shelf sees it (see shelf.js).
function shelfEntry(book) {
  const key = bookKey(book);
  const read = Math.min(book.chapters, store.data.stats.completed[key]?.length ?? 0);
  return {
    book, id: book.id, title: book.title, category: shelfCategory(book), status: shelfStatus(book),
    read, chapters: book.chapters, progress: book.chapters ? read / book.chapters : 0,
    // Positions saved before reading times were kept count as read long ago.
    lastReadAt: store.position(key) ? store.position(key).at ?? 0 : null,
    addedAt: book.addedAt ? Date.parse(book.addedAt) : null,
  };
}

function bookCard(entry, onEdit) {
  const { book, status, read, progress } = entry;
  const pos = store.position(bookKey(book));
  const start = `#/read/${encodeURIComponent(book.source)}/${encodeURIComponent(book.id)}`;
  const done = status === 'done';
  const href = done ? `${start}?from=start` : pos?.chapter ? readHref(book.source, book.id, pos.chapter) : start;
  const action = done ? '已读完 · 从头再读' : pos ? `继续阅读 · 第${pos.chapterNumber ?? '?'}章` : '开始阅读';
  const meta = `${entry.category} · ${book.source === 'builtin' ? `${book.words} 个单词` : '本机'}`;
  const when = lastReadLabel(entry.lastReadAt);
  return h('li', { class: 'shelf-item' },
    h('a', { class: 'book', href },
      h('span', { class: 'cover', 'aria-hidden': 'true', style: `--hue: ${coverHue(book.title)}` },
        h('span', { class: 'cover-title', text: book.title })),
      h('span', { class: 'book-title', text: book.title }),
      h('span', { class: 'book-meta', text: meta }),
      h('span', { class: `status status-${status}`, text: `${STATUS_LABEL[status]} · ${read}/${book.chapters} 章` }),
      h('span', { class: 'progress', 'aria-hidden': 'true' }, h('span', { style: `width: ${Math.round(progress * 100)}%` })),
      when && h('span', { class: 'book-when', text: `上次阅读：${when}` }),
      h('span', { class: 'book-action', text: action })),
    h('button', { type: 'button', class: 'icon book-edit', 'aria-label': `整理《${book.title}》`, onclick: () => onEdit(book), text: '⋯' }));
}

// The search text lasts for this visit; view, sort, filters, page size and
// page are remembered, so coming back from a chapter lands on the same page.
let shelfQuery = '';

function shelfSection(books, library) {
  const section = h('section', { class: 'shelf', 'aria-labelledby': 'h-shelf' });
  const results = h('div', { class: 'shelf-results' });
  const count = h('p', { class: 'shelf-count', role: 'status' });

  // A library URL with a query (#/?page=2) is the whole shelf state, so Back
  // and bookmarks restore it exactly. A bare #/ uses the remembered settings.
  const [, urlQuery] = location.hash.split('?');
  if (urlQuery !== undefined) {
    const state = { ...SHELF_DEFAULTS, ...shelfStateFromParams(new URLSearchParams(urlQuery)) };
    shelfQuery = state.query;
    Object.entries({
      shelfCategory: state.category, shelfStatus: state.status, shelfSort: state.sort, shelfDir: state.dir,
      shelfPage: state.page, shelfPageSize: state.size, shelfView: state.view,
    }).forEach(([name, value]) => store.setPref(name, value));
  }

  const prefs = () => {
    const sort = sortById(store.pref('shelfSort', 'recent'));
    const dir = ['asc', 'desc'].includes(store.pref('shelfDir', null)) ? store.pref('shelfDir', null) : sort.dir;
    const size = PAGE_SIZES.includes(store.pref('shelfPageSize', 24)) ? store.pref('shelfPageSize', 24) : 24;
    return { sort, dir, size, view: store.pref('shelfView', 'grid') === 'list' ? 'list' : 'grid' };
  };
  // Anything that changes which books match starts again from page 1.
  const refilter = (name, value) => { store.setPref(name, value); store.setPref('shelfPage', 1); };

  const search = h('input', {
    type: 'search', id: 'shelf-search', class: 'shelf-search', 'aria-labelledby': 'shelf-search-label', autocomplete: 'off', enterkeyhint: 'search',
    placeholder: '书名、分类或 id', value: shelfQuery,
  });
  search.addEventListener('input', () => { shelfQuery = search.value; store.setPref('shelfPage', 1); draw(); });

  const sortSelect = h('select', { id: 'shelf-sort', 'aria-labelledby': 'shelf-sort-label' },
    SORTS.map((s) => h('option', { value: s.id, selected: s.id === prefs().sort.id }, s.label)));
  sortSelect.addEventListener('change', () => { store.setPref('shelfDir', null); refilter('shelfSort', sortSelect.value); draw({ push: true }); });

  const dirBtn = h('button', { type: 'button', class: 'chip dir' });
  dirBtn.addEventListener('click', () => { store.setPref('shelfDir', prefs().dir === 'asc' ? 'desc' : 'asc'); store.setPref('shelfPage', 1); draw({ push: true }); });

  const sizeSelect = h('select', { id: 'shelf-size', 'aria-labelledby': 'shelf-size-label' },
    PAGE_SIZES.map((n) => h('option', { value: String(n), selected: n === prefs().size }, `${n} 本`)));
  sizeSelect.addEventListener('change', () => { refilter('shelfPageSize', Number(sizeSelect.value)); draw({ push: true }); });

  const viewBtn = (view, label) => {
    const btn = h('button', { type: 'button', class: 'chip', 'data-view': view, text: label });
    btn.addEventListener('click', () => { store.setPref('shelfView', view); draw({ push: true }); });
    return btn;
  };
  const viewBtns = [viewBtn('grid', '格子'), viewBtn('list', '列表')];

  const chip = (filter, value, label, active) => h('button', {
    type: 'button', class: 'chip', 'data-filter': `${filter}:${value ?? ''}`, 'aria-pressed': String(active),
    onclick: () => { refilter(filter, value); draw({ filter: `${filter}:${value ?? ''}`, push: true }); },
  }, label);

  function goTo(page, nav) {
    store.setPref('shelfPage', page);
    draw({ nav, push: true });
    if (section.getBoundingClientRect().top < 0) section.scrollIntoView({ block: 'start' });
  }

  function pager({ page, pages }) {
    if (pages < 2) return '';
    const btn = (label, target, nav, extra = {}) => h('button', {
      type: 'button', class: 'chip page', 'data-nav': nav, disabled: target < 1 || target > pages, onclick: () => goTo(target, nav), ...extra,
    }, label);
    return h('nav', { class: 'pager', 'aria-label': '书架分页' },
      btn('‹ 上一页', page - 1, 'prev'),
      pageList(page, pages).map((n) => (n === null
        ? h('span', { class: 'gap', 'aria-hidden': 'true', text: '…' })
        : btn(String(n), n, `p${n}`, { 'aria-label': `第 ${n} 页`, 'aria-current': n === page ? 'page' : null }))),
      btn('下一页 ›', page + 1, 'next'));
  }

  function draw(focus = {}) {
    const { sort, dir, size, view } = prefs();
    const entries = books.map(shelfEntry);
    const categories = [...new Set(entries.map((e) => e.category))];
    const category = categories.includes(store.pref('shelfCategory', null)) ? store.pref('shelfCategory', null) : null;
    const status = STATUSES.includes(store.pref('shelfStatus', null)) ? store.pref('shelfStatus', null) : null;
    const searched = filterShelf(entries, { query: shelfQuery });
    const inCategory = filterShelf(searched, { category });
    const matched = sortShelf(filterShelf(inCategory, { status }), sort.id, dir);
    const shown = paginate(matched, store.pref('shelfPage', 1), size);
    const tally = (list, test) => list.filter(test).length;

    dirBtn.textContent = dir === 'asc' ? '↑ 升序' : '↓ 降序';
    dirBtn.setAttribute('aria-label', `排序方向：${dir === 'asc' ? '升序' : '降序'}，点按切换`);
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    count.textContent = matched.length
      ? `${matched.length < entries.length ? `找到 ${matched.length} 本（共 ${entries.length} 本）` : `共 ${entries.length} 本`} · 第 ${shown.from}–${shown.to} 本 · 第 ${shown.page}/${shown.pages} 页`
      : '';

    results.replaceChildren(
      h('div', { class: 'filters', role: 'group', 'aria-label': '按分类筛选' },
        h('span', { class: 'filter-label', 'aria-hidden': 'true', text: '分类' }),
        chip('shelfCategory', null, `全部 ${searched.length}`, !category),
        categories.map((c) => chip('shelfCategory', c, `${c} ${tally(searched, (e) => e.category === c)}`, category === c))),
      h('div', { class: 'filters', role: 'group', 'aria-label': '按阅读状态筛选' },
        h('span', { class: 'filter-label', 'aria-hidden': 'true', text: '状态' }),
        chip('shelfStatus', null, `全部 ${inCategory.length}`, !status),
        STATUSES.map((st) => chip('shelfStatus', st, `${STATUS_LABEL[st]} ${tally(inCategory, (e) => e.status === st)}`, status === st))),
      count,
      shown.items.length
        ? h('ul', { class: `books books-${view}` }, shown.items.map((e) => bookCard(e, (book) => openShelfEdit(book, categories, draw))))
        : h('div', { class: 'notice' },
          h('p', { text: entries.length ? '没有符合条件的书。' : '书架上还没有书。' }),
          entries.length && h('button', {
            type: 'button', class: 'small',
            onclick: () => {
              shelfQuery = '';
              search.value = '';
              store.setPref('shelfCategory', null);
              store.setPref('shelfStatus', null);
              store.setPref('shelfPage', 1);
              draw({ push: true });
              search.focus();
            },
            text: '清除搜索和筛选',
          })),
      pager(shown),
      libraryHelp(library) ?? '');
    // Typing replaces the history entry; other changes add one, so Back steps through them.
    const hash = `#/?${shelfParams({ query: shelfQuery, category, status, sort: sort.id, dir, page: shown.page, size, view })}`;
    if (hash !== location.hash) history[focus.push ? 'pushState' : 'replaceState'](null, '', hash);
    if (focus.filter) results.querySelector(`[data-filter="${CSS.escape(focus.filter)}"]`)?.focus();
    if (focus.nav) {
      const target = results.querySelector(`[data-nav="${focus.nav}"]:not([disabled])`) ?? results.querySelector('.pager [aria-current="page"]');
      target?.focus({ preventScroll: true });
    }
  }

  section.append(
    h('div', { class: 'shelf-head' },
      h('h2', { id: 'h-shelf', text: '书架' }),
      h('div', { class: 'view-toggle', role: 'group', 'aria-label': '排列方式' }, viewBtns)),
    h('div', { class: 'shelf-tools' },
      h('label', { class: 'tool tool-search', for: 'shelf-search' }, h('span', { id: 'shelf-search-label', text: '搜索' }), search),
      h('label', { class: 'tool', for: 'shelf-sort' }, h('span', { id: 'shelf-sort-label', text: '排序' }), sortSelect),
      dirBtn,
      h('label', { class: 'tool', for: 'shelf-size' }, h('span', { id: 'shelf-size-label', text: '每页' }), sizeSelect)),
    results);
  draw();
  return section;
}

function libraryHelp(library) {
  if (library === null) {
    return h('div', { class: 'notice' },
      h('p', { text: '在自己电脑上运行 cliffword 时，可以导入你自己的书。书只保存在本机，不会上传。' }),
      h('pre', { lang: 'en' }, h('code', { text: 'npm run import -- 你的书.txt --id my-book' })),
      h('p', { text: '然后在 Codex 或 Claude Code 里说：“用 cliffword-annotate 标注 my-book”。' }));
  }
  return library.length ? null : h('p', { class: 'notice', text: '还没有导入的书。运行 npm run import -- 你的书.txt 导入一本。' });
}

function openShelfEdit(book, categories, onSave) {
  const key = bookKey(book);
  const fallback = book.category ?? SOURCE_CATEGORY[book.source];
  const input = h('input', {
    id: 'shelf-category', list: 'shelf-categories', autocomplete: 'off', maxlength: '40',
    value: store.category(key) ?? '', placeholder: fallback,
  });
  const chosen = store.statusOverride(key) ?? 'auto';
  const radio = (value, label) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'shelf-status', value, checked: value === chosen }), label);

  const form = h('form', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', { text: `整理《${book.title}》` }),
      h('button', { type: 'button', class: 'icon close', 'aria-label': '关闭', onclick: () => shelfDialog.close(), text: '✕' })),
    h('label', { for: 'shelf-category', text: '分类' }),
    input,
    h('datalist', { id: 'shelf-categories' },
      [...new Set([...categories, ...store.categories(), ...Object.values(SOURCE_CATEGORY)])].map((c) => h('option', { value: c }))),
    h('p', { class: 'fineprint', text: `留空就用默认分类：${fallback}` }),
    h('fieldset', { class: 'status-choice' },
      h('legend', { text: '阅读状态' }),
      radio('auto', '按阅读进度自动判断'),
      STATUSES.map((st) => radio(st, `标为${STATUS_LABEL[st]}`))),
    h('div', { class: 'sheet-actions' }, h('button', { type: 'submit', class: 'primary', text: '保存' })));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = form.elements['shelf-status'].value;
    store.setShelf(key, { category: input.value, status: status === 'auto' ? null : status });
    shelfDialog.close();
    onSave();
    document.querySelector(`.book-edit[aria-label="${CSS.escape(`整理《${book.title}》`)}"]`)?.focus();
  });

  shelfDialog.replaceChildren(form);
  shelfDialog.showModal();
  input.focus();
}

async function renderLibrary() {
  document.title = 'cliffword';
  const [builtIn, library] = await Promise.all([listBuiltIn(), listLibrary()]);
  const savedCount = Object.keys(store.saved()).length;

  const sum = store.summary();
  const reviewBanner = sum.due
    ? h('a', { class: 'review-banner', href: '#/review' },
      h('span', { class: 'review-count', text: `今日复习 · ${sum.due} 个单词` }), h('span', { text: '开始 →' }))
    : sum.upcoming
      ? h('p', { class: 'fineprint', text: `今天没有要复习的单词。还有 ${sum.upcoming} 个单词会在之后几天复习。` })
      : null;

  app.replaceChildren(h('main', { class: 'page home' },
    h('header', { class: 'masthead' },
      h('h1', { text: 'cliffword' }),
      h('p', { class: 'tagline', text: '读一个停不下来的故事，顺手记住里面的英文单词。' })),
    reviewBanner,
    shelfSection([...builtIn, ...(library ?? [])], library),
    builtIn.map((b) => b.note && h('p', { class: 'fineprint', text: `《${b.title}》：${b.note}` })),
    h('section', { 'aria-labelledby': 'h-saved' },
      h('h2', { id: 'h-saved', text: '生词本' }),
      h('p', {}, h('a', { href: '#/saved', text: savedCount ? `已收藏 ${savedCount} 个单词 →` : '还没有收藏单词' }))),
    h('section', { 'aria-labelledby': 'h-stats' },
      h('h2', { id: 'h-stats', text: '学习记录' }),
      h('dl', { class: 'stats' },
        stat('阅读天数', sum.days),
        stat('读完章节', sum.chapters),
        stat('主动点“下一章”', `${sum.nextChapter} 次`),
        stat('答题正确率', sum.answered ? `${Math.round((sum.correct / sum.answered) * 100)}%（${sum.correct}/${sum.answered}）` : '—'),
        stat('待复习', sum.due)),
      h('p', { class: 'fineprint', text: '这些记录只保存在这个浏览器里，不会发送到任何地方。' })),
    backupSection(),
    !store.persistent && h('p', { class: 'notice', text: '浏览器不允许本地保存，进度只在本次打开期间有效。' })));
}

function stat(label, value) {
  return h('div', {}, h('dt', { text: label }), h('dd', { text: String(value) }));
}

function backupSection() {
  const status = h('p', { class: 'fineprint', role: 'status' });
  const file = h('input', { type: 'file', id: 'import-file', accept: 'application/json,.json', class: 'visually-hidden' });
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    try {
      const text = await chosen.text();
      if (!store.isEmpty() && !confirm('导入会替换这个浏览器里现在的进度。继续吗？')) return;
      store.importJSON(text);
      await renderLibrary();
      document.querySelector('#backup-status').textContent = '已导入备份。';
    } catch (err) {
      status.textContent = err.message;
    }
  });

  const exportBtn = h('button', { type: 'button', class: 'small', text: '导出进度' });
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = h('a', { href: url, download: `cliffword-progress-${stamp}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '已导出。';
  });

  status.id = 'backup-status';
  return h('section', { 'aria-labelledby': 'h-backup' },
    h('h2', { id: 'h-backup', text: '备份' }),
    h('div', { class: 'backup-actions' },
      exportBtn,
      h('label', { for: 'import-file', class: 'small file-label', text: '导入进度' }),
      file),
    h('p', { class: 'fineprint', text: '备份文件只包含进度、收藏的单词和答题记录，不包含任何书的正文。' }),
    status);
}

/* ---------- Review ---------- */

function parseWordKey(key) {
  const parts = key.split('/');
  return { source: parts[0], id: parts.slice(1, -1).join('/'), w: parts.at(-1) };
}

async function reviewBook(item) {
  const { source, id } = parseWordKey(item.key);
  return loadBook(source, id).catch(() => null);
}

async function reviewContext(book, item) {
  if (!book) return null;
  try {
    const ref = book.chapters.find((c) => c.id === item.chapter);
    const paragraph = ref && (await ref.load()).paragraphs[item.p];
    if (!paragraph || typeof paragraph.segments[item.i] === 'string') return null;
    return h('p', { class: 'context' }, paragraph.segments.map((seg, i) => {
      if (typeof seg === 'string') return seg;
      if (i !== item.i) return seg.gloss;
      return item.direction === 'en2zh'
        ? h('mark', { lang: 'en', text: seg.form })
        : h('mark', {}, `（${seg.gloss}）`, h('span', { lang: 'en', text: hintFor(seg.form) }));
    }));
  } catch {
    return null;
  }
}

async function renderReview() {
  document.title = '复习 · cliffword';
  const queue = store.due();
  let done = 0;
  let right = 0;

  const shell = h('main', { class: 'page review' });
  app.replaceChildren(shell);

  async function show(index) {
    stopSpeaking();
    const item = queue[index];
    if (!item) {
      shell.replaceChildren(
        h('nav', { class: 'crumbs' }, h('a', { href: '#/', text: '← 书库' })),
        h('h1', { text: queue.length ? '今天的复习完成了' : '今天没有要复习的单词' }),
        queue.length && h('p', { text: `复习了 ${done} 个单词，答对 ${right} 个。答对的单词会隔几天再出现，答错的明天再来。` }),
        h('p', {}, h('a', { href: '#/', class: 'primary-link', text: '返回书库' })));
      return;
    }

    const meaning = item.direction === 'en2zh';
    const book = await reviewBook(item);
    const input = h('input', {
      id: 'review-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      lang: meaning ? 'zh-CN' : 'en', required: true,
    });
    const feedback = h('div', { class: 'feedback', role: 'status' });
    const submit = h('button', { type: 'submit', class: 'primary', text: '提交' });
    const next = (correct, given) => {
      store.reviewResult(item.key, correct, item.direction, given);
      done += 1;
      if (correct) right += 1;
      show(index + 1);
    };

    const form = h('form', { class: 'sheet review-card' },
      h('p', { class: 'fineprint', text: `${index + 1} / ${queue.length}${item.bookTitle ? ` · 《${item.bookTitle}》` : ''}` }),
      h('h1', { class: meaning ? 'lemma' : 'review-gloss', lang: meaning ? 'en' : 'zh-CN', text: meaning ? item.form : item.gloss }),
      meaning && ttsSupported && h('button', { type: 'button', class: 'icon', 'aria-label': `朗读 ${item.form}`, onclick: () => speak(item.form, { book: parseWordKey(item.key) }), text: '🔊' }),
      !meaning && h('p', { class: 'hint', lang: 'en', text: hintFor(item.form) }),
      await reviewContext(book, item),
      h('label', { for: 'review-input', text: meaning ? '中文意思' : `英文（${item.form.length} 个字母）` }),
      input,
      feedback,
      h('div', { class: 'sheet-actions' }, submit));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const given = input.value;
      const correct = meaning ? checkMeaning(given, item) : checkSpelling(given, item);
      input.readOnly = true;
      submit.remove();
      if (correct) {
        feedback.replaceChildren(h('p', { class: 'ok', text: '✓ 正确' }), h('button', { type: 'button', class: 'primary', onclick: () => next(true, given), text: '下一个' }));
        if (ttsSupported) speak(item.form, { book: parseWordKey(item.key) });
      } else {
        feedback.replaceChildren(
          h('p', { class: 'bad' }, '✗ 参考答案：', h('strong', { lang: meaning ? 'zh-CN' : 'en', text: meaning ? item.gloss : item.form })),
          meaning && h('button', { type: 'button', class: 'text-btn', onclick: () => next(true, given), text: '我的答案意思也对' }),
          h('button', { type: 'button', class: 'primary', onclick: () => next(false, given), text: '下一个' }));
      }
      feedback.querySelector('button.primary')?.focus();
    });

    shell.replaceChildren(h('nav', { class: 'crumbs' }, h('a', { href: '#/', text: '← 书库' })), form);
    input.focus();
  }

  await show(0);
}

/* ---------- Saved words ---------- */

function renderSaved() {
  document.title = '生词本 · cliffword';
  const entries = Object.entries(store.saved()).sort((a, b) => b[1].savedAt - a[1].savedAt);
  app.replaceChildren(h('main', { class: 'page' },
    h('nav', { class: 'crumbs' }, h('a', { href: '#/', text: '← 书库' })),
    h('h1', { text: '生词本' }),
    entries.length
      ? h('ul', { class: 'saved' }, entries.map(([key, w]) => h('li', {},
        h('span', { class: 'saved-word', lang: 'en', text: w.lemma ?? key.split('/').pop() }),
        w.ipa && h('span', { class: 'ipa', text: w.ipa }),
        h('span', { class: 'saved-gloss', text: w.gloss ?? '' }),
        w.bookTitle && h('span', { class: 'fineprint', text: `《${w.bookTitle}》` }),
        ttsSupported && h('button', { class: 'icon', type: 'button', 'aria-label': `朗读 ${w.lemma}`, onclick: () => speak(w.lemma, { book: parseWordKey(key) }), text: '🔊' }),
        h('button', { class: 'text-btn', type: 'button', onclick: () => { store.toggleSaved(key); renderSaved(); }, text: '移除' }))))
      : h('p', { class: 'notice', text: '在词卡上点“收藏”，单词就会出现在这里。' })));
}

/* ---------- Reader ---------- */

async function renderReader(route) {
  const book = await loadBook(route.source, route.id);
  const pos = store.position(bookKey(book));
  // ?from=start (从头再读) opens chapter 1 whatever the saved position.
  const chapterIndex = route.fromStart ? 0 : Math.max(0, book.chapters.findIndex((c) => c.id === (route.chapter ?? pos?.chapter)));
  const ref = book.chapters[chapterIndex];
  const chapter = await ref.load();
  const mode = MODES.some((m) => m.id === route.mode) ? route.mode : 'read';
  document.title = `${book.title} · ${ref.title}`;

  const restoring = !route.fromStart && pos && pos.chapter === ref.id && pos.paragraph > 0;
  store.setPosition(bookKey(book), { chapter: ref.id, chapterNumber: chapterIndex + 1, paragraph: restoring ? pos.paragraph : 0 });

  const tabs = h('div', { class: 'modes', role: 'group', 'aria-label': '学习模式' },
    MODES.map((m) => h('a', {
      class: 'mode', href: readHref(book.source, book.id, ref.id, m.id),
      'aria-current': m.id === mode ? 'page' : null, text: m.label,
    })));

  const body = mode === 'transfer' ? renderTransfer(book, chapter) : renderPassage(book, chapter, mode);
  const prev = book.chapters[chapterIndex - 1];
  const next = book.chapters[chapterIndex + 1];

  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-inner' },
        h('a', { class: 'back', href: '#/', text: '← 书库' }),
        h('p', { class: 'where' }, h('span', { class: 'where-book', text: book.title }), ' · ', ref.title),
        tabs)),
    h('main', { class: 'page reader', lang: 'zh-CN' },
      h('h1', { class: 'chapter-title', text: ref.title }),
      chapter.annotated === false && h('p', { class: 'notice', text: '这一章还没有标注英文单词。让你的 agent 运行 cliffword-annotate。' }),
      body,
      h('nav', { class: 'chapter-nav', 'aria-label': '章节' },
        prev ? h('a', { class: 'prev', href: readHref(book.source, book.id, prev.id, mode), text: `← ${prev.title}` }) : h('span'),
        next
          ? h('a', { class: 'next', href: readHref(book.source, book.id, next.id, mode), onclick: () => { store.noteNextChapter(bookKey(book)); store.markComplete(bookKey(book), ref.id); }, text: `下一章：${next.title} →` })
          : h('a', { class: 'next', href: '#/', onclick: () => store.markComplete(bookKey(book), ref.id), text: '全书完 · 返回书库' }))));

  const paragraphs = [...app.querySelectorAll('.para')];
  if (restoring && paragraphs[pos.paragraph]) paragraphs[pos.paragraph].scrollIntoView({ block: 'start' });
  else scrollTo(0, 0);

  let timer;
  scrollHandler = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const top = app.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const index = paragraphs.findIndex((p) => p.getBoundingClientRect().bottom > top + 8);
      store.setPosition(bookKey(book), { chapter: ref.id, chapterNumber: chapterIndex + 1, paragraph: Math.max(0, index) });
      const last = paragraphs.at(-1);
      if (last && last.getBoundingClientRect().bottom <= innerHeight) store.markComplete(bookKey(book), ref.id);
    }, 250);
  };
  addEventListener('scroll', scrollHandler, { passive: true });
}

function plainText(paragraph, highlight) {
  return paragraph.segments.map((s, i) => {
    if (typeof s === 'string') return s;
    return i === highlight ? h('mark', {}, h('span', { lang: 'en', text: s.form }), `（${s.gloss}）`) : s.gloss;
  });
}

// Closing punctuation must not start a line, so it stays glued to the chip before it.
const LEADING_PUNCT = /^[，。、；：！？）》」』”’…—,.;:!?)\]]+/;

function renderPassage(book, chapter, mode) {
  return h('article', { class: `passage mode-${mode}` }, chapter.paragraphs.map((paragraph, p) => {
    const nodes = [];
    let carry = '';
    paragraph.segments.forEach((seg, i) => {
      if (typeof seg === 'string') {
        nodes.push(carry ? seg.slice(carry.length) : seg);
        carry = '';
        return;
      }
      const occKey = `${bookKey(book)}/${chapter.id}/${p}/${i}`;
      const chip = wordChip({ book, chapter, paragraph, p, index: i, seg, occKey, mode });
      const next = paragraph.segments[i + 1];
      carry = typeof next === 'string' ? (LEADING_PUNCT.exec(next)?.[0] ?? '') : '';
      nodes.push(carry ? h('span', { class: 'nobr' }, chip, carry) : chip);
    });
    return h('p', { class: paragraph.hook ? 'para hook' : 'para' }, nodes);
  }));
}

function wordChip(ctx) {
  const { seg, mode, occKey } = ctx;
  const done = sessionAnswers.get(`${mode}:${occKey}`);
  let main;
  let note;
  let label;
  let cls = 'w';

  if (mode === 'en2zh') {
    main = h('span', { lang: 'en', text: seg.form });
    note = done ? seg.gloss : '？';
    label = done ? `${seg.form}，${seg.gloss}，查看词卡` : `写出 ${seg.form} 在这句里的意思`;
    cls += done ? (done.correct ? ' quiz ok' : ' quiz bad') : ' quiz';
  } else if (mode === 'zh2en') {
    main = h('span', { text: seg.gloss });
    note = done ? seg.form : hintFor(seg.form);
    label = done ? `${seg.form}，${seg.gloss}，查看词卡` : `写出“${seg.gloss}”的英文，提示 ${hintFor(seg.form)}`;
    cls += done ? (done.correct ? ' quiz ok' : ' quiz bad') : ' quiz';
  } else {
    main = h('span', { lang: 'en', text: seg.form });
    note = seg.gloss;
    label = `${seg.form}，${seg.gloss}，查看词卡`;
  }

  const chip = h('button', { type: 'button', class: cls, 'aria-label': label },
    h('ruby', {}, main, h('rt', { lang: mode === 'zh2en' && done ? 'en' : null, text: note })));
  chip.addEventListener('click', () => {
    if ((mode === 'en2zh' || mode === 'zh2en') && !sessionAnswers.has(`${mode}:${occKey}`)) openAnswer(ctx, chip);
    else openWordCard(ctx);
  });
  return chip;
}

/* ---------- Word card ---------- */

function openWordCard({ book, chapter, paragraph, p, index, seg }) {
  const word = book.vocab.get(seg.w) ?? { lemma: seg.form };
  const key = wordKey(book, seg.w);
  const errors = store.errors()[key]?.count ?? 0;
  const saveBtn = h('button', {
    type: 'button', class: 'save', 'aria-pressed': String(store.isSaved(key)),
    text: store.isSaved(key) ? '★ 已收藏' : '☆ 收藏',
  });
  saveBtn.addEventListener('click', () => {
    const saved = store.toggleSaved(key, reviewMeta(book, chapter.id, p, index, seg));
    saveBtn.setAttribute('aria-pressed', String(saved));
    saveBtn.textContent = saved ? '★ 已收藏' : '☆ 收藏';
  });

  wordDialog.replaceChildren(h('form', { method: 'dialog', class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', { lang: 'en', class: 'lemma', text: word.lemma }),
      ttsSupported && h('button', { type: 'button', class: 'icon', 'aria-label': `朗读 ${word.lemma}`, onclick: () => speak(word.lemma, { book }), text: '🔊' }),
      h('button', { class: 'icon close', value: 'close', 'aria-label': '关闭', text: '✕' })),
    h('p', { class: 'ipa-line' },
      word.ipa && h('span', { class: 'ipa', lang: 'en', text: word.ipa }),
      word.pos && h('span', { class: 'pos', lang: 'en', text: word.pos }),
      seg.form !== word.lemma && h('span', { class: 'form', lang: 'en', text: `本句：${seg.form}` })),
    h('h3', { text: '这句里的意思' }),
    h('p', { class: 'gloss', text: seg.gloss }),
    h('h3', { text: '原句' }),
    h('p', { class: 'context' }, plainText(paragraph, index)),
    word.example && h('h3', { text: '英文例句' }),
    word.example && h('p', { class: 'example' },
      h('span', { lang: 'en', text: word.example }),
      ttsSupported && h('button', { type: 'button', class: 'icon', 'aria-label': '朗读例句', onclick: () => speak(word.example, { book }), text: '🔊' })),
    errors > 0 && h('p', { class: 'fineprint', text: `答错 ${errors} 次` }),
    !ttsSupported && h('p', { class: 'fineprint', text: '这个浏览器不支持朗读。' }),
    h('div', { class: 'sheet-actions' }, saveBtn)));
  wordDialog.showModal();
}

/* ---------- Recall (answer sheet) ---------- */

// What a review needs to show this word later: word-level fields only.
function reviewMeta(book, chapterId, p, i, seg) {
  const word = book.vocab.get(seg.w) ?? {};
  return { lemma: word.lemma ?? seg.form, form: seg.form, gloss: seg.gloss, accept: seg.accept, ipa: word.ipa, bookTitle: book.title, chapter: chapterId, p, i };
}

function openAnswer(ctx, chip) {
  const { book, chapter, paragraph, p, index, seg, occKey, mode } = ctx;
  const key = wordKey(book, seg.w);
  const meaning = mode === 'en2zh';
  const input = h('input', {
    id: 'answer-input', name: 'answer', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    lang: meaning ? 'zh-CN' : 'en', required: true,
  });
  const feedback = h('div', { class: 'feedback', role: 'status' });
  const submit = h('button', { type: 'submit', class: 'primary', text: '提交' });
  let pending = null;

  const finish = (correct) => {
    store.recordAnswer(key, { mode, correct, given: pending.given }, reviewMeta(book, chapter.id, p, index, seg));
    sessionAnswers.set(`${mode}:${occKey}`, { correct });
    pending = null;
    answerDialog.close();
    chip.replaceWith(wordChip(ctx));
  };

  const form = h('form', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', { text: meaning ? '这个词在这句里是什么意思？' : '这里的英文是什么？' }),
      h('button', { type: 'button', class: 'icon close', 'aria-label': '关闭', onclick: () => answerDialog.close(), text: '✕' })),
    h('p', { class: 'context' }, paragraph.segments.map((s, i) => {
      if (typeof s === 'string') return s;
      if (i !== index) return s.gloss;
      return meaning
        ? h('mark', { lang: 'en', text: s.form })
        : h('mark', {}, `（${s.gloss}）`, h('span', { lang: 'en', text: hintFor(s.form) }));
    })),
    h('label', { for: 'answer-input', text: meaning ? '中文意思' : `英文（本句中的形式，${seg.form.length} 个字母）` }),
    input,
    feedback,
    h('div', { class: 'sheet-actions' }, submit));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    const given = input.value;
    const correct = meaning ? checkMeaning(given, seg) : checkSpelling(given, seg);
    pending = { given };
    input.readOnly = true;
    submit.remove();
    if (correct) {
      feedback.replaceChildren(h('p', { class: 'ok', text: '✓ 正确' }));
      feedback.append(h('button', { type: 'button', class: 'primary', onclick: () => finish(true), text: '继续' }));
    } else {
      feedback.replaceChildren(
        h('p', { class: 'bad' }, '✗ 参考答案：', h('strong', { lang: meaning ? 'zh-CN' : 'en', text: meaning ? seg.gloss : seg.form })),
        meaning && h('button', { type: 'button', class: 'text-btn', onclick: () => finish(true), text: '我的答案意思也对' }),
        h('button', { type: 'button', class: 'primary', onclick: () => finish(false), text: '知道了' }));
    }
    feedback.querySelector('button.primary')?.focus();
  });

  answerDialog.onclose = () => { if (pending) finish(false); };
  answerDialog.replaceChildren(form);
  answerDialog.showModal();
  input.focus();
}

/* ---------- Transfer ---------- */

function renderTransfer(book, chapter) {
  const forms = new Map();
  const gloss = new Map();
  const first = new Map();
  chapter.paragraphs.forEach((para, p) => para.segments.forEach((s, i) => {
    if (typeof s === 'string') return;
    if (!forms.has(s.w)) forms.set(s.w, new Set());
    forms.get(s.w).add(s.form);
    if (!gloss.has(s.w)) gloss.set(s.w, s.gloss);
    if (!first.has(s.w)) first.set(s.w, { p, i, seg: s });
  }));
  const items = [...forms].map(([id, f]) => {
    const word = book.vocab.get(id);
    const prompt = word && transferPrompt(word, [...f]);
    return prompt && { id, word, prompt };
  }).filter(Boolean);

  if (!items.length) return h('p', { class: 'notice', text: '这一章没有可以练习的英文例句。' });

  return h('section', { class: 'transfer' },
    h('p', { class: 'fineprint', text: '把本章的单词用到新的英文句子里。' }),
    h('ol', {}, items.map(({ id, word, prompt }) => {
      const inputId = `t-${id}`;
      const input = h('input', { id: inputId, lang: 'en', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', size: Math.max(6, prompt.answer.length + 2) });
      const feedback = h('span', { class: 'feedback', role: 'status' });
      const form = h('form', { class: 'transfer-item' },
        h('p', { lang: 'en' }, prompt.before, h('label', { for: inputId, class: 'visually-hidden', text: `填空，意思是“${gloss.get(id)}”` }), input, prompt.after),
        h('p', { class: 'fineprint' }, `提示：${gloss.get(id)} · ${hintFor(prompt.answer)}`),
        h('button', { type: 'submit', class: 'small', text: '检查' }),
        feedback);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const correct = input.value.trim().toLowerCase() === prompt.answer.toLowerCase();
        const at = first.get(id);
        store.recordAnswer(wordKey(book, id), { mode: 'transfer', correct, given: input.value }, reviewMeta(book, chapter.id, at.p, at.i, at.seg));
        feedback.replaceChildren(correct
          ? h('span', { class: 'ok', text: '✓ 正确' })
          : h('span', { class: 'bad' }, '✗ 答案：', h('strong', { lang: 'en', text: prompt.answer })));
        if (correct && ttsSupported) speak(word.example, { book });
      });
      return h('li', {}, form);
    })));
}

wordDialog.addEventListener('close', stopSpeaking);
answerDialog.addEventListener('close', stopSpeaking);
addEventListener('pagehide', stopSpeaking);

store.noteVisit();
addEventListener('hashchange', render);
render();
