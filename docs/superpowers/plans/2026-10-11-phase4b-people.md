# 4b단계 · 관리자 사람 탭 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권사님이 **사람** 탭에서 교인을 찾아(이름·번호, 필터 칩) 전체 번호와 태그를 보고, 사람 상세에서 **번호·이름 수정 · 가족 보기 · 발급·사용 이력**을 확인하고, 잘못 들어온 데이터를 화면에서 바로잡게 한다 — **중복 사람 합치기**, **사람 초기화**(잘못 가입), **카카오 계정 수동 연결**. 발급 취소에는 **사유 입력**을 붙이고 이력에 사유를 보여 준다.

**Architecture:** 교인 수가 수백 규모라 사람 목록은 한 번에 전부 읽고(관리자 RLS) **검색·필터·가족 수 계산은 순수 함수로 클라이언트에서** 한다(서버 왕복 없음, 즉시 반응). 쓰기 중 이름·번호 수정만 `people` 의 관리자 update 정책(열 권한 `name`·`phone`)으로 직접 하고, 사람을 합치거나 초기화·연결하는 것은 **SECURITY DEFINER 함수 3개**로만 한다 — 장부·자녀·계정·가족을 한 트랜잭션에서 옮겨야 하기 때문이다. 잠금은 3단계 규칙 그대로(② 사람 행 id 순 → ③ `lock_family` 가족 id 순), 자녀의 `guardian_id` 를 바꾸므로 **대상 보호자 행도 반드시 잠근다**(3단계 Task 3 리뷰 인계).

**Tech Stack:** 4a 와 동일 — React 19 · Vite 8 · TypeScript 6(strict) · Tailwind v4 · react-router 7(HashRouter) · TanStack Query 5 · supabase-js 2 · zod 4 · Vitest 4 · Playwright 1.63 · Supabase CLI 2.120.0 · pgTAP.

**설계 문서:** `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md` §7.3(`merge_people` · `link_person` · `admin_reset_person`), §8.1(라우트 `#/admin/people`, `#/admin/people/:id`), §8.3(사람), §9(가입·연결 예외, 관리자·운영), §10(개인정보 — 전체 번호는 관리자 사람 탭에서만). 인계 목록: 3단계 계획 `docs/superpowers/plans/2026-10-09-phase3-family.md` 의 "4단계로 넘기는 것", 4a 계획 `docs/superpowers/plans/2026-10-10-phase4a-meal-detail.md` 의 "다음 계획(4b·4c)으로 넘기는 것".

**4단계 분할:** 4a(식사 상세 현황판 + 식권 조작)는 2026-10-10 운영 배포 완료. **4b(이 계획)** 사람 탭. **4c** 통계·CSV·카톡 공유.

---

## 범위

| 영역 | 이 계획에서 하는 것 |
|---|---|
| DB | `merge_people(from, into)` · `admin_reset_person(person)` · `link_person(person, auth_user)` 신설(잠금 규칙 적용, 코드 목록은 각 함수 헤더). pgTAP `150_admin_people_ops.sql`(48). 타입 재생성 |
| 사람 목록 | `#/admin/people`: 전체 1회 조회 + 클라이언트 검색(이름·번호 뒷자리)·필터 칩(전체·미가입·관리자)·태그(관리자·자녀·미가입·가족 N명)·전체 번호 표시. 하단 탭에 **사람** 추가 |
| 사람 상세 | `#/admin/people/:personId`: 이름·전체 번호·태그, **이름·번호 수정**(관리자 열 권한으로 직접 update), **가족 보기**(구성원 목록 + 가족 탭과 같은 태그), **발급·사용 이력**(취소·무효 표시 + 취소 사유), **합치기 · 초기화 · 계정 연결** |
| 식사 현황판 | 발급 취소에 **사유 입력 칸**(`cancel_issuance` 의 `p_reason` 를 실제로 쓴다) |
| 공통 | 오류 문구 5개. E2E `e2e/people.spec.ts`. README 운영 체크리스트의 임시 SQL 제거, 설계 §8.3·§9·§14·§15 동기화 |

**설계와 다른 점(의도적):**
- 목록 태그에서 **"방문자" 는 빼고 "관리자" 를 넣는다.** 지금 스키마에는 방문자를 구분하는 열이 없다(선발급자와 같은 "계정 없는 사람" 이다) — 없는 정보를 태그로 만들지 않는다. 대신 권사님이 실제로 알아야 하는 `role = 'admin'` 을 태그로 둔다.
- 목록은 **익명화된 행(탈퇴·삭제·합쳐진 사람)을 보여 주지 않는다.** 이름이 모두 '탈퇴한 사용자' 라 검색에 방해만 된다. 그 사람들의 장부는 식사 현황판·통계(4c)에서 집계로 보인다.
- **카카오 계정 수동 연결은 "되돌리기" 전용 경로다.** 관리자가 Supabase 대시보드에서 계정 id(uuid)를 복사해 붙여 넣는다. 교인이 스스로 가입하면 자동 연결(`claim_person`)되거나 중복 행이 생겨 **합치기**로 해결되므로, 이 화면은 초기화 뒤 같은 계정으로 되돌릴 때만 쓴다. 동의 기록이 없는 사람에게는 연결하지 않는다(`consent_required`) — 동의를 대신 기록하지 않는다.
- 합치기는 **사람 상세에서 "이 사람으로 합치기"** 로만 한다(보고 있는 사람이 `into`, 고른 사람이 `from`). 목록에서 두 개를 고르는 UI 는 두지 않는다.

**중간 배포:** Task 5(사람 상세 읽기 + 번호 수정) 커밋 직후면 "교인 찾아 전체 번호·이력 확인 + 번호 고치기" 까지 되고 마이그레이션은 Task 1 하나뿐이다. 사용자가 원하면 그 시점에 PR 을 만든다(아래 Task 5 끝의 중간 배포 지점 참고).

## 구현 결과와 계획의 차이 (실행 중 리뷰로 바뀐 것)

- **Task 1** (DB): 계획 초안의 `merge_people` 은 빈 옛 가족을 지우지 못했다 — 익명화는 `family_id` 를 건드리지 않아 **익명화된 from 행이 옛 가족을 계속 가리키기** 때문이다(`not exists (people)` 가 거짓 → 조용히 0행 삭제; `deleted_at is null` 로 조건만 좁히면 FK 23503). 구현은 장부를 옮긴 뒤 **익명화된 행의 가족도 남는 쪽으로 옮기고** 나서 빈 가족을 지운다. 3단계 `add_family_member` 는 같은 상황에서 빈 껍데기 가족을 남기는데(문서에 "무해하다" 로 기록), 합치기는 "두 행이 같은 사람" 이라 익명화된 행을 남는 쪽 가족에 두는 편이 뜻에 맞고 껍데기도 쌓이지 않는다. 교인 화면에는 영향이 없다(가족 조회는 RLS·쿼리 모두 `deleted_at is null`). 관리자 사람 상세의 가족 목록에는 '초기화됨' 태그로 보인다.
- **Task 4** (상세 데이터): `IssuanceEntry` 에 `cancelReason` 이 생겨 **교인 내역 화면 테스트**(`src/pages/HistoryPage.test.tsx`)의 `LedgerEntry[]` 픽스처 두 곳에 `cancelReason: null` 을 더해야 했다(계획엔 없던 파일). `useFamilyLedger.test.tsx` 의 픽스처는 `ok(...)` 에 넘기는 무타입 리터럴이라 손댈 필요가 없었다.
- **Task 1** (테스트): `last_admin` 단언 뒤 관리자 인증 상태에서 `consented_at` 열을 넣으려다 `permission denied` — `authenticated` 에는 `insert (name, phone)` 열 권한만 있다. 그 insert 앞에 `tests.clear_auth()`, 뒤에 `tests.authenticate_as(admin)` 를 넣었다(공통 규약의 "직접 쓰기 전에 clear_auth" 그대로).
- **Task 5** (상세 화면): 구현이 두 군데서 편법을 썼고 되돌렸다. ① 가족 줄에서 **본인만** 번호 자리에 `'-'` 를 찍었다 — 테스트의 `getByText` 가 머리말과 중복으로 걸려서 생긴 변경인데, 화면에서는 "번호가 없는 사람" 으로 읽힌다. 모든 식구를 같은 모양으로 두고 테스트가 두 자리를 각각 못 박는다. ② `personSchema.test.ts` 의 `if (!r.ok) expect(...)` 세 곳을 `oxlint-disable` 로 덮었다 — `onboardingSchema.test.ts` 가 같은 상황에서 반대 결론을 적어 둔다(조건부 expect 는 검사가 안 돌아도 통과한다). 결과 전체를 `toEqual` 로 비교하면 억제도 필요 없고 기대하지 않은 필드 오류까지 잡힌다. ③ 테스트 헬퍼의 `over.phone ?? 기본값` 이 명시적 `null` 을 기본값으로 덮어써 `phone: null` 경로가 아예 안 돌았다(`=== undefined` 로 고쳤다).
- **Task 2** (목록 데이터, 리뷰 후속): 뮤테이션 테스트로 빈 자리 세 곳이 드러났다. ① `.order('name')` 에 두 번째 키가 없고 비교자도 동명이인에 0 을 돌려 **조회마다 줄 순서가 바뀔 수 있었다** — 합치기는 되돌릴 수 없고 누르는 순간의 줄이 곧 대상이므로, 서버(`.order('id')`)와 순수 함수(`|| id` 비교) 양쪽에서 고정했다. ② 숫자 **한 자리** 검색이 `010…` 전부에 걸렸다(`'김1'` 같은 오타도 교인 전체를 돌려줬다) — 번호 쪽에만 두 자리 하한을 뒀다. ③ `max_rows = 1000` 천장이 조용했다 — `MAX_PEOPLE` 로 명시하고 `.limit()` 을 붙였다. 더해서 칩 조건이 태그 규칙을 다시 쓰고 있어 태그를 단일 근거로 삼았다(이 중복 때문에 "자녀는 미가입이 아니다" 규칙이 뮤테이션에서 살아남았다). 주석의 근거도 틀렸다 — `auth_user_id` 는 `on delete set null` 이고 3단계에 `relink_child` 가 있으므로 **계정 없는 자녀는 정상 상태다**.
- **Task 3** (목록 화면, 리뷰 후속): **번호 없는 동명이인 두 줄이 보이는 글자도 읽히는 이름도 완전히 같았다.** `add_child` 는 번호 없이 자녀를 넣고 `people_phone_unique` 는 `where phone is not null` 이라 막아 주지 않는다 — 그 줄을 누르면 합치기·초기화가 걸린다. `decoratePeople` 에 `familyHint`('보호자 김철수' / '같은 가족 김철수')를 더하고, 줄 링크에 `aria-label` 을 직접 줬다(그냥 두면 이름과 첫 태그 사이에 공백 텍스트 노드가 없어 "권사관리자" 로 읽힌다). 합치기 **후보의 선택 버튼**도 같은 문제였다 — 접근성 이름에 번호 꼬리표를 붙였다. 빈 목록 문구를 원인별로 갈랐고(모두 가입한 교회에서 "미가입" 은 좋은 소식이다), 개수 줄에 `role="status"` 를 뒀다.
- **Task 1** (DB 품질 리뷰 결론): 마이그레이션은 **수정 없이 승인**됐다 — 12개 문장이 모두 `create or replace`/`comment`/`revoke`/`grant` 이고, 한 트랜잭션에서 두 번 재실행해도 `pg_proc` 의 소스·ACL·주석이 0행 차이인 무해한 재생이며, 두 세션 실험으로 ②③④ 잠금 순서와 교착 없음을 확인했다(반대 방향 합치기, `leave_family`·`add_family_member` 와의 경합 모두 40P01 없음). 받는 쪽 ④ 잠금이 불필요한 이유도 확인됐다 — 장부 이동은 목적지 묶음에 행을 **더하기만** 하므로 동시 `use_ticket` 은 보수적으로 적게 셀 뿐 음수가 되지 않는다. 테스트 쪽 빈 자리 세 곳(처리자 네 열의 이동, ③ `lock_family`, 익명화된 사람을 **받는 쪽**으로 삼는 경우)은 후속 커밋으로 채웠고, 전화번호 블록이 110 과 겹친 것도 옮겼다.
- **Task 7** (취소 사유, 리뷰 후속): 막는 결함 셋. ① **잔량 예비 검사가 사유 폼에서 뚫렸다** — `blocked` 이 트리거 버튼만 막고 그 버튼은 폼이 열리면 언마운트된다. 5초 폴링이 도는 동안 가족이 자기 폰에서 한 장을 쓰면 "남은 장수(N)보다 많아 취소할 수 없어요" 가 **켜진 취소하기** 위에 나타나고 그 버튼 문구는 아직 "가족 잔량이 N장 줄어요" 라고 약속한다. `ConfirmButton` 은 `disabled` 가 되는 순간 프롬프트를 닫아 이 상태에 닿지 않았다 — 입력 칸 때문에 폼으로 바꾸면서 그 보호를 잃었다. ② **관리자가 적은 취소 사유가 모든 가족 구성원의 폰으로 갔다** — 교인 화면은 '취소됨' 만 그리지만 값은 교인 브라우저가 받는 JSON 에 담겨 있었다(`issuances` 의 select 권한은 열 단위가 아니라 표 단위다). 교인 쪽 조회에서 열을 빼고, 공용 행 타입에서 선택 필드로 만들고, 한계를 설계 §10 에 적었다 — 열이 '비공개' 가 된 것은 아니므로 입력 칸 아래에 "가족도 볼 수 있어요" 를 둔다. ③ 폼이 열릴 때 **아무 말도 하지 않고 포커스를 잃었다** — 트리거가 언마운트되어 포커스가 body 로 떨어지고 새 질문은 맨 `<p>` 였다. 더해서 "그만두기" 가 취소 오류를 대상 없이 남겼고, `invalidatePeople` 이 가족 식구 목록과 발급 검색을 빼먹었다(초기화된 사람이 가족 탭에 남고 익명화된 사람이 계속 발급 대상으로 떴다).
- **Task 6** (되돌릴 수 없는 동작, 리뷰 후속): 합치기 **방향은 모든 자리에서 맞았다**(`useMergePeople(person.id)` + `merge.mutate(picked.id)`, `picked` 스냅샷이 재조회에도 id 를 고정, 모든 클라이언트 관문에 서버 관문이 받쳐 준다). 문제는 그 위의 **사람이 읽는 층**이었다. ① 번호 없는 동명이인 후보가 줄·접근성 이름·확인 문구 **네 자리 모두에서 글자까지 같았다** — 이 패널은 애초에 동명이인이 있을 때만 열리고, 둘 중 하나가 다른 생존 교인이면 어느 쪽을 익명화하는지 알 수 없다. 목록 화면이 이미 쓰는 조합(가족 힌트·등록일)을 후보에도 쓴다. ② 초기화 확인 문구가 **누구인지** 말하지 않았다 — 정정 구역은 가족·이력 목록 아래라 폰에서는 이름이 한참 위로 밀려 있다. ③ "그만두기" 가 선택만 지우고 오류는 남겨, 다른 후보의 확인 문구 위에 앞사람 오류가 붙었다. ④ 세 RPC 에 요청 시간 제한이 없어, 연결이 끊기면 **되돌릴 수 없는 동작의 확인 화면에** 오류도 재시도도 없이 갇혔다(4a 가 `withTimeout` 을 넣은 바로 그 이유). 뮤테이션 테스트에서 패널의 한 줄 결함 9개 중 8개가 통과했고, 그중 둘은 **이름 붙은 동작을 전혀 시험하지 않는 테스트**였다.
- **캐시 무효화가 이 브랜치의 약점이었다** — 같은 종류의 버그가 양방향으로 두 번 나왔다. 발급 취소·무효가 관리자 사람 이력을 무효화하지 않았고(E2E 가 찾았다), 합치기·초기화가 **익명 처리되는 쪽**의 상세·이력과 식사 현황판을 무효화하지 않았다(상대편 id 로 키가 잡히지 않았다). 둘 다 어느 id 인지 몰라도 되게 **접두사 무효화**로 고쳤다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20261011000001_admin_people_ops.sql` | `merge_people` · `admin_reset_person` · `link_person` |
| `supabase/tests/database/150_admin_people_ops.sql` | 위 세 함수 pgTAP (48) |
| `src/lib/database.types.ts` (재생성) | RPC 3개 추가 |
| `src/features/admin/peopleFilter.ts` (+test) | 순수: 사람 행 목록 → 태그·가족 수 붙이고 검색어·필터로 좁히기 |
| `src/features/admin/useAllPeople.ts` (+test) | 살아 있는 사람 전체 1회 조회 (`['all-people']`) |
| `src/features/admin/personSchema.ts` (+test) | zod: 관리자 이름·번호 수정(번호는 비울 수 있다), 계정 id(uuid) |
| `src/features/admin/usePersonDetail.ts` (+test) | 사람 1명 + 같은 가족 구성원 (`['person-detail', id]`) |
| `src/features/admin/usePersonLedger.ts` (+test) | 그 사람의 발급·사용 이력 (`['person-ledger', id]`), `mergeLedger` 재사용 |
| `src/features/admin/usePersonOps.ts` (+test) | 뮤테이션 4개(이름·번호 수정, 합치기, 초기화, 계정 연결) + 무효화 묶음 |
| `src/features/history/mergeLedger.ts` (수정, +test) | `cancel_reason` 을 엔트리에 싣는다(교인 화면은 쓰지 않는다) |
| `src/features/history/useFamilyLedger.ts` (수정) | select 에 `cancel_reason` 추가 |
| `src/pages/admin/AdminPeoplePage.tsx` (+test) | `#/admin/people` 목록 화면 |
| `src/pages/admin/PersonDetailPage.tsx` (+test) | `#/admin/people/:personId` 상세 화면 조립 |
| `src/features/admin/PersonEditForm.tsx` (+test) | 이름·번호 수정 폼 |
| `src/features/admin/PersonMergePanel.tsx` (+test) | 합치기: 상대 검색 → 두 단계 확인 |
| `src/features/admin/PersonDangerZone.tsx` (+test) | 초기화 · 계정 연결 |
| `src/components/PersonShell.tsx` (수정, +test) | 관리자 탭에 **사람** |
| `src/App.tsx` (수정) | 라우트 2개 |
| `src/lib/errors.ts` (수정, +test) | `same_person` `minor_not_allowed` `both_have_accounts` `account_not_found` `account_taken` |
| `src/features/admin/useMealOps.ts` (수정, +test) | `useCancelIssuance` 가 사유를 받는다 |
| `src/pages/admin/MealDetailPage.tsx` (수정, +test) | 발급 취소 사유 입력 칸 |
| `e2e/people.spec.ts` (신규) | 선발급 중복 → 합치기 → 이력 확인 |
| `README.md` · 설계 문서 · 이 계획 | 동기화 |

## 공통 규약 (1~4a 단계에서 이어받음 — 모든 Task 에 적용)

- **새 함수 체크리스트.** `auto_expose_new_tables = true` 가 새 함수에 `anon=X` 를 붙인다. 함수마다 `revoke execute … from public, anon` 을 적고 `grant … to authenticated`. pgTAP `020_people_schema.sql` 이 "anon 에 열린 public 함수는 `{ping}` 뿐" 을 고정한다.
- SECURITY DEFINER 는 `set search_path = public, pg_temp`. 오류는 `raise exception '<snake_case 코드>'`(값 보간 금지). **새 DB 오류 코드는 같은 커밋에서 `src/lib/errors.ts` 에 문구를 더한다** — 훅의 "서버가 판단한 거부" 판별(`rpcCodeOf`)이 MESSAGES 소속으로 돌아가서, 문구가 없으면 일반 문구로 떨어지고 화면 재조회·재시도 키 폐기까지 건너뛴다(4a Task 4 리뷰).
- **잠금 규칙:** ① `pairing_codes` 행 → ② 쓸 `people` 행을 **한 문장에서 id 순** `for update`(`perform 1 from public.people where id in (…) order by id for update;`) → ③ `public.lock_family(uuid)` 를 **가족 id 순**(`least`/`greatest`) → ④ `lock_family_meal(가족, 식사)` → 장부 행. 가족 잠금을 쥔 채 사람 행을 새로 잠그지 않는다. 자녀를 옮기는 함수는 **보호자(어른) 행을 자녀 행보다 먼저** 잠근다.
- pgTAP: `issuances`·`usages`·`people`·`ticket_balances` 를 **직접 읽거나 쓰기 전에 `tests.clear_auth()`**, RPC 호출 전에 다시 `tests.authenticate_as(...)`. 식사 제목·전화번호에 파일 번호를 박아 다른 테스트와 섞이지 않게 한다(`'테스트 점심 150'`, `0108888000x`).
- 프론트: 조회 화면은 `status` 가 아니라 **`data` 로 분기**(`data ? 본문 : status === 'error' ? alert+다시 시도 : <Spinner inline />`). 상세 화면은 `data !== undefined` 로 분기하고 `null` 은 "사람을 찾을 수 없어요" 로 쓴다(4a `MealDetailPage` 와 같은 꼴). 화면의 뮤테이션 오류는 다음 동작이 시작될 때 `reset()`. `onSuccess` 는 무효화 promise 를 return 하되 **대기에 한도**를 둔다(4a 최종 리뷰의 `SETTLE_TIMEOUT_MS` 패턴). 무효화 테스트는 훅마다 새 QueryClient + 키 목록 전체 단언. 알림은 `getByText` 로 찾는다.
- `verbatimModuleSyntax` 라 타입은 `import type`. `vi.fn<() => T>()` 처럼 타입 인자 필수. 컴포넌트 파일은 컴포넌트만 export(상수·훅은 `.ts` 로). effect 안에서 `setState` 를 바로 부르지 않는다.
- `ConfirmButton` 계약: `label`(바쁘면 `'처리 중…'`), `message`, `confirmLabel`, `onConfirm`, `disabled`, `align`, `context`(같은 라벨이 여러 줄일 때 sr-only 접두사 — 접근성 이름은 `"<context> <label>"`). 그만두기 버튼이 '취소' 라 **동작 라벨에 '취소' 를 단독으로 쓰지 않는다**. 이 계획의 라벨: `이 사람으로 합치기`/`합치기`, `사람 초기화`/`초기화`, `계정 연결`/`연결`, `발급 취소`/`취소하기`.
- `PersonShell` 아래 화면은 `<main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">`.
- 커밋 메시지 `<type>: <설명>` + 세션이 지정한 attribution 트레일러(2026-10-10 기준 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`). 작업 브랜치 `feat/phase4b-people`. `main` 직접 커밋 금지. PR 은 사용자가 merge 한다(merge 가 운영 마이그레이션을 실행한다).

```bash
cd /Users/hong-wongi/Dev/sample/meal-ticket
git checkout main && git pull --ff-only && git checkout -b feat/phase4b-people
git add docs/superpowers/plans/2026-10-11-phase4b-people.md && git commit -m "docs: 4b단계(사람 탭) 구현 계획

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 1: 마이그레이션 ⑮ `merge_people` · `admin_reset_person` · `link_person`

**Files:**
- Create: `supabase/migrations/20261011000001_admin_people_ops.sql`
- Create: `supabase/tests/database/150_admin_people_ops.sql`
- Regenerate: `src/lib/database.types.ts`

- [x] **Step 1: 실패하는 테스트**

`supabase/tests/database/150_admin_people_ops.sql`:

```sql
begin;
select plan(48);

-- ---------- 권한 ----------
select is(has_function_privilege('anon', 'public.merge_people(uuid,uuid)', 'EXECUTE'), false, 'anon 은 merge_people 을 실행할 수 없다');
select is(has_function_privilege('anon', 'public.admin_reset_person(uuid)', 'EXECUTE'), false, 'anon 은 admin_reset_person 을 실행할 수 없다');
select is(has_function_privilege('anon', 'public.link_person(uuid,uuid)', 'EXECUTE'), false, 'anon 은 link_person 을 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.merge_people(uuid,uuid)', 'EXECUTE'), true, 'authenticated 는 merge_people 을 실행할 수 있다');

-- ---------- 준비 ----------
-- 권사(관리자) · 김철수(계정 있음) · 이영희(계정 있음, 뒤에서 관리자로 올린다) · 사람 행 없는 계정 · 익명 계정
select tests.create_user('people-admin@test.local') as admin_uid \gset
select tests.create_user('people-a@test.local') as a_uid \gset
select tests.create_user('people-b@test.local') as b_uid \gset
select tests.create_user('people-ghost@test.local') as ghost_uid \gset
select tests.create_user() as anon_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('권사',   '01088880009', :'admin_uid', now(), '2026-10-07'),
       ('김철수', '01088880001', :'a_uid',     now(), '2026-10-07'),
       ('이영희', '01088880002', :'b_uid',     now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid from public.people where auth_user_id = :'b_uid' \gset

-- 같은 사람(김철수)이 선발급으로 한 번 더 들어간 중복 행: 계정 없음, 1인 가족, 자녀 하나, 오늘 식사 장부
insert into public.people (name, phone) values ('김철수', '01088880011') returning id as dup_pid \gset
select family_id as dup_fid from public.people where id = :'dup_pid' \gset
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'dup_fid', true, :'dup_pid', now()) returning id as kid_pid \gset
-- 익명화된 행 (person_not_found 확인용)
insert into public.people (name, phone, deleted_at) values ('탈퇴한 사용자', null, now()) returning id as gone_pid \gset
select (now() at time zone 'Asia/Seoul')::date as today \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 150', :'today', :'admin_pid') returning id as today_meal \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'dup_pid', :'dup_fid', :'today_meal', 2, 5000, :'admin_pid') returning id as dup_iss \gset
-- self 사용 1건: 쓴 사람과 기록자가 같다 (usages_self_recorded_by_person) — 합칠 때 두 열이 함께 옮겨져야 한다
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id)
values (:'dup_fid', :'dup_pid', :'today_meal', 'self', :'dup_pid', gen_random_uuid()) returning id as dup_use \gset

-- ---------- 로그인하지 않은 호출 ----------
select tests.clear_auth();
set local role authenticated;
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'a_pid'), 'P0001', 'not_authenticated', '로그인 없이 합칠 수 없다');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'a_pid'), 'P0001', 'not_authenticated', '로그인 없이 초기화할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'dup_pid', :'ghost_uid'), 'P0001', 'not_authenticated', '로그인 없이 연결할 수 없다');
reset role;

-- ---------- 교인(비관리자)은 셋 다 forbidden ----------
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'a_pid'), 'P0001', 'forbidden', '교인은 사람을 합칠 수 없다');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'dup_pid'), 'P0001', 'forbidden', '교인은 사람을 초기화할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'dup_pid', :'ghost_uid'), 'P0001', 'forbidden', '교인은 계정을 연결할 수 없다');

-- ---------- merge_people: 검증 ----------
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'a_pid', :'a_pid'), 'P0001', 'same_person', '같은 사람끼리는 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, gen_random_uuid(), :'a_pid'), 'P0001', 'person_not_found', '없는 사람은 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'gone_pid', :'a_pid'), 'P0001', 'person_not_found', '익명화된 사람은 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'kid_pid', :'a_pid'), 'P0001', 'minor_not_allowed', '자녀를 합칠 수 없다 (가족 탭에서 관리)');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'kid_pid'), 'P0001', 'minor_not_allowed', '자녀에게로 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'b_pid', :'a_pid'), 'P0001', 'both_have_accounts', '둘 다 계정이 있으면 거부');

-- ④ 잠금: 합치기 전에는 (중복 행 가족, 오늘 식사) 잠금이 없다
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'dup_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'today_meal'::text)::bigint & 4294967295)),
          0::bigint, '합치기 전에는 (옛 가족, 오늘 식사) ④ 잠금이 없다');

-- ---------- merge_people: 성공 (선발급 중복 → 계정 있는 본인) ----------
select lives_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'a_pid'), '관리자는 중복 사람을 합칠 수 있다');
-- 실패한 호출은 서브트랜잭션 롤백으로 잠금이 풀린다 — 성공한 호출 뒤에만 의미가 있다
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'dup_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'today_meal'::text)::bigint & 4294967295)),
          1::bigint, 'merge_people 이 옛 가족의 오늘 식사 ④ 잠금을 쥔다');
select tests.clear_auth();
select results_eq(
  format($$ select person_id, family_id, issued_by from public.issuances where id = %L $$, :'dup_iss'),
  format($$ values (%L::uuid, %L::uuid, %L::uuid) $$, :'a_pid', :'a_fid', :'admin_pid'),
  '발급은 구매자와 가족이 합쳐진 쪽으로 옮겨진다 (발급한 관리자는 그대로)');
select results_eq(
  format($$ select person_id, recorded_by, family_id from public.usages where id = %L $$, :'dup_use'),
  format($$ values (%L::uuid, %L::uuid, %L::uuid) $$, :'a_pid', :'a_pid', :'a_fid'),
  'self 사용은 쓴 사람·기록자가 함께 옮겨진다 (제약 위반 없이)');
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null from public.people where id = %L $$, :'dup_pid'),
  $$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true) $$,
  '합쳐진 쪽은 익명화된다');
select results_eq(
  format($$ select guardian_id, family_id from public.people where id = %L $$, :'kid_pid'),
  format($$ values (%L::uuid, %L::uuid) $$, :'a_pid', :'a_fid'),
  '자녀의 보호자와 가족도 함께 옮겨진다');
select is((select count(*) from public.families where id = :'dup_fid'), 0::bigint, '사람도 장부도 남지 않은 옛 가족은 지워진다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 1, '잔량 풀이 합쳐진다 (2장 발급 − 1장 사용)');

-- ---------- merge_people: 계정·관리자 권한이 옮겨 간다 ----------
-- 이영희(계정 있음)를 관리자로 올리고, 계정 없는 선발급 중복 행으로 합친다
update public.people set role = 'admin' where id = :'b_pid';
insert into public.people (name, phone) values ('이영희', '01088880012') returning id as dup2_pid \gset
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.merge_people(%L, %L) $$, :'b_pid', :'dup2_pid'), '계정이 한쪽에만 있으면 합칠 수 있다');
select tests.clear_auth();
select results_eq(
  format($$ select auth_user_id, consented_at is not null, role from public.people where id = %L $$, :'dup2_pid'),
  format($$ values (%L::uuid, true, 'admin'::text) $$, :'b_uid'),
  '계정·동의 기록·관리자 권한이 합쳐진 쪽으로 옮겨진다');
select is((select auth_user_id from public.people where id = :'b_pid'), null, '합쳐진 쪽의 계정 연결은 끊긴다');

-- ---------- merge_people: 옛 가족에 산 사람이 남으면 장부는 그 가족에 둔다 ----------
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('박민수', '01088880003', null, null, null) returning id as c1_pid \gset
select family_id as c_fid from public.people where id = :'c1_pid' \gset
insert into public.people (name, phone, family_id) values ('박서준', '01088880004', :'c_fid') returning id as c2_pid \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'c1_pid', :'c_fid', :'today_meal', 3, 5000, :'admin_pid') returning id as c1_iss \gset
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.merge_people(%L, %L) $$, :'c1_pid', :'a_pid'), '가족에 다른 사람이 남아 있어도 합칠 수 있다');
select tests.clear_auth();
select results_eq(
  format($$ select person_id, family_id from public.issuances where id = %L $$, :'c1_iss'),
  format($$ values (%L::uuid, %L::uuid) $$, :'a_pid', :'c_fid'),
  '장부의 구매자는 옮기지만 가족(함께 쓰던 풀)은 남긴다');
select is((select count(*) from public.families where id = :'c_fid'), 1::bigint, '산 사람이 남은 가족은 지우지 않는다');

-- ---------- admin_reset_person ----------
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'gone_pid'), 'P0001', 'person_not_found', '익명화된 사람은 초기화할 수 없다');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'kid_pid'), 'P0001', 'minor_not_allowed', '자녀는 초기화할 수 없다 (가족 탭에서 삭제)');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'a_pid'), 'P0001', 'has_children', '자녀가 딸린 사람은 먼저 자녀를 정리해야 한다');
select lives_ok(format($$ select public.admin_reset_person(%L) $$, :'c2_pid'), '관리자는 잘못 들어온 사람을 초기화할 수 있다');
select tests.clear_auth();
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null from public.people where id = %L $$, :'c2_pid'),
  $$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true) $$,
  '초기화는 익명화 + 계정 연결 해제다');
select is((select count(*) from public.issuances where family_id = :'c_fid'), 1::bigint, '초기화해도 장부는 보존된다');
-- 마지막 관리자: 010_e2e_admin.sql 시드와 위에서 올린 관리자들을 이 트랜잭션 동안만 member 로 내린다 (rollback 으로 복구)
update public.people set role = 'member' where role = 'admin' and deleted_at is null and id <> :'admin_pid';
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'admin_pid'), 'P0001', 'last_admin', '마지막 관리자는 초기화할 수 없다');

-- ---------- link_person ----------
-- 연결 대상: 동의 기록이 있는 계정 없는 사람. 박민수는 동의 기록이 없어 consent_required 가 된다.
-- people 에 대한 authenticated 의 insert 권한은 (name, phone) 열뿐이다 — consented_at·consent_version 을
-- 가진 테스트 시드 행은 postgres 로 넣고, 검증은 다시 admin_uid 로 돌아와 한다.
select tests.clear_auth();
insert into public.people (name, phone, consented_at, consent_version)
values ('최은지', '01088880005', now(), '2026-10-07') returning id as link_pid \gset
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'gone_pid', :'ghost_uid'), 'P0001', 'person_not_found', '익명화된 사람에게는 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'kid_pid', :'ghost_uid'), 'P0001', 'minor_not_allowed', '자녀에게는 연결할 수 없다 (가족 탭의 다시 연결)');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'a_pid', :'ghost_uid'), 'P0001', 'already_registered', '이미 계정이 있는 사람에게는 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'c1_pid', :'ghost_uid'), 'P0001', 'person_not_found', '합쳐져 익명화된 사람에게는 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', gen_random_uuid()), 'P0001', 'account_not_found', '없는 계정은 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', :'anon_uid'), 'P0001', 'anonymous_cannot_claim', '익명(아이) 계정은 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', :'a_uid'), 'P0001', 'account_taken', '다른 사람이 쓰는 계정은 연결할 수 없다');
select lives_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', :'ghost_uid'), '관리자는 동의 기록이 있는 사람에게 계정을 연결할 수 있다');
select tests.clear_auth();
select is((select auth_user_id from public.people where id = :'link_pid'), :'ghost_uid'::uuid, '연결된 계정이 기록된다');
-- 동의 기록이 없는 사람에게는 연결하지 않는다 (동의를 대신 만들지 않는다)
insert into public.people (name, phone) values ('동의없음', '01088880006') returning id as noconsent_pid \gset
select tests.create_user('people-ghost2@test.local') as ghost2_uid \gset
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'noconsent_pid', :'ghost2_uid'), 'P0001', 'consent_required', '동의 기록이 없는 사람에게는 연결할 수 없다');

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:test`
Expected: `150` 이 함수 없음으로 실패 (010~140 은 통과).

- [x] **Step 3: 마이그레이션**

`supabase/migrations/20261011000001_admin_people_ops.sql`:

```sql
-- =========================================================
-- 4b단계: 관리자 사람 관리 3종 (중복 합치기 · 초기화 · 계정 수동 연결)
-- 잠금 규칙은 20261009000002_family_functions.sql 헤더 그대로:
--   ② 쓸 people 행을 한 문장에서 id 순 for update → ③ lock_family 가족 id 순 → ④ lock_family_meal(가족, 식사) → 장부 행.
--   merge_people 은 ②(from·into) → ②(옮길 자녀) → ③(두 가족) → ④(옛 가족의 "오늘 이후" 식사) 를 쓴다.
--   ④ 가 필요한 이유: 옛 가족에 산 사람이 남지 않으면 그 가족의 장부를 통째로 옮기는데(add_family_member 와 같은 결정),
--   그 사이 옛 가족의 다른 구성원이 use_ticket 으로 잔량을 깎으면 음수가 될 수 있다. 지난 식사는 당일 규칙 때문에
--   쓸 수 없으니 잠그지 않는다.
--   자녀의 guardian_id 를 바꾸므로 대상 보호자(into) 행을 반드시 잠근다 (3단계 Task 3 리뷰).
-- 익명화 문구는 기존 두 경로와 같은 '탈퇴한 사용자' (remove_child · delete_my_account).
-- =========================================================

-- =========================================================
-- 중복 사람 합치기: from 의 장부·자녀·계정·관리자 권한을 into 로 옮기고 from 을 익명화한다.
--   · 장부의 구매자·사용자(person_id)와 처리자(issued_by·recorded_by·cancelled_by·voided_by)는 언제나 into 로.
--   · 장부의 가족(family_id)은 "옛 가족에 산 사람이 아무도 남지 않을 때만" 통째로 옮긴다 — 함께 쓰던 풀의 것은
--     남긴다(leave_family·add_family_member 와 같은 결정). 그래서 1인 가족 선발급 중복은 잔량까지 합쳐지고,
--     식구가 남은 가족의 장부는 그 가족에 남는다.
--   · 둘 다 계정이 있으면 both_have_accounts — 한 사람에 두 카카오 계정을 붙일 수 없다(먼저 한쪽을 초기화한다).
--   · 자녀는 양쪽 모두 거부한다(minor_not_allowed) — 자녀는 가족 탭의 "다시 연결"·"자녀 삭제" 로 관리한다.
-- 코드: not_authenticated | forbidden | same_person | person_not_found | minor_not_allowed | both_have_accounts
-- =========================================================
create or replace function public.merge_people(p_from_id uuid, p_into_id uuid)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_from public.people;
  v_into public.people;
  v_from_family uuid;
  v_meal uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_from_id is null or p_into_id is null then
    raise exception 'person_not_found';
  end if;
  if p_from_id = p_into_id then
    raise exception 'same_person';
  end if;

  -- ② 두 사람 행을 한 문장에서 id 순으로 잠근다 (두 관리자가 반대 방향으로 합쳐도 교착하지 않는다)
  perform 1 from public.people where id in (p_from_id, p_into_id) order by id for update;
  select * into v_from from public.people where id = p_from_id and deleted_at is null;
  if not found then
    raise exception 'person_not_found';
  end if;
  select * into v_into from public.people where id = p_into_id and deleted_at is null;
  if not found then
    raise exception 'person_not_found';
  end if;
  if v_from.is_minor or v_into.is_minor then
    raise exception 'minor_not_allowed';
  end if;
  if v_from.auth_user_id is not null and v_into.auth_user_id is not null then
    raise exception 'both_have_accounts';
  end if;

  v_from_family := v_from.family_id;

  -- ② 함께 옮길 자녀 행 (보호자 행을 이미 잠근 뒤다 — 어른 → 자녀 순서)
  perform 1 from public.people
   where guardian_id = v_from.id and is_minor and deleted_at is null
   order by id for update;

  -- ③ 가족 잠금은 가족 id 순으로
  if v_from_family <> v_into.family_id then
    perform public.lock_family(least(v_from_family, v_into.family_id));
    perform public.lock_family(greatest(v_from_family, v_into.family_id));
  else
    perform public.lock_family(v_from_family);
  end if;

  -- ④ 옛 가족의 "서울 오늘 이후" 식사만 (use_ticket 이 아직 건드릴 수 있는 것)
  for v_meal in
    select i.meal_id from public.issuances i join public.meals m on m.id = i.meal_id
     where i.family_id = v_from_family and m.served_on >= (now() at time zone 'Asia/Seoul')::date
    union
    select u.meal_id from public.usages u join public.meals m on m.id = u.meal_id
     where u.family_id = v_from_family and m.served_on >= (now() at time zone 'Asia/Seoul')::date
    order by 1
  loop
    perform public.lock_family_meal(v_from_family, v_meal);
  end loop;

  -- 장부: 구매자·사용자와 처리자를 into 로. self 사용은 person_id 와 recorded_by 가 같아야 하므로
  -- (usages_self_recorded_by_person) 두 열을 한 문장에서 바꾼다.
  update public.issuances
     set person_id    = case when person_id = v_from.id then v_into.id else person_id end,
         issued_by    = case when issued_by = v_from.id then v_into.id else issued_by end,
         cancelled_by = case when cancelled_by = v_from.id then v_into.id else cancelled_by end
   where person_id = v_from.id or issued_by = v_from.id or cancelled_by = v_from.id;
  update public.usages
     set person_id   = case when person_id = v_from.id then v_into.id else person_id end,
         recorded_by = case when recorded_by = v_from.id then v_into.id else recorded_by end,
         voided_by   = case when voided_by = v_from.id then v_into.id else voided_by end
   where person_id = v_from.id or recorded_by = v_from.id or voided_by = v_from.id;

  -- 자녀: 보호자와 가족을 into 로 (익명화보다 먼저 — 익명화된 보호자 밑에 산 자녀가 남지 않게)
  update public.people
     set guardian_id = v_into.id, family_id = v_into.family_id
   where guardian_id = v_from.id and is_minor and deleted_at is null;

  -- 관리자 권한은 사람이 아니라 역할이다 — 같은 사람이므로 이어 준다 (합치기로 마지막 관리자가 사라지지 않는다)
  if v_from.role = 'admin' then
    update public.people set role = 'admin' where id = v_into.id;
  end if;

  -- from 익명화. 계정을 여기서 끊어야 아래에서 into 에 붙일 때 auth_user_id unique 와 부딪히지 않는다.
  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_from.id;

  -- 계정이 from 에만 있었으면 into 로 옮긴다. 동의 기록이 없으면 함께 옮긴다
  -- (people_adult_requires_consent: 계정이 붙은 어른은 동의 기록이 있어야 한다).
  if v_from.auth_user_id is not null then
    update public.people
       set auth_user_id = v_from.auth_user_id,
           consented_at = coalesce(v_into.consented_at, v_from.consented_at),
           consent_version = coalesce(v_into.consent_version, v_from.consent_version)
     where id = v_into.id;
  end if;

  -- 옛 가족에 산 사람이 남지 않으면 장부를 옮기고 빈 가족을 지운다 (add_family_member 와 같은 조건·같은 이유)
  if v_from_family <> v_into.family_id
     and not exists (select 1 from public.people where family_id = v_from_family and deleted_at is null) then
    update public.issuances set family_id = v_into.family_id where family_id = v_from_family;
    update public.usages set family_id = v_into.family_id where family_id = v_from_family;
    -- 익명화된 from 행 자신도 옛 가족을 여전히 가리키고 있다 (익명화는 family_id 를 건드리지 않는다) —
    -- FK(people_family_id_fkey) 때문에 이 행을 옮기지 않으면 가족을 지울 수 없다.
    update public.people set family_id = v_into.family_id where id = v_from.id and family_id = v_from_family;
    delete from public.families f
     where f.id = v_from_family
       and not exists (select 1 from public.people p where p.family_id = f.id)
       and not exists (select 1 from public.issuances i where i.family_id = f.id)
       and not exists (select 1 from public.usages u where u.family_id = f.id);
  end if;

  select * into v_into from public.people where id = v_into.id;
  return v_into;
end
$$;

comment on function public.merge_people(uuid, uuid) is '중복 사람 합치기(장부·자녀·계정·권한 이동 + from 익명화). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.merge_people(uuid, uuid) from public, anon;
grant execute on function public.merge_people(uuid, uuid) to authenticated;

-- =========================================================
-- 사람 초기화: 잘못 가입한 사람(예: 만 14세 미만이 어른으로 가입)을 익명화하고 계정 연결을 끊는다.
--   장부는 그대로 둔다 — 그 폰은 다음 접속 때 가입 화면부터 다시 시작한다.
--   자녀가 딸려 있으면 먼저 정리해야 한다(has_children). 마지막 관리자는 거부한다(last_admin) —
--   role 을 바꿀 화면이 없어 운영이 멈춘다 (delete_my_account 와 같은 이유).
-- 코드: not_authenticated | forbidden | person_not_found | minor_not_allowed | has_children | last_admin
-- =========================================================
create or replace function public.admin_reset_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- ② 대상 사람 행
  select * into v_person from public.people where id = p_person_id and deleted_at is null for update;
  if not found then
    raise exception 'person_not_found';
  end if;
  if v_person.is_minor then
    raise exception 'minor_not_allowed';
  end if;

  -- ③ 자녀 수를 세는 동안 자녀 추가가 끼어들지 않게 (delete_my_account 와 같은 순서)
  perform public.lock_family(v_person.family_id);
  if exists (select 1 from public.people where guardian_id = v_person.id and is_minor and deleted_at is null) then
    raise exception 'has_children';
  end if;
  -- 관리자 수는 전역이지만 잠금은 그 가족뿐이다 — 서로 다른 가족의 두 관리자를 같은 순간에 초기화하면 둘 다 통과할 수 있다.
  -- 관리자는 한두 명이고 복구는 SQL 한 줄이라 그대로 둔다 (delete_my_account 와 같은 판단).
  if v_person.role = 'admin' and not exists (
    select 1 from public.people where role = 'admin' and deleted_at is null and id <> v_person.id
  ) then
    raise exception 'last_admin';
  end if;

  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_person.id;
end
$$;

comment on function public.admin_reset_person(uuid) is '관리자 사람 초기화(익명화 + 계정 해제, 장부 보존). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.admin_reset_person(uuid) from public, anon;
grant execute on function public.admin_reset_person(uuid) to authenticated;

-- =========================================================
-- 카카오 계정 수동 연결: 초기화 뒤 같은 계정으로 되돌릴 때만 쓰는 복구 경로.
--   교인이 스스로 가입하면 claim_person 이 번호·이름으로 자동 연결하거나 중복 행이 생겨 merge_people 로 해결된다.
--   동의 기록이 없는 사람에게는 연결하지 않는다(consent_required) — 동의를 대신 만들지 않는다(설계 §10).
--   익명(아이) 계정은 거부한다 — 자녀 연결은 가족 탭의 relink_child 가 한다.
-- 코드: not_authenticated | forbidden | person_not_found | minor_not_allowed | already_registered |
--       consent_required | account_not_found | anonymous_cannot_claim | account_taken
-- =========================================================
create or replace function public.link_person(p_person_id uuid, p_auth_user_id uuid)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
  v_is_anonymous boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_auth_user_id is null then
    raise exception 'account_not_found';
  end if;

  -- ② 대상 사람 행
  select * into v_person from public.people where id = p_person_id and deleted_at is null for update;
  if not found then
    raise exception 'person_not_found';
  end if;
  if v_person.is_minor then
    raise exception 'minor_not_allowed';
  end if;
  if v_person.auth_user_id is not null then
    raise exception 'already_registered';
  end if;
  if v_person.consented_at is null then
    raise exception 'consent_required';
  end if;

  select is_anonymous into v_is_anonymous from auth.users where id = p_auth_user_id;
  if not found then
    raise exception 'account_not_found';
  end if;
  if v_is_anonymous then
    raise exception 'anonymous_cannot_claim';
  end if;
  if exists (select 1 from public.people where auth_user_id = p_auth_user_id and deleted_at is null) then
    raise exception 'account_taken';
  end if;

  begin
    update public.people set auth_user_id = p_auth_user_id where id = v_person.id
    returning * into v_person;
  exception when unique_violation then
    -- 위 검사와 이 update 사이에 다른 관리자가 같은 계정을 붙였다 (auth_user_id unique)
    raise exception 'account_taken';
  end;
  return v_person;
end
$$;

comment on function public.link_person(uuid, uuid) is '관리자 카카오 계정 수동 연결(복구 경로). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.link_person(uuid, uuid) from public, anon;
grant execute on function public.link_person(uuid, uuid) to authenticated;
```

- [x] **Step 4: 통과 확인 · 타입 재생성**

Run: `npm run db:reset && npm run db:test`
Expected: `Files=15, Tests=440, Result: PASS` (392 + 48).

Run: `npm run db:types && git diff --stat src/lib/database.types.ts`
Expected: `Functions` 에 `merge_people`(`p_from_id`, `p_into_id`), `admin_reset_person`(`p_person_id`), `link_person`(`p_person_id`, `p_auth_user_id`) 추가.

- [x] **Step 5: 커밋**

```bash
git add supabase/migrations/20261011000001_admin_people_ops.sql supabase/tests/database/150_admin_people_ops.sql src/lib/database.types.ts
git commit -m "feat(db): merge_people·admin_reset_person·link_person (사람 합치기·초기화·계정 연결)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: 사람 목록 데이터 — `peopleFilter` · `useAllPeople`

**Files:**
- Create: `src/features/admin/peopleFilter.ts`, `src/features/admin/peopleFilter.test.ts`
- Create: `src/features/admin/useAllPeople.ts`, `src/features/admin/useAllPeople.test.tsx`

- [x] **Step 1: 실패하는 테스트**

`src/features/admin/peopleFilter.test.ts`:

```ts
import { decoratePeople, filterPeople, type PersonRow } from './peopleFilter'

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z', ...over,
})

describe('decoratePeople', () => {
  it('가족 수를 세고 태그를 붙인다 (관리자·자녀·미가입)', () => {
    const list = decoratePeople([
      row({ id: 'p1' }),
      row({ id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1' }),
      row({ id: 'p3', name: '권사', phone: '01099990000', family_id: 'f2', role: 'admin' }),
      row({ id: 'p4', name: '이순자', phone: '01011112222', family_id: 'f3', auth_user_id: null }),
    ])
    expect(list.map((p) => p.name)).toEqual(['김철수', '서연', '권사', '이순자'])
    expect(list[0]).toMatchObject({ familySize: 2, tags: [] })
    expect(list[1]!.tags).toEqual(['자녀'])
    expect(list[2]).toMatchObject({ familySize: 1, tags: ['관리자'] })
    expect(list[3]!.tags).toEqual(['미가입'])
  })

  it('가족이 1명이면 가족 수 태그를 쓰지 않도록 familySize 는 그대로 1 로 둔다', () => {
    expect(decoratePeople([row({})])[0]).toMatchObject({ familySize: 1 })
  })
})

describe('filterPeople', () => {
  const list = decoratePeople([
    row({ id: 'p1', name: '김철수', phone: '01012345678' }),
    row({ id: 'p2', name: '이영희', phone: '01098765432', family_id: 'f2' }),
    row({ id: 'p3', name: '권사', phone: '01099990000', family_id: 'f3', role: 'admin' }),
    row({ id: 'p4', name: '이순자', phone: '01011112222', family_id: 'f4', auth_user_id: null }),
    row({ id: 'p5', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1' }),
  ])

  it('빈 검색어 + 전체 필터는 이름 순으로 전부', () => {
    expect(filterPeople(list, '', 'all').map((p) => p.name)).toEqual(['권사', '김철수', '서연', '이순자', '이영희'])
  })

  it('이름 일부로 찾는다 (NFD 로 들어온 자모도 맞춘다)', () => {
    expect(filterPeople(list, '영희', 'all').map((p) => p.name)).toEqual(['이영희'])
    expect(filterPeople(list, '영희'.normalize('NFD'), 'all').map((p) => p.name)).toEqual(['이영희'])
  })

  it('번호 뒷자리로 찾는다 (하이픈·공백은 무시)', () => {
    expect(filterPeople(list, '5678', 'all').map((p) => p.name)).toEqual(['김철수'])
    expect(filterPeople(list, '010-1234', 'all').map((p) => p.name)).toEqual(['김철수'])
  })

  it('미가입 필터는 계정 없는 사람만 (자녀는 계정이 있어도 제외하지 않는다 — 자녀는 미가입이 아니다)', () => {
    expect(filterPeople(list, '', 'unlinked').map((p) => p.name)).toEqual(['이순자'])
  })

  it('관리자 필터는 관리자만', () => {
    expect(filterPeople(list, '', 'admin').map((p) => p.name)).toEqual(['권사'])
  })

  it('필터와 검색어는 함께 걸린다', () => {
    expect(filterPeople(list, '이', 'unlinked').map((p) => p.name)).toEqual(['이순자'])
  })
})
```

`src/features/admin/useAllPeople.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, fail, ok } from '../../test/fakeSupabase'
import { allPeopleQueryKey, useAllPeople } from './useAllPeople'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z',
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useAllPeople', () => {
  it('익명화되지 않은 사람 전부를 이름 순으로 읽고 태그·가족 수를 붙인다', async () => {
    let q: FakeQuery<unknown> | undefined
    from.mockImplementation(() => (q = ok([person])))
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useAllPeople(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.[0]).toMatchObject({ id: 'p1', name: '김철수', familySize: 1, tags: [] })
    expect(from).toHaveBeenCalledWith('people')
    expect(q?.has('is', 'deleted_at', null)).toBe(true)
    expect(q?.has('order', 'name')).toBe(true)
    expect(client.getQueryData(allPeopleQueryKey)).toBeDefined()
  })

  it('조회가 실패하면 코드를 보존한 Error 로 알린다', async () => {
    from.mockImplementation(() => fail('jwt expired', 'PGRST301'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAllPeople(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({ code: 'PGRST301' })
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/admin/peopleFilter src/features/admin/useAllPeople`
Expected: 모듈 없음.

- [x] **Step 3: 구현**

`src/features/admin/peopleFilter.ts`:

```ts
import type { Person } from '../auth/usePerson'

/** 목록에 필요한 열만. `useAllPeople` 의 select 문자열과 같은 모양이다. */
export type PersonRow = Pick<Person, 'id' | 'family_id' | 'name' | 'phone' | 'auth_user_id' | 'role' | 'is_minor' | 'guardian_id' | 'created_at'>

/** 화면에 쓰는 태그. "방문자" 는 스키마에 근거가 없어 두지 않는다 (계획 "설계와 다른 점" 참고). */
export type PersonTag = '관리자' | '자녀' | '미가입'
export type DecoratedPerson = PersonRow & { familySize: number; tags: PersonTag[] }
export type PeopleFilter = 'all' | 'unlinked' | 'admin'

/** 검색 비교용 키: NFC 로 맞추고 공백을 없앤다 (iOS 가 자모 분리(NFD)로 보낼 수 있다 — lib/fieldSchemas 와 같은 이유). */
const nameKey = (text: string) => text.normalize('NFC').replace(/\s+/g, '')
const digits = (text: string) => text.replace(/\D/g, '')

/** 가족 수와 태그를 붙인다. 입력 순서는 그대로 둔다 (정렬은 filterPeople 이 한다). */
export function decoratePeople(rows: readonly PersonRow[]): DecoratedPerson[] {
  const sizeByFamily = new Map<string, number>()
  for (const r of rows) sizeByFamily.set(r.family_id, (sizeByFamily.get(r.family_id) ?? 0) + 1)
  return rows.map((r) => {
    const tags: PersonTag[] = []
    if (r.role === 'admin') tags.push('관리자')
    if (r.is_minor) tags.push('자녀')
    // 자녀는 계정이 없어도 "미가입" 이 아니다 (보호자가 연결해 주는 것이고, 연결 전이면 애초에 사람 행이 없다)
    if (!r.is_minor && !r.auth_user_id) tags.push('미가입')
    return { ...r, familySize: sizeByFamily.get(r.family_id) ?? 1, tags }
  })
}

/** 검색어(이름 일부 또는 번호 뒷자리)와 필터 칩으로 좁히고 이름 순으로 정렬한다. */
export function filterPeople(people: readonly DecoratedPerson[], query: string, filter: PeopleFilter): DecoratedPerson[] {
  const key = nameKey(query)
  const num = digits(query)
  const matched = people.filter((p) => {
    if (filter === 'unlinked' && (p.auth_user_id !== null || p.is_minor)) return false
    if (filter === 'admin' && p.role !== 'admin') return false
    if (!key) return true
    if (nameKey(p.name).includes(key)) return true
    return num.length > 0 && (p.phone ?? '').includes(num)
  })
  return matched.toSorted((a, b) => a.name.localeCompare(b.name, 'ko'))
}
```

`src/features/admin/useAllPeople.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { decoratePeople, type DecoratedPerson } from './peopleFilter'

export const allPeopleQueryKey = ['all-people'] as const

const COLUMNS = 'id, family_id, name, phone, auth_user_id, role, is_minor, guardian_id, created_at'

/**
 * 살아 있는 사람 전부. 교인 수가 수백 규모라 한 번에 읽고 검색·필터·가족 수는 클라이언트에서 한다
 * (설계 §2 의 규모 가정). 수천 명이 되면 `usePeopleSearch` 처럼 서버 검색으로 바꾼다.
 * 익명화된 행(탈퇴·삭제·합쳐진 사람)은 이름이 모두 같아 검색을 방해하므로 빼고 읽는다.
 * 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다.
 */
export function useAllPeople() {
  return useQuery({
    queryKey: allPeopleQueryKey,
    staleTime: 30_000,
    queryFn: async (): Promise<DecoratedPerson[]> =>
      decoratePeople(await supabase.from('people').select(COLUMNS).is('deleted_at', null).order('name').then(unwrap)),
  })
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test -- src/features/admin && npm run lint && npx tsc -b`
Expected: 전부 통과.

- [x] **Step 5: 커밋**

```bash
git add src/features/admin/peopleFilter.ts src/features/admin/peopleFilter.test.ts src/features/admin/useAllPeople.ts src/features/admin/useAllPeople.test.tsx
git commit -m "feat(admin): 사람 목록 데이터 — 태그·가족 수·검색·필터(클라이언트), useAllPeople

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 사람 목록 화면 `#/admin/people` · 하단 탭 · 라우트

**Files:**
- Create: `src/pages/admin/AdminPeoplePage.tsx`, `src/pages/admin/AdminPeoplePage.test.tsx`
- Modify: `src/components/PersonShell.tsx`, `src/components/PersonShell.test.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: 실패하는 테스트**

`src/pages/admin/AdminPeoplePage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { decoratePeople, type DecoratedPerson, type PersonRow } from '../../features/admin/peopleFilter'
import { AdminPeoplePage } from './AdminPeoplePage'

type Q = { status: 'pending' | 'error' | 'success'; data?: DecoratedPerson[]; refetch: () => void }
const { useAllPeople } = vi.hoisted(() => ({ useAllPeople: vi.fn<() => Q>() }))
vi.mock('../../features/admin/useAllPeople', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useAllPeople')>()),
  useAllPeople,
}))

const row = (over: Partial<PersonRow>): PersonRow => ({
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z', ...over,
})
const people = decoratePeople([
  row({ id: 'p1' }),
  row({ id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1' }),
  row({ id: 'p3', name: '권사', phone: '01099990000', family_id: 'f2', role: 'admin' }),
  row({ id: 'p4', name: '이순자', phone: '01011112222', family_id: 'f3', auth_user_id: null }),
])

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/people']}>
      <Routes>
        <Route path="/admin/people" element={<AdminPeoplePage />} />
        <Route path="/admin/people/:personId" element={<p>사람 상세</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useAllPeople.mockReturnValue({ status: 'success', data: people, refetch: vi.fn<() => void>() })
})

describe('AdminPeoplePage', () => {
  it('머리말·인원수, 이름 순 목록, 전체 번호와 태그', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: '사람' })).toBeInTheDocument()
    expect(screen.getByText('4명')).toBeInTheDocument()
    const items = within(screen.getByRole('list', { name: '사람 목록' })).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('권사'),
      expect.stringContaining('김철수'),
      expect.stringContaining('서연'),
      expect.stringContaining('이순자'),
    ])
    // 전체 번호는 관리자 화면에서만 보인다 (설계 §10)
    expect(items[1]).toHaveTextContent('010-1234-5678')
    expect(items[0]).toHaveTextContent('관리자')
    expect(items[2]).toHaveTextContent('자녀')
    expect(items[3]).toHaveTextContent('미가입')
    // 가족이 둘 이상이면 가족 수를 보여 준다
    expect(items[1]).toHaveTextContent('가족 2명')
  })

  it('번호가 없는 사람은 "번호 없음"', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /서연/ })).toHaveTextContent('번호 없음')
  })

  it('검색하면 좁혀지고, 없으면 안내', async () => {
    renderPage()
    const box = screen.getByLabelText('이름 또는 번호 뒷자리')
    await userEvent.type(box, '1111')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1명')).toBeInTheDocument()
    await userEvent.clear(box)
    await userEvent.type(box, '없는사람')
    expect(screen.getByText('찾는 사람이 없어요')).toBeInTheDocument()
  })

  it('필터 칩으로 미가입·관리자만 볼 수 있다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: '미가입' }))
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('이순자')])
    await userEvent.click(screen.getByRole('radio', { name: '관리자' }))
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('권사')])
    await userEvent.click(screen.getByRole('radio', { name: '전체' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('이름을 누르면 상세로 간다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: /김철수/ }))
    expect(screen.getByText('사람 상세')).toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useAllPeople.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { rerender } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    const refetch = vi.fn<() => void>()
    useAllPeople.mockReturnValue({ status: 'error', refetch })
    rerender(
      <MemoryRouter initialEntries={['/admin/people']}>
        <Routes>
          <Route path="/admin/people" element={<AdminPeoplePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('데이터가 있는 채 재조회가 실패하면 작은 안내만 덧붙인다', () => {
    useAllPeople.mockReturnValue({ status: 'error', data: people, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('최신 목록을 받지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '사람 목록' })).toBeInTheDocument()
  })
})
```

`src/components/PersonShell.test.tsx` — `it('관리자 영역에서는 식사·발급·내 식권 탭', …)` 의 제목을 `'관리자 영역에서는 식사·발급·사람·내 식권 탭'` 으로 바꾸고 단언을 고친다:

```tsx
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🍚식사', '🎟️발급', '👥사람', '🎫내 식권'])
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/pages/admin/AdminPeoplePage src/components/PersonShell`
Expected: 모듈 없음 · 탭 배열 불일치.

- [x] **Step 3: 구현**

`src/pages/admin/AdminPeoplePage.tsx`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Spinner, TextField } from '../../components/ui'
import { filterPeople, type DecoratedPerson, type PeopleFilter } from '../../features/admin/peopleFilter'
import { useAllPeople } from '../../features/admin/useAllPeople'
import { formatPhone } from '../../lib/phone'

const FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'unlinked', label: '미가입' },
  { value: 'admin', label: '관리자' },
] as const satisfies readonly { value: PeopleFilter; label: string }[]

/** `#/admin/people` — 사람 목록 (설계 §8.3). 전체를 한 번 읽고 검색·필터는 클라이언트에서 한다. */
export function AdminPeoplePage() {
  const people = useAllPeople()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PeopleFilter>('all')
  const shown = people.data ? filterPeople(people.data, query, filter) : []

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">사람</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* status 가 아니라 data 로 분기한다 (공통 규약) */}
      {people.data ? (
        <>
          {people.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 목록을 받지 못했어요</p>}
          <TextField label="이름 또는 번호 뒷자리" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="두 글자부터 쉽게 찾아요" autoComplete="off" />
          <SegmentedControl label="사람 필터" value={filter} onChange={setFilter} options={FILTERS} />
          <p className="text-xs text-gray-500">{shown.length}명</p>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">찾는 사람이 없어요</p>
          ) : (
            <ul aria-label="사람 목록" className="flex flex-col gap-2">
              {shown.map((p) => <PersonLine key={p.id} person={p} />)}
            </ul>
          )}
        </>
      ) : people.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          사람을 불러오지 못했어요
          <button type="button" onClick={() => void people.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

/** 한 줄: 이름 · 태그 · 전체 번호 · 가족 수. 줄 전체가 상세로 가는 링크다. */
function PersonLine({ person }: { person: DecoratedPerson }) {
  return (
    <li>
      <Link
        to={`/admin/people/${person.id}`}
        className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm font-bold">
            <span className="truncate">{person.name}</span>
            {person.tags.map((tag) => (
              <span key={tag} className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">{tag}</span>
            ))}
          </div>
          {/* 전체 번호는 관리자 화면에서만 보여 준다 (설계 §10) */}
          <div className="text-xs text-gray-500">{person.phone ? formatPhone(person.phone) : '번호 없음'}</div>
        </div>
        {person.familySize > 1 && <span className="shrink-0 text-xs text-gray-500">가족 {person.familySize}명</span>}
      </Link>
    </li>
  )
}
```

`src/components/PersonShell.tsx` — 관리자 탭에 사람을 끼운다 (식사·발급 다음, 내 식권 앞):

```tsx
const ADMIN_TABS: readonly TabItem[] = [
  { to: '/admin/meals', label: '식사', icon: '🍚' },
  { to: '/admin/issue', label: '발급', icon: '🎟️' },
  { to: '/admin/people', label: '사람', icon: '👥' },
  { to: '/', label: '내 식권', icon: '🎫' },
]
```

`src/App.tsx` — `AdminPeoplePage` 를 import 하고 `RequirePerson` 아래 관리자 라우트에 두 줄을 더한다 (상세는 Task 5 가 채운다 — 가드가 보내는 경로에 라우트가 없으면 무한 리다이렉트가 되므로 자리만 먼저 잡는다):

```tsx
              <Route path="/admin/people" element={<RequireAdmin><AdminPeoplePage /></RequireAdmin>} />
```

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과. (`TabBar` 는 `flex-1` 이라 탭 4개도 412px 에서 들어간다.)

- [x] **Step 5: 커밋**

```bash
git add src/pages/admin/AdminPeoplePage.tsx src/pages/admin/AdminPeoplePage.test.tsx src/components/PersonShell.tsx src/components/PersonShell.test.tsx src/App.tsx
git commit -m "feat(admin): 사람 목록(#/admin/people) — 검색·필터 칩·전체 번호·태그, 하단 사람 탭

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: 사람 상세 데이터 — `usePersonDetail` · `usePersonLedger`(+ `mergeLedger` 에 취소 사유)

**Files:**
- Create: `src/features/admin/usePersonDetail.ts`, `src/features/admin/usePersonDetail.test.tsx`
- Create: `src/features/admin/usePersonLedger.ts`, `src/features/admin/usePersonLedger.test.tsx`
- Modify: `src/features/history/mergeLedger.ts`, `src/features/history/mergeLedger.test.ts`
- Modify: `src/features/history/useFamilyLedger.ts`
- Modify: `src/pages/HistoryPage.test.tsx` (`LedgerEntry[]` 로 타입을 박은 픽스처에 `cancelReason: null` — 교인 화면은 그리지 않는다)

- [x] **Step 1: 실패하는 테스트**

`src/features/history/mergeLedger.test.ts` — 기존 테스트는 그대로 두고, 발급 행 픽스처에 `cancel_reason` 을 넣고 엔트리에 실려 오는지 보는 테스트를 더한다. 파일의 발급 행 픽스처(`IssuanceRow`)에 `cancel_reason: null` 을 추가하고(타입이 요구한다), 아래 테스트를 `describe` 안에 더한다:

```ts
  it('취소 사유를 엔트리에 싣는다 (관리자 이력 화면이 쓴다)', () => {
    const [entry] = mergeLedger(
      [{
        id: 'i1', issued_at: '2026-10-09T05:00:00Z', quantity: 2, unit_price: 5000, memo: null,
        cancelled_at: '2026-10-09T06:00:00Z', cancel_reason: '입금 취소',
        meal: { title: '주일 점심', served_on: '2026-10-11' }, buyer: { name: '김철수' }, issuer: { name: '권사' },
      }],
      [],
    )
    expect(entry).toMatchObject({ kind: 'issuance', cancelled: true, cancelReason: '입금 취소' })
  })
```

`src/features/admin/usePersonDetail.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { personDetailQueryKey, usePersonDetail } from './usePersonDetail'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const PID = '00000000-0000-4000-8000-000000000001'
const person = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', role: 'member',
  is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07',
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
}
const sibling = { id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: PID, auth_user_id: 'k1', role: 'member', deleted_at: null }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('usePersonDetail', () => {
  it('사람 한 명과 같은 가족 구성원을 읽는다', async () => {
    const queries: FakeQuery<unknown>[] = []
    from.mockImplementation(() => {
      const q = ok(queries.length === 0 ? person : [person, sibling])
      queries.push(q)
      return q
    })
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonDetail(PID), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.person).toEqual(person)
    expect(result.current.data?.family.map((m) => m.name)).toEqual(['김철수', '서연'])
    expect(queries[0]?.has('eq', 'id', PID)).toBe(true)
    expect(queries[0]?.has('maybeSingle')).toBe(true)
    // 익명화된 행도 읽는다 — 초기화·합치기 직후 화면이 "없는 사람" 으로 바뀌지 않게 (deleted_at 필터 없음)
    expect(queries[0]?.has('is', 'deleted_at', null)).toBe(false)
    expect(queries[1]?.has('eq', 'family_id', 'f1')).toBe(true)
    expect(client.getQueryData(personDetailQueryKey(PID))).toBeDefined()
  })

  it('없는 사람은 null (오류가 아니다)', async () => {
    from.mockImplementation(() => ok(null))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonDetail(PID), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBeNull()
  })

  it('uuid 가 아닌 주소는 조회하지 않고 null', async () => {
    from.mockImplementation(() => ok(null))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonDetail('zzz'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})
```

`src/features/admin/usePersonLedger.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { personLedgerQueryKey, usePersonLedger } from './usePersonLedger'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const PID = '00000000-0000-4000-8000-000000000001'
const issuance = {
  id: 'i1', issued_at: '2026-10-09T05:00:00Z', quantity: 2, unit_price: 5000, memo: '입금 확인',
  cancelled_at: null, cancel_reason: null, meal: { title: '주일 점심', served_on: '2026-10-11' },
  buyer: { name: '김철수' }, issuer: { name: '권사' },
}
const usage = {
  id: 'u1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  meal: { title: '주일 점심', served_on: '2026-10-11' }, person: { name: '김철수' },
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('usePersonLedger', () => {
  it('그 사람의 발급·사용을 최근 것부터 합쳐 돌려준다', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = ok(table === 'issuances' ? [issuance] : [usage])))
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonLedger(PID), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.map((e) => e.kind)).toEqual(['usage', 'issuance'])
    expect(queries.issuances?.has('eq', 'person_id', PID)).toBe(true)
    expect(queries.usages?.has('eq', 'person_id', PID)).toBe(true)
    expect(queries.issuances?.has('order', 'issued_at', { ascending: false })).toBe(true)
    expect(client.getQueryData(personLedgerQueryKey(PID))).toBeDefined()
  })

  it('uuid 가 아니면 조회하지 않고 빈 목록', async () => {
    from.mockImplementation(() => ok([]))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePersonLedger('zzz'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/admin/usePersonDetail src/features/admin/usePersonLedger src/features/history/mergeLedger`
Expected: 모듈 없음 · `cancelReason` 없음.

- [x] **Step 3: 구현**

`src/features/history/mergeLedger.ts` — 발급 행과 엔트리에 취소 사유를 더한다. `IssuanceRow` 에 한 줄, `IssuanceEntry` 에 한 줄, `mergeLedger` 의 발급 매핑에 한 줄:

```ts
export type IssuanceRow = {
  id: string
  issued_at: string
  quantity: number
  unit_price: number
  memo: string | null
  cancelled_at: string | null
  /** 관리자가 취소할 때 적은 사유. 교인 화면은 쓰지 않는다 (관리자 사람 상세 이력에서 보여 준다). */
  cancel_reason: string | null
  meal: MealRef
  buyer: NameRef
  issuer: NameRef
}
```

```ts
export type IssuanceEntry = {
  kind: 'issuance'; id: string; at: string; mealTitle: string; servedOn: string
  quantity: number; amount: number; buyer: string; issuer: string; memo: string | null
  cancelled: boolean; cancelReason: string | null
}
```

```ts
    ...issuances.map((i): IssuanceEntry => ({
      kind: 'issuance', id: i.id, at: i.issued_at, ...mealOf(i.meal),
      quantity: i.quantity, amount: i.quantity * i.unit_price,
      buyer: i.buyer?.name ?? '', issuer: i.issuer?.name ?? '관리자', memo: i.memo,
      cancelled: i.cancelled_at !== null, cancelReason: i.cancel_reason,
    })),
```

`src/features/history/useFamilyLedger.ts` — select 문자열에 `cancel_reason` 을 더한다 (교인 화면은 그리지 않지만 타입이 요구한다):

```ts
const ISSUANCE_SELECT =
  'id, issued_at, quantity, unit_price, memo, cancelled_at, cancel_reason, meal:meals(title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
```

`src/features/admin/usePersonDetail.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'

export const personDetailQueryKey = (personId: string) => ['person-detail', personId] as const

/** 손으로 고친 주소(#/admin/people/zzz)는 PostgREST 22P02(400) 가 되므로 미리 "없는 사람" 으로 본다 (4a useMealDetail 과 같은 가드). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FAMILY_COLUMNS = 'id, name, phone, is_minor, guardian_id, auth_user_id, role, deleted_at'

export type FamilyMemberRow = Pick<Person, 'id' | 'name' | 'phone' | 'is_minor' | 'guardian_id' | 'auth_user_id' | 'role' | 'deleted_at'>
export type PersonDetail = { person: Person; family: FamilyMemberRow[] }

/**
 * 사람 한 명과 같은 가족 구성원. 익명화된 행(`deleted_at`)도 그대로 읽는다 —
 * 초기화·합치기 직후 화면이 "없는 사람" 으로 튀지 않고 "초기화됨" 상태를 보여 줄 수 있어야 한다.
 * 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다.
 */
export function usePersonDetail(personId: string) {
  return useQuery({
    queryKey: personDetailQueryKey(personId),
    queryFn: async (): Promise<PersonDetail | null> => {
      if (!UUID.test(personId)) return null
      // queryFn 문맥 타입과 maybeSingle 의 제네릭 추론이 부딪히므로 unwrap 에 타입 인자를 준다 (useLatestUnitPrice 참고)
      const person = await supabase.from('people').select('*').eq('id', personId).maybeSingle().then((r) => unwrap<Person | null>(r))
      if (!person) return null
      const family = await supabase.from('people').select(FAMILY_COLUMNS).eq('family_id', person.family_id).order('created_at').order('id').then(unwrap)
      return { person, family }
    },
  })
}
```

`src/features/admin/usePersonLedger.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { mergeLedger, type LedgerEntry } from '../history/mergeLedger'

export const personLedgerQueryKey = (personId: string) => ['person-ledger', personId] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 표마다 최근 100건씩 — 한 사람 기준으로는 넉넉하다 (useFamilyLedger 와 같은 전제).
const LIMIT = 100
// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다.
const ISSUANCE_SELECT =
  'id, issued_at, quantity, unit_price, memo, cancelled_at, cancel_reason, meal:meals(title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, used_at, used_via, voided_at, meal:meals(title, served_on), person:people!usages_person_id_fkey(name)'

/** 그 사람 이름으로 된 발급·사용 이력 (가족이 아니라 사람 기준 — 합치기 뒤에는 합쳐진 쪽 이력까지 보인다). */
export function usePersonLedger(personId: string) {
  return useQuery({
    queryKey: personLedgerQueryKey(personId),
    queryFn: async (): Promise<LedgerEntry[]> => {
      if (!UUID.test(personId)) return []
      const [issuances, usages] = await Promise.all([
        supabase.from('issuances').select(ISSUANCE_SELECT).eq('person_id', personId).order('issued_at', { ascending: false }).order('id').limit(LIMIT).then(unwrap),
        supabase.from('usages').select(USAGE_SELECT).eq('person_id', personId).order('used_at', { ascending: false }).order('id').limit(LIMIT).then(unwrap),
      ])
      return mergeLedger(issuances, usages)
    },
  })
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과 (교인 내역 화면 테스트도 그대로 — `cancelReason` 은 그리지 않는다).

- [x] **Step 5: 커밋**

```bash
git add src/features/admin/usePersonDetail.ts src/features/admin/usePersonDetail.test.tsx src/features/admin/usePersonLedger.ts src/features/admin/usePersonLedger.test.tsx src/features/history/mergeLedger.ts src/features/history/mergeLedger.test.ts src/features/history/useFamilyLedger.ts
git commit -m "feat(admin): 사람 상세 데이터 — usePersonDetail·usePersonLedger, 장부 엔트리에 취소 사유

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 사람 상세 화면 — 프로필·이름·번호 수정 · 가족 보기 · 이력

**Files:**
- Create: `src/features/admin/personSchema.ts`, `src/features/admin/personSchema.test.ts`
- Create: `src/features/admin/usePersonOps.ts`, `src/features/admin/usePersonOps.test.tsx`
- Create: `src/features/admin/PersonEditForm.tsx`, `src/features/admin/PersonEditForm.test.tsx`
- Create: `src/pages/admin/PersonDetailPage.tsx`, `src/pages/admin/PersonDetailPage.test.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: 실패하는 테스트**

`src/features/admin/personSchema.test.ts`:

```ts
import { validateAdminPerson, validateAuthUserId } from './personSchema'

describe('validateAdminPerson', () => {
  it('이름만 있어도 통과하고 번호는 비울 수 있다 (자녀·방문자)', () => {
    const r = validateAdminPerson({ name: '김철수', phone: '' })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: null } })
  })

  it('번호를 적으면 형식을 본다', () => {
    expect(validateAdminPerson({ name: '김철수', phone: '010-1234-5678' })).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678' } })
    const bad = validateAdminPerson({ name: '김철수', phone: '02-123' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.phone).toBe('휴대폰 번호를 확인해 주세요.')
  })

  it('이름이 비면 거부', () => {
    const r = validateAdminPerson({ name: '  ', phone: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.name).toBe('이름을 입력해 주세요')
  })
})

describe('validateAuthUserId', () => {
  it('uuid 만 받는다', () => {
    expect(validateAuthUserId({ authUserId: ' 123e4567-e89b-42d3-a456-426614174000 ' })).toEqual({
      ok: true,
      values: { authUserId: '123e4567-e89b-42d3-a456-426614174000' },
    })
    const bad = validateAuthUserId({ authUserId: 'abc' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.authUserId).toBe('계정 id(uuid)를 붙여 넣어 주세요')
  })
})
```

`src/features/admin/usePersonOps.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, ok } from '../../test/fakeSupabase'
import { invalidatePeople, useLinkPerson, useMergePeople, useResetPerson, useUpdatePerson } from './usePersonOps'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => unknown>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))

const PID = '00000000-0000-4000-8000-000000000001'
const PEOPLE_KEYS = [['all-people'], ['person-detail', PID], ['person-ledger', PID], ['admin-balances'], ['tickets'], ['ledger'], ['person']]

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper, invalidate }
}
function expectExactInvalidation(invalidate: ReturnType<typeof makeWrapper>['invalidate']) {
  expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(PEOPLE_KEYS)
}

describe('invalidatePeople', () => {
  // oxlint-disable-next-line vitest/expect-expect -- 단언은 expectExactInvalidation 안의 expect() 가 한다
  it('사람 목록·상세·이력과 식권 쪽 캐시를 무효화한다', async () => {
    const { client, invalidate } = makeWrapper()
    await invalidatePeople(client, PID)
    expectExactInvalidation(invalidate)
  })
})

describe('useUpdatePerson', () => {
  it('이름·번호를 people 에 직접 쓰고 캐시를 무효화한다', async () => {
    const row = { id: PID, name: '김철수', phone: '01099998888' }
    const q = ok(row)
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUpdatePerson(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: '김철수', phone: '01099998888' })
    })
    expect(from).toHaveBeenCalledWith('people')
    expect(q.has('update', { name: '김철수', phone: '01099998888' })).toBe(true)
    expect(q.has('eq', 'id', PID)).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('번호 중복(23505)은 코드를 보존해 던진다', async () => {
    from.mockReturnValue(fail('duplicate key value', '23505'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdatePerson(PID), { wrapper })
    await expect(result.current.mutateAsync({ name: '김철수', phone: '01099998888' })).rejects.toMatchObject({ code: '23505' })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useMergePeople', () => {
  it('merge_people 를 from·into 로 부르고 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: PID }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useMergePeople(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('p9')
    })
    expect(rpc).toHaveBeenCalledWith('merge_people', { p_from_id: 'p9', p_into_id: PID })
    expectExactInvalidation(invalidate)
  })

  it('RPC 오류는 코드를 보존한다', async () => {
    rpc.mockReturnValue(fail('both_have_accounts'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMergePeople(PID), { wrapper })
    await expect(result.current.mutateAsync('p9')).rejects.toThrow('both_have_accounts')
  })
})

describe('useResetPerson', () => {
  it('admin_reset_person 를 부르고 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok(null))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useResetPerson(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(rpc).toHaveBeenCalledWith('admin_reset_person', { p_person_id: PID })
    expectExactInvalidation(invalidate)
  })
})

describe('useLinkPerson', () => {
  it('link_person 를 사람·계정 id 로 부르고 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: PID }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useLinkPerson(PID), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('123e4567-e89b-42d3-a456-426614174000')
    })
    expect(rpc).toHaveBeenCalledWith('link_person', { p_person_id: PID, p_auth_user_id: '123e4567-e89b-42d3-a456-426614174000' })
    expectExactInvalidation(invalidate)
  })
})
```

`src/features/admin/PersonEditForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonEditForm } from './PersonEditForm'

type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useUpdatePerson } = vi.hoisted(() => ({ useUpdatePerson: vi.fn<(personId: string) => M>() }))
vi.mock('./usePersonOps', () => ({ useUpdatePerson }))

const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

function renderForm(over: { name?: string; phone?: string | null } = {}) {
  const onDone = vi.fn<(m: string) => void>()
  const onCancel = vi.fn<() => void>()
  render(<PersonEditForm personId="p1" name={over.name ?? '김철수'} phone={over.phone ?? '01012345678'} onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel }
}

describe('PersonEditForm', () => {
  beforeEach(() => {
    useUpdatePerson.mockReturnValue(idle())
  })

  it('현재 값이 채워지고, 저장하면 정규화된 값으로 부른다', async () => {
    const update = idle()
    update.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUpdatePerson.mockReturnValue(update)
    const { onDone } = renderForm()
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
    expect(screen.getByLabelText('휴대폰 번호')).toHaveValue('010-1234-5678')
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-9999-8888')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).toHaveBeenCalledWith({ name: '김철수', phone: '01099998888' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('김철수 님 정보를 저장했어요')
  })

  it('번호를 비우면 번호 없는 사람으로 저장한다', async () => {
    const update = idle()
    update.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUpdatePerson.mockReturnValue(update)
    renderForm({ phone: null })
    expect(screen.getByLabelText('휴대폰 번호')).toHaveValue('')
    await userEvent.type(screen.getByLabelText('이름'), '이')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).toHaveBeenCalledWith({ name: '김철수이', phone: null }, expect.anything())
  })

  it('틀린 번호는 서버를 부르지 않고 칸에 오류', async () => {
    const update = idle()
    useUpdatePerson.mockReturnValue(update)
    renderForm()
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
  })

  it('번호 중복(23505) 서버 오류 문구', () => {
    useUpdatePerson.mockReturnValue({ ...idle(), isError: true, error: Object.assign(new Error('duplicate'), { code: '23505' }) })
    renderForm()
    expect(screen.getByRole('alert')).toHaveTextContent('이미 다른 분이 쓰는 번호예요')
  })

  it('취소는 onCancel 과 reset', async () => {
    const update = idle()
    useUpdatePerson.mockReturnValue(update)
    const { onCancel } = renderForm()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(update.reset).toHaveBeenCalled()
  })
})
```

`src/pages/admin/PersonDetailPage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { LedgerEntry } from '../../features/history/mergeLedger'
import type { PersonDetail } from '../../features/admin/usePersonDetail'
import { PersonDetailPage } from './PersonDetailPage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T; refetch: () => void }
const { usePersonDetail, usePersonLedger } = vi.hoisted(() => ({
  usePersonDetail: vi.fn<(id: string) => Q<PersonDetail | null>>(),
  usePersonLedger: vi.fn<(id: string) => Q<LedgerEntry[]>>(),
}))
vi.mock('../../features/admin/usePersonDetail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/usePersonDetail')>()),
  usePersonDetail,
}))
vi.mock('../../features/admin/usePersonLedger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/usePersonLedger')>()),
  usePersonLedger,
}))
vi.mock('../../features/admin/PersonEditForm', () => ({
  PersonEditForm: ({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) => (
    <div>
      <p>정보 수정 폼</p>
      <button type="button" onClick={() => onDone('김철수 님 정보를 저장했어요')}>폼저장</button>
      <button type="button" onClick={onCancel}>폼취소</button>
    </div>
  ),
}))
vi.mock('../../features/admin/PersonMergePanel', () => ({ PersonMergePanel: () => <p>합치기 패널</p> }))
vi.mock('../../features/admin/PersonDangerZone', () => ({ PersonDangerZone: () => <p>위험 구역</p> }))

const PID = '00000000-0000-4000-8000-000000000001'
const person = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', role: 'member',
  is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07',
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
}
const detail: PersonDetail = {
  person,
  family: [
    { id: PID, name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1', role: 'member', deleted_at: null },
    { id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: PID, auth_user_id: 'k1', role: 'member', deleted_at: null },
  ],
}
const ledger: LedgerEntry[] = [
  { kind: 'usage', id: 'u1', at: '2026-10-11T03:31:00Z', mealTitle: '주일 점심', servedOn: '2026-10-11', person: '김철수', via: 'self', voided: false },
  { kind: 'issuance', id: 'i1', at: '2026-10-09T05:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-11', quantity: 2, amount: 10000, buyer: '김철수', issuer: '권사', memo: '입금 확인', cancelled: true, cancelReason: '입금 취소' },
]

function page(path = `/admin/people/${PID}`) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/people/:personId" element={<PersonDetailPage />} />
        <Route path="/admin/people" element={<p>사람 목록</p>} />
      </Routes>
    </MemoryRouter>
  )
}
const renderPage = (path?: string) => render(page(path))

beforeEach(() => {
  usePersonDetail.mockReturnValue({ status: 'success', data: detail, refetch: vi.fn<() => void>() })
  usePersonLedger.mockReturnValue({ status: 'success', data: ledger, refetch: vi.fn<() => void>() })
})

describe('PersonDetailPage', () => {
  it('이름·전체 번호·가족 구성원·이력을 보여 준다', () => {
    renderPage()
    expect(usePersonDetail).toHaveBeenCalledWith(PID)
    expect(screen.getByRole('heading', { level: 1, name: '김철수' })).toBeInTheDocument()
    expect(screen.getByText('010-1234-5678')).toBeInTheDocument()
    const family = within(screen.getByRole('list', { name: '가족 구성원' })).getAllByRole('listitem')
    expect(family).toHaveLength(2)
    expect(family[1]).toHaveTextContent('서연')
    expect(family[1]).toHaveTextContent('자녀')
    const history = within(screen.getByRole('list', { name: '발급·사용 이력' })).getAllByRole('listitem')
    expect(history[0]).toHaveTextContent('사용 1장 · 김철수 폰')
    expect(history[1]).toHaveTextContent('발급 2장 · 10,000원')
    expect(history[1]).toHaveTextContent('취소됨 · 입금 취소')
  })

  it('"수정" 을 누르면 폼이 열리고, 저장하면 닫히며 안내가 뜬다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByText('정보 수정 폼')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '폼저장' }))
    expect(screen.queryByText('정보 수정 폼')).not.toBeInTheDocument()
    expect(screen.getByText('김철수 님 정보를 저장했어요')).toBeInTheDocument()
  })

  it('합치기 패널과 위험 구역이 있다', () => {
    renderPage()
    expect(screen.getByText('합치기 패널')).toBeInTheDocument()
    expect(screen.getByText('위험 구역')).toBeInTheDocument()
  })

  it('이력이 없으면 안내', () => {
    usePersonLedger.mockReturnValue({ status: 'success', data: [], refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('아직 발급·사용 기록이 없어요')).toBeInTheDocument()
  })

  it('익명화된 사람은 초기화됨 안내와 함께 수정·합치기·위험 구역을 숨긴다', () => {
    usePersonDetail.mockReturnValue({
      status: 'success',
      data: { person: { ...person, name: '탈퇴한 사용자', phone: null, auth_user_id: null, deleted_at: '2026-10-11T00:00:00Z' }, family: [] },
      refetch: vi.fn<() => void>(),
    })
    renderPage()
    expect(screen.getByText('초기화·합쳐진 사람이에요. 기록만 남아 있어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(screen.queryByText('합치기 패널')).not.toBeInTheDocument()
    expect(screen.queryByText('위험 구역')).not.toBeInTheDocument()
  })

  it('없는 사람은 안내만', () => {
    usePersonDetail.mockReturnValue({ status: 'success', data: null, refetch: vi.fn<() => void>() })
    renderPage('/admin/people/zzz')
    expect(screen.getByRole('alert')).toHaveTextContent('사람을 찾을 수 없어요')
    expect(screen.queryByRole('list', { name: '가족 구성원' })).not.toBeInTheDocument()
  })

  it('"← 사람" 링크는 목록으로', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: '← 사람' }))
    expect(screen.getByText('사람 목록')).toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    usePersonDetail.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { rerender } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    const refetch = vi.fn<() => void>()
    usePersonDetail.mockReturnValue({ status: 'error', refetch })
    rerender(page())
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/admin src/pages/admin/PersonDetailPage`
Expected: 모듈 없음.

- [x] **Step 3: 구현**

`src/features/admin/personSchema.ts`:

```ts
import { z } from 'zod'
import { nameSchema } from '../../lib/fieldSchemas'
import { isValidMobile, normalizePhone } from '../../lib/phone'
import { validateWith, type Validation } from '../../lib/validate'

// 관리자 수정 화면의 번호는 비울 수 있다 — 자녀·방문자는 번호가 없고, 잘못 들어간 번호를 지워야 할 때도 있다.
const optionalPhoneSchema = z
  .string()
  .transform((s) => normalizePhone(s))
  .transform((s) => (s === '' ? null : s))
  .refine((s) => s === null || isValidMobile(s), '휴대폰 번호를 확인해 주세요.')

export const adminPersonSchema = z.object({ name: nameSchema, phone: optionalPhoneSchema })
export const authUserIdSchema = z.object({
  authUserId: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '계정 id(uuid)를 붙여 넣어 주세요')),
})

export type AdminPersonInput = z.input<typeof adminPersonSchema>
export type AdminPersonValues = z.output<typeof adminPersonSchema>
export type AuthUserIdInput = z.input<typeof authUserIdSchema>
export type AuthUserIdValues = z.output<typeof authUserIdSchema>

export const validateAdminPerson = (input: AdminPersonInput): Validation<AdminPersonValues, AdminPersonInput> =>
  validateWith(adminPersonSchema, input, 'name')
export const validateAuthUserId = (input: AuthUserIdInput): Validation<AuthUserIdValues, AuthUserIdInput> =>
  validateWith(authUserIdSchema, input, 'authUserId')
```

`src/features/admin/usePersonOps.ts`:

```ts
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { adminBalancesQueryKey } from './useMeals'
import { allPeopleQueryKey } from './useAllPeople'
import { personDetailQueryKey } from './usePersonDetail'
import { personLedgerQueryKey } from './usePersonLedger'
import type { AdminPersonValues } from './personSchema'

/** 재조회 대기 한도. 넘으면 버튼을 먼저 풀어 준다 (4a 최종 리뷰 — 재조회에는 AbortSignal 이 없다). */
export const SETTLE_TIMEOUT_MS = 3_000

/**
 * 사람을 고치면 다시 읽어야 하는 것 전부: 사람 목록·그 사람 상세·이력, 그리고 장부의 가족이 옮겨질 수 있으니
 * 관리자 합계·식권·내역, 마지막으로 내 사람 행(합친 대상이 관리자 본인일 수 있다). 순서는 테스트가 단언한다.
 */
export function invalidatePeople(queryClient: QueryClient, personId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: allPeopleQueryKey }),
    queryClient.invalidateQueries({ queryKey: personDetailQueryKey(personId) }),
    queryClient.invalidateQueries({ queryKey: personLedgerQueryKey(personId) }),
    queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
    queryClient.invalidateQueries({ queryKey: ['person'] }),
  ])
}

const settle = (queryClient: QueryClient, personId: string) =>
  Promise.race([invalidatePeople(queryClient, personId), new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))])

/** 이름·번호 수정. 함수가 아니라 people 의 관리자 update 정책(열 권한 name·phone)으로 바로 쓴다. */
export function useUpdatePerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: AdminPersonValues) =>
      unwrap(await supabase.from('people').update({ name: values.name, phone: values.phone }).eq('id', personId).select('id, name, phone').single()),
    onSuccess: () => settle(queryClient, personId),
  })
}

/** 중복 합치기: 보고 있는 사람이 into, 고른 사람이 from (from 이 익명화된다). */
export function useMergePeople(intoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (fromId: string) => unwrap(await supabase.rpc('merge_people', { p_from_id: fromId, p_into_id: intoId })),
    onSuccess: () => settle(queryClient, intoId),
  })
}

/** 사람 초기화: 익명화 + 계정 해제. 장부는 보존된다. */
export function useResetPerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('admin_reset_person', { p_person_id: personId })),
    onSuccess: () => settle(queryClient, personId),
  })
}

/** 카카오 계정 수동 연결 (복구 경로). */
export function useLinkPerson(personId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (authUserId: string) => unwrap(await supabase.rpc('link_person', { p_person_id: personId, p_auth_user_id: authUserId })),
    onSuccess: () => settle(queryClient, personId),
  })
}
```

`src/features/admin/PersonEditForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Button, TextField } from '../../components/ui'
import type { FieldErrors } from '../../lib/validate'
import { formatPhone } from '../../lib/phone'
import { profileErrorMessage } from '../family/useFamilyActions'
import { validateAdminPerson, type AdminPersonInput } from './personSchema'
import { useUpdatePerson } from './usePersonOps'

type Props = { personId: string; name: string; phone: string | null; onDone: (message: string) => void; onCancel: () => void }

/** 관리자 이름·번호 수정. 번호는 비울 수 있다(자녀·방문자). 번호 중복은 23505 → 구체적인 문구. */
export function PersonEditForm({ personId, name: initialName, phone: initialPhone, onDone, onCancel }: Props) {
  const update = useUpdatePerson(personId)
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone ? formatPhone(initialPhone) : '')
  const [errors, setErrors] = useState<FieldErrors<AdminPersonInput>>({})

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateAdminPerson({ name, phone })
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    update.mutate(result.values, { onSuccess: () => onDone(`${result.values.name} 님 정보를 저장했어요`) })
  }
  function cancel() {
    setErrors({})
    update.reset()
    onCancel()
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">정보 수정</h2>
      <TextField label="이름" name="person-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      <TextField
        label="휴대폰 번호"
        name="person-phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="없으면 비워 두세요"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={errors.phone}
      />
      {update.isError && <p role="alert" className="text-sm text-red-600">{profileErrorMessage(update.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={cancel} disabled={update.isPending}>취소</Button>
        <Button type="submit" disabled={update.isPending}>{update.isPending ? '저장 중…' : '저장'}</Button>
      </div>
    </form>
  )
}
```

`src/pages/admin/PersonDetailPage.tsx`:

```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Spinner } from '../../components/ui'
import { PersonDangerZone } from '../../features/admin/PersonDangerZone'
import { PersonEditForm } from '../../features/admin/PersonEditForm'
import { PersonMergePanel } from '../../features/admin/PersonMergePanel'
import { usePersonDetail, type FamilyMemberRow } from '../../features/admin/usePersonDetail'
import { usePersonLedger } from '../../features/admin/usePersonLedger'
import type { LedgerEntry } from '../../features/history/mergeLedger'
import { formatDateTime, formatShortDate } from '../../lib/dates'
import { formatWon } from '../../lib/money'
import { formatPhone } from '../../lib/phone'

/** `#/admin/people/:personId` — 사람 상세 (설계 §8.3). 전체 번호·가족·이력과 고치기 동작. */
export function PersonDetailPage() {
  const { personId = '' } = useParams()
  const detail = usePersonDetail(personId)
  const ledger = usePersonLedger(personId)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const person = detail.data?.person
  const anonymized = person?.deleted_at !== null && person?.deleted_at !== undefined

  function done(message: string) {
    setNotice(message)
    setEditing(false)
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link to="/admin/people" className="text-sm text-blue-600 underline">← 사람</Link>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* data 로 분기한다 (공통 규약). null 은 "없는 사람" 이라는 정상 값이다. */}
      {detail.data !== undefined ? (
        detail.data === null || !person ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
            사람을 찾을 수 없어요. 목록으로 돌아가 주세요.
          </p>
        ) : (
          <>
            <div>
              <h1 className="text-lg font-extrabold">{person.name}</h1>
              <p className="text-xs text-gray-500">
                {person.phone ? formatPhone(person.phone) : '번호 없음'}
                {person.role === 'admin' ? ' · 관리자' : ''}
                {person.is_minor ? ' · 자녀' : ''}
                {!person.is_minor && !person.auth_user_id ? ' · 미가입' : ''}
              </p>
            </div>
            {detail.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 정보를 받지 못했어요</p>}
            {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</p>}

            {anonymized ? (
              <p role="status" className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">초기화·합쳐진 사람이에요. 기록만 남아 있어요.</p>
            ) : editing ? (
              <PersonEditForm personId={person.id} name={person.name} phone={person.phone} onDone={done} onCancel={() => setEditing(false)} />
            ) : (
              <button type="button" onClick={() => { setNotice(null); setEditing(true) }} className="self-start px-3 py-2 text-xs text-blue-600 underline">수정</button>
            )}

            <section aria-label="가족" className="flex flex-col gap-2">
              <h2 className="text-xs font-bold text-gray-500">가족</h2>
              {detail.data.family.length === 0 ? (
                <p className="text-sm text-gray-500">가족 정보가 없어요</p>
              ) : (
                <ul aria-label="가족 구성원" className="flex flex-col gap-2">
                  {detail.data.family.map((m) => <FamilyLine key={m.id} member={m} meId={person.id} />)}
                </ul>
              )}
            </section>

            <section aria-label="이력" className="flex flex-col gap-2">
              <h2 className="text-xs font-bold text-gray-500">발급·사용 이력</h2>
              {ledger.data && ledger.data.length > 0 ? (
                <ul aria-label="발급·사용 이력" className="flex flex-col gap-2">
                  {ledger.data.map((entry) => <LedgerLine key={`${entry.kind}-${entry.id}`} entry={entry} />)}
                </ul>
              ) : ledger.data ? (
                <p className="text-sm text-gray-500">아직 발급·사용 기록이 없어요</p>
              ) : ledger.status === 'error' ? (
                <p role="status" className="text-xs text-gray-500">이력을 받지 못했어요</p>
              ) : (
                <Spinner inline />
              )}
            </section>

            {!anonymized && (
              <>
                <PersonMergePanel person={person} onDone={done} />
                <PersonDangerZone person={person} onDone={done} />
              </>
            )}
          </>
        )
      ) : detail.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          사람을 불러오지 못했어요
          <button type="button" onClick={() => void detail.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function FamilyLine({ member, meId }: { member: FamilyMemberRow; meId: string }) {
  const tags = [member.id === meId ? '본인' : null, member.role === 'admin' ? '관리자' : null, member.is_minor ? '자녀' : null, member.deleted_at ? '초기화됨' : null].filter(
    (t): t is string => t !== null,
  )
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-bold">{member.name}</span>
        {tags.map((tag) => (
          <span key={tag} className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">{tag}</span>
        ))}
      </span>
      <span className="shrink-0 text-xs text-gray-500">{member.phone ? formatPhone(member.phone) : '번호 없음'}</span>
    </li>
  )
}

/** 교인 내역 화면과 같은 줄 모양 + 관리자만 보는 취소 사유. */
function LedgerLine({ entry }: { entry: LedgerEntry }) {
  const struck = entry.kind === 'issuance' ? entry.cancelled : entry.voided
  const servedOn = entry.servedOn ? `${formatShortDate(entry.servedOn)} ` : ''
  return (
    <li className={`rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm ${struck ? 'text-gray-500' : ''}`}>
      {entry.kind === 'issuance' ? (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>발급 {entry.quantity}장 · {formatWon(entry.amount)}</div>
          <div className="text-xs">{formatDateTime(entry.at)} · {servedOn}{entry.mealTitle} · {entry.issuer}{entry.memo ? ` · ${entry.memo}` : ''}</div>
          {entry.cancelled && <div className="text-xs font-bold">취소됨{entry.cancelReason ? ` · ${entry.cancelReason}` : ''}</div>}
        </>
      ) : (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>
            사용 1장 · {entry.via === 'admin' ? '담당자 처리' : entry.person ? `${entry.person} 폰` : '가족 폰'}
          </div>
          <div className="text-xs">{formatDateTime(entry.at)} · {servedOn}{entry.mealTitle}</div>
          {entry.voided && <div className="text-xs font-bold">무효</div>}
        </>
      )}
    </li>
  )
}
```

`src/App.tsx` — `PersonDetailPage` 를 import 하고 관리자 라우트에 한 줄:

```tsx
              <Route path="/admin/people/:personId" element={<RequireAdmin><PersonDetailPage /></RequireAdmin>} />
```

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과. `PersonMergePanel`·`PersonDangerZone` 은 Task 6 이 채우지만 이 Task 의 페이지가 이미 쓰므로 **자리만 먼저 만든다**. `noUnusedParameters: true` 라 props 이름 앞에 `_` 를 붙인다:

```tsx
// src/features/admin/PersonMergePanel.tsx — Task 6 에서 채운다
import type { Person } from '../auth/usePerson'

export function PersonMergePanel(_props: { person: Person; onDone: (message: string) => void }) {
  return null
}
```

```tsx
// src/features/admin/PersonDangerZone.tsx — Task 6 에서 채운다
import type { Person } from '../auth/usePerson'

export function PersonDangerZone(_props: { person: Person; onDone: (message: string) => void }) {
  return null
}
```

(상세 화면 테스트는 두 컴포넌트를 목으로 바꾸므로 자리만 있으면 통과한다.)

- [x] **Step 5: 수동 확인 (로컬)**

Run: `npm run dev`. 개발 로그인 `e2e-admin@test.local` → 관리 › 사람 → 검색·필터 → 아무 사람 → 전체 번호·가족·이력 확인 → 수정으로 번호 바꾸고 목록에 반영되는지.

- [x] **Step 6: 커밋**

```bash
git add src/features/admin/personSchema.ts src/features/admin/personSchema.test.ts src/features/admin/usePersonOps.ts src/features/admin/usePersonOps.test.tsx src/features/admin/PersonEditForm.tsx src/features/admin/PersonEditForm.test.tsx src/features/admin/PersonMergePanel.tsx src/features/admin/PersonDangerZone.tsx src/pages/admin/PersonDetailPage.tsx src/pages/admin/PersonDetailPage.test.tsx src/App.tsx
git commit -m "feat(admin): 사람 상세(#/admin/people/:id) — 전체 번호·가족·이력, 이름·번호 수정

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**중간 배포 지점.** 여기까지가 "교인 찾아 번호·가족·이력 확인 + 번호 고치기" 다. 사용자가 당장 쓰고 싶어 하면 이 커밋으로 PR 을 만들 수 있다(마이그레이션은 Task 1 하나 — 세 함수는 아직 화면에서 부르지 않으므로 올라가도 무해하다). 이후 Task 는 같은 브랜치에서 이어 간다.

---
### Task 6: 상세 동작 — 합치기 · 초기화 · 계정 연결 · 오류 문구

**Files:**
- Modify: `src/features/admin/PersonMergePanel.tsx`(Task 5 의 자리를 채운다), Create: `src/features/admin/PersonMergePanel.test.tsx`
- Modify: `src/features/admin/PersonDangerZone.tsx`(Task 5 의 자리를 채운다), Create: `src/features/admin/PersonDangerZone.test.tsx`
- Modify: `src/features/admin/usePersonOps.ts` (문구 매퍼), `src/features/admin/usePersonOps.test.tsx`
- Modify: `src/lib/errors.ts`, `src/lib/errors.test.ts`

- [x] **Step 1: 실패하는 테스트**

`src/lib/errors.test.ts` — 새 `it` 하나를 더한다:

```ts
  it('4b단계 사람 관리 코드에 문구가 있다', () => {
    expect(toUserMessage(new Error('same_person'))).toBe('같은 사람끼리는 합칠 수 없어요.')
    expect(toUserMessage(new Error('minor_not_allowed'))).toBe('자녀는 가족 탭에서 관리해 주세요.')
    expect(toUserMessage(new Error('both_have_accounts'))).toBe('두 분 모두 카카오 계정이 있어요. 한쪽을 먼저 초기화해 주세요.')
    expect(toUserMessage(new Error('account_not_found'))).toBe('그 계정 id 를 찾을 수 없어요. 다시 확인해 주세요.')
    expect(toUserMessage(new Error('account_taken'))).toBe('이미 다른 분이 쓰는 계정이에요.')
  })
```

`src/features/admin/usePersonOps.test.tsx` — 문구 매퍼 테스트를 더한다(파일 맨 아래):

```tsx
describe('personOpsErrorMessage', () => {
  it('사람 관리 맥락에서만 다른 세 코드를 바꿔 준다', () => {
    expect(personOpsErrorMessage(new Error('already_registered'))).toBe('이 분은 이미 카카오 계정이 연결돼 있어요.')
    expect(personOpsErrorMessage(new Error('consent_required'))).toBe('그 분의 동의 기록이 없어요. 본인이 가입 화면에서 동의해야 연결할 수 있어요.')
    expect(personOpsErrorMessage(new Error('last_admin'))).toBe('마지막 관리자는 초기화할 수 없어요. 다른 관리자를 먼저 지정해 주세요.')
  })

  it('나머지는 공용 문구 그대로', () => {
    expect(personOpsErrorMessage(new Error('both_have_accounts'))).toBe('두 분 모두 카카오 계정이 있어요. 한쪽을 먼저 초기화해 주세요.')
    expect(personOpsErrorMessage(new Error('has_children'))).toBe('연결된 자녀가 있어요. 자녀를 먼저 삭제해 주세요.')
  })
})
```

(파일 상단 import 에 `personOpsErrorMessage` 를 더한다.)

`src/features/admin/PersonMergePanel.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decoratePeople, type DecoratedPerson, type PersonRow } from './peopleFilter'
import type { Person } from '../auth/usePerson'
import { PersonMergePanel } from './PersonMergePanel'

type Q = { status: 'pending' | 'error' | 'success'; data?: DecoratedPerson[]; refetch: () => void }
type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: string, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useAllPeople, useMergePeople } = vi.hoisted(() => ({
  useAllPeople: vi.fn<() => Q>(),
  useMergePeople: vi.fn<(intoId: string) => M>(),
}))
vi.mock('./useAllPeople', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useAllPeople')>()),
  useAllPeople,
}))
vi.mock('./usePersonOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usePersonOps')>()),
  useMergePeople,
}))

const PID = '00000000-0000-4000-8000-000000000001'
const me = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: null, role: 'member',
  is_minor: false, guardian_id: null, consented_at: null, consent_version: null,
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const row = (over: Partial<PersonRow>): PersonRow => ({
  id: 'p9', family_id: 'f9', name: '김철수', phone: '01088887777', auth_user_id: null,
  role: 'member', is_minor: false, guardian_id: null, created_at: '2026-10-07T00:00:00Z', ...over,
})
const candidates = decoratePeople([
  row({ id: PID, family_id: 'f1', phone: '01012345678' }), // 본인
  row({ id: 'p9' }),                                        // 합칠 중복 행 (계정 없음)
  row({ id: 'p8', name: '이영희', phone: '01099998888', auth_user_id: 'u8', family_id: 'f8' }), // 계정 있음
  row({ id: 'p7', name: '서연', phone: null, is_minor: true, guardian_id: PID, auth_user_id: 'k7', family_id: 'f1' }), // 자녀
])
const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

function renderPanel(person: Person = me) {
  const onDone = vi.fn<(m: string) => void>()
  render(<PersonMergePanel person={person} onDone={onDone} />)
  return { onDone }
}

beforeEach(() => {
  useAllPeople.mockReturnValue({ status: 'success', data: candidates, refetch: vi.fn<() => void>() })
  useMergePeople.mockReturnValue(idle())
})

describe('PersonMergePanel', () => {
  it('접혀 있고, 열면 검색 칸이 나온다', async () => {
    renderPanel()
    expect(screen.queryByLabelText('합칠 사람 찾기')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByLabelText('합칠 사람 찾기')).toBeInTheDocument()
    expect(useMergePeople).toHaveBeenCalledWith(PID)
  })

  it('본인과 자녀는 후보에서 빠진다', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    await userEvent.type(screen.getByLabelText('합칠 사람 찾기'), '010')
    const names = within(screen.getByRole('list', { name: '합칠 사람 후보' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(names).toEqual([expect.stringContaining('김철수'), expect.stringContaining('이영희')])
    expect(names.join()).not.toContain('서연')
  })

  it('두 글자 미만이면 후보를 띄우지 않는다 (전체 명단이 쏟아지지 않게)', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByText('두 글자 또는 번호 뒷자리를 넣어 주세요')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '합칠 사람 후보' })).not.toBeInTheDocument()
  })

  it('둘 다 계정이 있으면 그 후보는 잠기고 이유를 보여 준다', async () => {
    renderPanel({ ...me, auth_user_id: 'u1', consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07' })
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    await userEvent.type(screen.getByLabelText('합칠 사람 찾기'), '이영희')
    expect(screen.getByRole('button', { name: /이영희 선택/ })).toBeDisabled()
    expect(screen.getByText('둘 다 카카오 계정이 있어요 — 한쪽을 먼저 초기화해 주세요')).toBeInTheDocument()
  })

  it('후보를 고르면 방향이 분명한 확인을 거쳐 merge 를 부른다', async () => {
    const merge = idle()
    merge.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useMergePeople.mockReturnValue(merge)
    const { onDone } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    await userEvent.type(screen.getByLabelText('합칠 사람 찾기'), '8888')
    await userEvent.click(screen.getByRole('button', { name: /김철수 선택/ }))
    expect(screen.getByText(/김철수\(010-8888-7777\) 의 기록·자녀·계정을 김철수\(010-1234-5678\) 로 옮기고/)).toBeInTheDocument()
    expect(merge.mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '합치기' }))
    expect(merge.mutate).toHaveBeenCalledWith('p9', expect.anything())
    expect(onDone).toHaveBeenCalledWith('김철수 님으로 합쳤어요')
  })

  it('서버 오류 문구를 사람 관리 맥락으로 보여 준다', async () => {
    useMergePeople.mockReturnValue({ ...idle(), isError: true, error: new Error('both_have_accounts') })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: '중복 사람 합치기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('두 분 모두 카카오 계정이 있어요')
  })
})
```

`src/features/admin/PersonDangerZone.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Person } from '../auth/usePerson'
import { PersonDangerZone } from './PersonDangerZone'

type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars?: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useResetPerson, useLinkPerson } = vi.hoisted(() => ({
  useResetPerson: vi.fn<(id: string) => M>(),
  useLinkPerson: vi.fn<(id: string) => M>(),
}))
vi.mock('./usePersonOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usePersonOps')>()),
  useResetPerson,
  useLinkPerson,
}))

const PID = '00000000-0000-4000-8000-000000000001'
const base = {
  id: PID, family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: null, role: 'member',
  is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z', consent_version: '2026-10-07',
  guardian_consented_at: null, deleted_at: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })

function renderZone(person: Person = base) {
  const onDone = vi.fn<(m: string) => void>()
  render(<PersonDangerZone person={person} onDone={onDone} />)
  return { onDone }
}

beforeEach(() => {
  useResetPerson.mockReturnValue(idle())
  useLinkPerson.mockReturnValue(idle())
})

describe('PersonDangerZone · 초기화', () => {
  it('확인을 거쳐 초기화하고 안내가 뜬다', async () => {
    const reset = idle()
    reset.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useResetPerson.mockReturnValue(reset)
    const { onDone } = renderZone()
    await userEvent.click(screen.getByRole('button', { name: '사람 초기화' }))
    expect(screen.getByRole('status')).toHaveTextContent('이름·번호를 지우고 카카오 연결을 끊어요')
    expect(reset.mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '초기화' }))
    expect(reset.mutate).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledWith('김철수 님을 초기화했어요')
  })

  it('마지막 관리자 오류는 초기화 맥락 문구로', () => {
    useResetPerson.mockReturnValue({ ...idle(), isError: true, error: new Error('last_admin') })
    renderZone()
    expect(screen.getByRole('alert')).toHaveTextContent('마지막 관리자는 초기화할 수 없어요')
  })
})

describe('PersonDangerZone · 계정 연결', () => {
  it('계정이 없는 사람에게만 보인다', () => {
    renderZone({ ...base, auth_user_id: 'u1' })
    expect(screen.queryByRole('button', { name: '계정 연결' })).not.toBeInTheDocument()
    expect(screen.getByText('카카오 계정이 연결돼 있어요')).toBeInTheDocument()
  })

  it('uuid 를 넣어야 부른다', async () => {
    const link = idle()
    link.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useLinkPerson.mockReturnValue(link)
    const { onDone } = renderZone()
    await userEvent.click(screen.getByRole('button', { name: '계정 연결' }))
    await userEvent.type(screen.getByLabelText('카카오 계정 id'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: '연결' }))
    expect(link.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('계정 id(uuid)를 붙여 넣어 주세요')
    await userEvent.clear(screen.getByLabelText('카카오 계정 id'))
    await userEvent.type(screen.getByLabelText('카카오 계정 id'), '123e4567-e89b-42d3-a456-426614174000')
    await userEvent.click(screen.getByRole('button', { name: '연결' }))
    expect(link.mutate).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000', expect.anything())
    expect(onDone).toHaveBeenCalledWith('카카오 계정을 연결했어요')
  })

  it('동의 기록이 없는 사람은 연결 칸 대신 이유를 보여 준다', async () => {
    renderZone({ ...base, consented_at: null, consent_version: null })
    expect(screen.queryByRole('button', { name: '계정 연결' })).not.toBeInTheDocument()
    expect(screen.getByText('동의 기록이 없어 연결할 수 없어요. 본인이 가입 화면에서 동의해야 해요.')).toBeInTheDocument()
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/admin src/lib/errors`
Expected: 문구 없음 · 두 컴포넌트가 비어 있어(Task 5 의 자리만 있는 상태) 단언 실패.

- [x] **Step 3: 구현**

`src/lib/errors.ts` 의 `MESSAGES` 에 4a 블록 다음으로 추가:

```ts
  // 4b단계 · 관리자 사람 관리
  same_person: '같은 사람끼리는 합칠 수 없어요.',
  minor_not_allowed: '자녀는 가족 탭에서 관리해 주세요.',
  both_have_accounts: '두 분 모두 카카오 계정이 있어요. 한쪽을 먼저 초기화해 주세요.',
  account_not_found: '그 계정 id 를 찾을 수 없어요. 다시 확인해 주세요.',
  account_taken: '이미 다른 분이 쓰는 계정이에요.',
```

`src/features/admin/usePersonOps.ts` 끝에 문구 매퍼를 더한다 (`rpcCodeOf`·`toUserMessage` 를 import):

```ts
/**
 * 사람 관리 화면의 오류 문구. 세 코드는 교인 맥락 문구가 이 화면에서 어색하다:
 *  · already_registered  가입 화면에서는 "이미 가입된 계정" 이지만 여기서는 "이 사람에게 계정이 이미 있다" 는 뜻
 *  · consent_required    가입 화면에서는 "동의해 주세요" 지만 여기서는 "그 사람의 동의 기록이 없다"
 *  · last_admin          탈퇴가 아니라 초기화를 막는 맥락
 */
export function personOpsErrorMessage(err: unknown): string {
  switch (rpcCodeOf(err)) {
    case 'already_registered':
      return '이 분은 이미 카카오 계정이 연결돼 있어요.'
    case 'consent_required':
      return '그 분의 동의 기록이 없어요. 본인이 가입 화면에서 동의해야 연결할 수 있어요.'
    case 'last_admin':
      return '마지막 관리자는 초기화할 수 없어요. 다른 관리자를 먼저 지정해 주세요.'
    default:
      return toUserMessage(err)
  }
}
```

`src/features/admin/PersonMergePanel.tsx`:

```tsx
import { useState } from 'react'
import { Button, TextField } from '../../components/ui'
import { formatPhone } from '../../lib/phone'
import type { Person } from '../auth/usePerson'
import { filterPeople, type DecoratedPerson } from './peopleFilter'
import { useAllPeople } from './useAllPeople'
import { personOpsErrorMessage, useMergePeople } from './usePersonOps'

type Props = { person: Person; onDone: (message: string) => void }

/** 후보를 두 글자부터 보여 준다 — 열자마자 전 교인 명단이 쏟아지면 잘못 고를 위험만 커진다. */
const MIN_QUERY = 2
const label = (p: DecoratedPerson | Person) => `${p.name}(${p.phone ? formatPhone(p.phone) : '번호 없음'})`

/**
 * 중복 사람 합치기. 보고 있는 사람이 **남는 쪽**(into), 고른 사람이 **익명 처리되는 쪽**(from) 이다.
 * 방향을 틀리면 되돌릴 수 없으므로 확인 문구에 두 사람의 이름·번호를 모두 적는다.
 */
export function PersonMergePanel({ person, onDone }: Props) {
  const people = useAllPeople()
  const merge = useMergePeople(person.id)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<DecoratedPerson | null>(null)

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { merge.reset(); setOpen(true) }}>중복 사람 합치기</Button>
    )
  }

  // 본인과 자녀는 후보가 아니다 (자녀는 가족 탭의 다시 연결·삭제로 관리한다). 익명화된 행은 useAllPeople 이 이미 뺀다.
  const candidates = people.data
    ? filterPeople(people.data, query, 'all').filter((p) => p.id !== person.id && !p.is_minor)
    : []
  const bothLinked = (p: DecoratedPerson) => person.auth_user_id !== null && p.auth_user_id !== null

  function close() {
    setOpen(false)
    setPicked(null)
    setQuery('')
    merge.reset()
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">중복 사람 합치기</h2>
      {picked ? (
        <>
          <p role="status" className="text-sm leading-relaxed text-gray-700">
            {label(picked)} 의 기록·자녀·계정을 {label(person)} 로 옮기고, {picked.name} 행은 익명 처리해요. 되돌릴 수 없어요.
          </p>
          {merge.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(merge.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPicked(null)} disabled={merge.isPending}>그만두기</Button>
            <Button
              onClick={() => merge.mutate(picked.id, { onSuccess: () => { onDone(`${person.name} 님으로 합쳤어요`); close() } })}
              disabled={merge.isPending}
            >
              {merge.isPending ? '처리 중…' : '합치기'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <TextField label="합칠 사람 찾기" name="merge-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 번호 뒷자리" autoComplete="off" />
          {merge.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(merge.error)}</p>}
          {query.trim().length < MIN_QUERY ? (
            <p className="text-sm text-gray-500">두 글자 또는 번호 뒷자리를 넣어 주세요</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-gray-500">찾는 사람이 없어요</p>
          ) : (
            <ul aria-label="합칠 사람 후보" className="flex flex-col gap-2">
              {candidates.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words">{label(p)}</span>
                  <div className="shrink-0 text-right">
                    <button
                      type="button"
                      onClick={() => setPicked(p)}
                      disabled={bothLinked(p)}
                      aria-label={`${p.name} 선택`}
                      className="px-3 py-2 text-xs text-blue-600 underline disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      선택
                    </button>
                    {bothLinked(p) && <p className="text-xs text-gray-500">둘 다 카카오 계정이 있어요 — 한쪽을 먼저 초기화해 주세요</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" onClick={close}>닫기</Button>
        </>
      )}
    </section>
  )
}
```

`src/features/admin/PersonDangerZone.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { ConfirmButton } from '../../components/ConfirmButton'
import { Button, TextField } from '../../components/ui'
import type { Person } from '../auth/usePerson'
import { validateAuthUserId } from './personSchema'
import { personOpsErrorMessage, useLinkPerson, useResetPerson } from './usePersonOps'

type Props = { person: Person; onDone: (message: string) => void }

const RESET_NOTICE = '이름·번호를 지우고 카카오 연결을 끊어요. 발급·사용 기록은 남아요. 그 폰은 다음 접속 때 가입 화면부터 다시 시작해요. 되돌릴 수 없어요.'

/** 사람 상세 맨 아래: 초기화(잘못 가입 정정) · 카카오 계정 수동 연결(복구 경로). */
export function PersonDangerZone({ person, onDone }: Props) {
  const reset = useResetPerson(person.id)
  const link = useLinkPerson(person.id)
  const [linking, setLinking] = useState(false)
  const [authUserId, setAuthUserId] = useState('')
  const [idError, setIdError] = useState<string | undefined>()

  function onLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateAuthUserId({ authUserId })
    if (!result.ok) return setIdError(result.errors.authUserId)
    setIdError(undefined)
    link.mutate(result.values.authUserId, {
      onSuccess: () => {
        onDone('카카오 계정을 연결했어요')
        setLinking(false)
        setAuthUserId('')
      },
    })
  }

  return (
    <section className="mt-2 flex flex-col gap-3 border-t border-gray-200 pt-4">
      <h2 className="text-xs font-bold text-gray-500">정정</h2>

      {person.auth_user_id ? (
        <p className="text-xs text-gray-500">카카오 계정이 연결돼 있어요</p>
      ) : person.consented_at === null ? (
        <p className="text-xs text-gray-500">동의 기록이 없어 연결할 수 없어요. 본인이 가입 화면에서 동의해야 해요.</p>
      ) : linking ? (
        <form onSubmit={onLink} noValidate className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3">
          <p className="text-xs leading-relaxed text-gray-600">
            초기화한 사람을 같은 카카오 계정으로 되돌릴 때만 씁니다. 계정 id 는 Supabase 의 Authentication › Users 에서 복사해 주세요.
          </p>
          <TextField label="카카오 계정 id" name="auth-user-id" value={authUserId} onChange={(e) => setAuthUserId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" error={idError} />
          {link.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(link.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setLinking(false); setIdError(undefined); link.reset() }} disabled={link.isPending}>그만두기</Button>
            <Button type="submit" disabled={link.isPending}>{link.isPending ? '연결 중…' : '연결'}</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => { link.reset(); setLinking(true) }}>계정 연결</Button>
      )}

      <div className="flex flex-col items-end gap-1">
        <ConfirmButton
          label={reset.isPending ? '처리 중…' : '사람 초기화'}
          message={RESET_NOTICE}
          confirmLabel="초기화"
          onConfirm={() => reset.mutate(undefined, { onSuccess: () => onDone(`${person.name} 님을 초기화했어요`) })}
          disabled={reset.isPending}
        />
        {reset.isError && <p role="alert" className="text-sm text-red-600">{personOpsErrorMessage(reset.error)}</p>}
      </div>
    </section>
  )
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과.

- [x] **Step 5: 수동 확인 (로컬)**

Run: `npm run dev`. 관리자 › 발급 › "+ 새로 등록" 으로 같은 이름·다른 번호의 중복 행을 만들고 2장 발급 → 사람 › 그 중복 행이 아닌 본인 → 중복 사람 합치기 → 검색 → 선택 → 합치기 → 이력에 발급이 따라오고 목록에서 중복 행이 사라지는지. 그 다음 아무 미가입 행에서 초기화 → 목록에서 사라지고 상세는 "초기화·합쳐진 사람" 으로 보이는지.

- [x] **Step 6: 커밋**

```bash
git add src/features/admin/PersonMergePanel.tsx src/features/admin/PersonMergePanel.test.tsx src/features/admin/PersonDangerZone.tsx src/features/admin/PersonDangerZone.test.tsx src/features/admin/usePersonOps.ts src/features/admin/usePersonOps.test.tsx src/lib/errors.ts src/lib/errors.test.ts
git commit -m "feat(admin): 사람 합치기·초기화·계정 연결 + 사람 관리 오류 문구

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 발급 취소 사유 입력

**Files:**
- Modify: `src/features/admin/useMealOps.ts`, `src/features/admin/useMealOps.test.tsx`
- Modify: `src/pages/admin/MealDetailPage.tsx`, `src/pages/admin/MealDetailPage.test.tsx`

- [x] **Step 1: 실패하는 테스트**

`src/features/admin/useMealOps.test.tsx` — `useCancelIssuance` 테스트를 인자 객체로 바꾼다(기존 두 테스트의 `mutateAsync('i1')` 호출과 rpc 단언을 아래로 교체):

```tsx
    await act(async () => {
      await result.current.mutateAsync({ issuanceId: 'i1', reason: '  입금 취소  ' })
    })
    expect(rpc).toHaveBeenCalledWith('cancel_issuance', { p_issuance_id: 'i1', p_reason: '입금 취소' })
```

그리고 사유 없는 경우를 더한다:

```tsx
  it('사유가 비면 p_reason 을 보내지 않는다', async () => {
    const q = ok({ id: 'i1' })
    rpc.mockReturnValue(q)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ issuanceId: 'i1', reason: '   ' })
    })
    expect(rpc).toHaveBeenCalledWith('cancel_issuance', { p_issuance_id: 'i1' })
  })
```

(오류 경로 테스트의 `mutateAsync('i1')` 도 `mutateAsync({ issuanceId: 'i1', reason: '' })` 로 바꾼다.)

`src/pages/admin/MealDetailPage.test.tsx` — 발급 취소 흐름이 사유 폼을 거치도록 바꾼다. 기존 `'"발급 취소" 는 남은 장수 안의 발급에만 열리고, 확인을 거쳐 cancel_issuance'` 테스트를 아래로 교체한다:

```tsx
  it('"발급 취소" 는 남은 장수 안의 발급에만 열리고, 사유 폼을 거쳐 cancel_issuance', async () => {
    const cancel = idle()
    cancel.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useCancelIssuance.mockReturnValue(cancel)
    renderPage()
    // f1: 남음 1. 이영희 1장(i2) → 가능. 김철수 2장(i1) → 불가 + 안내. 취소된 i3 에는 버튼이 없다.
    const blocked = screen.getByRole('button', { name: /김철수 2장 발급 취소$/ })
    expect(blocked).toBeDisabled()
    expect(screen.getByText('남은 장수(1)보다 많아 취소할 수 없어요 — 먼저 사용을 무효 처리해 주세요')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /발급 취소$/ })).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: /이영희 1장 발급 취소$/ }))
    expect(cancel.mutate).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('취소 사유 (선택)'), '입금 취소')
    await userEvent.click(screen.getByRole('button', { name: '취소하기' }))
    expect(cancel.mutate).toHaveBeenCalledWith({ issuanceId: 'i2', reason: '입금 취소' }, expect.anything())
    expect(screen.getByText('이영희 님 1장 발급을 취소했어요')).toBeInTheDocument()
  })

  it('사유 폼은 "그만두기" 로 닫히고 사유는 비워진다', async () => {
    const cancel = idle()
    useCancelIssuance.mockReturnValue(cancel)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /이영희 1장 발급 취소$/ }))
    await userEvent.type(screen.getByLabelText('취소 사유 (선택)'), '잘못 적음')
    await userEvent.click(screen.getByRole('button', { name: '그만두기' }))
    expect(screen.queryByLabelText('취소 사유 (선택)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /이영희 1장 발급 취소$/ }))
    expect(screen.getByLabelText('취소 사유 (선택)')).toHaveValue('')
  })
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/admin/useMealOps src/pages/admin/MealDetailPage`
Expected: 인자 모양·사유 칸 없음으로 실패.

- [x] **Step 3: 구현**

`src/features/admin/useMealOps.ts` — `useCancelIssuance` 가 사유를 받는다:

```ts
export type CancelArgs = { issuanceId: string; reason: string }

/** 발급 한 건 취소. 사유는 선택 — 비면 보내지 않는다(DB 의 p_reason 은 기본값 null). */
export function useCancelIssuance(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ issuanceId, reason }: CancelArgs) => {
      const trimmed = reason.trim()
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(
          await supabase
            .rpc('cancel_issuance', trimmed === '' ? { p_issuance_id: issuanceId } : { p_issuance_id: issuanceId, p_reason: trimmed })
            .abortSignal(signal),
        )
      } finally {
        done()
      }
    },
    onSuccess: () => settleBoard(queryClient, mealId),
    onError: makeRefreshBoard(queryClient, mealId),
  })
}
```

(기존 구현의 `withTimeout`·`settleBoard`·`makeRefreshBoard` 이름은 그대로 쓴다 — 파일에 이미 있다.)

`src/pages/admin/MealDetailPage.tsx` — 발급 줄의 `ConfirmButton` 을 "열기 버튼 + 사유 폼" 으로 바꾼다. `Actions` 에 취소 중인 발급 id 와 두 콜백을 더하고, `IssuanceLine` 을 고친다. 바뀌는 부분만:

```tsx
type Actions = {
  pending: boolean
  /** 사유를 적는 중인 발급 id (한 줄만 열린다) */
  cancelingId: string | null
  onCancelOpen: (issuance: MealIssuance) => void
  onCancelClose: () => void
  onCancel: (issuance: MealIssuance, reason: string) => void
  onVoid: (usage: MealUsage) => void
  onUseAsAdmin: (family: FamilyGroup) => void
}
```

```tsx
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  // …
  const actions: Actions = {
    pending,
    cancelingId,
    onCancelOpen: (i) => {
      clearFeedback()
      setCancelingId(i.id)
    },
    onCancelClose: () => setCancelingId(null),
    onCancel: (i, reason) => {
      clearFeedback()
      cancel.mutate({ issuanceId: i.id, reason }, {
        onSuccess: () => {
          setCancelingId(null)
          setNotice(`${i.buyer ? `${i.buyer} 님` : NO_NAME} ${i.quantity}장 발급을 취소했어요`)
        },
      })
    },
    onVoid: /* 그대로 */,
    onUseAsAdmin: /* 그대로 */,
  }
```

`IssuanceLine` 의 `{!i.cancelled && (<ConfirmButton … />)}` 블록을 아래로 바꾼다:

```tsx
      {!i.cancelled && actions.cancelingId !== i.id && (
        <button
          type="button"
          onClick={() => actions.onCancelOpen(i)}
          disabled={actions.pending || blocked}
          className="shrink-0 px-3 py-2 text-xs text-gray-600 underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          {/* sr-only 접두사로 줄마다 접근성 이름을 다르게 한다 (같은 구매자·장수가 두 줄일 수 있다) */}
          <span className="sr-only">{formatDateTime(i.issuedAt)} {buyer} {i.quantity}장</span> {actions.pending ? '처리 중…' : '발급 취소'}
        </button>
      )}
```

그리고 같은 `<li>` 안, 줄 본문 아래에 사유 폼을 둔다 (취소 중인 줄만):

```tsx
      {actions.cancelingId === i.id && <CancelReasonForm issuance={i} actions={actions} />}
```

새 컴포넌트(같은 파일 아래쪽):

```tsx
/** 발급 취소는 두 단계다: 버튼 → 사유 폼(사유는 선택) → 취소하기. ConfirmButton 과 달리 입력 칸이 필요해 폼으로 둔다. */
function CancelReasonForm({ issuance: i, actions }: { issuance: MealIssuance; actions: Actions }) {
  const [reason, setReason] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        actions.onCancel(i, reason)
      }}
      noValidate
      className="mt-2 flex flex-col gap-2 rounded-xl border border-gray-200 p-3"
    >
      <p className="text-xs text-gray-600">{i.buyer || NO_NAME} 님의 {i.quantity}장 발급을 취소할까요? 가족 잔량이 {i.quantity}장 줄어요.</p>
      <TextField label="취소 사유 (선택)" name={`cancel-reason-${i.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} placeholder="예) 입금 취소" autoComplete="off" />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={actions.onCancelClose} disabled={actions.pending}>그만두기</Button>
        <Button type="submit" disabled={actions.pending}>{actions.pending ? '처리 중…' : '취소하기'}</Button>
      </div>
    </form>
  )
}
```

(파일 상단 import 에 `Button`, `TextField` 를 더한다 — `Spinner` 와 같은 `../../components/ui` 에서 온다. `IssuanceLine` 은 `<li className="flex …">` 에서 `<li className="flex flex-col gap-0">` 으로 바꾸지 말고, 기존 좌우 배치를 `<div className="flex items-start justify-between gap-2">` 로 감싸고 그 아래 폼을 둔다.)

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과. E2E 는 Task 8 에서 함께 돌린다 — `e2e/admin.spec.ts` 의 `발급 취소` → `취소하기` 순서는 그대로 통하지만(사유는 선택) Task 8 에서 반드시 재확인한다.

- [x] **Step 5: 커밋**

```bash
git add src/features/admin/useMealOps.ts src/features/admin/useMealOps.test.tsx src/pages/admin/MealDetailPage.tsx src/pages/admin/MealDetailPage.test.tsx
git commit -m "feat(admin): 발급 취소에 사유 입력 (사람 상세 이력에서 보인다)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 8: E2E — 중복 합치기 · 이력 합산 · 취소 사유 · 초기화

**Files:**
- Modify: `e2e/helpers.ts` (관리자 헬퍼 쪼개기 — 4a 인계 항목)
- Create: `e2e/people.spec.ts`

- [x] **Step 1: 헬퍼 쪼개기**

4a 리뷰가 넘긴 대로, 한 덩어리였던 `adminCreateTodayMealAndIssueTwo` 를 셋으로 쪼개고 기존 함수는 그 셋을 부르는 얇은 껍데기로 남긴다(기존 세 스펙은 그대로 통한다). `e2e/helpers.ts` 의 `adminCreateTodayMealAndIssueTwo` 를 아래로 바꾼다:

```ts
/** 관리자로 개발 로그인하고 홈까지. */
export async function adminLogin(page: Page) {
  await devLogin(page, ADMIN.email, ADMIN.password)
  await expect(page.getByRole('heading', { name: '권사 님' })).toBeVisible()
}

/** 관리 › 식사 › "+ 식사 직접 추가" 로 오늘 식사를 만든다 (날짜 기본값이 오늘이다). */
export async function adminCreateTodayMeal(page: Page, mealTitle: string) {
  await page.getByRole('link', { name: '관리' }).click()
  await page.getByRole('button', { name: '+ 식사 직접 추가' }).click()
  await page.getByLabel('식사 이름').fill(mealTitle)
  await page.getByRole('button', { name: '식사 추가' }).click()
  await expect(page.getByRole('article', { name: new RegExp(mealTitle) })).toBeVisible()
}

type IssueOne = { mealLabel: string; name: string; phone: string; quantity: number; unitPrice: number }

/** 발급 › 식사 고르기 › "+ 새로 등록" › 장수·단가 › 발급. 등록·발급을 한 사람에게 한 번 한다. */
export async function adminIssue(page: Page, { mealLabel, name, phone, quantity, unitPrice }: IssueOne) {
  await page.getByRole('link', { name: '발급', exact: true }).click()
  await page.getByRole('button', { name: '변경' }).click()
  await page.getByRole('button', { name: mealLabel, exact: true }).click()
  await page.getByRole('button', { name: '+ 새로 등록' }).click()
  // "이름" 은 검색창 레이블("이름 또는 번호 뒷자리")의 부분 문자열 — exact 로 좁힌다
  await page.getByLabel('이름', { exact: true }).fill(name)
  await page.getByLabel('휴대폰 번호').fill(phone)
  await page.getByRole('button', { name: '등록하고 선택' }).click()
  await expect(page.getByRole('heading', { name: `${name} 님께 발급` })).toBeVisible()
  await page.getByLabel('단가 (원)').fill(String(unitPrice))
  for (let i = 1; i < quantity; i++) await page.getByRole('button', { name: '장수 늘리기' }).click()
  await expect(page.getByText(`합계 ${(quantity * unitPrice).toLocaleString('ko-KR')}원`)).toBeVisible()
  await page.getByRole('button', { name: `${quantity}장 발급하기` }).click()
  await expect(page.getByText(`${name} 님께 ${quantity}장 발급했어요`)).toBeVisible()
}

type IssueArgs = { mealTitle: string; mealLabel: string; name: string; phone: string }

/** 관리자로 로그인해 오늘 식사를 만들고, "새로 등록" 한 사람에게 5,000원 × 2장을 발급한 뒤 로그아웃한다. */
export async function adminCreateTodayMealAndIssueTwo(page: Page, { mealTitle, mealLabel, name, phone }: IssueArgs) {
  await adminLogin(page)
  await adminCreateTodayMeal(page, mealTitle)
  await adminIssue(page, { mealLabel, name, phone, quantity: 2, unitPrice: 5000 })
  await logout(page)
}
```

Run: `npm run e2e`
Expected: **5 passed** (쪼개기 전과 동작 동일 — admin 1 · family 1 · onboarding 2 · tickets 1).

- [x] **Step 2: 스펙 작성**

`e2e/people.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { formatPhone } from '../src/lib/phone.ts'
import { adminCreateTodayMeal, adminIssue, adminLogin, uniqueDigits } from './helpers.ts'

// 발급 두 번 → 사람 탭 → 합치기 → 취소 사유 → 초기화까지 한 흐름
test.describe.configure({ timeout: 180_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

test('관리자 사람 탭: 중복 합치기 → 이력 합산 → 취소 사유 → 초기화', async ({ page }) => {
  const digits = uniqueDigits()
  const phoneA = `01${digits}`
  const phoneB = `01${uniqueDigits()}`
  // 이름은 이 실행만의 고유값 — 사람 목록 검색이 다른 실행이 남긴 행과 섞이지 않게 한다
  const name = `중복테스트${digits.slice(-5)}`
  const mealTitle = `E2E 사람 ${digits}`
  const mealLabel = `${formatMealDate(todaySeoul())} · ${mealTitle}`

  await test.step('관리자: 오늘 식사 + 같은 이름 두 사람에게 발급(2장·1장)', async () => {
    await adminLogin(page)
    await adminCreateTodayMeal(page, mealTitle)
    await adminIssue(page, { mealLabel, name, phone: phoneA, quantity: 2, unitPrice: 5000 })
    await adminIssue(page, { mealLabel, name, phone: phoneB, quantity: 1, unitPrice: 5000 })
  })

  await test.step('사람 탭: 검색하면 둘, 상세에 전체 번호와 이력', async () => {
    await page.getByRole('link', { name: '사람', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: '사람' })).toBeVisible()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await expect(page.getByRole('list', { name: '사람 목록' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('link', { name: formatPhone(phoneA) }).click()
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(page.getByText(formatPhone(phoneA))).toBeVisible()
    const history = page.getByRole('list', { name: '발급·사용 이력' }).getByRole('listitem')
    await expect(history).toHaveCount(1)
    await expect(history.first()).toContainText('발급 2장 · 10,000원')
  })

  await test.step('중복 합치기: 방향을 확인하고 합치면 이력이 합쳐진다', async () => {
    await page.getByRole('button', { name: '중복 사람 합치기' }).click()
    await page.getByLabel('합칠 사람 찾기').fill(phoneB.slice(-4))
    await page.getByRole('button', { name: `${name} 선택` }).click()
    // 방향이 분명해야 한다: 고른 쪽(B)이 익명 처리되고 보고 있던 쪽(A)이 남는다
    await expect(page.getByText(new RegExp(`${name}\\(${formatPhone(phoneB)}\\) 의 기록·자녀·계정을 ${name}\\(${formatPhone(phoneA)}\\) 로 옮기고`))).toBeVisible()
    await page.getByRole('button', { name: '합치기' }).click()
    await expect(page.getByText(`${name} 님으로 합쳤어요`)).toBeVisible()
    const history = page.getByRole('list', { name: '발급·사용 이력' }).getByRole('listitem')
    await expect(history).toHaveCount(2)
    await expect(history.filter({ hasText: '발급 1장' })).toHaveCount(1)
  })

  await test.step('사람 목록에는 하나만 남는다', async () => {
    await page.getByRole('link', { name: '← 사람' }).click()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await expect(page.getByRole('list', { name: '사람 목록' }).getByRole('listitem')).toHaveCount(1)
  })

  await test.step('현황판: 사유를 적어 1장 발급을 취소하면 이력에 사유가 보인다', async () => {
    await page.getByRole('link', { name: '식사', exact: true }).click()
    await page.getByRole('link', { name: `${formatMealDate(todaySeoul())} ${mealTitle} 현황` }).click()
    await expect(page.getByText('발급 3장 · 사용 0장 · 남음 3장 · 15,000원')).toBeVisible()
    await page.getByRole('button', { name: new RegExp(`${name} 1장 발급 취소$`) }).click()
    await page.getByLabel('취소 사유 (선택)').fill('입금 취소')
    await page.getByRole('button', { name: '취소하기', exact: true }).click()
    await expect(page.getByText(`${name} 님 1장 발급을 취소했어요`)).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 0장 · 남음 2장 · 10,000원')).toBeVisible()

    await page.getByRole('link', { name: '사람', exact: true }).click()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await page.getByRole('link', { name: formatPhone(phoneA) }).click()
    await expect(page.getByRole('list', { name: '발급·사용 이력' }).getByText('취소됨 · 입금 취소')).toBeVisible()
  })

  await test.step('사람 초기화: 목록에서 사라지고 상세는 기록만 남는다', async () => {
    await page.getByRole('button', { name: '사람 초기화' }).click()
    await page.getByRole('button', { name: '초기화', exact: true }).click()
    await expect(page.getByText(`${name} 님을 초기화했어요`)).toBeVisible()
    await expect(page.getByText('초기화·합쳐진 사람이에요. 기록만 남아 있어요.')).toBeVisible()
    await expect(page.getByRole('button', { name: '중복 사람 합치기' })).toHaveCount(0)
    // 기록은 남는다
    await expect(page.getByRole('list', { name: '발급·사용 이력' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('link', { name: '← 사람' }).click()
    await page.getByLabel('이름 또는 번호 뒷자리').fill(name)
    await expect(page.getByText('찾는 사람이 없어요')).toBeVisible()
  })
})
```

- [x] **Step 3: 실행**

Run: `npm run e2e`
Expected: **6 passed** (admin 1 · family 1 · onboarding 2 · people 1 · tickets 1). 실패하면 `test-results/` 의 오류·스크린샷을 본다. 흔한 원인: (1) `getByRole('link', { name: '사람' })` 이 목록 줄 링크와 겹침 — 탭은 `exact: true` 로 좁혔다; (2) 사람 목록 줄의 접근성 이름은 "이름 + 태그 + 번호" 를 모두 이어 붙인 것이라 번호 부분 문자열로 고른다; (3) 합치기 확인 문구의 괄호는 정규식에서 이스케이프해야 한다.

- [x] **Step 4: 커밋**

```bash
git add e2e/helpers.ts e2e/people.spec.ts
git commit -m "test(e2e): 사람 탭 — 중복 합치기·이력 합산·취소 사유·초기화, 관리자 헬퍼 분해

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 문서 동기화 · 전체 검증 · 마무리

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md`
- Modify: `docs/superpowers/plans/2026-10-11-phase4b-people.md` (이 파일)

- [x] **Step 1: README**

"### 5. 운영 체크리스트" 의 다음 줄을 지운다 (3단계가 넣은 임시 절차 — 이제 화면에서 한다):

```markdown
- 자녀 삭제·탈퇴는 화면에서 본인(보호자)이 한다. 관리자가 대신 처리해야 하면(권사님 요청) 4단계 `admin_reset_person` 전까지는 SQL 로: `update public.people set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now() where id = '<사람 id>';`
```

그 자리에 두 줄을 넣는다:

```markdown
- 자녀 삭제·탈퇴는 화면에서 본인(보호자)이 한다. 관리자가 대신 정정해야 하면 **관리 › 사람 › 그 사람 › 사람 초기화** 를 쓴다(이름·번호를 지우고 카카오 연결을 끊되 발급·사용 기록은 남는다). SQL 로 직접 고치지 않는다.
- 같은 사람이 두 줄로 들어갔으면(선발급 뒤 이름을 달리 적어 가입한 경우 등) **관리 › 사람 › 남길 사람 › 중복 사람 합치기** 로 합친다. 고른 쪽이 익명 처리되고 기록·자녀·계정·관리자 권한이 남길 쪽으로 옮겨진다. 되돌릴 수 없으니 확인 문구의 두 번호를 꼭 읽는다.
```

- [x] **Step 2: 설계 문서**

- **§8.3 사람**: 구현대로 — "검색(이름·번호 뒷자리, 전체를 한 번 읽어 클라이언트에서 좁힌다), 필터 칩(전체·미가입·관리자), 목록(전체 번호, 관리자·자녀·미가입 태그와 가족 수). 상세: 이름·번호 수정, 가족 보기, 발급·사용 이력(취소 사유 포함), 중복 사람 합치기, 사람 초기화, 카카오 계정 수동 연결(복구 경로). 익명화된 사람은 목록에서 빼고 상세는 '기록만 남아 있어요' 로 보여 준다." **"방문자" 태그는 스키마에 근거가 없어 넣지 않았다**는 한 줄도 적는다.
- **§7.3 표**: `merge_people(from_id, into_id)` 행을 구현대로 — "from 의 장부(구매자·처리자)·자녀·계정·관리자 권한을 into 로 옮기고 from 익명화. 장부의 가족은 옛 가족에 산 사람이 남지 않을 때만 옮긴다. 코드: `not_authenticated \| forbidden \| same_person \| person_not_found \| minor_not_allowed \| both_have_accounts`". `admin_reset_person(person_id)` 행에 코드 목록(`… \| minor_not_allowed \| has_children \| last_admin`)과 "장부 보존". `link_person(person_id, auth_user_id)` 행에 "동의 기록이 있는 계정 없는 어른에게만. 코드: `… \| already_registered \| consent_required \| account_not_found \| anonymous_cannot_claim \| account_taken`".
- **§9 가입·연결**: "14세 미만이 어른으로 가입" 항목의 "발견 시 관리자가 그 사람을 초기화하면" 을 "발견 시 관리자가 **사람 › 사람 초기화** 를 누르면" 으로 구체화.
- **§12**: item 1 의 pgTAP 목록에 `merge_people` 의 "장부·자녀·계정·권한 이동, 가족 유지 조건, ④ 잠금" 을, item 4 에 `e2e/people.spec.ts`(중복 합치기·취소 사유·초기화) 를 더한다.
- **§14**: 4단계를 "4a(완료, 2026-10-10) · 4b 사람 탭(완료, merge 날짜) · 4c 통계·CSV·공유" 로.
- **§15**: 새 항목 셋 — "사람 목록은 살아 있는 사람 전체를 한 번 읽는다(수백 명 전제). 수천 명이 되면 서버 검색으로 바꾼다", "`link_person` 은 계정 id 를 손으로 붙여 넣는 복구 경로다. 교인이 스스로 가입하면 자동 연결 또는 합치기로 해결된다", "합치기는 되돌릴 수 없다 — 되돌리기(분리)는 범위 밖이다".

- [x] **Step 3: 이 계획 파일**

"구현 결과와 계획의 차이" 절을 범위 절 다음에 만들어 Task 별로 실제 바뀐 것을 적고, 완료 기준의 수치를 측정값으로 채운다. 모든 Step 체크박스를 `[x]` 로(PR 본문의 Test Plan 항목은 그대로 둔다).

- [x] **Step 4: 전체 검증**

```bash
npm run db:reset && npm run db:test        # pgTAP 440
npm run lint && npx tsc -b
npm run test:coverage                      # 임계값(80/80/70/80) 통과 — % 표를 기록한다
npm run build && VITE_BASE_PATH=/meal-ticket/ npm run build && grep -q '/meal-ticket/assets/' dist/index.html && echo SUBPATH_OK
npm run e2e                                # 6 passed
```

- [x] **Step 5: 커밋** (push·PR 은 컨트롤러가 한다)

```bash
git add README.md docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md docs/superpowers/plans/2026-10-11-phase4b-people.md
git commit -m "docs: 4b단계 문서 동기화 — README 정정 절차, 설계 §7.3·§8.3·§9·§12·§14·§15, 계획 차이·수치

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

PR 본문:

```markdown
## Summary
- 관리자 **사람** 탭 신설: `#/admin/people` 검색·필터 칩(전체·미가입·관리자)·전체 번호·태그(관리자·자녀·미가입·가족 N명), `#/admin/people/:id` 상세(이름·번호 수정, 가족 보기, 발급·사용 이력).
- 화면에서 데이터 정정: **중복 사람 합치기**(기록·자녀·계정·관리자 권한 이동 + 익명화), **사람 초기화**(잘못 가입 — 기록 보존), **카카오 계정 수동 연결**(복구 경로). **발급 취소에 사유 입력**을 붙이고 이력에 사유를 보여 준다.
- DB: `merge_people` · `admin_reset_person` · `link_person` 신설(잠금 규칙 ②→③→④). pgTAP +48 (총 440). E2E `people.spec.ts`. README 의 임시 SQL 정정 절차 제거.

## 운영 (merge 전 확인)
- 마이그레이션 1개(함수만, 테이블 변경 없음 — `create or replace` · `grant/revoke` 뿐이라 재실행도 안전하다). 교인 화면은 바뀌지 않는다.
- **합치기와 초기화는 되돌릴 수 없다.** 둘 다 두 단계 확인을 거치고, 합치기 확인 문구에 두 사람의 이름·번호가 모두 나온다. 실제 교인 데이터에 쓰기 전에 시험용 사람으로 한 번 해 보시길 권한다.
- 관리자 조작은 교회 전체 범위다(4a 와 같다). 마지막 관리자는 초기화할 수 없고, 합치기는 관리자 권한을 남는 쪽으로 넘긴다.

## Test Plan
- [ ] CI 녹색 (pgTAP 446 · Vitest 576 · E2E 6)
- [ ] merge 후 Deploy 성공, 운영에서 관리 › 사람 열어 교인 검색·전체 번호 확인
- [ ] 실제 폰: 시험용 중복 행 만들어 합치기 → 이력 합산 → 초기화

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

PR 은 사용자가 merge 한다.

---

## 완료 기준

- pgTAP: 010~150 전부 통과, **Files=15, Tests=446** (150 = `plan(54)` — 계획의 48 에 리뷰가 찾은 빈 자리 6개를 더했다).
- Vitest: **73 파일 576 통과**. 커버리지 — statements **97.85%** (1460/1492) · branches **91.38%** (1050/1149) · functions **97.14%** (510/525) · lines **98.97%** (1254/1267). 임계값(80/80/70/80) 모두 통과.
- `npm run lint`(oxlint `--deny-warnings`) · `npx tsc -b` · `npm run build` · `VITE_BASE_PATH=/meal-ticket/` 하위 경로 빌드 통과(`dist/index.html` 에 `/meal-ticket/assets/` 확인).
- Playwright: **6 passed** (admin 1 · family 1 · onboarding 2 · people 1 · tickets 1).
- 수동: 관리자로 사람 검색 → 상세 → 번호 수정 → 중복 합치기 → 초기화가 화면 문구대로 동작.
- 운영: merge 뒤 Deploy 성공, 관리 › 사람에서 교인 목록이 보인다.

## 4c·5단계로 넘기는 것

- **4c 통계**: 월 선택(식사일 기준) → 발급 장수·금액·사용 장수 → 식사별 행 → 교인별 검색, CSV(종류·일시·식사일·식사명·이름·가족 대표·장수·단가·금액·처리자·메모 — 취소·무효 행 포함), Web Share 공유. 사람 상세의 이력은 최근 100건씩이다 — 통계는 월 범위로 따로 읽는다.
- **`admin_reset_person` 이 남기는 `pairing_codes`** (최종 리뷰에서 나왔다 — 고의로 4c 로 넘긴다): 같은 익명화를 하는 두 형제 함수는 모두 코드를 먼저 지운다(`delete_my_account`·`remove_child`). 초기화만 지우지 않아, 교인이 가족 연결 코드를 띄워 둔 상태에서 초기화되고 10분 안에 다시 가입하면, 그 코드가 **새 행**에 대해 유효해진다(`add_family_member` 는 `auth_user_id` 로 대상을 찾는다) — 코드를 쥔 사람이 그 교인을 흡수할 수 있다. 좁고 10분짜리 창이지만 가족 함수 머리말이 세운 규칙과의 어긋남이다. 고치는 방법도 정해져 있다: 잠그기 전에 행을 읽어 `delete from public.pairing_codes where auth_user_id = v_person.auth_user_id` 를 먼저 하고, 그 다음 잠그고 다시 읽는다(`remove_child` 의 모양 — 잠금 순서 ①→② 를 지킨다). **이번에 손대지 않는 이유**: 이 마이그레이션은 두 세션 동시성 실험과 뮤테이션 테스트를 거쳐 "수정 없이 배포 승인" 을 받았다. 함수 본문을 지금 바꾸면 그 검증이 무효가 되고 pgTAP 도 새로 필요하다. 4c 의 첫 마이그레이션에 함께 넣는다.
- **되돌리기 없음**: 합치기·초기화는 되돌릴 수 없다. 분리(un-merge)는 범위 밖 — 필요해지면 `merge_log` 표를 먼저 두고 설계한다.
- **`link_person` 의 UI**: 계정 id 를 손으로 붙여 넣는다. 더 쉬운 길이 필요하면 미가입 상태의 폰이 `#/pair` 처럼 코드를 띄우고 관리자가 그 코드를 넣는 방식을 검토한다(지금은 카카오 계정에 사람 행이 없으면 가입 화면으로 가므로 코드 화면이 없다).
- **사람 목록 규모**: 살아 있는 사람 전체를 한 번에 읽는다(수백 명 전제, `staleTime` 30초). 수천 명이 되면 `usePeopleSearch` 처럼 서버 검색 + 가족 수는 집계 뷰로.
- **익명화된 사람 보기**: 목록에서 빼 두었다. 통계·감사 목적으로 "초기화된 사람 보기" 칩이 필요해지면 `useAllPeople` 에 플래그를 더한다.
- 3·4a 단계가 넘긴 나머지는 그대로: `ConfirmButton` 터치 영역(44px), 패널·폼 포커스 복귀, 이름 칸 `maxLength` 의 NFD 문제, `FamilyPage` 의 두 초록 알림 합치기, 조건부 라이브 리전(iOS VoiceOver), 식사 현황판의 sticky 알림이 긴 목록에서 행을 가리는 것, 대신 사용의 60초 중복 확인 창.
