# Supabase DB 스크립트

이 폴더에는 이 도구의 저장 데이터를 PostgreSQL(Supabase 또는 사내 PostgreSQL)로 옮길 때 쓰는 스키마가 들어 있습니다.
지금 도구는 **계정 없이 브라우저 저장소(localStorage)** 만 씁니다. DB 에 연결하는 코드는 2단계에서 붙입니다.

## 왜 DB 가 필요한가

- **문서가 많아지면 브라우저 한 칸으로는 부족합니다.** 브라우저 저장소는 보통 5MB 안팎이고, PC · 브라우저마다 따로이며, 정리하면 사라집니다.
- **인증팀이 올린 문서를 현업이 함께 봐야 합니다**(기획서 8장 2단계). 한곳에 모아야 같은 근거로 답합니다.
- **감사 기록은 고칠 수 없어야 합니다.** 질문 · 근거 조항 · 답 · 검증 결과(`qa_log`)와 피드백(`qa_feedback_log`)은 덧붙이기만 되고, 본인도 고치거나 지울 수 없습니다(정책 없음 + 권한 회수, 두 겹).
- **인용 ID 가 흔들리지 않게** — 조각 ID 는 「문서코드 조항」 규칙을 DB 가 지키고(`kb_chunk_id_prefix`), 문서를 지우면 조각도 함께 지워지지만 질의 기록은 남습니다.

## 테이블

| 테이블 | 용도 | localStorage 대응 |
|---|---|---|
| `kb_document` | 문서 한 개 — 코드 · 이름 · 국가 · 인증 분야 · 개정일 · 시행일 · 상태(운영 · 검수 중 · 구버전) · 출처 · 원문 글 | `docs[]` |
| `kb_chunk` | 조항 조각 — 조각 ID · 조항 · 제목 · 위치 · 본문 · 쪽 · 순서 · (선택) 임베딩 | `chunks[]` · `vectors` |
| `qa_log` | 질의 기록 — 질문 · 조건 · 판정 · 핵심 낱말 비율 · 없던 낱말 · 근거 조항 · 답 · 검증 결과 | `log[]` |
| `qa_feedback_log` | 도움됨 · 오답 신고 | `log[].feedback` |
| `golden_question` | 골든셋 — 질문 · 정답 조각 ID 들 또는 「거절」 | `golden` |

BM25 색인은 조각에서 다시 만들므로 저장하지 않습니다.

### 권한

- 모든 표에 RLS(행 수준 보안)를 켰고, 모든 행은 만든 사람만 봅니다(`owner_id = auth.uid()`, 자동으로 채워짐). 1단계가 개인 도구라서이고, 팀 공유 정책은 2단계에서 그룹 표와 함께 넓힙니다.
- `kb_chunk` 는 `(owner_id, doc_code)` 로 문서를 가리킵니다. 남의 문서 코드를 알아내도 거기에 조각을 끼워 넣을 수 없습니다. 피드백도 `(owner_id, qa_id)` 로 본인 기록에만 달립니다.
- 기록 표(`qa_log` · `qa_feedback_log`)는 SELECT · INSERT 정책만 있고, UPDATE · DELETE 권한도 회수했습니다.
- 「근거 없음」 기록에는 답이 있을 수 없습니다(`qa_log_no_answer_without_evidence`) — 근거가 없으면 AI 를 부르지 않는다는 규칙을 DB 가 한 번 더 지킵니다.
- 로그인하지 않은 사용자(anon)는 어떤 표도 읽거나 쓸 수 없습니다.
- 앱에서 upsert 할 때 `onConflict` 는 `owner_id,code` · `owner_id,chunk_id` · `owner_id,question` 입니다.

## 적용 방법

1. <https://supabase.com> 에 가입하고 이 도구 전용으로 새 프로젝트를 만듭니다(그래서 표 이름에 접두사가 없습니다). 사내 PostgreSQL 을 쓸 때는 `auth.uid()` 를 사내 로그인 체계에 맞게 바꿔야 합니다.
2. 왼쪽 메뉴 **SQL Editor** 에 `supabase/schema.sql` 내용을 전부 붙여넣고 **Run** 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표는 건너뛰고 정책 · 트리거는 지우고 다시 만듭니다.

## 확인 방법

1. **Table Editor** 에 위 5개 표가 있고, 표마다 RLS 가 켜져 있는지 봅니다.
2. **Authentication → Policies** 에서 정책이 16개(문서 · 조각 · 골든셋 4개씩, 기록 2개 표는 SELECT · INSERT 2개씩)인지 봅니다.
3. SQL Editor 에서 함수 권한에 `anon` 이 없는지 봅니다.

```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
```

## 로컬 검증 방법

운영에서 처음 실행하지 않도록, 임시 로컬 PostgreSQL 에 실제로 적용해 검사하는 도구를 함께 두었습니다(run.sh · 스텁 · 공통 검사는 data09-11 과 같은 파일).

```sh
./scripts/sqltest/run.sh
```

PostgreSQL 16 이상이 필요합니다(macOS: `brew install postgresql@17`). 임시 DB 를 만들어 쓰고 끝나면 지웁니다.

- 스키마를 두 번 적용해도 오류가 없는가
- 사용자 A 의 행이 사용자 B 에게 보이지 않고, 고치거나 지울 수도 없는가 · 남의 문서에 조각을, 남의 기록에 피드백을 붙일 수 없는가
- 본인도 질의 기록 · 피드백을 고치거나 지울 수 없는가 · 로그인하지 않은 사용자는 아무것도 못 하는가
- 인증 분야 · 상태 · 판정 · 피드백 값 목록, 빈칸 든 문서 코드, 조각 ID 머리, 빈 조각, 쪽 순서, 근거 없음 + 답, 골든셋 형식을 막는가
- 문서를 지우면 조각이 함께 지워지고 기록은 남는가 · 함수 실행 권한에 PUBLIC · anon 이 남지 않았는가

검사용 SQL(`scripts/sqltest/*.local.sql`)은 로컬 전용이며, Supabase 운영 DB 에서 실행하면 스스로 멈춥니다.
