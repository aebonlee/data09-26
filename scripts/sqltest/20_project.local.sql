-- ============================================================================
-- 로컬 검증 전용 — data09-26 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B 두 명과 비로그인(anon)을 번갈아 흉내 내어
--  ① 본인 행만 보이는가 ② 남의 문서에 조각을 끼워 넣을 수 없는가
--  ③ 기록(qa_log · qa_feedback_log)은 고치거나 지울 수 없는가 ④ anon 은 아무것도 못 하는가
--  ⑤ CHECK·UNIQUE·외래키·연쇄 삭제·코드 변경 전파 ⑥ 함수 권한 을 잰다. 값은 전부 가상(알파국 샘플).
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice '  OK   %', p_label; return; end if;
    raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 % — %)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %  (기대 SQLSTATE % 인데 성공했다)', p_label, p_state;
end;
$fn$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com')
on conflict (id) do nothing;

do $t$ begin raise notice '[프로젝트] data09-26 — 소유자 격리 · 문서 소속 · 기록 불변 · anon 차단 · 제약 · 함수 권한'; end $t$;

-- ----------------------------------------------------------------------------
-- 1. 사용자 A 가 가상 문서 1개 · 조각 2개 · 질의 기록 2건 · 피드백 · 골든셋을 저장한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
declare v_id bigint;
begin
  insert into public.kb_document (code, title, country, field, revised, effective, status, source, body, chunk_mode)
  values ('ALP-EM-2025', '알파국 배출가스 기준(가상)', '알파국(가상)', '배출가스', '2025-03-01', '2026-01-01', '운영', '가상 샘플', '제3조(배출 허용 기준) ① …', 'article');
  insert into public.kb_chunk (doc_code, chunk_id, label, title, body, page, ord) values
    ('ALP-EM-2025', 'ALP-EM-2025 제3조 ①', '제3조 ①', '배출 허용 기준', '입자상물질 배출량은 0.020 g/kWh 이하이어야 한다.', 1, 0),
    ('ALP-EM-2025', 'ALP-EM-2025 제7조', '제7조', '인증의 유효기간', '인증의 유효기간은 인증일로부터 4년으로 한다.', 2, 1);
  insert into public.qa_log (question, filters, status, coverage, evidence, answer, verdict, flagged)
  values ('알파국 입자상물질 기준은?', '{"country":"알파국(가상)"}', 'sufficient', 1, '[{"label":"E1","chunkId":"ALP-EM-2025 제3조 ①"}]', '0.020 g/kWh 이하입니다. [E1]', 'pass', 0)
  returning id into v_id;
  insert into public.qa_log (question, status, missing) values ('독일 배출가스 기준은?', 'insufficient', '{독일}');
  insert into public.qa_feedback_log (qa_id, feedback) values (v_id, '도움됨');
  insert into public.golden_question (question, expect) values ('알파국 입자상물질 기준은?', '{"ALP-EM-2025 제3조 ①"}');
  insert into public.golden_question (question, refuse) values ('독일 배출가스 기준은?', true);

  perform public._assert_eq((select owner_id from public.kb_chunk where label = '제7조'),
    '11111111-1111-1111-1111-111111111111'::uuid, 'owner_id 기본값이 auth.uid() 로 채워진다');
  perform public._assert_eq((select count(*) from public.qa_log), 2::bigint, 'A 는 자기 질의 기록 2건을 본다');
end $t$;
commit;

begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
declare n bigint;
begin
  update public.kb_document set title = '알파국 비도로 배출가스 기준(가상)' where code = 'ALP-EM-2025';
  perform public._assert((select updated_at > created_at from public.kb_document where code = 'ALP-EM-2025'), 'updated_at 트리거가 수정 시각을 갱신한다');
  -- 기록은 본인 것이라도 고치거나 지울 수 없다(감사 기록)
  -- 인증 분야(2026-09-30 「사이버 보안」 추가): 목록 밖 값은 막는다
  perform public._assert_raises($s$insert into public.kb_document (code, country, field) values ('BET-CS-X', '베타국(가상)', '해킹')$s$,
    '23514', '인증 분야 목록 밖 값(해킹)은 저장되지 않는다');
  perform public._assert_raises($s$update public.qa_log set answer = '고친 답'$s$, '42501', 'A 도 자기 질의 기록을 고칠 수 없다');
  perform public._assert_raises($s$delete from public.qa_log$s$, '42501', 'A 도 자기 질의 기록을 지울 수 없다');
  perform public._assert_raises($s$delete from public.qa_feedback_log$s$, '42501', 'A 도 피드백 기록을 지울 수 없다');
  -- 문서 코드를 바꾸면 조각의 doc_code 가 따라 바뀐다(on update cascade) — 단, 조각 ID 머리 규칙이 막아 준다
  perform public._assert_raises($s$update public.kb_document set code = 'ALP-EM-2026' where code = 'ALP-EM-2025'$s$,
    '23514', '문서 코드만 바꾸고 조각 ID 를 그대로 두면 막는다(조각 ID 는 「문서코드 조항」)');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 2. 사용자 B — A 의 행을 보지도, 고치지도, 지우지도, 대신 쓰지도 못한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
declare n bigint;
begin
  perform public._assert_eq(
    (select count(*) from public.kb_document) + (select count(*) from public.kb_chunk) + (select count(*) from public.qa_log)
    + (select count(*) from public.qa_feedback_log) + (select count(*) from public.golden_question),
    0::bigint, 'B 에게는 A 의 행이 5개 표 어디에서도 보이지 않는다');
  update public.kb_chunk set body = '조작';
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 UPDATE 는 A 의 조각에 닿지 않는다');
  delete from public.kb_document;
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 DELETE 는 A 의 문서에 닿지 않는다');
  perform public._assert_raises(
    $s$insert into public.kb_document (owner_id, code, country) values ('11111111-1111-1111-1111-111111111111', 'FAKE-1', '알파국')$s$,
    '42501', 'B 는 owner_id 를 A 로 적어 대신 쓸 수 없다');
  -- B 가 A 의 문서 코드를 알아냈다고 가정한다
  perform public._assert_raises(
    $s$insert into public.kb_chunk (doc_code, chunk_id, label, body) values ('ALP-EM-2025', 'ALP-EM-2025 제9조', '제9조', '가짜 조항')$s$,
    '23503', 'B 는 자기 owner_id 로라도 A 의 문서에 조각을 끼워 넣을 수 없다 (복합 외래키)');
  perform public._assert_raises(
    $s$insert into public.qa_feedback_log (qa_id, feedback) values ((select 1), '오답 신고')$s$,
    '23503', 'B 는 A 의 질의 기록에 피드백을 달 수 없다 (복합 외래키)');
  insert into public.kb_document (code, country) values ('ALP-EM-2025', '알파국(가상)');
  perform public._assert_eq((select count(*) from public.kb_document), 1::bigint, '같은 문서 코드라도 사용자가 다르면 따로 저장된다');
end $t$;
commit;

do $t$
begin
  perform public._assert_eq((select count(*) from public.kb_chunk where owner_id = '11111111-1111-1111-1111-111111111111'), 2::bigint,
    'B 의 시도 뒤에도 A 의 조각 2개는 그대로다');
  perform public._assert_eq((select answer from public.qa_log where verdict = 'pass'), '0.020 g/kWh 이하입니다. [E1]',
    'A 의 질의 기록 답은 처음 그대로다');
end $t$;

-- ----------------------------------------------------------------------------
-- 3. 비로그인(anon) — 읽기도 쓰기도 막힌다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '';
set local role anon;
do $t$
declare t text;
begin
  foreach t in array array['kb_document', 'kb_chunk', 'qa_log', 'qa_feedback_log', 'golden_question']
  loop
    perform public._assert_raises(format('select * from public.%I', t), '42501', 'anon 은 ' || t || ' 를 읽을 수 없다');
  end loop;
  perform public._assert_raises($s$insert into public.qa_log (question, status) values ('x', 'clarify')$s$, '42501', 'anon 은 기록을 남길 수 없다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 4. 정책 구조
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  select string_agg(p.polname, ', ') into v_bad
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%owner_id = auth.uid()%';
  perform public._assert(v_bad is null, '모든 정책이 owner_id = auth.uid() 로 묶여 있다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    16::bigint, '정책 수가 16개다 (문서·조각·골든셋 4개씩 + 기록 2표 2개씩, 재실행해도 늘지 않는다)');
  perform public._assert(not has_table_privilege('authenticated', 'public.qa_log', 'UPDATE') and not has_table_privilege('authenticated', 'public.qa_log', 'DELETE'),
    '기록 표는 authenticated 에게도 UPDATE·DELETE 권한이 없다');
end $t$;

-- ----------------------------------------------------------------------------
-- 5. CHECK · UNIQUE · 외래키 · 연쇄 삭제
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  perform public._assert_raises($s$insert into public.kb_document (code, country, field) values ('X-1', '알파국', '전파')$s$, '23514', '인증 분야는 정해진 7가지 중 하나다');
  perform public._assert_raises($s$insert into public.kb_document (code, country, status) values ('X-2', '알파국', '폐기')$s$, '23514', '문서 상태는 운영 · 검수 중 · 구버전 중 하나다');
  perform public._assert_raises($s$insert into public.kb_document (code, country) values ('X 3', '알파국')$s$, '23514', '문서 코드에 빈칸을 넣을 수 없다(인용 ID 가 흔들림)');
  perform public._assert_raises($s$insert into public.kb_document (code, country) values ('X-4', '  ')$s$, '23514', '국가는 비워 둘 수 없다');
  perform public._assert_raises($s$insert into public.kb_document (code, country) values ('ALP-EM-2025', '알파국')$s$, '23505', '같은 사용자의 문서 코드는 하나뿐이다');
  perform public._assert_raises($s$insert into public.kb_chunk (doc_code, chunk_id, label, body) values ('ALP-EM-2025', 'OTHER 제1조', '제1조', '본문')$s$,
    '23514', '조각 ID 는 「문서코드 + 빈칸」으로 시작해야 한다');
  perform public._assert_raises($s$insert into public.kb_chunk (doc_code, chunk_id, label, body) values ('ALP-EM-2025', 'ALP-EM-2025 제3조 ①', '제3조 ①', '중복')$s$,
    '23505', '같은 조각 ID 는 하나뿐이다');
  perform public._assert_raises($s$insert into public.kb_chunk (doc_code, chunk_id, label, body) values ('ALP-EM-2025', 'ALP-EM-2025 제8조', '제8조', '   ')$s$,
    '23514', '빈 조각은 저장하지 않는다');
  perform public._assert_raises($s$insert into public.kb_chunk (doc_code, chunk_id, label, body, page, page_end) values ('ALP-EM-2025', 'ALP-EM-2025 제8조', '제8조', '본문', 3, 2)$s$,
    '23514', '끝 쪽이 시작 쪽보다 앞설 수 없다');
  perform public._assert_raises($s$insert into public.kb_chunk (doc_code, chunk_id, label, body) values ('없는-문서', '없는-문서 제1조', '제1조', '본문')$s$,
    '23503', '없는 문서에는 조각을 붙일 수 없다');
  perform public._assert_raises($s$insert into public.qa_log (question, status, answer) values ('독일은?', 'insufficient', '추정한 답')$s$,
    '23514', '「근거 없음」 기록에는 답이 있을 수 없다(근거 없이는 AI 를 부르지 않음)');
  perform public._assert_raises($s$insert into public.qa_log (question, status) values ('q', 'maybe')$s$, '23514', '판정은 네 가지(충분·일부·없음·되묻기) 중 하나다');
  perform public._assert_raises($s$insert into public.qa_log (question, status, coverage) values ('q', 'partial', 1.5)$s$, '23514', '핵심 낱말 비율은 0~1 이다');
  perform public._assert_raises($s$insert into public.qa_feedback_log (qa_id, feedback) values ((select min(id) from public.qa_log), '좋음')$s$, '23514', '피드백은 도움됨 · 오답 신고 둘 중 하나다');
  perform public._assert_raises($s$insert into public.golden_question (question, expect, refuse) values ('g', '{"ALP-EM-2025 제7조"}', true)$s$,
    '23514', '골든셋은 정답 조각이 있거나 「거절」 둘 중 하나다');
  perform public._assert_raises($s$insert into public.golden_question (question) values ('g2')$s$, '23514', '정답 조각도 없고 거절도 아닌 골든셋은 막는다');

  delete from public.kb_document where code = 'ALP-EM-2025';
  perform public._assert_eq((select count(*) from public.kb_chunk), 0::bigint, '문서를 지우면 그 조각도 함께 지워진다');
  perform public._assert_eq((select count(*) from public.qa_log), 2::bigint, '문서를 지워도 질의 기록은 남는다(감사)');
end $t$;
commit;

-- 사이버 보안 분야 문서는 저장된다(2026-09-30 추가, 다른 검증 수에 영향이 없도록 되돌림)
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  insert into public.kb_document (code, title, country, field) values ('BET-CS-2026', '베타국 사이버 보안 요건(가상)', '베타국(가상)', '사이버 보안');
  perform public._assert_eq((select field from public.kb_document where code = 'BET-CS-2026'), '사이버 보안'::text, '「사이버 보안」 분야 문서를 저장할 수 있다');
end $t$;
rollback;

-- ----------------------------------------------------------------------------
-- 6. 함수 권한 · search_path · 표 권한
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid)));
  perform public._assert(v_bad is null, 'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and not coalesce('search_path=public' = any(p.proconfig), false);
  perform public._assert(v_bad is null, '모든 함수에 search_path = public 이 고정돼 있다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'SELECT');
  perform public._assert(v_bad is null, 'anon 에게 표 SELECT 권한이 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;
