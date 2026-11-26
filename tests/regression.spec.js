import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 計算の回帰テストはデータ駆動で行う。
// tests/groups.json に、あり得る540通りを層化ランダムで分けた
// グループA〜J（各54通り）が入っている。期待値も一緒に入っている。
// どのグループを回すかは環境変数 TEST_GROUP で選ぶ。
//   TEST_GROUP=A   … グループAの54通りだけ回す（ふだんはこれ）
//   TEST_GROUP=ALL … 540通り全部回す（初めての自動テストのときだけ）
// 決めていないときは A を回す。GitHub Actions では workflow の
// TEST_GROUP を見て、回すグループを切り替える。
const groups = JSON.parse(readFileSync(new URL('./groups.json', import.meta.url), 'utf8'));
const groupName = process.env.TEST_GROUP || 'A';
const cases =
  groupName === 'ALL'
    ? Object.entries(groups).flatMap(([g, list]) => list.map((c) => ({ ...c, group: g })))
    : (groups[groupName] || []).map((c) => ({ ...c, group: groupName }));
if (cases.length === 0) throw new Error(`TEST_GROUP が正しくありません: ${groupName}`);

// テスト対象はリポジトリ直下の index.html。
// GitHub Actions でもローカルでも、同じファイルを開く。
const APP_URL = `file://${process.cwd()}/index.html`;

// 親・子 / ロン・ツモ / 符 / 翻 を選ぶ共通の操作。
// 符と翻は data-fu / data-han 属性で指定する（座標では指定しない）。
async function select(page, { dealer, tsumo, fu, han }) {
  await page.click(dealer ? '#btn-dealer' : '#btn-child');
  await page.click(tsumo ? '#btn-tsumo' : '#btn-ron');
  await page.locator(`#fu-chips button[data-fu="${fu}"]`).click();
  await page.locator(`#han-chips button[data-han="${han}"]`).click();
}

const fmt = (n) => n.toLocaleString('en-US');

test.describe(`計算（グループ${groupName}・${cases.length}通り）`, () => {
  for (const c of cases) {
    const who = `${c.dealer ? '親' : '子'}・${c.tsumo ? 'ツモ' : 'ロン'}・${c.fu}符・${c.han}翻`;
    test(`${who} = ${fmt(c.total)}点`, async ({ page }) => {
      await page.goto(APP_URL);
      await select(page, c);
      await expect(page.locator('#score-main')).toContainText(fmt(c.total));
      if (c.name) {
        await expect(page.locator('#hand-name')).toHaveText(c.name);
      } else {
        await expect(page.locator('#hand-name')).toBeEmpty();
      }
      if (c.tsumo && c.dealer) {
        await expect(page.locator('#tsumo-detail')).toContainText(`${fmt(c.each)}点オール`);
      }
      if (c.tsumo && !c.dealer) {
        await expect(page.locator('#tsumo-detail')).toContainText(fmt(c.fromChild));
        await expect(page.locator('#tsumo-detail')).toContainText(fmt(c.fromDealer));
      }
    });
  }
});

test.describe('ロジック制御', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('20符を選ぶと1翻は選べなくなり、1翻のままなら2翻に動く', async ({ page }) => {
    await page.click('#btn-child');
    await page.click('#btn-tsumo');
    await page.locator('#han-chips button[data-han="1"]').click();
    await page.locator('#fu-chips button[data-fu="20"]').click();
    // 1翻ボタンが無効になり、2翻が選ばれた状態になる
    await expect(page.locator('#han-chips button[data-han="1"]')).toBeDisabled();
    await expect(page.locator('#han-chips button[data-han="2"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('25符を選ぶと1翻は選べなくなる', async ({ page }) => {
    await page.click('#btn-child');
    await page.click('#btn-tsumo');
    await page.locator('#fu-chips button[data-fu="25"]').click();
    await expect(page.locator('#han-chips button[data-han="1"]')).toBeDisabled();
  });

  test('ロンのとき20符は選べない', async ({ page }) => {
    await page.click('#btn-child');
    await page.click('#btn-ron');
    await expect(page.locator('#fu-chips button[data-fu="20"]')).toBeDisabled();
  });

  test('ツモで20符を選んでロンに切り替えると30符に動く', async ({ page }) => {
    await select(page, { dealer: false, tsumo: true, fu: 20, han: 2 });
    await page.click('#btn-ron');
    await expect(page.locator('#fu-chips button[data-fu="30"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#fu-chips button[data-fu="20"]')).toBeDisabled();
  });

  test('5翻以上でも符は選べるが、点数は満貫で変わらない', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 30, han: 5 });
    await expect(page.locator('#score-main')).toContainText('8,000');
    await expect(page.locator('#fu-chips button[data-fu="110"]')).toBeEnabled();
    await page.locator('#fu-chips button[data-fu="110"]').click();
    await expect(page.locator('#score-main')).toContainText('8,000');
  });
});

test.describe('表示とリセット', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('初期状態は結果が空（入力Clearを押した状態と同じ）', async ({ page }) => {
    await expect(page.locator('#score-main')).toBeEmpty();
    await expect(page.locator('#bd-base')).toBeEmpty();
    await expect(page.locator('#panel-table4 .guide-cross')).toHaveCount(0);
  });

  test('入力Clearを押すと結果とハイライトが消える', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 30, han: 3 });
    await expect(page.locator('#score-main')).toContainText('3,900');
    await page.click('#btn-clear');
    await expect(page.locator('#score-main')).toBeEmpty();
    await expect(page.locator('#panel-table4 .guide-cross')).toHaveCount(0);
  });

  test('入力に合わせて早見表に金のガイド線が出る', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 30, han: 3 });
    // 広い画面用の表と狭い画面用の表の両方にガイド線が出る（片方は非表示）
    await expect(page.locator('#panel-table4 .score-wide .guide-cross')).toHaveCount(1);
    await expect(page.locator('#panel-table4 td.is-highlight')).not.toHaveCount(0);
  });

  test('満貫以上のとき右下に役名が出る', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 40, han: 4 });
    await expect(page.locator('#hand-name')).toHaveText('満貫');
  });
});

test.describe('満貫切り上げスイッチ（#2の仕様）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
  });

  test('切り上げON・子・30符4翻で役名「満貫」が出て8,000点になる', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 30, han: 4 });
    await expect(page.locator('#score-main')).toContainText('7,700');
    await expect(page.locator('#btn-mangan')).toBeEnabled();
    await page.click('#btn-mangan');
    await expect(page.locator('#score-main')).toContainText('8,000');
    // #1のQAで見つかった「子の役名が出ない」不具合の再発防止
    await expect(page.locator('#hand-name')).toHaveText('満貫');
  });

  test('対象外のパターンではスイッチがグレーアウトして押せない', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 30, han: 3 });
    await expect(page.locator('#btn-mangan')).toBeDisabled();
  });

  test('ONのまま対象外に移っても状態が保持され、対象に戻るとまた効く', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 30, han: 4 });
    await page.click('#btn-mangan');
    await expect(page.locator('#score-main')).toContainText('8,000');
    await page.locator('#han-chips button[data-han="3"]').click();
    // 対象外ではグレーアウトするが、ONの表示は残る（勝手にOFFに戻らない）
    await expect(page.locator('#btn-mangan')).toBeDisabled();
    await expect(page.locator('#mangan-btn-text')).toContainText('ON');
    await expect(page.locator('#score-main')).toContainText('3,900');
    await page.locator('#han-chips button[data-han="4"]').click();
    await expect(page.locator('#score-main')).toContainText('8,000');
    await expect(page.locator('#hand-name')).toHaveText('満貫');
  });

  // 切り上げ対象は30符4翻と60符3翻の8パターン（親子×ロン/ツモ）。
  // 30符4翻も60符3翻も基本点は1,920で同じなので、点数は一致する。
  const kiriageCases = [
    { dealer: false, tsumo: false, fu: 30, han: 4, off: 7700, on: 8000 },
    { dealer: false, tsumo: true, fu: 30, han: 4, off: 7900, on: 8000, fromChild: 2000, fromDealer: 4000 },
    { dealer: true, tsumo: false, fu: 30, han: 4, off: 11600, on: 12000 },
    { dealer: true, tsumo: true, fu: 30, han: 4, off: 11700, on: 12000, each: 4000 },
    { dealer: false, tsumo: false, fu: 60, han: 3, off: 7700, on: 8000 },
    { dealer: false, tsumo: true, fu: 60, han: 3, off: 7900, on: 8000, fromChild: 2000, fromDealer: 4000 },
    { dealer: true, tsumo: false, fu: 60, han: 3, off: 11600, on: 12000 },
    { dealer: true, tsumo: true, fu: 60, han: 3, off: 11700, on: 12000, each: 4000 },
  ];
  for (const c of kiriageCases) {
    const who = `${c.dealer ? '親' : '子'}・${c.tsumo ? 'ツモ' : 'ロン'}・${c.fu}符・${c.han}翻`;
    test(`切り上げON: ${who} は ${fmt(c.off)}点 → ${fmt(c.on)}点（満貫）になる`, async ({ page }) => {
      await select(page, c);
      await expect(page.locator('#score-main')).toContainText(fmt(c.off));
      await expect(page.locator('#btn-mangan')).toBeEnabled();
      await page.click('#btn-mangan');
      await expect(page.locator('#score-main')).toContainText(fmt(c.on));
      await expect(page.locator('#hand-name')).toHaveText('満貫');
      if (c.tsumo && c.dealer) {
        await expect(page.locator('#tsumo-detail')).toContainText(`${fmt(c.each)}点オール`);
      }
      if (c.tsumo && !c.dealer) {
        await expect(page.locator('#tsumo-detail')).toContainText(fmt(c.fromChild));
        await expect(page.locator('#tsumo-detail')).toContainText(fmt(c.fromDealer));
      }
    });
  }

  test('切り上げONで早見表4の対象セルが「満貫」表記になり、OFFで数字に戻る', async ({ page }) => {
    await select(page, { dealer: false, tsumo: false, fu: 30, han: 4 });
    const cell = page.locator('#panel-table4 .score-wide td.guide-cross');
    await expect(cell).toContainText('7,700');
    await page.click('#btn-mangan');
    // F-01の決定：切り上げが効いている間、対象セルは数字ではなく「満貫」と表示する
    await expect(cell).toContainText('満貫');
    await page.click('#btn-mangan');
    await expect(cell).toContainText('7,700');
  });
});
