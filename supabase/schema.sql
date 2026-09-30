-- ============================================================================
-- data09-26 — 인증법규 Agent (근거 한정 RAG)
-- Supabase(PostgreSQL) DB 스키마 + RLS
--
--  실행 위치 : 수강생 본인 Supabase 프로젝트(또는 사내 PostgreSQL)의 SQL Editor 에서 실행
--              (Dashboard → SQL Editor → 이 파일 전체를 붙여넣고 Run)
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  지금 도구는 브라우저 localStorage 의 `data09-26.db` 한 칸에 모든 것을 둡니다.
--    docs[]    → kb_document (문서 한 개 = 메타데이터 + 원문 글)
--    chunks[]  → kb_chunk    (조항 조각 한 개 = 인용 ID·조항·쪽·본문, 선택: 임베딩)
--    log[]     → qa_log      (질문 · 판정 · 근거 조항 · 답 · 검증 결과) — 감사 기록이라 고치거나 지우지 않음
--    feedback  → qa_feedback_log (도움됨 · 오답 신고) — 역시 덧붙이기만
--    golden    → golden_question (골든셋)
--  BM25 색인은 조각에서 다시 만드는 파생 데이터라 저장하지 않습니다.
--
--  권한 원칙 : 모든 행은 만든 사람(owner_id = auth.uid())만 봅니다(1단계 = 개인 도구 전제).
--              팀 공유(인증팀이 올리고 현업이 읽기)는 2단계에서 그룹 표를 더해 정책을 넓힙니다.
--  조각은 (owner_id, doc_code) 복합 외래키로 문서를 가리켜 남의 문서에 조각을 끼워 넣을 수 없고,
--  문서를 지우면 조각도 함께 지워집니다. 문서 코드를 바꾸면 조각의 doc_code 도 따라 바뀝니다.
--  이 스키마는 수강생 본인 프로젝트 전제라 테이블 이름에 접두사를 붙이지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.kb_document (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  code        text not null check (code ~ '^[0-9A-Za-z가-힣][0-9A-Za-z가-힣-]{0,39}$'),  -- 인용 ID 머리(예: ALP-EM-2025)
  title       text not null default '',
  country     text not null check (length(trim(country)) > 0),   -- '공통(사내)' = 어느 나라 질문에도 함께 찾음
  field       text not null default '기타',                        -- 허용 값은 아래 kb_document_field_check
  revised     date,                                              -- 개정일
  effective   date,                                              -- 시행일
  status      text not null default '운영' check (status in ('운영', '검수 중', '구버전')),
  source      text not null default '',                          -- 원문 위치(M365 폴더 경로·기관 URL)
  file_name   text not null default '',
  format      text not null default '',
  body        text not null default '',                          -- 원문 글(조각을 다시 만들 때 씀)
  chunk_mode  text not null default 'para' check (chunk_mode in ('article', 'section', 'heading', 'para')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint kb_document_uniq unique (owner_id, code)            -- upsert onConflict = 'owner_id,code'
);

-- 인증 분야 목록 — js/logic.js 의 FIELDS 와 같아야 합니다(test/logic.test.mjs 가 대조).
-- 2026-09-30 「사이버 보안」 추가. 표를 이미 만든 DB 에서도 이 파일을 다시 실행하면 새 목록으로 바뀝니다.
alter table public.kb_document drop constraint if exists kb_document_field_check;
alter table public.kb_document add constraint kb_document_field_check
  check (field in ('배출가스', '안전', '소음', 'EMC', '기능안전', '사이버 보안', '형식승인', '기타'));

create table if not exists public.kb_chunk (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  doc_code    text not null,
  chunk_id    text not null,                                     -- '문서코드 조항' (예: 'ALP-EM-2025 제3조 ①') = 답의 인용·기록에 쓰는 ID
  label       text not null,
  title       text not null default '',
  path        text not null default '',                          -- 장·상위 절
  body        text not null check (length(trim(body)) > 0),
  page        integer check (page is null or page >= 1),
  page_end    integer check (page_end is null or page_end >= 1),
  ord         integer not null default 0 check (ord >= 0),
  embedding   real[],                                            -- 선택(벡터 검색). pgvector 를 쓰면 vector(n) 으로 바꿈
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint kb_chunk_uniq unique (owner_id, chunk_id),          -- upsert onConflict = 'owner_id,chunk_id'
  constraint kb_chunk_id_prefix check (left(chunk_id, length(doc_code) + 1) = doc_code || ' '),
  constraint kb_chunk_pages check (page_end is null or page is null or page_end >= page),
  constraint kb_chunk_doc_fk foreign key (owner_id, doc_code)
    references public.kb_document (owner_id, code) on delete cascade on update cascade
);
create index if not exists kb_chunk_doc_idx on public.kb_chunk (owner_id, doc_code, ord);

create table if not exists public.qa_log (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  asked_at    timestamptz not null default now(),
  question    text not null check (length(trim(question)) > 0),
  filters     jsonb not null default '{}'::jsonb,                -- {country, field}
  status      text not null check (status in ('sufficient', 'partial', 'insufficient', 'clarify')),
  coverage    numeric not null default 0 check (coverage between 0 and 1),
  missing     text[] not null default '{}',                      -- 근거에서 찾지 못한 낱말(미응답 분석)
  evidence    jsonb not null default '[]'::jsonb,                -- [{label, chunkId, score}] — 그때의 근거 조항
  answer      text not null default '',
  verdict     text not null default '' check (verdict in ('', 'pass', 'flagged', 'fail', 'refused', 'empty')),
  flagged     integer not null default 0 check (flagged >= 0),
  -- 근거 없음이면 답(AI 호출)이 있을 수 없다 — 도구가 고정 문구로 거절했다는 기록
  constraint qa_log_no_answer_without_evidence check (status <> 'insufficient' or answer = ''),
  constraint qa_log_owner_id_uniq unique (owner_id, id)
);
create index if not exists qa_log_status_idx on public.qa_log (owner_id, status, asked_at desc);

create table if not exists public.qa_feedback_log (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  qa_id       bigint not null,
  feedback    text not null check (feedback in ('도움됨', '오답 신고')),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  constraint qa_feedback_log_fk foreign key (owner_id, qa_id) references public.qa_log (owner_id, id)
);

create table if not exists public.golden_question (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  question    text not null check (length(trim(question)) > 0),
  expect      text[] not null default '{}',                      -- 정답 조각 ID 들
  refuse      boolean not null default false,                    -- true = 반드시 「근거 없음」이어야 함
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint golden_question_uniq unique (owner_id, question),
  constraint golden_question_kind check (refuse = (cardinality(expect) = 0))
);

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거 (search_path 고정)
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['kb_document', 'kb_chunk', 'golden_question']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만. 기록(_log)은 읽기·덧붙이기만(UPDATE/DELETE 정책 없음)
-- ----------------------------------------------------------------------------

alter table public.kb_document     enable row level security;
alter table public.kb_chunk        enable row level security;
alter table public.qa_log          enable row level security;
alter table public.qa_feedback_log enable row level security;
alter table public.golden_question enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['kb_document', 'kb_chunk', 'qa_log', 'qa_feedback_log', 'golden_question']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', t || '_insert', t);
    if t not like '%log' then
      execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_update', t);
      execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())', t || '_delete', t);
    end if;
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 표 권한 — Supabase 는 새 표마다 anon 에도 전 권한을 붙인다. 정책 + 권한 회수 두 겹.
--    기록 표는 authenticated 에게도 UPDATE·DELETE 권한을 주지 않는다(정책이 없어도 한 겹 더).
-- ----------------------------------------------------------------------------

revoke all on public.kb_document, public.kb_chunk, public.qa_log, public.qa_feedback_log, public.golden_question from anon;
revoke all on public.qa_log, public.qa_feedback_log from authenticated;
grant select, insert, update, delete on public.kb_document, public.kb_chunk, public.golden_question to authenticated;
grant select, insert on public.qa_log, public.qa_feedback_log to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한 — PUBLIC 과 anon 을 둘 다 끊는다(Supabase 가 anon 에 자동 부여하므로).
--    트리거 전용 함수는 authenticated 를 남긴다.
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated;

-- ============================================================================
-- 끝.
-- ============================================================================
