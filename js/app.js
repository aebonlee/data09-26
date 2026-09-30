/* 인증법규 Agent — 화면
   계산은 js/logic.js(RegLogic), 파일 읽기는 js/readers.js, 저장은 js/store.js, AI 연결은 js/ai-endpoint.js·ai-panel.js. */
(function () {
  'use strict';
  var L = window.RegLogic, S = window.RegStore, SAMPLE = window.RegSample, R = window.RegReaders, AIP = window.AIPanel, E = window.AIEndpoint;
  var db = S.loadDb();
  var ui = { q: '', country: null, field: null, res: null, answer: '', check: null, fups: null, logAt: null, busy: false, pending: [], logFilter: 'all', open: {} };
  var main = document.getElementById('main');
  var index = null, indexKey = '';

  /* ── 작은 도구 ───────────────────────────── */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function fld(label, control, hint) {
    return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  var toastTimer = null;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function save() {
    var ok = S.saveDb(db);
    document.getElementById('storeNote').textContent = ok ? '이 브라우저에 저장됨 · ' + S.sizeKb() + 'KB' : '저장 안 됨(브라우저 저장소가 막혔거나 가득 참) — JSON 백업을 받아 두세요';
    return ok;
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function nowStr() { var d = new Date(); return today() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(t) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = t; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); toast(ok ? '복사했습니다.' : '복사하지 못했습니다. 글을 직접 선택해 복사해 주세요.', !ok);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { toast('복사했습니다.'); }, fallback);
    else fallback();
  }
  function idx() {
    var key = db.chunks.length + ':' + db.docs.map(function (d) { return d.code + d.chunkCount; }).join(',');
    if (!index || key !== indexKey) { index = L.buildIndex(db.chunks); indexKey = key; }
    return index;
  }
  function pageHead(stage, title, lead, right) {
    return h('div', { class: 'page-head' }, h('div', { class: 'titles' }, h('div', { class: 'stage' }, stage), h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null), right || null);
  }
  function table(head, rows, opts) {
    opts = opts || {};
    var t = h('table', { class: 'list' + (opts.cls ? ' ' + opts.cls : '') });
    t.appendChild(h('thead', null, h('tr', null, head.map(function (x, i) { return h('th', { scope: 'col', class: opts.num && opts.num[i] ? 'num' : null }, x); }))));
    t.appendChild(h('tbody', null, rows.map(function (r) {
      return h('tr', { class: r.cls || null }, (r.cells || r).map(function (x, i) { return h('td', { class: opts.num && opts.num[i] ? 'num' : null }, x); }));
    })));
    return h('div', { class: 'table-wrap' }, t);
  }
  function tile(k, v, sub) { return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'note' }, sub) : null); }
  var STATUS_TXT = { sufficient: '근거 충분', partial: '근거 일부', insufficient: '근거 없음', clarify: '되묻기' };
  var VERDICT_TXT = { pass: '검증 통과', flagged: '일부 문장 표시', fail: '전체 거절', refused: '근거 없음 답', empty: '답 없음' };
  function badge(status) { return h('span', { class: 'badge st-' + status }, STATUS_TXT[status] || status); }
  function vbadge(v) { return h('span', { class: 'badge vd-' + v }, VERDICT_TXT[v] || v); }
  function emptyDocs() {
    return h('section', { class: 'card empty' },
      h('p', null, '아직 넣은 인증 문서가 없습니다.'),
      h('p', null, '가상 샘플 규정으로 먼저 둘러보거나, 인증팀이 승인한 규정 파일(PDF · Word · 글자)을 넣어 주세요.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: loadSample }, '가상 샘플 규정으로 시작'),
        h('a', { class: 'btn', href: '#/docs' }, '지식 문서로')));
  }
  function loadSample() {
    if (db.docs.length && !db.sample && !confirm('지금 넣어 둔 문서에 가상 샘플 8개를 더합니다. 계속할까요?')) return;
    SAMPLE.DOCS.forEach(function (d) { var x = Object.assign({}, d, { sample: true, addedAt: nowStr() }); L.upsertDoc(db, x); });
    db.sample = db.docs.every(function (d) { return d.sample; });
    save(); toast('가상 샘플 규정 8개를 넣었습니다. 예시 질문을 눌러 보세요.');
    location.hash = '#/ask'; render();
  }

  /* ── ① 질문하기 ─────────────────────────── */
  function runAsk(q, filters) {
    ui.q = q;
    if (filters) { ui.country = filters.country != null ? filters.country : null; ui.field = filters.field != null ? filters.field : null; }
    var st = L.cleanSettings(db.settings), cfg = E.load();
    var opts = { country: ui.country, field: ui.field, today: today(), at: nowStr() };
    function finish(vec) {
      if (vec) opts.queryVec = vec;
      ui.res = L.ask(db, idx(), q, opts);
      ui.answer = ''; ui.check = null; ui.logAt = null;
      ui.fups = L.followups(db, idx(), ui.res, { today: today() });
      writeLog(null, 'tool');  // 모든 질문을 남깁니다(감사 기록) — 답을 검증하면 같은 줄을 고칩니다
      ui.busy = false; render();
      var el = document.getElementById('result'); if (el) el.scrollIntoView({ block: 'start' });
    }
    if (st.hybrid && st.embedModel && E.isReady(cfg) && Object.keys(db.vectors || {}).length) {
      ui.busy = true; render();
      E.callEmbeddings(cfg, [q], st.embedModel).then(function (v) { finish(v[0]); }, function (e) { toast('벡터 검색을 건너뛰고 키워드 검색만 씁니다: ' + e.message, true); finish(null); });
    } else finish(null);
  }
  function writeLog(check, mode) {
    var entry = L.logEntry(ui.res, check, { answer: ui.answer, mode: mode, at: ui.res.at });
    var i = ui.logAt == null ? -1 : db.log.map(function (x) { return x.at + x.question; }).indexOf(ui.logAt);
    if (i >= 0) { entry.feedback = db.log[i].feedback; db.log[i] = entry; }
    else { db.log.push(entry); if (db.log.length > 500) db.log.shift(); }
    ui.logAt = entry.at + entry.question;
    save();
  }
  function setFeedback(v) {
    var i = db.log.map(function (x) { return x.at + x.question; }).indexOf(ui.logAt);
    if (i < 0) { writeLog(ui.check, ui.check ? 'answer' : 'tool'); i = db.log.length - 1; }
    db.log[i].feedback = v; save();
    toast(v === '오답 신고' ? '오답 신고를 기록했습니다. 「③ 기록」에서 인증팀이 모아 볼 수 있습니다.' : '고맙습니다. 기록에 남겼습니다.');
  }

  function evidenceCard(e) {
    var d = e.doc, c = e.chunk;
    var meta = [d.country, L.fieldLabel(d.field), d.revised ? '개정 ' + d.revised : '', d.effective ? '시행 ' + d.effective : '', c.page ? c.page + (c.pageEnd && c.pageEnd !== c.page ? '~' + c.pageEnd : '') + '쪽' : '', d.source].filter(Boolean).join(' · ');
    return h('article', { class: 'ev' },
      h('div', { class: 'ev-top' }, h('span', { class: 'cite' }, e.label), h('b', { class: 'ev-ref' }, L.chunkRef(c, d)),
        h('span', { class: 'note' }, '점수 ' + e.score + (e.cos != null ? ' · 벡터 ' + e.cos : ''))),
      h('div', { class: 'note' }, d.title + ' — ' + meta),
      e.flags.length ? h('div', { class: 'tags' }, e.flags.map(function (f) { return h('span', { class: 'tag caution' }, f); })) : null,
      c.path ? h('div', { class: 'note' }, c.path) : null,
      h('p', { class: 'ev-text' }, c.text));
  }
  function followupBlock(title, list) {
    if (!list || !list.length) return null;
    return h('section', { class: 'card' }, h('h2', null, title),
      h('p', { class: 'note' }, '아래 질문은 지식베이스에서 근거가 실제로 찾아지는 것만 골랐습니다(답이 없는 질문은 보여 주지 않습니다).'),
      h('div', { class: 'fups' }, list.map(function (f) {
        return h('button', { type: 'button', class: 'fup', onclick: function () { runAsk(f.question, f.filters); } },
          h('span', { class: 'tag' }, f.type), h('span', { class: 't' }, f.question), f.topRef ? h('span', { class: 'note' }, '근거: ' + f.topRef) : null);
      })));
  }
  function pageAsk() {
    if (!db.docs.length) return [pageHead('① 질문하기', '인증법규 질문하기', '확보된 문서에서 근거를 찾아, 근거가 있을 때만 답을 만듭니다.'), emptyDocs()];
    var qIn = h('textarea', { id: 'q', rows: 3, placeholder: '예: 알파국에서 굴착기 입자상물질 배출 기준은?' });
    qIn.value = ui.q;
    var cs = L.countries(db);
    var cSel = h('select', { 'aria-label': '국가 조건' });
    [['__auto', '질문에서 읽기(자동)'], ['', '전체 국가']].concat(cs.map(function (c) { return [c, c]; })).forEach(function (o) {
      var op = h('option', { value: o[0] }, o[1]); if ((ui.country == null ? '__auto' : ui.country) === o[0]) op.selected = true; cSel.appendChild(op);
    });
    var fSel = h('select', { 'aria-label': '인증 분야 조건' });
    [['__auto', '질문에서 읽기(자동)'], ['', '전체 분야']].concat(L.FIELDS.map(function (f) { return [f, L.fieldLabel(f)]; })).forEach(function (o) {
      var op = h('option', { value: o[0] }, o[1]); if ((ui.field == null ? '__auto' : ui.field) === o[0]) op.selected = true; fSel.appendChild(op);
    });
    function go() {
      var q = qIn.value.trim();
      if (!q) { toast('질문을 적어 주세요.', true); qIn.focus(); return; }
      runAsk(q, { country: cSel.value === '__auto' ? null : cSel.value, field: fSel.value === '__auto' ? null : fSel.value });
    }
    qIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) go(); });
    var ex = db.sample || db.docs.some(function (d) { return d.sample; }) ? SAMPLE.QUESTIONS : [];
    var out = [
      pageHead('① 질문하기', '인증법규 질문하기', '확보된 문서에서 근거 조항을 찾고, 근거가 충분할 때만 AI 에게 답을 부탁합니다. AI 의 답은 문장마다 인용을 대조해 표시합니다.'),
      h('section', { class: 'card' },
        fld('질문', qIn, 'Ctrl + Enter 로도 찾을 수 있습니다. 국가 · 기종 · 인증 분야를 함께 적으면 더 정확합니다.'),
        h('div', { class: 'filters', style: 'margin-top:12px' },
          fld('국가 조건', cSel), fld('인증 분야 조건', fSel),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: go, disabled: ui.busy }, ui.busy ? '찾는 중…' : '근거 찾기'))),
        ex.length ? h('div', { class: 'examples' }, h('span', { class: 'note' }, '예시 질문'), ex.map(function (q) {
          return h('button', { type: 'button', class: 'chip', onclick: function () { runAsk(q, { country: null, field: null }); } }, q);
        })) : null)
    ];
    if (ui.res) out = out.concat(resultBlock());
    return out;
  }
  function resultBlock() {
    var r = ui.res, g = r.gate, out = [];
    var src = function (k) { return ui[k] == null ? '질문에서 읽음' : '직접 고름'; };
    var cond = [];
    if (r.filters.country) cond.push('국가 ' + r.filters.country + ' (' + src('country') + ')');
    if (r.filters.field) cond.push('분야 ' + L.fieldLabel(r.filters.field) + ' (' + src('field') + ')');
    out.push(h('section', { class: 'card', id: 'result' },
      h('div', { class: 'res-top' }, badge(g.status), h('b', null, r.question)),
      h('dl', { class: 'summary', style: 'margin-top:10px' },
        h('dt', null, '적용한 조건'), h('dd', null, cond.length ? cond.join(' · ') : '없음(전체 문서)',
          cond.length ? h('button', { type: 'button', class: 'btn btn-sm', style: 'margin-left:8px', onclick: function () { runAsk(r.question, { country: '', field: '' }); } }, '조건 풀고 다시') : null),
        h('dt', null, '핵심 낱말'), h('dd', null, g.terms && g.terms.length ? g.terms.map(function (t) { return h('span', { class: 'term ' + (g.covered.indexOf(t) >= 0 ? 'in' : 'out') }, t); }) : '-',
          g.terms && g.terms.length ? h('span', { class: 'note', style: 'margin-left:6px' }, '근거에 있음 ' + g.covered.length + '/' + g.terms.length) : null),
        h('dt', null, '판정 이유'), h('dd', null, g.reasons.length ? h('ul', { class: 'plain' }, g.reasons.map(function (x) { return h('li', null, x); })) : '핵심 낱말이 모두 근거에 있습니다.'))));

    if (g.status === 'clarify') {
      out.push(h('section', { class: 'card clarify' }, h('h2', null, r.clarify.question),
        h('div', { class: 'btn-row' }, r.clarify.options.map(function (c) {
          return h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { runAsk(r.question, { country: c, field: ui.field }); } }, c + ' 기준으로');
        }), h('button', { type: 'button', class: 'btn', onclick: function () { runAsk(r.question, { country: '', field: ui.field == null ? null : ui.field }); ui.res.clarify = null; } }, '국가 구분 없이 보기'))));
    }
    if (g.status === 'insufficient') {
      out.push(h('section', { class: 'card refusal' }, h('h2', null, L.REFUSAL),
        h('p', { class: 'pre' }, r.refusal.split('\n').slice(2).join('\n')),
        h('p', { class: 'note' }, '이 답은 AI 가 아니라 도구가 정해진 문구로 냅니다(근거가 없으면 AI 를 부르지 않습니다). 「③ 기록 · 미응답」에 모여 인증팀이 지식을 채울 우선순위로 씁니다.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { copyText(r.refusal); } }, '안내 글 복사'))));
      var alt = followupBlock('대신 확인할 수 있는 주제', ui.fups);
      if (alt) out.push(alt);
    }
    if (r.evidence.length) {
      out.push(h('section', { class: 'card' }, h('h2', null, '찾은 근거 조항 (' + r.evidence.length + ')'),
        h('p', { class: 'note' }, g.status === 'insufficient' ? '검색에 걸린 조항이지만 질문의 핵심 낱말을 충분히 담고 있지 않아 근거로 쓰지 않았습니다.' : '운영 승인 문서의 조항만 씁니다. 원문 확인은 문서 코드 · 조항 · 쪽으로 찾아 주세요.'),
        h('div', { class: 'ev-list' }, r.evidence.map(evidenceCard))));
    }
    if (r.prompt) out = out.concat(answerBlock());
    return out;
  }
  function answerBlock() {
    var r = ui.res, out = [];
    var pr = h('textarea', { class: 'mono', rows: 10, readonly: true }); pr.value = r.prompt;
    var ans = h('textarea', { id: 'answer', rows: 8, placeholder: 'AI 의 답을 그대로 붙여 넣어 주세요. 문장마다 [E1] 같은 인용이 붙어 있어야 통과합니다.' });
    ans.value = ui.answer;
    function check() {
      ui.answer = ans.value;
      if (!ui.answer.trim()) { toast('AI 의 답을 붙여 넣어 주세요.', true); return; }
      ui.check = L.checkAnswer(ui.answer, r.evidence);
      writeLog(ui.check, 'answer'); render();
      var el = document.getElementById('check'); if (el) el.scrollIntoView({ block: 'start' });
    }
    out.push(h('section', { class: 'card' }, h('h2', null, (r.gate.status === 'partial' ? '근거가 일부만 있습니다 — ' : '') + 'AI 에게 근거 한정 답 부탁하기'),
      h('ol', { class: 'steps' },
        h('li', null, '아래 프롬프트를 복사해 회사가 허용한 AI(사내 LLM 등)에 붙여 넣습니다. 프롬프트에는 질문과 위 근거 조항만 들어 있습니다.'),
        h('li', null, 'AI 의 답을 아래 칸에 붙여 넣고 「답 검증」을 누릅니다. 문장마다 인용 · 숫자를 근거와 대조합니다.')),
      pr,
      h('div', { class: 'btn-row', style: 'margin:8px 0 16px' },
        h('button', { type: 'button', class: 'btn', onclick: function () { copyText(r.prompt); } }, '프롬프트 복사'),
        AIP.sendButton('설정한 AI 서버로 보내기', function () { return r.prompt; }, function (text) { ui.answer = text; ans.value = text; check(); }, { toast: toast, settingsHref: '#/settings', system: '근거 밖의 지식으로 답하지 않는 인증법규 보조자입니다.' })),
      fld('AI 의 답', ans),
      h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: check }, '답 검증'))));
    if (ui.check) {
      var c = ui.check;
      out.push(h('section', { class: 'card', id: 'check' },
        h('div', { class: 'res-top' }, vbadge(c.verdict), h('span', null, '사실 문장 ' + (c.passed + c.flagged) + '개 중 통과 ' + c.passed + ' · 표시 ' + c.flagged)),
        h('ol', { class: 'sents' }, c.sentences.map(function (s) {
          var cls = s.kind !== 'fact' ? 'sk-' + s.kind : s.issues.length ? 'sk-bad' : 'sk-ok';
          return h('li', { class: cls }, h('span', { class: 'st' }, s.kind === 'refusal' ? '근거 없음 표시' : s.kind === 'header' ? '제목(검사 제외)' : s.issues.length ? '표시' : '통과'),
            h('span', { class: 'tx' }, s.text), s.issues.length ? h('span', { class: 'why' }, s.issues.join(' · ')) : null);
        })),
        h('h3', null, '사용자에게 보여 줄 답 (검증 통과 문장만)'),
        h('p', { class: 'pre safe' }, c.safeText),
        h('p', { class: 'note' }, '이 도구는 의사결정을 돕는 검색 · 정리 결과입니다. 대외 제출이나 최종 인증 판단 전에는 인증팀 확인을 받아 주세요.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () { copyText(c.safeText + '\n\n[근거]\n' + r.evidence.map(function (e) { return e.label + ' ' + L.chunkRef(e.chunk, e.doc) + (e.doc.revised ? ' (개정 ' + e.doc.revised + ')' : ''); }).join('\n')); } }, '답과 근거 목록 복사'),
          h('button', { type: 'button', class: 'btn', onclick: function () { setFeedback('도움됨'); } }, '도움됨'),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { setFeedback('오답 신고'); } }, '오답 신고'))));
    }
    var f = followupBlock('이어서 확인할 만한 질문', ui.fups);
    if (f) out.push(f);
    return out;
  }

  /* ── ② 지식 문서 ────────────────────────── */
  function handleFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    Promise.all(files.map(function (f) { return R.readDocFile(f).catch(function (e) { return { error: e.message }; }); })).then(function (items) {
      items.forEach(function (it) {
        if (it.error) { toast(it.error, true); return; }
        ui.pending.push(pendingFrom(it.fileName, it.text, it.format));
      });
      render();
    });
  }
  function pendingFrom(fileName, text, format) {
    var code = L.suggestCode(fileName, db.docs.concat(ui.pending.map(function (p) { return p.doc; })));
    var title = (text.split('\n').filter(function (l) { return l.trim() && !/^\[\[p\.\d+\]\]$/.test(l.trim()); })[0] || fileName).replace(/^#+\s*/, '').trim().slice(0, 80);
    return { doc: { code: code, title: title, country: '', field: '기타', revised: '', effective: '', status: '운영', source: '', fileName: fileName, format: format, text: text } };
  }
  function docForm(doc, onSave, onCancel, saveLabel) {
    var d = Object.assign({}, doc);
    var inputs = {};
    function inp(k, attrs) { var i = h('input', attrs || {}); i.value = d[k] || ''; inputs[k] = i; return i; }
    var fSel = h('select'); L.FIELDS.forEach(function (f) { var o = h('option', { value: f }, L.fieldLabel(f)); if (d.field === f) o.selected = true; fSel.appendChild(o); }); inputs.field = fSel;
    var sSel = h('select'); L.STATUSES.forEach(function (s) { var o = h('option', { value: s }, s); if (d.status === s) o.selected = true; sSel.appendChild(o); }); inputs.status = sSel;
    var dl = h('datalist', { id: 'countryList' }, L.countries(db).concat([L.COMMON_COUNTRY]).map(function (c) { return h('option', { value: c }); }));
    var preview = h('div', { class: 'note' });
    function showPreview() {
      var ch = L.chunkDocument(d.text, inputs.code.value.trim() || 'DOC');
      var modeTxt = { article: '조문형(제N조 · ①항)', section: '절 번호형(3.1 · 부속서)', heading: '제목형(# 제목)', para: '문단형(조항 표시 없음 — 문단 묶음)' }[ch.mode];
      preview.innerHTML = '';
      add(preview, [h('b', null, '나누기 미리보기: '), modeTxt + ' · 조각 ' + ch.chunks.length + '개',
        h('ul', { class: 'plain chunk-pv' }, ch.chunks.slice(0, 6).map(function (c) { return h('li', null, h('b', null, c.label + (c.title ? ' ' + c.title : '')), ' — ' + c.text.slice(0, 60) + (c.text.length > 60 ? '…' : '')); })),
        ch.chunks.length > 6 ? '… 외 ' + (ch.chunks.length - 6) + '개' : null]);
    }
    var codeIn = inp('code', { autocomplete: 'off' }); codeIn.addEventListener('change', showPreview);
    var form = h('div', { class: 'doc-form' },
      h('div', { class: 'form-grid' },
        fld('문서 코드(인용 ID 머리)', codeIn, '예: ALP-EM-2025. 답의 인용에 이 코드가 붙습니다.'),
        h('label', { class: 'field span-2' }, h('span', null, '문서 이름'), inp('title')),
        fld('국가', [inp('country', { list: 'countryList', placeholder: '예: 알파국 / 공통(사내)' }), dl], '공통(사내) 문서는 어느 국가 질문에도 함께 찾습니다.'),
        fld('인증 분야', fSel),
        fld('상태', sSel, '운영 = 답의 근거로 씀 · 검수 중 = 쓰지 않음 · 구버전 = 설정에서 켤 때만'),
        fld('개정일', inp('revised', { type: 'date' })),
        fld('시행일', inp('effective', { type: 'date' })),
        fld('출처(원문 위치·링크)', inp('source', { placeholder: '예: M365 인증규제 폴더 경로 / 공식 기관 URL' }))),
      preview,
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          Object.keys(inputs).forEach(function (k) { d[k] = inputs[k].value; });
          if (!d.code.trim()) { toast('문서 코드를 적어 주세요.', true); return; }
          if (!d.country.trim()) { toast('국가를 적어 주세요(사내 공통 문서는 「' + L.COMMON_COUNTRY + '」).', true); return; }
          onSave(d);
        } }, saveLabel || '저장'),
        onCancel ? h('button', { type: 'button', class: 'btn', onclick: onCancel }, '취소') : null));
    showPreview();
    return form;
  }
  function pageDocs() {
    var fileIn = h('input', { type: 'file', multiple: true, accept: '.pdf,.docx,.txt,.md' });
    fileIn.addEventListener('change', function () { handleFiles(fileIn.files); fileIn.value = ''; });
    var drop = h('div', { class: 'drop' },
      h('label', { class: 'btn btn-primary' }, fileIn, '규정 파일 고르기'),
      h('span', { class: 'note' }, '또는 여기에 끌어다 놓기 — PDF(글자 층 있는 것) · Word(.docx) · 글자(.txt · .md)'));
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
    var pasteTitle = h('input', { placeholder: '예: 사내 인증 회신 메일 모음' });
    var pasteText = h('textarea', { rows: 5, placeholder: '규정 · 해설 · 회신 메일 글을 붙여 넣어 주세요. 「제N조」「①」「3.1」「## 제목」이 있으면 그 단위로 나눕니다.' });
    var out = [
      pageHead('② 지식 문서', '지식 문서', '답의 근거가 되는 문서입니다. 여기 넣고 「운영」으로 둔 문서만 답에 씁니다(폐쇄 세계). 파일은 이 브라우저 안에서만 읽습니다.'),
      h('section', { class: 'card' }, h('h2', null, '문서 넣기'), drop,
        h('details', null, h('summary', null, '글자 붙여 넣기로 넣기'),
          fld('문서 이름', pasteTitle), fld('본문', pasteText),
          h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
            if (!pasteText.value.trim()) { toast('본문을 붙여 넣어 주세요.', true); return; }
            var p = pendingFrom((pasteTitle.value.trim() || '붙여넣기') + '.txt', pasteText.value, 'paste');
            if (pasteTitle.value.trim()) p.doc.title = pasteTitle.value.trim();
            ui.pending.push(p); render();
          } }, '미리보기로'))),
        h('div', { class: 'btn-row', style: 'margin-top:12px' },
          h('button', { type: 'button', class: 'btn', onclick: loadSample }, '가상 샘플 규정 넣기'),
          db.docs.length ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            if (!confirm('넣어 둔 문서 ' + db.docs.length + '개와 조각 · 임베딩을 모두 지웁니다(기록은 남습니다). 계속할까요?')) return;
            db.docs = []; db.chunks = []; db.vectors = {}; db.sample = false; ui.res = null; save(); render();
          } }, '모든 문서 지우기') : null))
    ];
    ui.pending.forEach(function (p, i) {
      out.push(h('section', { class: 'card pending' }, h('h2', null, '넣기 전 확인 — ' + p.doc.fileName),
        h('p', { class: 'note' }, '메타데이터(국가 · 분야 · 개정일 · 시행일 · 출처)는 답에 함께 표시되고 검색 조건으로 쓰입니다. 파일에서 추정하지 않으니 직접 적어 주세요.'),
        docForm(p.doc, function (d) {
          try { L.upsertDoc(db, Object.assign(d, { addedAt: nowStr() })); } catch (e) { toast(e.message, true); return; }
          if (db.docs.filter(function (x) { return x.code === d.code; })[0].chunkCount === 0) toast('조각이 0개입니다. 글자가 없는 파일인지 확인해 주세요.', true);
          db.sample = db.docs.every(function (x) { return x.sample; });
          ui.pending.splice(i, 1); save(); toast(d.code + ' 를 넣었습니다.'); render();
        }, function () { ui.pending.splice(i, 1); render(); }, '지식베이스에 넣기')));
    });
    if (!db.docs.length) { out.push(emptyDocs()); return out; }
    var tdy = today(), st = L.cleanSettings(db.settings);
    out.push(h('section', { class: 'card' }, h('h2', null, '넣어 둔 문서 (' + db.docs.length + '개 · 조각 ' + db.chunks.length + '개)'),
      table(['코드', '문서 이름', '국가', '분야', '개정일', '시행일', '상태', '조각', '주의', ''], db.docs.slice().sort(function (a, b) { return a.code < b.code ? -1 : 1; }).map(function (d) {
        var fl = L.docFlags(d, tdy, st.staleYears);
        return { cls: d.status !== '운영' ? 'excluded' : null, cells: [h('span', { class: 'mono' }, d.code), d.title, d.country, L.fieldLabel(d.field), d.revised || '-', d.effective || '-', d.status, String(d.chunkCount),
          fl.length ? fl.join(', ') : '',
          h('span', { class: 'btn-row nowrap' },
            h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.open[d.code] = ui.open[d.code] === 'chunks' ? null : 'chunks'; render(); } }, '조각'),
            h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.open[d.code] = ui.open[d.code] === 'edit' ? null : 'edit'; render(); } }, '고치기'),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: function () { if (confirm(d.code + ' 를 지울까요?')) { L.removeDoc(db, d.code); db.sample = db.docs.length > 0 && db.docs.every(function (x) { return x.sample; }); save(); render(); } } }, '지우기'))] };
      }), { num: [false, false, false, false, false, false, false, true] })));
    db.docs.forEach(function (d) {
      if (ui.open[d.code] === 'edit') out.push(h('section', { class: 'card' }, h('h2', null, d.code + ' 고치기'), docForm(d, function (nd) {
        if (nd.code !== d.code) L.removeDoc(db, d.code);
        L.upsertDoc(db, nd); ui.open[d.code] = null; save(); toast('저장했습니다. 조각을 다시 만들었습니다.'); render();
      }, function () { ui.open[d.code] = null; render(); })));
      if (ui.open[d.code] === 'chunks') {
        var cs = db.chunks.filter(function (c) { return c.docCode === d.code; });
        out.push(h('section', { class: 'card' }, h('h2', null, d.code + ' 조각 ' + cs.length + '개'),
          h('p', { class: 'note' }, '나누기 방식: ' + ({ article: '조문형', section: '절 번호형', heading: '제목형', para: '문단형' }[d.mode] || '-') + '. 조각 ID 가 답의 인용 · 기록에 그대로 쓰입니다.'),
          table(['조각 ID', '제목', '위치', '쪽', '본문'], cs.map(function (c) { return [h('span', { class: 'mono' }, c.id), c.title, c.path, c.page ? String(c.page) : '-', c.text]; }), { cls: 'chunks' })));
      }
    });
    return out;
  }

  /* ── ③ 기록 · 미응답 ─────────────────────── */
  function pageLog() {
    var log = db.log.slice().reverse();
    var n = function (fn) { return db.log.filter(fn).length; };
    var filters = [['all', '전체'], ['insufficient', '근거 없음(미응답)'], ['flagged', '답 검증에서 표시됨'], ['report', '오답 신고'], ['clarify', '되묻기']];
    var sel = h('select', { 'aria-label': '기록 거르기' });
    filters.forEach(function (f) { var o = h('option', { value: f[0] }, f[1]); if (ui.logFilter === f[0]) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { ui.logFilter = sel.value; render(); });
    var shown = log.filter(function (l) {
      if (ui.logFilter === 'insufficient') return l.status === 'insufficient';
      if (ui.logFilter === 'flagged') return l.verdict === 'flagged' || l.verdict === 'fail';
      if (ui.logFilter === 'report') return l.feedback === '오답 신고';
      if (ui.logFilter === 'clarify') return l.status === 'clarify';
      return true;
    });
    // 미응답 낱말 모아보기 — 어떤 지식을 먼저 채울지(기획서 F4)
    var miss = {};
    db.log.filter(function (l) { return l.status === 'insufficient'; }).forEach(function (l) { (l.missing || []).forEach(function (w) { miss[w] = (miss[w] || 0) + 1; }); });
    var missTop = Object.keys(miss).sort(function (a, b) { return miss[b] - miss[a]; }).slice(0, 12);
    return [
      pageHead('③ 기록 · 미응답', '질의 기록', '모든 질문 · 근거 조항 · 판정 · 답 검증 결과가 이 브라우저에 남습니다. 근거 없음 질문은 인증팀이 채울 지식의 목록입니다.'),
      h('div', { class: 'tiles' }, tile('질문', String(db.log.length)), tile('근거 없음', String(n(function (l) { return l.status === 'insufficient'; }))),
        tile('답 검증 통과', String(n(function (l) { return l.verdict === 'pass'; }))), tile('오답 신고', String(n(function (l) { return l.feedback === '오답 신고'; })))),
      missTop.length ? h('section', { class: 'card' }, h('h2', null, '근거가 없던 낱말 (많이 나온 순)'),
        h('p', { class: 'note' }, '이 낱말을 담은 문서를 확보해 넣으면 같은 질문에 답할 수 있게 됩니다.'),
        h('div', { class: 'tags' }, missTop.map(function (w) { return h('span', { class: 'term out' }, w + ' ' + miss[w]); }))) : null,
      h('section', { class: 'card' },
        h('div', { class: 'filters' }, fld('보기', sel),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn', onclick: function () { download('인증법규_질의기록_' + today() + '.csv', new Blob([L.toCsv(L.logToRows(db.log))], { type: 'text/csv;charset=utf-8' })); } }, 'CSV 내려받기'),
            db.log.length ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { if (confirm('기록 ' + db.log.length + '건을 모두 지울까요?')) { db.log = []; save(); render(); } } }, '기록 지우기') : null)),
        shown.length ? table(['시각', '질문', '판정', '근거 조항', '답 검증', '피드백', ''], shown.map(function (l) {
          return [l.at, l.question, badge(l.status), (l.evidence || []).slice(0, 3).map(function (e) { return e.label + ' ' + e.chunkId; }).join(' · ') + ((l.evidence || []).length > 3 ? ' …' : ''),
            l.verdict ? vbadge(l.verdict) : '-', l.feedback || '-',
            h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { location.hash = '#/ask'; runAsk(l.question, { country: l.filters && l.filters.country || null, field: l.filters && l.filters.field || null }); } }, '다시 묻기')];
        }), { cls: 'log' }) : h('p', { class: 'empty' }, '기록이 없습니다.'))
    ];
  }

  /* ── ④ 골든셋 점검 ─────────────────────── */
  function goldenLines(g) { return g.map(function (x) { return x.q + ' | ' + (x.refuse ? '거절' : [].concat(x.expect).join(' ; ')); }).join('\n'); }
  function parseGolden(text) {
    return text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var p = l.split('|'), q = (p[0] || '').trim(), e = (p[1] || '').trim();
      return /^(거절|refuse|없음)$/i.test(e) ? { q: q, refuse: true } : { q: q, expect: e.split(';').map(function (x) { return x.trim(); }).filter(Boolean) };
    }).filter(function (x) { return x.q; });
  }
  function pageEval() {
    if (!db.docs.length) return [pageHead('④ 골든셋 점검', '골든셋 점검', ''), emptyDocs()];
    var gl = db.golden || (db.docs.some(function (d) { return d.sample; }) ? SAMPLE.GOLDEN : []);
    var ta = h('textarea', { class: 'mono', rows: 8 }); ta.value = goldenLines(gl);
    var res = gl.length ? L.runGolden(db, idx(), gl, { today: today() }) : null;
    var pct = function (v) { return v == null ? '-' : Math.round(v * 100) + '%'; };
    return [
      pageHead('④ 골든셋 점검', '골든셋 점검', '정답을 아는 질문과 반드시 거절해야 할 질문으로 검색 · 판정 기준을 잽니다. AI 없이 도구만으로 돕니다. 문서나 기준을 바꾼 뒤에는 여기서 먼저 확인해 주세요.'),
      res ? h('div', { class: 'tiles' }, tile('정답 조항 찾기 (Recall@' + L.cleanSettings(db.settings).topK + ')', pct(res.recall), '답이 있는 질문 ' + res.answerable + '개'),
        tile('정직한 거절률', pct(res.refusal), '답이 없는 질문 ' + res.unanswerable + '개 — 목표 100%'),
        tile('전체 통과', res.rows.filter(function (r) { return r.ok; }).length + ' / ' + res.rows.length)) : null,
      res ? h('section', { class: 'card' }, table(['질문', '기대', '판정', '1순위 조항', '결과'], res.rows.map(function (r) {
        return { cls: r.ok ? null : 'differs', cells: [r.q, r.refuse ? '거절' : [].concat(r.expect).join(' / '), badge(r.status), r.top || '-', r.ok ? '통과' : '실패' + (r.refuse ? '(답하면 안 되는 질문에 근거가 잡힘)' : '(정답 조항을 못 찾음)')] };
      }))) : null,
      h('section', { class: 'card' }, h('h2', null, '골든셋 고치기'),
        h('p', { class: 'note' }, '한 줄에 「질문 | 정답 조각 ID」 또는 「질문 | 거절」. 정답이 여럿이면 「;」로 나눕니다. 조각 ID 는 ② 지식 문서의 「조각」에서 볼 수 있습니다.'),
        ta, h('div', { class: 'btn-row', style: 'margin-top:8px' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { db.golden = parseGolden(ta.value); save(); render(); toast('골든셋 ' + db.golden.length + '문항으로 다시 쟀습니다.'); } }, '저장하고 다시 재기'),
          db.golden ? h('button', { type: 'button', class: 'btn', onclick: function () { delete db.golden; save(); render(); } }, '샘플 골든셋으로 되돌리기') : null))
    ];
  }

  /* ── 설정 ───────────────────────────────── */
  function pageSettings() {
    var st = L.cleanSettings(db.settings);
    var ins = {};
    function num(k, label, hint, step) { var i = h('input', { type: 'number', step: step || 'any', value: String(st[k]) }); ins[k] = i; return fld(label, i, hint); }
    var oldCb = h('input', { type: 'checkbox' }); oldCb.checked = st.includeOld;
    var hyCb = h('input', { type: 'checkbox' }); hyCb.checked = st.hybrid;
    var emIn = h('input', { value: st.embedModel, placeholder: '예: 서버의 임베딩 모델 이름', autocomplete: 'off' });
    var nVec = Object.keys(db.vectors || {}).length;
    var backup = h('input', { type: 'file', accept: '.json' });
    backup.addEventListener('change', function () {
      var f = backup.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { try { db = L.restoreDb(JSON.parse(fr.result)); db.chunks = []; db.docs.slice().forEach(function (d) { L.upsertDoc(db, d); }); save(); toast('백업을 불러왔습니다.'); render(); } catch (e) { toast('백업 파일을 읽지 못했습니다.', true); } };
      fr.readAsText(f);
    });
    function saveSettings() {
      var s = Object.assign({}, st);
      Object.keys(ins).forEach(function (k) { s[k] = Number(ins[k].value); });
      s.includeOld = oldCb.checked; s.hybrid = hyCb.checked; s.embedModel = emIn.value.trim();
      db.settings = L.cleanSettings(s); save(); toast('저장했습니다. ④ 골든셋 점검에서 결과를 확인해 주세요.'); render();
    }
    function makeVectors(btn) {
      var cfg = E.load(), model = emIn.value.trim();
      if (!E.isReady(cfg)) { toast('먼저 아래 AI 연결 설정에 서버 주소와 모델을 저장해 주세요.', true); return; }
      if (!model) { toast('임베딩 모델 이름을 적어 주세요.', true); return; }
      var todo = db.chunks.filter(function (c) { return !db.vectors[c.id]; }), done = 0;
      if (!todo.length) { toast('모든 조각에 벡터가 있습니다.'); return; }
      btn.disabled = true;
      var step = function () {
        var batch = todo.slice(done, done + 16);
        if (!batch.length) { btn.disabled = false; db.settings.embedModel = model; save(); toast('벡터 ' + done + '개를 만들었습니다.'); render(); return; }
        btn.textContent = '만드는 중… ' + done + '/' + todo.length;
        E.callEmbeddings(cfg, batch.map(function (c) { return [c.label, c.title, c.text].join(' '); }), model).then(function (vs) {
          batch.forEach(function (c, i) { db.vectors[c.id] = vs[i].map(function (x) { return Math.round(x * 1e4) / 1e4; }); });
          done += batch.length; step();
        }, function (e) { btn.disabled = false; btn.textContent = '조각 벡터 만들기'; toast(e.message, true); save(); });
      };
      step();
    }
    var vecBtn = h('button', { type: 'button', class: 'btn' }, '조각 벡터 만들기');
    vecBtn.addEventListener('click', function () { makeVectors(vecBtn); });
    return [
      pageHead('설정', '설정', '검색 · 판정 기준, AI 연결(선택), 백업'),
      h('section', { class: 'card' }, h('h2', null, '검색 · 근거 판정 기준'),
        h('p', { class: 'note' }, '엄격할수록 거절이 늘고, 느슨할수록 틀린 근거가 섞일 위험이 커집니다. 바꾼 뒤에는 ④ 골든셋 점검으로 확인해 주세요.'),
        h('div', { class: 'form-grid' },
          num('topK', '근거 조항 수(상위 K)', '프롬프트에 넣는 조항 수', '1'),
          num('suffCoverage', '「충분」 핵심 낱말 비율', '질문의 핵심 낱말 중 근거에 있어야 하는 비율(0~1)'),
          num('partCoverage', '「일부」 핵심 낱말 비율', '이보다 낮으면 근거 없음'),
          num('minScore', '최소 검색 점수', 'BM25 1순위 점수가 이보다 낮으면 근거 없음'),
          num('relFloor', '함께 넣을 조항의 점수 하한', '1순위 점수 대비 비율(0~1)'),
          num('staleYears', '오래된 자료 경고(년)', '개정일이 이보다 오래되면 주의 표시', '1')),
        h('label', { class: 'opt', style: 'margin-top:10px' }, oldCb, h('span', null, h('span', { class: 't' }, '구버전 문서도 근거로 쓰기'), h('span', { class: 's' }, '「개정 전 규정」을 물을 때만 켜 주세요. 켜면 답에 「구버전」 주의가 붙습니다.'))),
        h('div', { class: 'btn-row', style: 'margin-top:12px' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: saveSettings }, '저장'),
          h('button', { type: 'button', class: 'btn', onclick: function () { db.settings = L.defaultSettings(); save(); render(); } }, '기본값으로'))),
      h('section', { class: 'card' }, h('h2', null, '벡터 검색 더하기 (선택)'),
        h('p', { class: 'note' }, '기본은 키워드(BM25) 검색입니다. 아래 AI 연결 설정의 서버가 「/embeddings」를 제공하면 조각마다 벡터를 만들어 두고, 키워드 순위와 벡터 순위를 합쳐(RRF) 뜻이 비슷한 조항도 찾습니다. 근거 판정(핵심 낱말 확인)은 그대로입니다.'),
        h('div', { class: 'form-grid' }, fld('임베딩 모델 이름', emIn), h('div', { class: 'field' }, h('span', null, '만든 벡터'), h('div', null, nVec + ' / ' + db.chunks.length + ' 조각'))),
        h('label', { class: 'opt', style: 'margin-top:10px' }, hyCb, h('span', null, h('span', { class: 't' }, '질문할 때 벡터 검색도 쓰기'), h('span', { class: 's' }, '서버에 연결되지 않으면 키워드 검색만 씁니다.'))),
        h('div', { class: 'btn-row', style: 'margin-top:10px' }, vecBtn,
          h('button', { type: 'button', class: 'btn', onclick: saveSettings }, '저장'),
          nVec ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { db.vectors = {}; save(); render(); } }, '벡터 지우기') : null)),
      AIP.settingsCard({ toast: toast, onChange: render }),
      h('section', { class: 'card' }, h('h2', null, '백업'),
        h('p', { class: 'note' }, '문서 · 조각 · 기록은 이 브라우저에만 있습니다. 다른 PC 로 옮기거나 브라우저 정리 전에 JSON 으로 받아 두세요. 사내 문서가 들어 있으니 보관 위치에 주의해 주세요.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () { download('인증법규_백업_' + today() + '.json', new Blob([JSON.stringify(db)], { type: 'application/json' })); } }, 'JSON 백업 내려받기'),
          h('label', { class: 'btn' }, backup, 'JSON 백업 불러오기')))
    ];
  }

  /* ── 라우터 ─────────────────────────────── */
  var PAGES = [
    { id: 'ask', no: '①', t: '질문하기', s: '근거 찾기 · 답 검증', fn: pageAsk },
    { id: 'docs', no: '②', t: '지식 문서', s: '파일 넣기 · 조항 나누기', fn: pageDocs },
    { id: 'log', no: '③', t: '기록 · 미응답', s: '감사 기록 · 채울 지식', fn: pageLog },
    { id: 'eval', no: '④', t: '골든셋 점검', s: '재현율 · 정직한 거절', fn: pageEval },
    { id: 'settings', no: '설', t: '설정', s: '기준 · AI 연결 · 백업', fn: pageSettings }
  ];
  function route() { var id = (location.hash || '').replace(/^#\//, '').split('?')[0]; return PAGES.filter(function (p) { return p.id === id; })[0] || (db.docs.length ? PAGES[0] : PAGES[1]); }
  function render() {
    var p = route();
    var nav = document.getElementById('nav'); nav.innerHTML = '';
    PAGES.forEach(function (x) {
      nav.appendChild(h('a', { href: '#/' + x.id, 'aria-current': x === p ? 'page' : null }, h('span', { class: 'no' }, x.no), h('span', { class: 't' }, x.t), h('span', { class: 's' }, x.s)));
    });
    var active = db.docs.filter(function (d) { return d.status === '운영'; }).length;
    document.getElementById('dataChip').textContent = db.docs.length ? '문서 ' + db.docs.length + '개(운영 ' + active + ') · 조각 ' + db.chunks.length + '개 · 국가 ' + L.countries(db).filter(function (c) { return c !== L.COMMON_COUNTRY; }).length : '문서 없음';
    var b = document.getElementById('sampleBanner');
    b.hidden = !db.docs.some(function (d) { return d.sample; });
    b.textContent = '지금 들어 있는 것은 가상 샘플 규정입니다(알파국 · 베타국 · 감마연합 — 실제 법규가 아니며 숫자도 지어낸 것). 실제로 쓰실 때는 ② 지식 문서에서 샘플을 지우고 인증팀이 승인한 문서를 넣어 주세요.';
    main.innerHTML = '';
    add(main, p.fn());
    document.title = p.t + ' — 인증법규 Agent';
    save();
  }
  window.addEventListener('hashchange', function () { render(); main.focus(); window.scrollTo(0, 0); });
  render();
})();
