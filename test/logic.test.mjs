// 실행: node test/logic.test.mjs   (의존성 없음 — vendor 의 JSZip 만 씀)
// 모든 문서·숫자는 가상 샘플입니다(js/sample-data.js). 실제 규정 원문은 리포에 없습니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const S = require('../js/sample-data.js');
const E = require('../js/ai-endpoint.js');
const JSZip = require('../vendor/jszip.min.js');

let passed = 0;
const pending = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { pending.push(r.then(() => { passed++; console.log('  ok  ' + name); }, (e) => { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; })); return; }
    passed++; console.log('  ok  ' + name);
  } catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const TODAY = '2026-09-30';
function sampleDb() { const db = L.emptyDb(); S.DOCS.forEach((d) => L.upsertDoc(db, d)); return db; }
const ids = (db, code) => db.chunks.filter((c) => c.docCode === code).map((c) => c.label);

console.log('조항 나누기');
test('조문형 — 제N조·①항 단위, 첫 항이 조 제목과 같은 줄이어도 나눔, 부칙 조는 「부칙」 머리', () => {
  const db = sampleDb();
  assert.deepEqual(ids(db, 'ALP-EM-2025'), ['제1조', '제2조 ①', '제2조 ②', '제2조 ③', '제3조 ①', '제3조 ②', '제3조 ③', '제4조 ①', '제4조 ②', '제5조', '제6조', '제7조', '부칙 제1조', '부칙 제2조']);
  const c = db.chunks.find((x) => x.id === 'ALP-EM-2025 제3조 ②');
  assert.equal(c.title, '배출 허용 기준');
  assert.equal(c.path, '제2장 배출 허용 기준');
});
test('조문형 — 각 호(1. 2. …)는 조를 쪼개지 않고 그 조 안에 남음', () => {
  const c = sampleDb().chunks.find((x) => x.id === 'ALP-EM-2025 제5조');
  assert.match(c.text, /1\. 인증 신청서/);
  assert.match(c.text, /4\. 배출가스 저감장치 내구성 자료/);
});
test('절 번호형 — 3.1 단위, 상위 절 제목을 위치로, 제목만 있는 절은 조각을 만들지 않음, 부속서 A.1', () => {
  const db = sampleDb();
  assert.deepEqual(ids(db, 'GAM-EMC-2025'), ['1', '2.1', '3.1', '3.2', '4.1', '4.2', 'A.1', 'A.2']);
  assert.equal(db.chunks.find((x) => x.id === 'GAM-EMC-2025 3.1').path, '3 내성');
  assert.equal(db.chunks.find((x) => x.id === 'GAM-EMC-2025 A.1').path, '부속서 A 시험 배치');
  assert.equal(L.splitUnits(S.DOCS.find((d) => d.code === 'BET-NS-2023').text).mode, 'section');
});
test('숫자로 시작하는 본문 줄(「3.3 g/kWh 이하」)은 절 제목으로 보지 않음', () => {
  const r = L.chunkDocument('1 범위\n기준을 정한다.\n2 한도\n2.1 질소산화물\n배출량은\n3.3 g/kWh 이하이어야 한다.', 'T');
  assert.deepEqual(r.chunks.map((c) => c.label), ['1', '2.1']);
  assert.match(r.chunks[1].text, /3\.3 g\/kWh/);
});
test('제목형(Markdown) · 조항 표시가 없으면 문단형', () => {
  const db = sampleDb();
  assert.equal(ids(db, 'INT-FAQ-2026').length, 4);
  assert.ok(ids(db, 'INT-FAQ-2026')[2].startsWith('Q3.'));
  const p = L.chunkDocument('회신 메일 정리입니다. 수출 문의는 인증팀으로 보냅니다.\n\n두 번째 문단입니다. 서류는 4주 걸립니다.', 'M');
  assert.equal(p.mode, 'para');
  assert.equal(p.chunks.length, 1);
});
test('쪽 표시([[p.N]])를 조각의 쪽으로 옮기고 본문에서는 뺌', () => {
  const r = L.chunkDocument('[[p.1]]\n제1조(목적) 목적을 정한다.\n[[p.2]]\n제2조(범위) ① 굴착기에 적용한다.\n② 수출용은 뺀다.', 'P');
  assert.deepEqual(r.chunks.map((c) => [c.label, c.page]), [['제1조', 1], ['제2조 ①', 2], ['제2조 ②', 2]]);
  assert.ok(!/\[\[p/.test(r.chunks.map((c) => c.text).join('')));
});
test('아주 긴 조는 문장 경계에서 (1/2) (2/2) 로 나누고 ID 가 겹치지 않음', () => {
  const long = '제8조(짧은 조) 짧은 조항이다.\n제9조(긴 조) ' + Array.from({ length: 60 }, (_, i) => '문장 ' + i + ' 은 시험 조건을 설명한다.').join(' ');
  const r = L.chunkDocument(long, 'LONG', { maxChars: 400 });
  assert.ok(r.chunks.length >= 3);
  assert.ok(r.chunks.every((c) => c.text.length <= 400));
  assert.equal(new Set(r.chunks.map((c) => c.id)).size, r.chunks.length);
  assert.match(r.chunks[1].label, /^제9조 \(1\/\d+\)$/);
});

console.log('BM25 · 검색');
test('토큰 — 한글은 두 글자씩, 영문·숫자는 통째로', () => {
  const t = L.tokenize('굴착기의 ROPS 0.020 g/kWh');
  assert.ok(t.includes('굴착') && t.includes('착기') && t.includes('rops') && t.includes('0.020'));
});
test('BM25 — 질문에 맞는 조항이 1순위, 흔한 낱말만 겹치는 조항은 아래', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  const r = L.bm25Search(ix, '후방 카메라 시야');
  assert.match(r[0].id, /^BET-SF-2024 제4조/);
  const r2 = L.bm25Search(ix, 'FOPS 등급');
  assert.equal(r2[0].id, 'BET-SF-2024 제3조 ②');
  assert.ok(r2.every((x, i) => i === 0 || x.score <= r2[i - 1].score));
});
test('BM25 — 드문 낱말(IDF 높음)이 흔한 낱말보다 무겁다', () => {
  const ix = L.buildIndex([
    // IDF 가 없으면 「기준」을 여섯 번 쓴 a 가 이긴다 — 드문 「풍속」을 가진 b 가 1순위여야 한다
    { id: 'a', text: '기준 기준 기준 기준 기준 기준' }, { id: 'b', text: '풍속 설명 설명 설명 설명 설명' }, { id: 'c', text: '기준 정한다' }, { id: 'd', text: '기준 표시' }
  ]);
  assert.equal(L.bm25Search(ix, '기준 풍속')[0].id, 'b');
});
test('BM25 — 허용 목록(메타데이터 필터) 밖 조각은 나오지 않고, 빈 질문은 결과 없음', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  const al = L.allowedChunks(db, { country: '베타국(가상)', field: '안전' }, L.defaultSettings());
  const r = L.bm25Search(ix, '시험 성적서 보관', al.map);
  assert.ok(r.every((x) => x.id.startsWith('BET-SF-2024')));
  assert.deepEqual(L.bm25Search(ix, '   ?! '), []);
});
test('RRF · 코사인 — 두 순위를 합치면 양쪽에서 높은 것이 1순위', () => {
  const m = L.rrf([[{ id: 'x' }, { id: 'y' }, { id: 'z' }], [{ id: 'y' }, { id: 'x' }, { id: 'q' }]]);
  assert.deepEqual(m.slice(0, 2).map((r) => r.id).sort(), ['x', 'y']);
  assert.equal(m[m.length - 1].id === 'z' || m[m.length - 1].id === 'q', true);
  assert.equal(L.cosine([1, 0], [1, 0]), 1);
  assert.equal(L.cosine([1, 0], [0, 1]), 0);
});

console.log('조건 읽기 · 근거 판정(Gate)');
test('질문에서 국가·분야 읽기, 지식베이스에 없는 실제 국가는 따로 표시', () => {
  const cs = L.countries(sampleDb());
  assert.deepEqual(L.detectSlots('알파국에서 굴착기 배출 기준은?', cs), { country: '알파국(가상)', unknownCountry: null, field: '배출가스' });
  const d = L.detectSlots('독일 EMC 요건', cs);
  assert.equal(d.unknownCountry, '독일'); assert.equal(d.field, 'EMC');
  assert.equal(L.detectSlots('기능안전 평가 자료', cs).field, '기능안전');
});
test('골든셋 — 정답 조항 Recall@5 100%, 답이 없는 질문 거절 100%', () => {
  const db = sampleDb(), g = L.runGolden(db, L.buildIndex(db.chunks), S.GOLDEN, { today: TODAY });
  assert.equal(g.recall, 1, g.rows.filter((r) => !r.ok).map((r) => r.q).join(', '));
  assert.equal(g.refusal, 1, g.rows.filter((r) => !r.ok).map((r) => r.q).join(', '));
});
test('근거 없음 — 도구가 고정 문구를 내고 프롬프트를 만들지 않음(AI 를 부르지 않음)', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  for (const q of ['독일에서 굴착기 배출가스 기준은?', '베타국 크레인 풍속 제한은?', '알파국 소음 표시 기준은?', '']) {
    const r = L.ask(db, ix, q, { today: TODAY });
    assert.equal(r.gate.status, 'insufficient', q);
    assert.equal(r.prompt, '');
    assert.ok(r.refusal.startsWith(L.REFUSAL));
  }
});
test('구버전 문서는 기본 검색에서 빠지고, 설정에서 켜면 「구버전」 주의와 함께 나옴', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  const q = '알파국 입자상물질 배출량 기준';
  assert.ok(!L.ask(db, ix, q, { today: TODAY }).evidence.some((e) => e.doc.code === 'ALP-EM-2021'));
  db.settings.includeOld = true;
  const old = L.ask(db, ix, q, { today: TODAY }).evidence.find((e) => e.doc.code === 'ALP-EM-2021');
  assert.ok(old && old.flags.includes('구버전'));
});
test('시행 전 문서 · 오래된 문서에 주의 표시', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  const r = L.ask(db, ix, '감마연합 EMC 방사 내성 전계 세기는?', { today: TODAY });
  assert.ok(r.evidence[0].flags.some((f) => f.startsWith('시행 전(2027-01-01')));
  assert.match(r.prompt, /주의: 시행 전/);
  assert.ok(L.docFlags({ revised: '2019-01-01', status: '운영' }, TODAY, 3).some((f) => f.startsWith('오래된 자료')));
});
test('되묻기 — 국가 없이 물었는데 여러 나라 근거가 비슷하면 답 전에 국가를 물음', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  const r = L.ask(db, ix, '시험 성적서 보관 기간은?', { today: TODAY });
  assert.equal(r.gate.status, 'clarify');
  assert.ok(r.clarify.options.includes('베타국(가상)') && r.clarify.options.includes('감마연합(가상)'));
  assert.equal(r.prompt, '');
  const r2 = L.ask(db, ix, '시험 성적서 보관 기간은?', { today: TODAY, country: '베타국(가상)' });
  assert.equal(r2.gate.status, 'sufficient');
  assert.equal(r2.evidence[0].chunkId, 'BET-NS-2023 5.2');
});
test('공통(사내) 문서는 나라 조건이 있어도 함께 찾음', () => {
  const db = sampleDb(), al = L.allowedChunks(db, { country: '알파국(가상)' }, L.defaultSettings());
  assert.ok(Object.keys(al.map).some((id) => id.startsWith('INT-FAQ-2026')));
  assert.ok(!Object.keys(al.map).some((id) => id.startsWith('BET-')));
});
test('프롬프트 — 규칙·근거 번호·조항·개정일이 들어가고, 고른 근거 밖 조항은 없음', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  const r = L.ask(db, ix, '베타국 굴착기 ROPS 갖춰야 하는 운전 질량은?', { today: TODAY });
  assert.match(r.prompt, /\[근거\] 밖의 지식/);
  assert.match(r.prompt, new RegExp(L.REFUSAL));
  assert.match(r.prompt, /\[E1\] 문서: 베타국 건설기계 안전 요건 \(BET-SF-2024\) \| 조항: 제3조 ① 운전자 보호구조/);
  assert.match(r.prompt, /개정일: 2024-06-15/);
  assert.ok(!/ALP-EM|GAM-EMC/.test(r.prompt));
  assert.equal((r.prompt.match(/^\[E\d+\]/gm) || []).length, r.evidence.length);
});

console.log('답 사후 검증');
function evFor(q) { const db = sampleDb(); return L.ask(db, L.buildIndex(db.chunks), q, { today: TODAY }).evidence; }
test('모든 문장에 이번 근거 인용 + 숫자 일치 → 통과 (인용이 마침표 앞뒤 어디에 있어도)', () => {
  const ev = evFor('알파국에서 굴착기 입자상물질 배출 기준은?');
  const c = L.checkAnswer('56kW 이상 130kW 미만 엔진의 입자상물질 배출량은 0.020 g/kWh 이하입니다. [E1] 130kW 이상 엔진도 0.020 g/kWh 이하입니다[E3].\n- 이 기준은 굴착기에 적용됩니다 [E1, E4].', ev);
  assert.equal(c.verdict, 'pass');
  assert.equal(c.passed, 3);
  assert.deepEqual(c.sentences[2].cites, ['E1', 'E4']);
});
test('인용 없는 문장 · 근거에 없는 인용 · 근거에 없는 숫자 → 표시하고 사용자용 답에서 뺌', () => {
  const ev = evFor('알파국에서 굴착기 입자상물질 배출 기준은?');
  const c = L.checkAnswer('입자상물질은 0.020 g/kWh 이하입니다. [E1]\n시험은 매년 받아야 합니다.\n유효기간은 4년입니다. [E9]\n굴착기는 0.015 g/kWh 이하입니다. [E1]', ev);
  assert.equal(c.verdict, 'flagged');
  assert.deepEqual(c.sentences.map((s) => s.issues.length ? s.issues[0].split(':')[0] : ''), ['', '인용 없음', '이번 근거에 없는 인용', '인용한 근거에 없는 숫자']);
  assert.ok(!/0\.015|매년|4년/.test(c.safeText));
  assert.match(c.safeText, /0\.020/);
});
test('다른 조항의 숫자를 끌어다 인용만 붙여도 잡음(인용한 조항 안에서 대조)', () => {
  const ev = evFor('알파국에서 굴착기 입자상물질 배출 기준은?');
  // 0.35 는 제3조 ②(질소산화물)의 숫자 — 제3조 ①(E1)에는 없다
  const c = L.checkAnswer('입자상물질 배출량은 0.35 g/kWh 이하입니다. [E1]', ev);
  assert.equal(c.verdict, 'fail');
  assert.match(c.safeText, new RegExp(L.REFUSAL));
});
test('「근거 없음 — 인증팀 확인 필요」만 답하면 정직한 거절, 빈 답은 empty', () => {
  const ev = evFor('알파국에서 굴착기 입자상물질 배출 기준은?');
  assert.equal(L.checkAnswer(L.REFUSAL, ev).verdict, 'refused');
  assert.equal(L.checkAnswer('형식승인 면제: ' + L.REFUSAL + '\n입자상물질은 0.020 g/kWh 이하입니다 [E1]', ev).verdict, 'pass');
  assert.equal(L.checkAnswer('  \n ', ev).verdict, 'empty');
});

console.log('후속 질문 · 기록');
test('후속 질문은 모두 실제로 근거가 충분한 것만(Gate 재확인)', () => {
  const db = sampleDb(), ix = L.buildIndex(db.chunks);
  const r = L.ask(db, ix, '베타국 굴착기 ROPS 갖춰야 하는 운전 질량은?', { today: TODAY });
  const f = L.followups(db, ix, r, { today: TODAY });
  assert.ok(f.length >= 2);
  assert.ok(f.some((x) => x.type === '범위 확장' && /소음/.test(x.question)));
  for (const x of f) assert.equal(L.ask(db, ix, x.question, { today: TODAY, country: x.filters.country, field: x.filters.field, noClarify: true }).gate.status, 'sufficient', x.question);
});
test('기록 CSV — 머리행 · 판정 한글 · 쉼표 따옴표', () => {
  const db = sampleDb(), r = L.ask(db, L.buildIndex(db.chunks), '독일, 배출가스 기준은?', { today: TODAY, at: '2026-09-30 10:00' });
  const csv = L.toCsv(L.logToRows([L.logEntry(r, null)]));
  assert.ok(csv.startsWith('﻿시각,질문'));
  assert.match(csv, /"독일, 배출가스 기준은\?",,배출가스,근거 없음/);
});
test('저장 형식 되살리기 — 모르는 값은 기본값, 문서 없는 조각은 버림', () => {
  const d = L.restoreDb({ docs: [{ code: 'A' }], chunks: [{ id: 'A 1', docCode: 'A' }, { id: 'B 1', docCode: 'B' }], settings: { topK: 99, suffCoverage: 0.5, partCoverage: 0.9 }, golden: [{ q: 'x' }, {}] });
  assert.equal(d.chunks.length, 1);
  assert.equal(d.settings.topK, 5);
  assert.equal(d.settings.partCoverage, 0.5);
  assert.equal(d.golden.length, 1);
});
test('문서 코드 제안 — 파일 이름 앞 영문 코드를 쓰고 겹치면 번호', () => {
  assert.equal(L.suggestCode('ALP-EM-2025_알파국_기준.pdf', []), 'ALP-EM-2025');
  assert.equal(L.suggestCode('ALP-EM-2025_알파국_기준.pdf', [{ code: 'ALP-EM-2025' }]), 'ALP-EM-2025-2');
  assert.equal(L.suggestCode('회신 메일.txt', []), '회신-메일');
});

console.log('파일 글자 꺼내기');
test('PDF 글자 항목 → 줄(위에서 아래, 왼쪽에서 오른쪽) + 쪽 표시', () => {
  const t = L.pdfPagesToText([[
    { str: '한다.', x: 150, y: 700, w: 30, h: 10 }, { str: '제1조(목적) 이 기준을 정', x: 50, y: 700, w: 100, h: 10 },
    { str: '제2조(범위) 적용한다.', x: 50, y: 686, w: 100, h: 10 }
  ], [{ str: '제3조(표시) 붙인다.', x: 50, y: 700, w: 90, h: 10 }]]);
  assert.equal(t, '[[p.1]]\n제1조(목적) 이 기준을 정한다.\n제2조(범위) 적용한다.\n[[p.2]]\n제3조(표시) 붙인다.');
});
test('Word(.docx) 샘플 → 글과 같은 조각(표는 「칸 | 칸」 줄)', async () => {
  const buf = readFileSync(new URL('../samples/BET-SF-2024_베타국_안전_요건.docx', import.meta.url));
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
  const text = L.docxXmlToText(xml);
  assert.match(text, /ROPS \| 운전 질량 5톤 이상 굴착기/);
  const fromDocx = L.chunkDocument(text, 'BET-SF-2024').chunks.map((c) => c.label);
  const fromText = L.chunkDocument(S.DOCS.find((d) => d.code === 'BET-SF-2024').text, 'BET-SF-2024').chunks.map((c) => c.label);
  assert.deepEqual(fromDocx, fromText);
});

console.log('AI 연결(선택)');
test('임베딩 요청은 {Base URL}/embeddings, 응답은 index 순으로 정렬', () => {
  const req = E.buildEmbeddingRequest({ baseUrl: 'https://llm.example.com/v1/', apiKey: '' }, ['가', '나'], 'emb');
  assert.equal(req.url, 'https://llm.example.com/v1/embeddings');
  assert.ok(!req.init.headers.Authorization);
  assert.deepEqual(E.parseEmbeddingResponse({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }, 2), [[1], [2]]);
  assert.throws(() => E.parseEmbeddingResponse({ data: [{ index: 0, embedding: [1] }] }, 2));
});
test('자동 보내기 주소 점검 — https 페이지에서 http 사내 주소는 막고 file:// 에서는 허용', () => {
  const cfg = { baseUrl: 'http://10.0.0.5:8000/v1', model: 'm' };
  assert.equal(E.validateConfig(cfg, 'https:').errors.length, 1);
  assert.equal(E.validateConfig(cfg, 'file:').errors.length, 0);
});

await Promise.all(pending);
console.log(`\n${passed}개 통과`);
