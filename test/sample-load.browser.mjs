// 브라우저 회귀 점검 — 「가상 샘플 규정 넣기」가 누른 화면에 머무는지 (2026-09-30 패들릿 오류 신고)
// 실행: PLAYWRIGHT_CORE=<playwright-core 폴더> CHROME=<크롬 실행 파일> node test/sample-load.browser.mjs [주소]
//   주소를 빼면 이 리포의 index.html 을 file:// 로 엽니다. 라이브 점검은 https://aebonlee.github.io/data09-26/?cb=난수
// playwright-core 는 리포에 넣지 않았습니다(폐쇄망 도구라 의존성 0 유지). 없으면 건너뜁니다.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_CORE;
const chrome = process.env.CHROME;
if (!pwPath || !chrome || !existsSync(chrome)) { console.log('건너뜀 — PLAYWRIGHT_CORE · CHROME 를 지정해 주세요.'); process.exit(0); }
const { chromium } = require(pwPath);
const base = process.argv[2] || new URL('../index.html', import.meta.url).href;

let failed = 0;
function check(name, cond, detail) { console.log((cond ? '  ok  ' : '  FAIL ') + name + (cond ? '' : '\n       ' + detail)); if (!cond) failed++; }

const browser = await chromium.launch({ executablePath: chrome });
async function fresh(hash) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + (hash || ''));
  await p.waitForSelector('#main h1');
  return { p, ctx, errs };
}
const state = (p) => p.evaluate(() => ({
  hash: location.hash, title: document.title,
  chip: document.getElementById('dataChip').textContent,
  note: (document.querySelector('.sample-loaded') || {}).innerText || '',
  table: !!Array.from(document.querySelectorAll('#main h2')).find((e) => /넣어 둔 문서/.test(e.textContent)),
  examples: document.querySelectorAll('#main .fup, #main button').length
}));

// 1) 처음 연 화면(주소 비어 있음 → ② 지식 문서)에서 「가상 샘플 규정으로 시작」
{
  const { p, ctx, errs } = await fresh('');
  await p.getByRole('button', { name: '가상 샘플 규정으로 시작' }).click();
  await p.waitForTimeout(300);
  const s = await state(p);
  check('처음 화면의 「시작」 → ② 지식 문서에 머묾', s.title.startsWith('지식 문서') && s.hash === '#/docs', JSON.stringify(s));
  check('넣은 결과 확인 상자(새로 8개)와 문서 표가 보임', /새로 8개/.test(s.note) && s.table, JSON.stringify(s));
  // 2) 이미 들어 있을 때 ② 의 「가상 샘플 규정 넣기」 — 패들릿 신고와 같은 상태(문서 8개)
  await p.evaluate(() => { location.hash = '#/docs'; }); await p.waitForTimeout(300);
  await p.getByRole('button', { name: '가상 샘플 규정 넣기' }).click();
  await p.waitForTimeout(300);
  const s2 = await state(p);
  check('② 「가상 샘플 규정 넣기」 → ② 에 머묾(질문하기로 넘어가지 않음)', s2.title.startsWith('지식 문서') && s2.hash === '#/docs', JSON.stringify(s2));
  check('다시 넣으면 「이미 있던 8개는 원본으로 다시 넣음」, 문서 수 그대로', /이미 있던 8개/.test(s2.note) && /문서 8개/.test(s2.chip), JSON.stringify(s2));
  // 3) 확인 상자의 버튼으로 ① 에 가면 예시 질문이 보이고, 상자는 다시 ② 에 와도 남지 않음
  await p.getByRole('link', { name: '① 질문하기에서 예시 질문 보기' }).click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(300);
  const s3 = await state(p);
  check('확인 상자 → ① 질문하기', s3.hash === '#/ask', JSON.stringify(s3));
  await p.evaluate(() => { location.hash = '#/docs'; }); await p.waitForTimeout(300);
  check('다른 화면에 다녀오면 확인 상자는 닫힘', !(await state(p)).note, '');
  check('JS 오류 없음', errs.length === 0, errs.join(' / '));
  await ctx.close();
}
// 4) 형제 버튼 — ① 질문하기 · ④ 골든셋의 빈 상태 「시작」은 각각 그 화면에 머묾
for (const [hash, t] of [['#/ask', '질문하기'], ['#/eval', '골든셋 점검']]) {
  const { p, ctx, errs } = await fresh(hash);
  await p.getByRole('button', { name: '가상 샘플 규정으로 시작' }).click();
  await p.waitForTimeout(300);
  const s = await state(p);
  check(hash + ' 빈 상태 「시작」 → ' + t + ' 에 머묾', s.hash === hash && s.title.startsWith(t) && /문서 8개/.test(s.chip), JSON.stringify(s));
  check(hash + ' JS 오류 없음', errs.length === 0, errs.join(' / '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exitCode = failed ? 1 : 0;
