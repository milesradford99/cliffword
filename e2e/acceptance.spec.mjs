import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const wordCard = (page) => page.locator('#word-card');
const answer = (page) => page.locator('#answer');

async function submitAnswer(page, text) {
  await answer(page).getByLabel(/中文意思|英文/).fill(text);
  await answer(page).getByRole('button', { name: '提交' }).click();
}

test('the library lists the built-in story', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/cliffword/);
  await expect(page.getByRole('link', { name: /画皮/ })).toBeVisible();
});

// v0.1 acceptance flow, steps 1–5 (docs/SCOPE.md).
test('read, save, recall in both directions, and keep it all after reload', async ({ page }) => {
  // 1. Library → chapter 1.
  await page.goto('/');
  await page.getByRole('link', { name: /画皮/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('第1章 包袱');

  // 2. Word card, then save.
  await page.getByRole('button', { name: /^scholar，书生/ }).first().click();
  await expect(wordCard(page).getByRole('heading', { name: 'scholar' })).toBeVisible();
  await expect(wordCard(page).getByText('/ˈskɒlə/')).toBeVisible();
  await wordCard(page).getByRole('button', { name: /收藏/ }).click();
  await expect(wordCard(page).getByRole('button', { name: /已收藏/ })).toHaveAttribute('aria-pressed', 'true');
  await wordCard(page).getByRole('button', { name: '关闭' }).click();
  await expect(wordCard(page)).toBeHidden();

  // 3. EN→ZH: one wrong, one right.
  await page.getByRole('link', { name: '英→中' }).click();
  await page.getByRole('button', { name: '写出 scholar 在这句里的意思' }).first().click();
  await submitAnswer(page, '学者');
  await expect(answer(page).getByText('参考答案')).toBeVisible();
  await answer(page).getByRole('button', { name: '知道了' }).click();
  await expect(page.getByRole('button', { name: /^scholar，书生/ }).first()).toHaveClass(/bad/);

  await page.getByRole('button', { name: '写出 dawn 在这句里的意思' }).first().click();
  await submitAnswer(page, '天刚亮');
  await expect(answer(page).getByText('✓ 正确')).toBeVisible();
  await answer(page).getByRole('button', { name: '继续' }).click();
  await expect(page.getByRole('button', { name: /^dawn，天刚亮/ }).first()).toHaveClass(/ok/);

  // 4. ZH→EN: one wrong.
  await page.getByRole('link', { name: '中→英' }).click();
  await page.getByRole('button', { name: /写出“包袱”的英文/ }).first().click();
  await submitAnswer(page, 'bundel');
  await expect(answer(page).getByText('参考答案')).toBeVisible();
  await answer(page).getByRole('button', { name: '知道了' }).click();

  // Move on to chapter 2 so the saved position is not the default.
  await page.getByRole('link', { name: /下一章/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('第2章 拂尘');

  // 5. Reload from the library: position, saved word and errors are restored.
  await page.goto('/');
  await page.reload();
  await expect(page.getByRole('link', { name: /画皮/ })).toContainText('继续阅读 · 第2章');
  await page.getByRole('link', { name: /已收藏 1 个单词/ }).click();
  await expect(page.getByText('scholar', { exact: true })).toBeVisible();

  await page.goto('/#/read/builtin/huapi/01');
  await page.getByRole('button', { name: /^scholar，书生/ }).first().click();
  await expect(wordCard(page).getByText('答错 1 次')).toBeVisible();
  await expect(wordCard(page).getByRole('button', { name: /已收藏/ })).toBeVisible();
});

test('a new English sentence in transfer mode', async ({ page }) => {
  await page.goto('/#/read/builtin/huapi/01?mode=transfer');
  const first = page.locator('.transfer-item').first();
  await expect(first).toContainText('She is a respected');
  await first.getByRole('textbox').fill('scholar');
  await first.getByRole('button', { name: '检查' }).click();
  await expect(first.getByText('✓ 正确')).toBeVisible();
});

test('我的书库 shows an imported book with its own annotations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /演示书/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('第一章 雨夜');
  const chips = page.getByRole('button', { name: /^letter，信/ });
  await expect(chips).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^trust，相信/ })).toHaveCount(2);
  // Untagged text is shown exactly as in the source file.
  await expect(page.locator('.para').nth(1)).toContainText('上没有名字，只有一行字：别');
});

// v0.1 acceptance flow, steps 6–7.
test('errors and saved words are due the next day, and export/import restores state', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T10:00:00') });

  // One wrong answer and one saved word on day 1.
  await page.goto('/#/read/builtin/huapi/01?mode=en2zh');
  await page.getByRole('button', { name: '写出 scholar 在这句里的意思' }).first().click();
  await submitAnswer(page, '学者');
  await answer(page).getByRole('button', { name: '知道了' }).click();
  await page.goto('/#/read/builtin/huapi/01');
  await page.getByRole('button', { name: /^dawn，天刚亮/ }).first().click();
  await wordCard(page).getByRole('button', { name: /收藏/ }).click();
  await wordCard(page).getByRole('button', { name: '关闭' }).click();

  // Same day: nothing due yet.
  await page.goto('/');
  await expect(page.getByText('今天没有要复习的单词。还有 2 个单词会在之后几天复习。')).toBeVisible();

  // 6. Next morning both are due; review them.
  await page.clock.setSystemTime(new Date('2026-10-26T09:00:00'));
  await page.reload();
  await page.getByRole('link', { name: /今日复习 · 2 个单词/ }).click();
  const answers = { scholar: '书生', dawn: '天刚亮' };
  for (let n = 0; n < 2; n += 1) {
    const shown = (await page.locator('.review-card h1').textContent()).trim();
    await expect(page.locator('.review-card .context mark')).toHaveText(shown);
    await page.getByLabel('中文意思').fill(answers[shown]);
    await page.getByRole('button', { name: '提交' }).click();
    await expect(page.getByText('✓ 正确')).toBeVisible();
    await page.getByRole('button', { name: '下一个' }).click();
  }
  await expect(page.getByRole('heading', { name: '今天的复习完成了' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /今日复习/ })).toHaveCount(0);
  await expect(page.locator('.stats div', { hasText: '阅读天数' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.stats div', { hasText: '答题正确率' }).locator('dd')).toHaveText('67%（2/3）');

  // 7. Export, clear storage, import: the state matches.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出进度' }).click();
  const file = await (await download).path();
  const json = await readFile(file, 'utf8');
  expect(JSON.parse(json).app).toBe('cliffword');
  expect(json).not.toContain('太原有个');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText('还没有收藏单词')).toBeVisible();
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.getByText('已导入备份。')).toBeVisible();
  await expect(page.getByRole('link', { name: '已收藏 1 个单词 →' })).toBeVisible();
  await expect(page.getByText('今天没有要复习的单词。还有 2 个单词会在之后几天复习。')).toBeVisible();
  await expect(page.locator('.stats div', { hasText: '答题正确率' }).locator('dd')).toHaveText('67%（2/3）');
});

test('the shelf sorts books into categories and read states, as a grid or a list', async ({ page }) => {
  await page.goto('/');
  const shelf = page.locator('.shelf');
  await expect(shelf.locator('.books-grid .cover')).toHaveCount(2);
  await expect(shelf.getByRole('button', { name: '我的书库 1' })).toBeVisible();

  // Reading 画皮 moves it to 在读.
  await expect(shelf.getByRole('link', { name: /画皮/ })).toContainText('未读 · 0/3 章');
  await page.goto('/#/read/builtin/huapi/01');
  await page.getByRole('link', { name: /下一章/ }).click();
  await page.goto('/');
  await expect(shelf.getByRole('link', { name: /画皮/ })).toContainText('在读 · 1/3 章');

  // Give the imported book a category and mark it read.
  await shelf.getByRole('button', { name: '整理《演示书》' }).click();
  const dialog = page.locator('#shelf-edit');
  await dialog.getByLabel('分类').fill('小说');
  await dialog.getByLabel('标为已读').check();
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(shelf.getByRole('link', { name: /演示书/ })).toContainText('小说 · 本机');
  await expect(shelf.getByRole('link', { name: /演示书/ })).toContainText('已读 · 0/1 章');

  await shelf.getByRole('button', { name: '小说 1' }).click();
  await expect(shelf.locator('.book')).toHaveCount(1);
  await shelf.getByRole('button', { name: '全部 2' }).first().click();
  await shelf.getByRole('button', { name: '在读 1' }).click();
  await expect(shelf.locator('.book-title')).toHaveText(['画皮']);

  // Filters and the list view are remembered.
  await shelf.getByRole('button', { name: '列表' }).click();
  await page.reload();
  await expect(shelf.locator('.books-list')).toBeVisible();
  await expect(shelf.locator('.cover').first()).toBeHidden();
  await expect(shelf.getByRole('button', { name: '在读 1' })).toHaveAttribute('aria-pressed', 'true');
});

test('a large shelf can be searched, sorted and paged', async ({ page }) => {
  // 30 imported books, served in place of the fixture index.
  const books = Array.from({ length: 30 }, (_, i) => ({
    id: `book-${String(i + 1).padStart(2, '0')}`, title: `第${String(i + 1).padStart(2, '0')}本书`,
    chapters: i + 1, category: i % 2 ? '小说' : '历史', addedAt: new Date(2026, 0, i + 1).toISOString(),
  }));
  await page.route('**/library/index.json', (route) => route.fulfill({ json: { books } }));
  await page.goto('/');
  const shelf = page.locator('.shelf');
  const titles = shelf.locator('.book-title');

  // 31 books (30 + 画皮) at 24 a page; never-read books sort by title.
  await expect(shelf.locator('.shelf-count')).toHaveText('共 31 本 · 第 1–24 本 · 第 1/2 页');
  await expect(titles).toHaveCount(24);
  await shelf.getByRole('button', { name: '第 2 页' }).click();
  await expect(titles).toHaveCount(7);
  await expect(shelf.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page');
  await expect(shelf.getByRole('button', { name: '下一页 ›' })).toBeDisabled();

  // Page size, then sort by length, longest first, and flip it.
  await shelf.getByLabel('每页', { exact: true }).selectOption('12');
  await expect(shelf.locator('.shelf-count')).toHaveText('共 31 本 · 第 1–12 本 · 第 1/3 页');
  await shelf.getByLabel('排序', { exact: true }).selectOption('length');
  await expect(titles.first()).toHaveText('第30本书');
  await shelf.getByRole('button', { name: /排序方向/ }).click();
  await expect(titles.first()).toHaveText('第01本书');

  // Search narrows and resets to page 1; filters combine with it.
  await shelf.getByRole('button', { name: '第 3 页' }).click();
  await shelf.getByLabel('搜索', { exact: true }).fill('book-1');
  await expect(shelf.locator('.shelf-count')).toHaveText('找到 10 本（共 31 本） · 第 1–10 本 · 第 1/1 页');
  await expect(shelf.locator('.pager')).toHaveCount(0);
  await shelf.getByRole('button', { name: '小说 5' }).click();
  await expect(titles).toHaveCount(5);
  await shelf.getByLabel('搜索', { exact: true }).fill('没有这本书');
  await shelf.getByRole('button', { name: '清除搜索和筛选' }).click();
  await expect(shelf.locator('.shelf-count')).toHaveText('共 31 本 · 第 1–12 本 · 第 1/3 页');

  // Reading a book puts it first under 最近阅读, and the shelf remembers its settings.
  await shelf.getByLabel('排序', { exact: true }).selectOption('recent');
  await page.goto('/#/read/builtin/huapi/01');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('第1章 包袱');
  await page.goto('/');
  await expect(titles.first()).toHaveText('画皮');
  await expect(shelf.getByLabel('每页', { exact: true })).toHaveValue('12');
});

test('the shelf URL keeps its state for Back and bookmarks', async ({ page }) => {
  const books = Array.from({ length: 30 }, (_, i) => ({
    id: `book-${String(i + 1).padStart(2, '0')}`, title: `第${String(i + 1).padStart(2, '0')}本书`, chapters: i + 1, category: '小说',
  }));
  await page.route('**/library/index.json', (route) => route.fulfill({ json: { books } }));
  await page.goto('/');
  const shelf = page.locator('.shelf');
  const count = shelf.locator('.shelf-count');

  await shelf.getByRole('button', { name: '第 2 页' }).click();
  await expect(page).toHaveURL(/#\/\?page=2$/);
  await shelf.getByRole('link', { name: /第25本书/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goBack();
  await expect(count).toHaveText('共 31 本 · 第 25–31 本 · 第 2/2 页');
  await page.goBack();
  await expect(count).toHaveText('共 31 本 · 第 1–24 本 · 第 1/2 页');

  // A bookmarked view opens exactly as saved.
  await page.goto('/#/?q=book-0&sort=title&dir=desc&view=list');
  await expect(shelf.getByLabel('搜索', { exact: true })).toHaveValue('book-0');
  await expect(shelf.locator('.books-list .book-title').first()).toHaveText('第09本书');
  await expect(count).toHaveText('找到 9 本（共 31 本） · 第 1–9 本 · 第 1/1 页');
});

test('a finished book starts again from chapter 1, and old reading history still counts as read', async ({ page }) => {
  // Progress saved before reading times were kept: a position with no `at`.
  await page.addInitScript(() => {
    if (localStorage.getItem('cliffword:v1')) return;
    localStorage.setItem('cliffword:v1', JSON.stringify({
      version: 1, positions: { 'builtin/huapi': { chapter: '03', chapterNumber: 3, paragraph: 2 } },
      stats: { nextChapter: {}, completed: { 'builtin/huapi': ['01', '02', '03'] }, days: [] },
    }));
  });
  await page.goto('/');
  const card = page.locator('.shelf').getByRole('link', { name: /画皮/ });
  await expect(card).toContainText('已读完 · 从头再读');
  await expect(page.locator('.shelf .book-title').first()).toHaveText('画皮');
  await card.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('第1章 包袱');
});
