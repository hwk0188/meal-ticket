# 2단계 · 식권 핵심 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권사님이 식사를 만들고 교인에게 식권을 발급하면, 교인 폰에 식권이 낱장으로 뜨고 배식 담당자가 한 장을 600ms 꾹 눌러 사용 처리할 수 있게 한다. 내역 화면까지 포함한다.

**Architecture:** 설계 문서 §7 의 `meals` · `issuances` · `usages` 테이블과 `ticket_balances` 뷰(가족 단위 잔량)를 추가하고, 쓰기는 전부 SECURITY DEFINER 함수(`issue_tickets`, `use_ticket`, `create_next_sunday_lunch`)로만 한다. 프론트는 TanStack Query 로 5초 폴링하며, 꾹 누르기는 훅 하나(`useHold`)에 가둔다. 가족 공유 잔량은 1단계가 만든 1인 가족 위에서 그대로 동작하므로 3단계(가족·아이)에서 스키마를 바꿀 필요가 없다.

**Tech Stack:** 1단계와 동일 — React 19 · Vite 8 · TypeScript 6(strict) · Tailwind v4 · react-router 7(HashRouter) · TanStack Query 5 · supabase-js 2 · zod 4 · Vitest 4 · Playwright 1.63 · Supabase CLI 2.120.0(고정) · pgTAP.

**설계 문서:** `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md` §4, §5.1(구매·당일), §7.1~7.4, §8.1~8.3(식사·발급), §9(사용·발급), §12.

---

## 범위

**이번 단계에 넣는 것**

| 영역 | 내용 |
|---|---|
| DB | `meals`, `issuances`, `usages`, `ticket_balances`(security_invoker 뷰), RLS, 함수 `issue_tickets` · `use_ticket` · `create_next_sunday_lunch`, 1단계 이월(헬퍼 함수 `search_path` 고정) |
| 교인 | 홈: 오늘 식사 카드(초 단위 시계·N장 남음) · 식권 세로 목록(사용분 회색·3장 이상 접기) · 600ms 꾹 누르기 · 다음 식권 한 줄 · 오늘 식사 없음(다가오는·지난 식권) · 오프라인 배지. 내역(`#/history`). 하단 탭 |
| 관리자 | 식사(`#/admin/meals`): 다음 주일 점심 만들기 · 직접 추가 · 카드(발급·가족·금액·사용률) · 발급 없는 식사 삭제. 발급(`#/admin/issue`): 식사 선택 · 이름/번호 검색 · 새로 등록 · 장수/단가/메모 · 60초 중복 확인 |
| 테스트 | pgTAP 4개 파일, Vitest 단위·컴포넌트, Playwright E2E 1개(관리자 발급 → 선발급 가입 자동 연결 → 꾹 눌러 사용) |

**이번 단계에서 의도적으로 미루는 것** (설계 §14 기준)

- `cancel_issuance` · `use_ticket_as_admin` · `void_usage` · `merge_people` · `link_person` · `admin_reset_person`, 식사 상세 현황판, 사람 탭, 통계·CSV·공유 → **4단계**. 발급 실수는 4단계 전까지 개발자가 SQL 로 `cancelled_at` 을 채워 처리한다(README 운영 절차에 적는다).
- `pairing_codes`, 익명 로그인, 가족 탭, 홈의 "우리 가족 식권 · N명"(이번엔 가족 구성원 수를 세어 1명이면 "내 식권"으로 표시) → **3단계**.
- pg_cron 정리 작업 → 3단계. PWA 매니페스트 → 5단계.
- 발급 화면 검색 결과의 "가족 수" 태그 → 3단계(지금은 모두 1인 가족).
- 로그아웃 시 캐시 정리를 `AuthProvider` `SIGNED_OUT` 으로 옮기는 일(설계 §15) → 두 번째 로그아웃 경로가 생기는 3단계.

---

## 구현 결과와 계획의 차이 (실행 중 리뷰로 바뀐 것)

아래 스니펫은 각 Task 를 시작할 때의 설계다. 실행 중 코드 리뷰를 거치며 다음과 같이 바뀌었다(커밋 메시지·3·4단계 인계 항목 기준). 긴 코드 스니펫 자체는 고치지 않았으니, 실제 동작은 각 Task 의 커밋과 `src`/`supabase` 코드를 기준으로 본다.

- **Task 1** (`meals`): 테스트가 `served_on` 날짜 대신 id 로 식사를 찾도록 바뀌었다(다른 테스트·E2E 가 같은 날짜에 식사를 만들 수 있어서). 제목도 `'테스트 점심 060'` 처럼 파일 번호가 박힌 고유한 이름으로 고정했다. 관리자도 `created_by` 컬럼을 직접 넣을 수 없다는 검증과, NFC 정규화로 다른 표기(NFD)가 같은 식사와 충돌한다는 검증을 더했다. `060_meals.sql` 은 계획의 `plan(16)` 이 아니라 `plan(23)`.
- **Task 2** (장부·뷰): `cancel_reason` 에도 `memo` 와 같은 100자 제한 체크를 추가했고, `usages` 에 `used_via <> 'self' or recorded_by = person_id` 제약(`usages_self_recorded_by_person`)을 더했다. `070_ledger.sql` 은 `plan(31)`.
- **Task 3** (`issue_tickets`/`create_next_sunday_lunch`): `issue_tickets` 에 `person_is_minor` 오류(자녀 이름으로는 발급하지 않는다)를 추가했다. `create_next_sunday_lunch` 는 `p_today date default 서울 오늘` 기본 인자를 받고, "동시 클릭만 on conflict 로 수렴하고 순차 재호출은 다음 일요일을 새로 만든다(프론트는 자동 재시도하지 않는다)"는 재호출 의미를 테스트로 고정했다. 이 함수는 "가장 늦은 '주일 점심'"이라는 전역 상태에 의존하므로, 테스트는 트랜잭션 안에서 기존 '주일 점심' 장부·식사를 먼저 지워 로컬에 남은 수동·E2E 데이터의 영향을 받지 않게 했다(끝에 rollback 되므로 실제 데이터는 그대로). `080_issue_tickets.sql` 은 `plan(33)`.
- **Task 4** (`use_ticket`): 잠금을 멱등 조회보다 **먼저** 걸도록 바꿨다(같은 request_id 의 동시 재시도가 먼저 커밋된 행을 보도록). 멱등 분기와 `unique_violation` 분기 모두 "다른 식사로 재사용된 request_id" 를 `duplicate_request` 로 거부하도록 조건(`v_row.meal_id <> p_meal_id`)을 넓혔다. `090_use_ticket.sql` 은 `plan(22)`.
- **Task 5** (프론트 공통): `unwrap` 의 입력 타입을 `PostgrestResult<T>` 로 이름 붙였고, 통신 오류(타임아웃 등)가 실제 supabase-js 가 던지는 직렬화 모양과 같은지 검증하는 테스트를 추가했다.
- **Task 6** (라우팅 뼈대): 뷰포트 높이(`min-h-dvh`)를 화면마다 반복하지 않고 `PersonShell` 이 한 번만 갖도록 옮겼다(하위 화면은 `flex-1`). `useCurrentPerson` 은 `RequirePerson` 바깥에서 쓰면 명시적으로 던진다. 관리자 영역 판정에 `role` 을 포함해 Outlet context 왕복을 테스트로 확인했다.
- **Task 7** (`useFamilyTickets`): 사용 기록(usages) 조회를 가족으로 좁혔다(관리자가 보면 RLS 상 모든 가족이 보이므로 그대로 두면 다른 가족 기록이 섞인다). "오늘" 판정은 서버 필터를 믿되, `queryFn` 안에서 자정을 넘기는 경우에 대비해 다시 계산한다. 같은 날짜 정렬의 동률 처리, 오류 경로 테스트를 더했다.
- **Task 8** (훅): `useUseTicket` 에 진행 중 시도를 가두는 in-flight(`Promise` 캐시) 중복 방지를 추가하고, 요청 키를 `{mealId, id}` 로 식사마다 다른 `request_id` 를 쓰게 했다. 타임아웃 뒤 재시도 테스트, `useHold` 의 `pointerleave` 처리 근거 주석과 테스트를 보강했다.
- **Task 9** (홈 화면): 조회 화면을 `status` 가 아니라 `data` 기준으로 그리도록 바꿨다(공통 규약 — 폴링 실패에도 목록을 유지). 식권 행에 `touch-pan-y`(세로 스크롤은 허용하고 드래그는 누름을 취소)와 iOS 롱프레스 콜아웃 방지 클래스를 추가했다. `Spinner` 는 inline 으로 쓰고, 리뷰 중 한 번 빠졌던 로그아웃 재시도 테스트를 복원했다. 아래 Task 9 스니펫의 렌더 게이트(`tickets.status === 'success'`)는 실제로는 `tickets.data` 유무 기준으로 바뀌었으며, 그 부분은 실제 코드로 바로 교체해 두었다.
- **Task 10** (내역): 정렬 기준을 문자열 비교 대신 `Date.parse` 로 바꿨다(표시 형식이 달라도 실제 시각으로 비교). 오류 분기에 다시 시도·안내 UI를 추가했고, `usages` 타입 캐스트를 제거했다. 발급 뮤테이션이 무효화할 쿼리 키 목록에 `ledgerQueryKey` 를 더해 내보냈고, `useUseTicket` 의 `onSettled` 가 재조회 promise 를 돌려주도록 고쳐 재조회가 끝날 때까지 `isPending` 이 유지되게 했다(회귀 테스트 포함).
- **Task 11** (관리자 식사 화면): 식사·잔량 두 조회가 모두 `data` 를 가졌을 때만 카드를 그리도록 바꿨다(공통 규약 — 하나만 왔을 때 0으로 채워 그리면 잘못된 숫자·버튼이 보인다). `addMealErrorMessage` 를 분리해 내보냈고, 지난 식사 정렬과 폼의 오류 리셋 규율을 정리했다.
- **Task 12** (발급 화면): 선택한 식사가 목록에서 사라지면 다음 식사로 자동 전환하고, 등록 중에는 취소를 잠근다. 단가 기본값은 "유료(0원 제외)·미취소" 발급만 보도록 `useLatestUnitPrice` 에 `.gt('unit_price', 0)` 과 `.is('cancelled_at', null)` 을 더했다(이월 0원 발급 뒤 기본값이 0원이 되는 문제 수정). 검색 결과는 `keepPreviousData` 로 깜빡임을 줄였고, 오류 코드 추출 `codeOf` 를 `lib/errors.ts` 에서 내보내 재사용했으며, 테스트용 가짜 Supabase 빌더에 `gt` 체인을 추가했다.
- **Task 13** (E2E): 관리자 시드 이메일을 계획의 `admin@test.local` 대신 `e2e-admin@test.local` 로 바꿨다(pgTAP `030_people_rls.sql` 이 이미 `admin@test.local` 을 임시 사용자로 쓰고 있어, `auth.users` 의 이메일 부분 유니크 인덱스와 충돌해 그 파일 전체가 깨진다). GoTrue 가 토큰 컬럼(`confirmation_token` 등)이 NULL 이면 500 을 내는 문제가 있어, 실제 가입이 만드는 행처럼 빈 문자열로 채워 넣었다. 공유 DB 를 쓰는 E2E 는 `playwright.config.ts` 에 `workers: 1` 을 추가해 직렬 실행하도록 했고, 기존 가입(onboarding) E2E 의 홈 화면 단언을 "오늘은 식사가 없어요 | 이 식사의 식권이 없어요" 정규식으로 바꿔 다른 테스트가 먼저 오늘 식사를 만들어 둬도 깨지지 않게 했다.

---

## 파일 구조

**DB (`supabase/`)**

| 파일 | 책임 |
|---|---|
| `migrations/20261008000001_meals.sql` | 헬퍼 `search_path` 고정, `meals` 테이블·트리거·RLS(전체 조회, 관리자 쓰기) |
| `migrations/20261008000002_ledger.sql` | `issuances` · `usages` 테이블·인덱스·RLS(가족 또는 관리자 조회만), `ticket_balances` 뷰 |
| `migrations/20261008000003_issue_tickets.sql` | `issue_tickets`, `create_next_sunday_lunch` |
| `migrations/20261008000004_use_ticket.sql` | `use_ticket`(멱등·당일·advisory lock) |
| `seeds/010_e2e_admin.sql` | 로컬·CI 전용 관리자 계정(`e2e-admin@test.local`) — E2E 가 쓴다 |
| `tests/database/060_meals.sql` · `070_ledger.sql` · `080_issue_tickets.sql` · `090_use_ticket.sql` | pgTAP |

**프론트 (`src/`)** — 기능별 폴더. 한 파일 하나의 책임, 테스트는 옆에 둔다.

| 파일 | 책임 |
|---|---|
| `lib/postgrest.ts` | PostgREST 응답 → 값 또는 Error (`unwrap`, `toError`). `usePerson` · `OnboardingPage` 의 중복 코드를 여기로 모은다 |
| `lib/dates.ts` | Asia/Seoul 날짜·시각 유틸(`todaySeoul`, `formatMealDate`, `formatTime`, `formatClock`, `nextSundayAfter`) |
| `lib/money.ts` | `formatWon` |
| `lib/timeout.ts` | `withTimeout(ms)` → AbortSignal (사용 처리 5초 제한) |
| `lib/errors.ts` (수정) | 2단계 오류 코드 문구, DB 제약 코드(23503·23505) 문구, 타임아웃 문구, `rpcCodeOf` |
| `components/TabBar.tsx` | 하단 탭(교인: 식권·내역[·관리] / 관리자 영역: 식사·발급·내 식권) |
| `components/PersonShell.tsx` | 탭이 있는 화면의 공통 틀(하단 여백 + TabBar) |
| `features/auth/Gate.tsx` (수정) | `RequirePerson`(레이아웃 라우트, Outlet context 로 person 전달), `RequireAdmin` |
| `features/tickets/groupTickets.ts` | 잔량·식사 → 오늘/다가오는/지난 묶기 (순수 함수) |
| `features/tickets/useFamilyTickets.ts` | 잔량·식사·사용·가족 구성원 조회, 5초 폴링 |
| `features/tickets/useHold.ts` | 600ms 꾹 누르기 훅 |
| `features/tickets/useUseTicket.ts` | `use_ticket` 호출(같은 `request_id` 재시도, 5초 타임아웃) |
| `features/tickets/useOnline.ts` | 온라인 여부 |
| `features/tickets/Clock.tsx` | 초 단위 시계 |
| `features/tickets/TicketList.tsx` | 식권 세로 목록(사용분 회색·접기·꾹 누르기 행) |
| `features/tickets/TodayMealCard.tsx` | 오늘 식사 카드 + 목록 + 사용 처리 묶음 |
| `pages/HomePage.tsx` (재작성) | 홈 조립 |
| `features/history/mergeLedger.ts` · `useFamilyLedger.ts` | 발급·사용 합쳐 시간 역순 (순수 함수 + 조회 훅) |
| `pages/HistoryPage.tsx` | 내역 |
| `features/admin/useMeals.ts` | 식사 목록·추가·삭제·다음 주일 점심 |
| `features/admin/summarizeByMeal.ts` | 관리자용 식사별 발급·가족·금액·사용률 집계 (순수 함수) |
| `features/admin/MealForm.tsx` | 식사 직접 추가 폼 |
| `pages/admin/AdminMealsPage.tsx` | 식사 화면 |
| `features/admin/issueSchema.ts` | 장수·단가·메모·새 사람 검증(zod) |
| `features/admin/usePeopleSearch.ts` | 이름·번호 검색, 새로 등록 |
| `features/admin/useIssue.ts` | 최근 단가, 60초 중복 확인, `issue_tickets` 호출 |
| `pages/admin/IssuePage.tsx` | 발급 화면 |
| `App.tsx` (수정) | 라우트 추가 |
| `e2e/tickets.spec.ts` | 관리자 발급 → 교인 가입(선발급 연결) → 꾹 눌러 사용 |

---

## 공통 규약 (1단계에서 이어받음 — 모든 Task 에 적용)

- **새 함수 체크리스트.** `auto_expose_new_tables = true` 는 새 함수에 `anon=X` 를 자동으로 붙인다. 함수마다 `revoke execute … from public, anon` 을 명시하고 필요한 역할에만 `grant`. pgTAP `020_people_schema.sql` 이 "anon 에게 열린 public 함수는 `{ping}` 뿐" 을 고정하고 있어, 잊으면 그 테스트가 깨진다. **새 테이블·뷰도 `revoke all … from anon`** 을 명시한다.
- SECURITY DEFINER 함수는 `set search_path = public, pg_temp`. 객체는 스키마 한정. 정책·쿼리의 `auth.uid()`/헬퍼 호출은 `(select …)` 로 감싼다.
- RPC 오류는 `raise exception '<snake_case 코드>'` (값 보간 금지). 프론트는 `toUserMessage` 로 문구화. 알려진 DB 원시 오류(23505 등)는 함수 안에서 코드로 번역한다.
- 테스트 데이터는 다른 테스트·E2E 가 남긴 행과 섞이지 않게 **고정 id 또는 `created_at = now()`** 로 범위를 좁힌다(`now()` 는 트랜잭션 시각).
- 프론트: `verbatimModuleSyntax` 라 타입은 `import type`. `vi.fn<() => T>()` 처럼 타입 인자를 적는다(`vitest/require-mock-type-parameters`). 컴포넌트 파일에서 컴포넌트가 아닌 것을 export 하지 않는다(`react/only-export-components`). `oxlint --deny-warnings` 가 CI 에서 돈다.
- 커밋 메시지는 `<type>: <설명>` 형식, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **조회 화면은 `status` 가 아니라 `data` 로 분기한다.** TanStack 은 백그라운드 재조회가 실패해도 `data` 를 유지한 채 `status='error'` 가 된다. `status === 'success'` 로 가리면 폴링 한 번 실패에 목록이 통째로 사라진다(Task 9 리뷰). 패턴: `data ? <목록 + (error 면 작은 안내)> : status === 'error' ? <alert + 다시 시도> : <Spinner inline />`.
- **여러 조회를 합쳐 그리는 화면은 모든 조회의 `data` 가 있을 때만 본문을 그린다** (하나라도 없으면 Spinner/alert). 일부만 왔을 때 0 으로 채워 그리면 잘못된 숫자와 버튼이 보인다 (Task 11 리뷰).
- 작업 브랜치 `feat/phase2-tickets` 에서 시작한다. `main` 에 직접 커밋하지 않는다.

```bash
cd /Users/hong-wongi/Dev/sample/meal-ticket
git checkout main && git pull --ff-only && git checkout -b feat/phase2-tickets
# 이 계획 파일이 아직 커밋 전이면 브랜치의 첫 커밋으로 넣는다
git add docs/superpowers/plans/2026-10-08-phase2-tickets.md && git commit -m "docs: 2단계(식권 핵심) 구현 계획

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
npm ci && npm run db:start   # 로컬 Supabase (Docker 필요). 이미 떠 있으면 생략
```

---

### Task 1: 마이그레이션 ⑤ `meals` 테이블 + RLS, 헬퍼 함수 `search_path` 고정

**Files:**
- Create: `supabase/migrations/20261008000001_meals.sql`
- Test: `supabase/tests/database/060_meals.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/060_meals.sql`**

```sql
begin;
select plan(16);

-- 1단계 이월: invoker 헬퍼의 search_path 고정 (Supabase 어드바이저 "function_search_path_mutable" 경고 제거)
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.normalize_phone(text)'::regprocedure),
  'search_path=""', 'normalize_phone 의 search_path 가 고정되어 있다');
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.is_valid_mobile(text)'::regprocedure),
  'search_path=""', 'is_valid_mobile 의 search_path 가 고정되어 있다');
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.normalize_name(text)'::regprocedure),
  'search_path=""', 'normalize_name 의 search_path 가 고정되어 있다');

select has_table('public', 'meals', 'meals 테이블이 있다');
select col_is_unique('public', 'meals', array['served_on', 'title'], '같은 날짜·제목의 식사는 하나뿐이다');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'meals' and grantee = 'anon'),
  0::bigint, 'anon 은 meals 에 아무 권한이 없다');

-- 사용자: 교인 A, 관리자
select tests.create_user('meal-a@test.local') as a_uid \gset
select tests.create_user('meal-admin@test.local') as admin_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01033330001', :'a_uid', now(), '2026-10-07'),
       ('권사',   '01033330009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';

-- 관리자: 만들 수 있고, created_by 는 기본값으로 본인이 들어간다. 제목은 공백 제거·NFC.
select tests.authenticate_as(:'admin_uid');
select lives_ok(
  $$ insert into public.meals (title, served_on, note) values ('  주일 점심 ', '2026-10-12', '  ') $$,
  '관리자는 식사를 만들 수 있다');
select is((select title from public.meals where served_on = '2026-10-12'), '주일 점심', '제목의 앞뒤 공백이 지워진다');
select is((select note from public.meals where served_on = '2026-10-12'), null, '공백뿐인 비고는 null 이 된다');
select is((select created_by from public.meals where served_on = '2026-10-12'),
  (select id from public.people where auth_user_id = :'admin_uid'), 'created_by 는 기본값으로 만든 관리자가 들어간다');
select throws_ok(
  $$ insert into public.meals (title, served_on) values ('주일 점심', '2026-10-12') $$,
  '23505', null, '같은 날짜·제목은 거부된다');
select throws_ok(
  $$ insert into public.meals (title, served_on) values ('', '2026-10-13') $$,
  '23514', null, '빈 제목은 거부된다');
select lives_ok($$ update public.meals set note = '추수감사' where served_on = '2026-10-12' $$, '관리자는 식사를 고칠 수 있다');

-- 교인: 전부 볼 수 있지만 쓸 수 없다
select tests.authenticate_as(:'a_uid');
select is((select count(*) from public.meals where served_on = '2026-10-12'), 1::bigint, '교인은 모든 식사를 본다');
select throws_ok(
  $$ insert into public.meals (title, served_on) values ('몰래', '2026-10-14') $$,
  '42501', null, '교인은 식사를 만들 수 없다');
-- update/delete 는 정책이 걸러 "0건 변경" 으로 조용히 끝난다 (오류가 아니다). 행이 그대로인지 본다.
update public.meals set title = '바꿈' where served_on = '2026-10-12';
delete from public.meals where served_on = '2026-10-12';
select tests.clear_auth();
select is((select title from public.meals where served_on = '2026-10-12'), '주일 점심', '교인의 수정·삭제는 아무 행도 바꾸지 못한다');

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: `060_meals.sql` 에서 `has_table` 등 실패 (`meals` 없음). 기존 010~050 은 통과.

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261008000001_meals.sql`**

```sql
-- =========================================================
-- 1단계 이월: invoker 헬퍼의 search_path 고정.
-- 호출하는 것은 pg_catalog 함수(regexp_replace, normalize…)뿐이라 빈 search_path 로 충분하다.
-- 보안 영향은 없지만(invoker 권한) Supabase 어드바이저 경고를 없앤다.
-- =========================================================
alter function public.normalize_phone(text) set search_path = '';
alter function public.is_valid_mobile(text) set search_path = '';
alter function public.normalize_name(text) set search_path = '';

-- =========================================================
-- 식사 — "10월 12일 주일 점심" 처럼 날짜와 이름을 가진 한 끼. 관리자만 만든다.
-- =========================================================
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 30),
  served_on date not null,
  note text check (note is null or char_length(note) <= 100),
  -- 만든 관리자. 기본값이 호출자의 사람 행이라 프론트는 이 열을 넣지 않는다 (insert 열 권한에도 없다).
  created_by uuid references public.people(id) default public.current_person_id(),
  created_at timestamptz not null default now(),
  constraint meals_served_on_title_key unique (served_on, title)
);
create index meals_served_on_idx on public.meals (served_on desc);

-- 제목은 앞뒤 공백 제거 + NFC (people.name 과 같은 규칙). 공백뿐인 비고는 null.
create or replace function public.meals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := normalize(btrim(coalesce(new.title, '')), NFC);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  return new;
end
$$;
create trigger meals_before_write
  before insert or update on public.meals
  for each row execute function public.meals_before_write();
-- 트리거 함수는 RPC 로 노출할 이유가 없다 (auto_expose_new_tables 대응으로 명시 revoke)
revoke execute on function public.meals_before_write() from public, anon, authenticated;

-- 기본 차단 후 필요한 권한만. 삭제는 발급(issuances.meal_id FK, 다음 마이그레이션)이 있으면 23503 으로 막힌다.
alter table public.meals enable row level security;
revoke all on public.meals from anon, authenticated;
grant select on public.meals to authenticated;
grant insert (title, served_on, note), update (title, served_on, note), delete on public.meals to authenticated;

create policy meals_select_all on public.meals
  for select to authenticated using (true);
create policy meals_insert_admin on public.meals
  for insert to authenticated with check ((select public.is_admin()));
create policy meals_update_admin on public.meals
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy meals_delete_admin on public.meals
  for delete to authenticated using ((select public.is_admin()));
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 060 포함 전부 통과. 020 의 "anon 에게 열린 public 함수는 ping 뿐" 도 그대로 통과(트리거 함수 revoke 덕분).

- [x] **Step 5: 커밋**

```bash
git add supabase/migrations/20261008000001_meals.sql supabase/tests/database/060_meals.sql
git commit -m "feat(db): meals 테이블과 RLS, 헬퍼 함수 search_path 고정

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 마이그레이션 ⑥ `issuances` · `usages` 장부 + `ticket_balances` 뷰 + RLS

**Files:**
- Create: `supabase/migrations/20261008000002_ledger.sql`
- Test: `supabase/tests/database/070_ledger.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/070_ledger.sql`**

```sql
begin;
select plan(20);

select has_table('public', 'issuances', 'issuances 테이블이 있다');
select has_table('public', 'usages', 'usages 테이블이 있다');
select has_view('public', 'ticket_balances', 'ticket_balances 뷰가 있다');
select is((select reloptions::text from pg_class where oid = 'public.ticket_balances'::regclass),
  '{security_invoker=true}', '뷰는 security_invoker 라 기반 테이블 RLS 를 그대로 받는다');
select col_is_unique('public', 'usages', 'request_id', 'request_id 는 유일하다 (재시도 중복 방지)');
select is((select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name in ('issuances', 'usages', 'ticket_balances') and grantee = 'anon'),
  0::bigint, 'anon 은 장부와 뷰에 아무 권한이 없다');
select is((select array_agg(distinct privilege_type::text order by privilege_type::text) from information_schema.role_table_grants
            where table_schema = 'public' and table_name in ('issuances', 'usages') and grantee = 'authenticated'),
  '{SELECT}'::text[], 'authenticated 는 장부를 읽기만 한다 (쓰기는 함수로만)');

-- 준비: 가족 A(김철수), 가족 B(이영희), 관리자. 식사 하나.
select tests.create_user('ledger-a@test.local') as a_uid \gset
select tests.create_user('ledger-b@test.local') as b_uid \gset
select tests.create_user('ledger-admin@test.local') as admin_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01044440001', :'a_uid', now(), '2026-10-07'),
       ('이영희', '01044440002', :'b_uid', now(), '2026-10-07'),
       ('권사',   '01044440009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid, family_id as b_fid from public.people where auth_user_id = :'b_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.meals (title, served_on, created_by) values ('주일 점심', '2026-10-11', :'admin_pid') returning id as meal_id \gset

-- 장부는 슈퍼유저로 직접 적는다 (함수는 다음 Task). A: 4장 발급(5,000) + 취소된 2장, 사용 1장 + 무효 1장. B: 2장.
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'meal_id', 4, 5000, :'admin_pid'),
       (:'b_pid', :'b_fid', :'meal_id', 2, 5000, :'admin_pid');
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by, cancelled_at, cancelled_by, cancel_reason)
values (:'a_pid', :'a_fid', :'meal_id', 2, 5000, :'admin_pid', now(), :'admin_pid', '실수');
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id)
values (:'a_fid', :'a_pid', :'meal_id', 'self', :'a_pid', gen_random_uuid());
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id, voided_at, voided_by)
values (:'a_fid', :'a_pid', :'meal_id', 'self', :'a_pid', gen_random_uuid(), now(), :'admin_pid');

-- 뷰 계산: 취소·무효는 빠진다
select results_eq(
  format($$ select issued, used, remaining, amount from public.ticket_balances where family_id = %L and meal_id = %L $$, :'a_fid', :'meal_id'),
  $$ values (4, 1, 3, 20000) $$,
  'A 가족: 발급 4(취소 제외) · 사용 1(무효 제외) · 남음 3 · 금액 20,000');
select results_eq(
  format($$ select issued, used, remaining, amount from public.ticket_balances where family_id = %L and meal_id = %L $$, :'b_fid', :'meal_id'),
  $$ values (2, 0, 2, 10000) $$,
  'B 가족: 사용이 없어도 행이 나온다 (full outer join)');

-- 제약
select throws_ok(
  format($$ insert into public.usages (family_id, person_id, meal_id, quantity, used_via, recorded_by, request_id)
            values (%L, %L, %L, 2, 'self', %L, gen_random_uuid()) $$, :'a_fid', :'a_pid', :'meal_id', :'a_pid'),
  '23514', null, '사용은 항상 1장이다');
select throws_ok(
  format($$ insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by) values (%L, %L, %L, 0, 5000, %L) $$,
         :'a_pid', :'a_fid', :'meal_id', :'admin_pid'),
  '23514', null, '0장 발급은 거부된다');
select throws_ok(
  format($$ insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by, cancelled_at) values (%L, %L, %L, 1, 5000, %L, now()) $$,
         :'a_pid', :'a_fid', :'meal_id', :'admin_pid'),
  '23514', null, '취소 시각만 있고 취소자가 없으면 거부된다');
select throws_ok(
  format($$ delete from public.meals where id = %L $$, :'meal_id'),
  '23503', null, '발급이 있는 식사는 지울 수 없다 (FK)');

-- RLS: A 는 자기 가족만
select tests.authenticate_as(:'a_uid');
select is((select count(*) from public.issuances), 2::bigint, 'A 는 자기 가족 발급(취소분 포함)만 본다');
select is((select count(*) from public.usages), 2::bigint, 'A 는 자기 가족 사용(무효분 포함)만 본다');
select is((select count(*) from public.ticket_balances), 1::bigint, 'A 는 뷰에서도 자기 가족 행만 본다');
select throws_ok(
  format($$ insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id)
            values (%L, %L, %L, 'self', %L, gen_random_uuid()) $$, :'a_fid', :'a_pid', :'meal_id', :'a_pid'),
  '42501', null, '교인은 사용 장부에 직접 쓸 수 없다');
select throws_ok(
  format($$ update public.issuances set quantity = 99 where family_id = %L $$, :'a_fid'),
  '42501', null, '교인은 발급 장부를 고칠 수 없다');

-- 관리자는 전부
select tests.authenticate_as(:'admin_uid');
select is((select count(*) from public.issuances where meal_id = :'meal_id'), 3::bigint, '관리자는 모든 발급을 본다');
select is((select count(*) from public.ticket_balances where meal_id = :'meal_id'), 2::bigint, '관리자는 모든 가족의 잔량을 본다');
select tests.clear_auth();

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 070 실패 (`issuances` 없음).

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261008000002_ledger.sql`**

```sql
-- =========================================================
-- 장부: 발급(issuances)과 사용(usages)은 지우지 않고 쌓는다.
-- 발급 취소는 cancelled_at, 사용 무효는 voided_at 으로 표시한다 (4단계 함수가 채운다).
-- 쓰기는 함수(issue_tickets, use_ticket …)로만 한다. 그래서 insert/update 정책을 아예 두지 않는다.
-- =========================================================
create table public.issuances (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),   -- 구매자 (통계는 이 사람 이름으로)
  family_id uuid not null references public.families(id), -- 발급 시점 구매자의 가족 (잔량은 가족 단위)
  meal_id uuid not null references public.meals(id),      -- 삭제는 restrict (기본). 발급이 있으면 식사를 못 지운다
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),    -- 원. 이월은 0
  memo text check (memo is null or char_length(memo) <= 100),
  issued_by uuid not null references public.people(id),
  issued_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.people(id),
  cancel_reason text,
  constraint issuances_cancel_consistent check ((cancelled_at is null) = (cancelled_by is null))
);
create index issuances_family_meal_idx on public.issuances (family_id, meal_id);
create index issuances_meal_idx on public.issuances (meal_id);
create index issuances_issued_at_idx on public.issuances (issued_at desc);

create table public.usages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id), -- 차감된 가족
  person_id uuid not null references public.people(id),   -- self: 어느 폰에서 / admin: 누구 몫으로
  meal_id uuid not null references public.meals(id),
  quantity integer not null default 1 check (quantity = 1), -- 낱장 사용
  used_via text not null check (used_via in ('self', 'admin')),
  recorded_by uuid not null references public.people(id), -- self 면 person_id 와 같음, admin 이면 관리자
  request_id uuid not null unique,                         -- 클라이언트 생성. 같은 시도의 재시도는 같은 값
  used_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.people(id),
  constraint usages_void_consistent check ((voided_at is null) = (voided_by is null))
);
create index usages_family_meal_idx on public.usages (family_id, meal_id);
create index usages_meal_idx on public.usages (meal_id);
create index usages_used_at_idx on public.usages (used_at desc);

alter table public.issuances enable row level security;
alter table public.usages enable row level security;
revoke all on public.issuances, public.usages from anon, authenticated;
grant select on public.issuances, public.usages to authenticated;

create policy issuances_select_family_or_admin on public.issuances
  for select to authenticated
  using (family_id = (select public.current_family_id()) or (select public.is_admin()));
create policy usages_select_family_or_admin on public.usages
  for select to authenticated
  using (family_id = (select public.current_family_id()) or (select public.is_admin()));

-- =========================================================
-- 가족·식사별 잔량. security_invoker 라 호출자의 RLS 가 기반 테이블에 그대로 적용된다
-- (교인은 자기 가족 행만, 관리자는 전부).
-- meal_id/family_id 가 coalesce 식이라 PostgREST 는 이 뷰에서 meals 를 임베딩하지 못한다.
-- 프론트는 뷰를 읽은 뒤 meals 를 id 목록으로 따로 읽는다.
-- =========================================================
create view public.ticket_balances with (security_invoker = true) as
with issued as (
  select family_id, meal_id,
         sum(quantity)::integer as issued,
         sum(quantity * unit_price)::integer as amount
    from public.issuances
   where cancelled_at is null
   group by family_id, meal_id
), used as (
  select family_id, meal_id, sum(quantity)::integer as used
    from public.usages
   where voided_at is null
   group by family_id, meal_id
)
select coalesce(i.family_id, u.family_id) as family_id,
       coalesce(i.meal_id, u.meal_id) as meal_id,
       coalesce(i.issued, 0) as issued,
       coalesce(u.used, 0) as used,
       coalesce(i.issued, 0) - coalesce(u.used, 0) as remaining,
       coalesce(i.amount, 0) as amount
  from issued i
  full outer join used u on u.family_id = i.family_id and u.meal_id = i.meal_id;

revoke all on public.ticket_balances from anon;
grant select on public.ticket_balances to authenticated;
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 070 포함 전부 통과.

- [x] **Step 5: 커밋**

```bash
git add supabase/migrations/20261008000002_ledger.sql supabase/tests/database/070_ledger.sql
git commit -m "feat(db): 발급·사용 장부와 ticket_balances 뷰, 가족 단위 RLS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 마이그레이션 ⑦ `issue_tickets` · `create_next_sunday_lunch`

**Files:**
- Create: `supabase/migrations/20261008000003_issue_tickets.sql`
- Test: `supabase/tests/database/080_issue_tickets.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/080_issue_tickets.sql`**

```sql
begin;
select plan(22);

select is(has_function_privilege('anon', 'public.issue_tickets(uuid,uuid,integer,integer,text)', 'EXECUTE'), false, 'anon 은 issue_tickets 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.create_next_sunday_lunch(date)', 'EXECUTE'), false, 'anon 은 create_next_sunday_lunch 를 실행할 수 없다');

select tests.create_user('issue-a@test.local') as a_uid \gset
select tests.create_user('issue-admin@test.local') as admin_uid \gset
select tests.create_user('issue-noperson@test.local') as ghost_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01055550001', :'a_uid', now(), '2026-10-07'),
       ('권사',   '01055550009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
insert into public.people (name, phone) values ('방문자', '01055550003');  -- 선발급 대상 (계정 없음)
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as v_pid from public.people where phone = '01055550003' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.meals (title, served_on, created_by) values ('주일 점심', '2026-10-11', :'admin_pid') returning id as meal_id \gset

-- 비관리자 거부
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 4, 5000, null) $$, :'a_pid', :'meal_id'),
  'P0001', 'forbidden', '교인은 발급할 수 없다');
select throws_ok($$ select public.create_next_sunday_lunch('2026-10-08') $$, 'P0001', 'forbidden', '교인은 식사를 만들 수 없다');
-- 계정은 있지만 사람 행이 없는 호출자도 forbidden
select tests.authenticate_as(:'ghost_uid');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 4, 5000, null) $$, :'a_pid', :'meal_id'),
  'P0001', 'forbidden', '사람 행이 없는 계정은 발급할 수 없다');

-- 관리자: 검증 오류
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 0, 5000, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_quantity', '0장은 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 100, 5000, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_quantity', '100장은 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, -1, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_price', '음수 단가는 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 1000001, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_price', '100만 원 초과 단가는 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, repeat('가', 101)) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_memo', '101자 메모는 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, null) $$, gen_random_uuid(), :'meal_id'), 'P0001', 'person_not_found', '없는 사람은 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, null) $$, :'a_pid', gen_random_uuid()), 'P0001', 'meal_not_found', '없는 식사는 거부');

-- 관리자: 성공. family 스냅샷·issued_by·메모 정리
select lives_ok(format($$ select public.issue_tickets(%L, %L, 4, 5000, '  입금 확인 ') $$, :'a_pid', :'meal_id'), '관리자는 발급할 수 있다');
select results_eq(
  format($$ select family_id, issued_by, quantity, unit_price, memo, cancelled_at from public.issuances where person_id = %L $$, :'a_pid'),
  format($$ values (%L::uuid, %L::uuid, 4, 5000, '입금 확인'::text, null::timestamptz) $$, :'a_fid', :'admin_pid'),
  '가족 스냅샷·발급자·장수·단가가 기록되고 메모 공백이 정리된다');
select lives_ok(format($$ select public.issue_tickets(%L, %L, 1, 0, '10/5 이월') $$, :'v_pid', :'meal_id'), '계정 없는 선발급 대상에게 0원 발급(이월)이 된다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'meal_id'), 4, '발급 직후 잔량은 장수와 같다');

-- 다음 주일 점심: 2026-10-08(목) 기준, 주일 점심이 10/11(일) 에 있으므로 → 10/18
select is((select served_on from public.create_next_sunday_lunch('2026-10-08')), '2026-10-18'::date, '가장 늦은 주일 점심 다음 일요일을 만든다');
select is((select served_on from public.create_next_sunday_lunch('2026-10-08')), '2026-10-25'::date, '한 번 더 누르면 그 다음 일요일');
-- 오래 쉬어 가장 늦은 주일 점심이 과거면, 기준은 어제 → 오늘 이후 첫 일요일
select is((select served_on from public.create_next_sunday_lunch('2026-12-06')), '2026-12-06'::date, '오늘이 일요일이고 그 뒤 식사가 없으면 오늘을 만든다');
select is((select served_on from public.create_next_sunday_lunch('2026-12-07')), '2026-12-13'::date, '월요일이면 다가오는 일요일');
select is((select count(*) from public.meals where title = '주일 점심' and created_at = now()), 5::bigint, '주일 점심은 5개(수동 1 + 함수 4)뿐이다 (중복 없음)');
select is((select created_by from public.meals where served_on = '2026-10-18'), :'admin_pid'::uuid, '함수가 만든 식사에도 created_by 가 들어간다');
select tests.clear_auth();

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 080 실패 (함수 없음).

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261008000003_issue_tickets.sql`**

```sql
-- =========================================================
-- 발급: 관리자가 입금 확인 후 사람에게 식권을 준다. family_id 는 그 사람의 "현재" 가족을 스냅샷으로 남긴다.
-- issue_tickets 코드: not_authenticated | forbidden | invalid_quantity | invalid_price | invalid_memo
--                     | person_not_found | meal_not_found
-- =========================================================
create or replace function public.issue_tickets(
  p_person_id uuid,
  p_meal_id uuid,
  p_quantity integer,
  p_unit_price integer,
  p_memo text default null
)
returns public.issuances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_family uuid;
  v_memo text := nullif(btrim(coalesce(p_memo, '')), '');
  v_row public.issuances;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- 사람 행이 없는 계정(가입 전)도 forbidden 으로 본다. 관리자 여부는 is_admin() 이 deleted_at 까지 본다.
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity';
  end if;
  if p_unit_price is null or p_unit_price < 0 or p_unit_price > 1000000 then
    raise exception 'invalid_price';
  end if;
  if v_memo is not null and char_length(v_memo) > 100 then
    raise exception 'invalid_memo';
  end if;

  select family_id into v_family from public.people where id = p_person_id and deleted_at is null;
  if not found then
    raise exception 'person_not_found';
  end if;
  if not exists (select 1 from public.meals where id = p_meal_id) then
    raise exception 'meal_not_found';
  end if;

  insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, memo, issued_by)
  values (p_person_id, v_family, p_meal_id, p_quantity, p_unit_price, v_memo, v_admin)
  returning * into v_row;
  return v_row;
end
$$;

comment on function public.issue_tickets(uuid, uuid, integer, integer, text) is '관리자 발급. 오류 코드는 파일 헤더 참고.';
revoke execute on function public.issue_tickets(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.issue_tickets(uuid, uuid, integer, integer, text) to authenticated;

-- =========================================================
-- 다음 주일 점심 만들기. 기준일 = max(가장 늦은 '주일 점심' 날짜, 어제). 기준일 다음의 첫 일요일에 만든다.
--   · 보통: 10/11(일) 이 있으면 10/18. 오래 쉬어 가장 늦은 식사가 과거면 오늘 이후 첫 일요일(오늘이 일요일이면 오늘).
--   · 이미 있으면(동시 클릭) 그 행을 그대로 돌려준다.
-- p_today 는 테스트와 날짜 미리보기용. 기본값은 서울 오늘. 관리자 전용이라 임의 날짜를 넣어도 해가 없다.
-- 코드: not_authenticated | forbidden | invalid_date
-- =========================================================
create or replace function public.create_next_sunday_lunch(
  p_today date default (now() at time zone 'Asia/Seoul')::date
)
returns public.meals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_base date;
  v_target date;
  v_row public.meals;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_today is null then
    raise exception 'invalid_date';
  end if;

  select greatest(coalesce(max(served_on), p_today - 1), p_today - 1)
    into v_base
    from public.meals
   where title = '주일 점심';
  -- dow: 일=0 … 토=6. 기준일 "다음" 일요일까지 날수: 일→7, 월→6, …, 토→1
  v_target := v_base + ((6 - extract(dow from v_base)::integer) % 7 + 1);

  -- meals 의 BEFORE 트리거는 정규화만 하므로(people 과 달리 부수 행을 만들지 않음) on conflict 가 안전하다
  insert into public.meals (title, served_on, created_by)
  values ('주일 점심', v_target, v_admin)
  on conflict (served_on, title) do nothing;

  select * into v_row from public.meals where served_on = v_target and title = '주일 점심';
  return v_row;
end
$$;

comment on function public.create_next_sunday_lunch(date) is '다음 주일 점심 생성(멱등). 프론트 lib/dates.ts 의 nextSundayAfter 와 같은 규칙.';
revoke execute on function public.create_next_sunday_lunch(date) from public, anon;
grant execute on function public.create_next_sunday_lunch(date) to authenticated;
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 080 포함 전부 통과.

- [x] **Step 5: 커밋**

```bash
git add supabase/migrations/20261008000003_issue_tickets.sql supabase/tests/database/080_issue_tickets.sql
git commit -m "feat(db): issue_tickets, create_next_sunday_lunch RPC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 마이그레이션 ⑧ `use_ticket` + 타입 재생성

**Files:**
- Create: `supabase/migrations/20261008000004_use_ticket.sql`
- Test: `supabase/tests/database/090_use_ticket.sql`
- Regenerate: `src/lib/database.types.ts`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/090_use_ticket.sql`**

```sql
begin;
select plan(21);

select is(has_function_privilege('anon', 'public.use_ticket(uuid,uuid)', 'EXECUTE'), false, 'anon 은 use_ticket 을 실행할 수 없다');

-- 준비: 가족 A = 어른 김철수 + 자녀 서연(익명 계정, 같은 가족). 가족 B = 이영희. 관리자. 오늘 식사 + 다음 주 식사.
select tests.create_user('use-a@test.local') as a_uid \gset
select tests.create_user() as kid_uid \gset
select tests.create_user('use-b@test.local') as b_uid \gset
select tests.create_user('use-admin@test.local') as admin_uid \gset
select tests.create_user('use-ghost@test.local') as ghost_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01066660001', :'a_uid', now(), '2026-10-07'),
       ('이영희', '01066660002', :'b_uid', now(), '2026-10-07'),
       ('권사',   '01066660009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid, family_id as b_fid from public.people where auth_user_id = :'b_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'a_fid', :'kid_uid', true, :'a_pid', now());
select (now() at time zone 'Asia/Seoul')::date as today \gset
insert into public.meals (title, served_on, created_by) values ('주일 점심', :'today', :'admin_pid') returning id as today_meal \gset
insert into public.meals (title, served_on, created_by) values ('주일 점심', :'today'::date + 7, :'admin_pid') returning id as next_meal \gset
-- A 가족 오늘 2장, 다음 주 1장. B 가족은 없음.
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'today_meal', 2, 5000, :'admin_pid'),
       (:'a_pid', :'a_fid', :'next_meal', 1, 5000, :'admin_pid');

-- 가입 전 계정
select tests.authenticate_as(:'ghost_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'not_registered', '사람 행이 없는 계정은 쓸 수 없다');

-- A: 검증
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, gen_random_uuid(), gen_random_uuid()), 'P0001', 'meal_not_found', '없는 식사');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'next_meal', gen_random_uuid()), 'P0001', 'not_today', '오늘이 아닌 식사의 식권은 쓸 수 없다');
select throws_ok(format($$ select public.use_ticket(%L, null) $$, :'today_meal'), 'P0001', 'invalid_request', 'request_id 가 없으면 거부');

-- A: 성공 + 멱등
select gen_random_uuid() as req1 \gset
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req1'), '오늘 식권을 1장 쓴다');
select results_eq(
  format($$ select family_id, person_id, quantity, used_via, recorded_by, voided_at from public.usages where request_id = %L $$, :'req1'),
  format($$ values (%L::uuid, %L::uuid, 1, 'self'::text, %L::uuid, null::timestamptz) $$, :'a_fid', :'a_pid', :'a_pid'),
  '사용 기록: 가족·누른 폰·1장·self');
select is((select remaining from public.ticket_balances where meal_id = :'today_meal'), 1, '잔량이 1 줄었다');
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req1'), '같은 request_id 재시도는 성공으로 본다');
select is((select count(*) from public.usages where meal_id = :'today_meal'), 1::bigint, '재시도는 새 사용을 만들지 않는다');
select is((select remaining from public.ticket_balances where meal_id = :'today_meal'), 1, '재시도 뒤에도 잔량은 그대로');

-- 자녀 계정(같은 가족)이 2장째를 쓴다 → 0장
select tests.authenticate_as(:'kid_uid');
select gen_random_uuid() as req2 \gset
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req2'), '자녀 계정도 가족 식권을 쓸 수 있다');
select is((select person_id from public.usages where request_id = :'req2'),
  (select id from public.people where auth_user_id = :'kid_uid'), '어느 폰에서 썼는지(자녀)가 남는다');
select is((select remaining from public.ticket_balances where meal_id = :'today_meal'), 0, '가족 잔량이 0 이 된다');
-- 남의 request_id 로는 결과를 가져갈 수 없다
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req1'), 'P0001', 'duplicate_request', '다른 사람의 request_id 는 거부');

-- 잔량 초과
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'no_remaining', '잔량이 없으면 거부');
select is((select count(*) from public.usages where meal_id = :'today_meal'), 2::bigint, '거부된 호출은 기록을 남기지 않는다');

-- B(다른 가족): 발급이 없으므로 no_remaining. A 의 식권을 가져다 쓸 수 없다
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'no_remaining', '다른 가족은 남의 식권을 쓸 수 없다');

-- 관리자도 자기 가족 식권만 (관리자 대신 처리는 4단계 use_ticket_as_admin)
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'no_remaining', '관리자도 use_ticket 으로는 남의 식권을 쓸 수 없다');

-- JWT 없이 직접 호출
select tests.clear_auth();
set local role authenticated;
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'not_authenticated', 'JWT 가 없으면 not_authenticated');
reset role;

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 090 실패 (함수 없음).

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261008000004_use_ticket.sql`**

```sql
-- =========================================================
-- 사용: 가족 구성원(자녀 포함)이 자기 폰에서 식권 1장을 쓴다. 담당자가 교인 폰을 꾹 누르면 호출된다.
--   · 멱등: 같은 request_id 는 처음 결과를 그대로 돌려준다 (느린 네트워크 재시도 → 이중 차감 없음).
--   · 당일만: served_on 이 서울 기준 오늘이 아니면 not_today. 서버가 판정하므로 폰 시계는 믿지 않는다.
--   · 직렬화: 가족·식사 단위 advisory lock. 같은 가족의 두 폰이 동시에 눌러도 잔량 계산이 겹치지 않는다.
-- 코드: not_authenticated | not_registered | invalid_request | meal_not_found | not_today | no_remaining | duplicate_request
-- =========================================================
create or replace function public.use_ticket(p_meal_id uuid, p_request_id uuid)
returns public.usages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_person public.people;
  v_meal public.meals;
  v_row public.usages;
  v_remaining integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_person from public.people where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_registered';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request';
  end if;

  -- 멱등 분기. 남의 request_id 로 남의 결과를 받아 가지는 못하게 person 까지 맞춘다.
  select * into v_row from public.usages where request_id = p_request_id;
  if found then
    if v_row.person_id <> v_person.id then
      raise exception 'duplicate_request';
    end if;
    return v_row;
  end if;

  select * into v_meal from public.meals where id = p_meal_id;
  if not found then
    raise exception 'meal_not_found';
  end if;
  if v_meal.served_on <> (now() at time zone 'Asia/Seoul')::date then
    raise exception 'not_today';
  end if;

  -- 두 int4 키: 가족·식사 해시. 트랜잭션이 끝나면 자동 해제된다.
  perform pg_advisory_xact_lock(hashtext(v_person.family_id::text), hashtext(p_meal_id::text));

  select coalesce(sum(i.quantity), 0)
         - (select coalesce(sum(u.quantity), 0) from public.usages u
             where u.family_id = v_person.family_id and u.meal_id = p_meal_id and u.voided_at is null)
    into v_remaining
    from public.issuances i
   where i.family_id = v_person.family_id and i.meal_id = p_meal_id and i.cancelled_at is null;
  if v_remaining < 1 then
    raise exception 'no_remaining';
  end if;

  begin
    insert into public.usages (family_id, person_id, meal_id, quantity, used_via, recorded_by, request_id)
    values (v_person.family_id, v_person.id, p_meal_id, 1, 'self', v_person.id, p_request_id)
    returning * into v_row;
  exception when unique_violation then
    -- 같은 request_id 의 동시 재시도가 먼저 들어갔다. 잠금은 가족·식사 단위라 이 경우까지 막지는 못한다.
    select * into v_row from public.usages where request_id = p_request_id;
    if not found or v_row.person_id <> v_person.id then
      raise exception 'duplicate_request';
    end if;
  end;
  return v_row;
end
$$;

comment on function public.use_ticket(uuid, uuid) is '식권 1장 사용(멱등·당일·가족 잠금). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.use_ticket(uuid, uuid) from public, anon;
grant execute on function public.use_ticket(uuid, uuid) to authenticated;
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 010~090 전부 통과 (1단계 80 + 이번 79 = 159 assertions).

- [x] **Step 5: 타입 재생성 + 확인**

Run: `npm run db:types && grep -c "ticket_balances\|issue_tickets\|use_ticket\|create_next_sunday_lunch" src/lib/database.types.ts`
Expected: 0보다 큰 수. `git diff --stat src/lib/database.types.ts` 에 변경이 보인다. `npm run build` 가 여전히 통과한다(기존 코드는 새 타입을 아직 안 쓴다).

- [x] **Step 6: 커밋**

```bash
git add supabase/migrations/20261008000004_use_ticket.sql supabase/tests/database/090_use_ticket.sql src/lib/database.types.ts
git commit -m "feat(db): use_ticket RPC (멱등·당일·가족 advisory lock), 타입 재생성

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 프론트 공통 — PostgREST 언래핑 · Asia/Seoul 날짜 · 금액 · 타임아웃 · 오류 문구

**Files:**
- Create: `src/lib/postgrest.ts`, `src/lib/postgrest.test.ts`
- Create: `src/lib/dates.ts`, `src/lib/dates.test.ts`
- Create: `src/lib/money.ts`, `src/lib/money.test.ts`
- Create: `src/lib/timeout.ts`, `src/lib/timeout.test.ts`
- Modify: `src/lib/errors.ts`, `src/lib/errors.test.ts`
- Modify: `src/features/auth/usePerson.ts:194-196`, `src/features/onboarding/OnboardingPage.tsx:560-563` (중복 제거)

- [x] **Step 1: 실패하는 테스트 — `src/lib/postgrest.test.ts`**

```ts
import { toError, unwrap } from './postgrest'

const pgError = { message: 'phone_taken', code: 'P0001', details: '', hint: '', name: 'PostgrestError' }

describe('toError', () => {
  it('message 와 code 를 보존한 Error 를 만든다', () => {
    const err = toError(pgError)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('phone_taken')
    expect(err.code).toBe('P0001')
    expect(err.cause).toBe(pgError)
  })
})

describe('unwrap', () => {
  it('오류가 없으면 data 를 돌려준다 (null 도 값이다)', () => {
    expect(unwrap({ data: [1, 2], error: null })).toEqual([1, 2])
    expect(unwrap({ data: null, error: null })).toBeNull()
  })

  it('오류가 있으면 던진다', () => {
    expect(() => unwrap({ data: null, error: pgError })).toThrow('phone_taken')
  })
})
```

- [x] **Step 2: 실패하는 테스트 — `src/lib/dates.test.ts`**

```ts
import { formatClock, formatDateTime, formatMealDate, formatShortDate, formatTime, nextSundayAfter, todaySeoul } from './dates'

describe('todaySeoul', () => {
  it('서울 기준 날짜를 YYYY-MM-DD 로 준다 (UTC 자정 전후가 갈린다)', () => {
    // 2026-10-11 23:30 UTC = 10-12 08:30 KST
    expect(todaySeoul(new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-12')
    // 2026-10-12 14:59 UTC = 10-12 23:59 KST / 15:00 UTC = 10-13 00:00 KST
    expect(todaySeoul(new Date('2026-10-12T14:59:00Z'))).toBe('2026-10-12')
    expect(todaySeoul(new Date('2026-10-12T15:00:00Z'))).toBe('2026-10-13')
  })
})

describe('formatMealDate', () => {
  it('일요일은 (주일), 나머지는 요일 한 글자', () => {
    expect(formatMealDate('2026-10-11')).toBe('10월 11일 (주일)')
    expect(formatMealDate('2026-10-12')).toBe('10월 12일 (월)')
    expect(formatMealDate('2026-01-03')).toBe('1월 3일 (토)')
  })
  it('짧은 형식', () => {
    expect(formatShortDate('2026-10-12')).toBe('10/12')
  })
})

describe('formatTime / formatDateTime / formatClock', () => {
  it('서울 시각 HH:MM', () => {
    expect(formatTime('2026-10-12T03:31:00Z')).toBe('12:31')
    expect(formatTime('2026-10-12T15:05:00Z')).toBe('00:05')
  })
  it('날짜와 시각', () => {
    expect(formatDateTime('2026-10-12T03:31:00Z')).toBe('10/12 12:31')
  })
  it('초 단위 시계', () => {
    expect(formatClock(new Date('2026-10-12T03:31:07Z'))).toBe('12:31:07')
  })
})

describe('nextSundayAfter', () => {
  it('기준일 다음의 첫 일요일 (DB create_next_sunday_lunch 와 같은 규칙)', () => {
    expect(nextSundayAfter('2026-10-11')).toBe('2026-10-18') // 일요일 → 다음 주
    expect(nextSundayAfter('2026-10-07')).toBe('2026-10-11') // 수요일
    expect(nextSundayAfter('2026-10-10')).toBe('2026-10-11') // 토요일
    expect(nextSundayAfter('2026-10-05')).toBe('2026-10-11') // 월요일
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/lib/money.test.ts`**

```ts
import { formatWon } from './money'

describe('formatWon', () => {
  it('천 단위 쉼표와 원', () => {
    expect(formatWon(0)).toBe('0원')
    expect(formatWon(5000)).toBe('5,000원')
    expect(formatWon(1234567)).toBe('1,234,567원')
  })
})
```

- [x] **Step 4: 실패하는 테스트 — `src/lib/timeout.test.ts`**

```ts
import { withTimeout } from './timeout'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('시간이 지나면 TimeoutError 로 abort 된다', () => {
    const { signal } = withTimeout(5000)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(signal.aborted).toBe(true)
    expect((signal.reason as DOMException).name).toBe('TimeoutError')
  })

  it('done() 을 부르면 더는 abort 되지 않는다', () => {
    const { signal, done } = withTimeout(5000)
    done()
    vi.advanceTimersByTime(5000)
    expect(signal.aborted).toBe(false)
  })
})
```

- [x] **Step 5: 실패하는 테스트 추가 — `src/lib/errors.test.ts` 끝에 덧붙인다**

파일 상단 import 에 `rpcCodeOf` 를 추가한다 (예: `import { messageOf, rpcCodeOf, toUserMessage } from './errors'`).

```ts
describe('2단계 오류 문구', () => {
  it.each([
    ['forbidden', '관리자만 할 수 있어요.'],
    ['not_registered', '가입을 먼저 해 주세요.'],
    ['meal_not_found', '식사를 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    ['person_not_found', '사람을 찾을 수 없어요.'],
    ['person_is_minor', '자녀 이름으로는 발급할 수 없어요. 보호자 이름으로 발급해 주세요.'],
    ['invalid_quantity', '장수는 1~99 사이로 적어 주세요.'],
    ['invalid_price', '단가는 0~1,000,000원 사이로 적어 주세요.'],
    ['invalid_memo', '메모는 100자까지예요.'],
    ['invalid_date', '날짜를 확인해 주세요.'],
    ['not_today', '오늘 식사의 식권만 쓸 수 있어요.'],
    ['no_remaining', '방금 다른 폰에서 사용되었어요.'],
    ['duplicate_request', '이미 처리된 요청이에요.'],
    ['invalid_request', '잘못된 요청이에요. 다시 눌러 주세요.'],
  ])('%s → 문구', (code, text) => {
    expect(toUserMessage({ message: code, code: 'P0001' })).toBe(text)
  })

  it('DB 제약 코드도 문구로 바꾼다 (직접 insert/delete 경로)', () => {
    expect(toUserMessage({ code: '23503', message: 'update or delete on table "meals" violates foreign key constraint' }))
      .toBe('연결된 기록이 있어 지울 수 없어요.')
    expect(toUserMessage({ code: '23505', message: 'duplicate key value violates unique constraint' }))
      .toBe('같은 값이 이미 있어요.')
  })

  it('타임아웃·중단은 통신 문구', () => {
    expect(toUserMessage(new DOMException('signal timed out', 'TimeoutError'))).toBe('통신이 불안정해요. 잠시 후 다시 시도해 주세요.')
    expect(toUserMessage(new DOMException('The operation was aborted.', 'AbortError'))).toBe('통신이 불안정해요. 잠시 후 다시 시도해 주세요.')
  })

  it('rpcCodeOf 는 알려진 코드만 돌려준다', () => {
    expect(rpcCodeOf({ message: 'no_remaining' })).toBe('no_remaining')
    expect(rpcCodeOf({ message: 'something else' })).toBeUndefined()
    expect(rpcCodeOf(new Error('failed to fetch'))).toBeUndefined()
  })
})
```

- [x] **Step 6: 실패 확인**

Run: `npx vitest run src/lib`
Expected: 새 파일들 "Cannot find module", errors.test 의 새 케이스 실패.

- [x] **Step 7: 구현 — `src/lib/postgrest.ts`**

```ts
import type { PostgrestError } from '@supabase/supabase-js'

export type PostgrestResponse<T> = { data: T; error: null } | { data: null; error: PostgrestError }

/** PostgREST 오류는 Error 가 아닌 평범한 객체다. message/code 를 보존해 Error 로 감싼다 (react-query 는 Error 를 기대한다). */
export function toError(error: PostgrestError): Error & { code: string } {
  return Object.assign(new Error(error.message), { code: error.code, cause: error })
}

/** 응답을 값으로 푼다. 오류면 던진다. maybeSingle 의 null 은 정상 값이다. */
export function unwrap<T>(result: PostgrestResponse<T>): T {
  if (result.error) throw toError(result.error)
  return result.data
}
```

- [x] **Step 8: 구현 — `src/lib/dates.ts`**

```ts
// 모든 날짜 판정은 Asia/Seoul (설계 §2). 폰의 시간대가 달라도 식사일·사용 시각이 흔들리지 않게 한다.
const SEOUL = 'Asia/Seoul'

// en-CA 로케일은 YYYY-MM-DD 로 찍는다. DB 의 served_on(date) 과 같은 모양이라 문자열로 비교할 수 있다.
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit' })
const hm = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const hms = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

/** 서울 기준 오늘 (YYYY-MM-DD) */
export function todaySeoul(now: Date = new Date()): string {
  return ymd.format(now)
}

const WEEKDAYS = ['주일', '월', '화', '수', '목', '금', '토'] as const

/** 'YYYY-MM-DD' → [년, 월, 일]. 날짜만 있는 값은 Date 로 바꾸면 시간대에 밀리므로 직접 쪼갠다. */
function parts(ymdText: string): [number, number, number] {
  const [y, m, d] = ymdText.split('-').map(Number)
  return [y!, m!, d!]
}

function dayOfWeek(ymdText: string): number {
  const [y, m, d] = parts(ymdText)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** '2026-10-11' → '10월 11일 (주일)' */
export function formatMealDate(servedOn: string): string {
  const [, m, d] = parts(servedOn)
  return `${m}월 ${d}일 (${WEEKDAYS[dayOfWeek(servedOn)]})`
}

/** '2026-10-12' → '10/12' */
export function formatShortDate(servedOn: string): string {
  const [, m, d] = parts(servedOn)
  return `${m}/${d}`
}

/** ISO 시각 → 서울 'HH:MM' */
export function formatTime(iso: string): string {
  return hm.format(new Date(iso))
}

/** ISO 시각 → 서울 'M/D HH:MM' */
export function formatDateTime(iso: string): string {
  return `${formatShortDate(todaySeoul(new Date(iso)))} ${formatTime(iso)}`
}

/** 초 단위 시계 'HH:MM:SS' (홈 화면 실시간 시계 — 스크린샷 판별용) */
export function formatClock(now: Date): string {
  return hms.format(now)
}

/**
 * 기준일 "다음" 의 첫 일요일. DB `create_next_sunday_lunch` 와 같은 규칙이라 버튼에 미리 날짜를 보여 줄 수 있다.
 * 일→+7, 월→+6, …, 토→+1
 */
export function nextSundayAfter(base: string): string {
  const [y, m, d] = parts(base)
  const dow = dayOfWeek(base)
  const target = new Date(Date.UTC(y, m - 1, d + ((6 - dow) % 7) + 1))
  return target.toISOString().slice(0, 10)
}
```

- [x] **Step 9: 구현 — `src/lib/money.ts`, `src/lib/timeout.ts`**

```ts
// src/lib/money.ts
/** 5000 → '5,000원' */
export function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}
```

```ts
// src/lib/timeout.ts
/**
 * ms 뒤에 TimeoutError 로 abort 되는 신호. 응답이 오면 done() 으로 타이머를 치운다.
 * AbortSignal.timeout() 대신 직접 만드는 이유: jsdom(테스트)에 없을 수 있고, 가짜 타이머로 제어하기 쉽다.
 */
export function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('signal timed out', 'TimeoutError'))
  }, ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}
```

- [x] **Step 10: 구현 — `src/lib/errors.ts` 수정**

`MESSAGES` 에 2단계 코드를 추가하고, 제약 코드와 타임아웃 분기를 넣고, `rpcCodeOf` 를 export 한다. 파일 전체:

```ts
// DB 함수는 오류 코드를 message 에 문자열로 담아 보낸다 ({code:'P0001', message:'phone_taken'}).
const MESSAGES = {
  // 1단계 · 가입
  phone_taken: '이미 등록된 번호예요. 권사님께 문의해 주세요.',
  invalid_phone: '휴대폰 번호를 확인해 주세요.',
  invalid_name: '이름을 확인해 주세요.',
  consent_required: '개인정보 동의가 필요해요.',
  already_registered: '이미 가입된 계정이에요.',
  anonymous_cannot_claim: '아이 계정은 보호자 연결로 시작해 주세요.',
  not_authenticated: '로그인이 필요해요.',
  dev_login_disabled: '개발용 로그인은 사용할 수 없어요.',
  // 2단계 · 발급·사용
  forbidden: '관리자만 할 수 있어요.',
  not_registered: '가입을 먼저 해 주세요.',
  meal_not_found: '식사를 찾을 수 없어요. 목록을 새로고침해 주세요.',
  person_not_found: '사람을 찾을 수 없어요.',
  person_is_minor: '자녀 이름으로는 발급할 수 없어요. 보호자 이름으로 발급해 주세요.',
  invalid_quantity: '장수는 1~99 사이로 적어 주세요.',
  invalid_price: '단가는 0~1,000,000원 사이로 적어 주세요.',
  invalid_memo: '메모는 100자까지예요.',
  invalid_date: '날짜를 확인해 주세요.',
  not_today: '오늘 식사의 식권만 쓸 수 있어요.',
  no_remaining: '방금 다른 폰에서 사용되었어요.',
  duplicate_request: '이미 처리된 요청이에요.',
  invalid_request: '잘못된 요청이에요. 다시 눌러 주세요.',
} as const satisfies Record<string, string>

/** MESSAGES 에 문구가 있는 오류 코드. 호출하는 쪽에서 오타를 막는 데 쓴다. */
export type RpcErrorCode = keyof typeof MESSAGES

// 테이블에 직접 쓰는 경로(관리자 식사 추가·삭제, 선발급 사람 등록)에서 새는 Postgres 제약 코드
const CODE_MESSAGES: Record<string, string> = {
  '23503': '연결된 기록이 있어 지울 수 없어요.',
  '23505': '같은 값이 이미 있어요.',
}

// 세션 만료·비로그인. 42501 은 Postgres 권한/RLS, PGRST301·302 는 PostgREST 의 JWT 오류다.
const AUTH_CODES = new Set(['42501', 'PGRST301', 'PGRST302'])
const PERMISSION_DENIED = /permission denied/i
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|timed out|aborted/i

const FALLBACK = '잠시 후 다시 시도해 주세요.'
const NETWORK = '통신이 불안정해요. 잠시 후 다시 시도해 주세요.'

function fieldOf(err: unknown, key: 'message' | 'code' | 'name'): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const value = (err as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** 오류 객체에서 message 문자열을 꺼낸다. Supabase RPC 는 message 에 코드 문자열(phone_taken 등)을 담는다. */
export function messageOf(err: unknown): string | undefined {
  return fieldOf(err, 'message')
}

/** 오류 객체에서 code 를 꺼낸다. 빈 문자열은 없는 것으로 본다. */
function codeOf(err: unknown): string | undefined {
  const code = fieldOf(err, 'code')
  return code === '' ? undefined : code
}

// 평범한 객체의 프로토타입 키(toString 등)에 걸리지 않도록 hasOwn 으로 본다.
function isRpcErrorCode(value: string): value is RpcErrorCode {
  return Object.hasOwn(MESSAGES, value)
}

/** 서버 함수가 판정한 오류 코드. 통신 오류처럼 판정이 없는 경우는 undefined (→ 같은 요청을 재시도해도 된다). */
export function rpcCodeOf(err: unknown): RpcErrorCode | undefined {
  const message = messageOf(err)
  return message && isRpcErrorCode(message) ? message : undefined
}

/** 어떤 오류든 사용자에게 보여 줄 한국어 문구로 바꾼다. 모르는 오류는 일반 문구. */
export function toUserMessage(err: unknown): string {
  const rpc = rpcCodeOf(err)
  if (rpc) return MESSAGES[rpc]
  const code = codeOf(err)
  if (code && AUTH_CODES.has(code)) return MESSAGES.not_authenticated
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  const name = fieldOf(err, 'name')
  if (name === 'TimeoutError' || name === 'AbortError') return NETWORK
  const message = messageOf(err)
  if (!message) return FALLBACK
  if (PERMISSION_DENIED.test(message)) return MESSAGES.not_authenticated
  if (NETWORK_FAILURE.test(message)) return NETWORK
  return FALLBACK
}
```

- [x] **Step 11: 중복 제거 — `usePerson.ts` 와 `OnboardingPage.tsx`**

`src/features/auth/usePerson.ts` 의 queryFn 끝부분을:

```ts
      const result = await supabase
        .from('people')
        .select('*')
        .eq('auth_user_id', userId)
        // 제약으로 이미 보장되지만(살아 있는 행만 auth_user_id 를 가진다) 이중 방어로 둔다.
        .is('deleted_at', null)
        .maybeSingle()
      return unwrap(result)
```

으로 바꾸고 `import { unwrap } from '../../lib/postgrest'` 를 추가한다. `src/features/onboarding/OnboardingPage.tsx` 의 `claimPerson` 도:

```ts
async function claimPerson(values: OnboardingValues) {
  return unwrap(
    await supabase.rpc('claim_person', {
      p_name: values.name,
      p_phone: values.phone,
      p_consent_version: church.consentVersion,
    }),
  )
}
```

(`import { unwrap } from '../../lib/postgrest'`). 기존 `usePerson.test.tsx` · `OnboardingPage.test.tsx` 는 그대로 통과해야 한다(동작 동일).

- [x] **Step 12: 통과 확인**

Run: `npx vitest run src/lib src/features/auth src/features/onboarding && npm run lint && npx tsc -b --noEmit`
Expected: 전부 통과, lint·타입 오류 없음.

- [x] **Step 13: 커밋**

```bash
git add src/lib/postgrest.ts src/lib/postgrest.test.ts src/lib/dates.ts src/lib/dates.test.ts src/lib/money.ts src/lib/money.test.ts src/lib/timeout.ts src/lib/timeout.test.ts src/lib/errors.ts src/lib/errors.test.ts src/features/auth/usePerson.ts src/features/onboarding/OnboardingPage.tsx
git commit -m "feat: 날짜·금액·타임아웃 유틸, PostgREST 언래핑, 2단계 오류 문구

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 라우팅 뼈대 — `RequirePerson` 레이아웃 · `RequireAdmin` · 하단 탭 · `PersonShell`

**Files:**
- Create: `src/components/TabBar.tsx`, `src/components/TabBar.test.tsx`
- Create: `src/components/PersonShell.tsx`, `src/components/PersonShell.test.tsx`
- Modify: `src/features/auth/Gate.tsx`, `src/features/auth/Gate.test.tsx`
- Modify: `src/features/auth/usePerson.ts` (`useCurrentPerson` 추가)

라우트 자체(`/history`, `/admin/*`)는 각 화면을 만드는 Task 10·11·12 에서 `App.tsx` 에 붙인다. 여기서는 가드와 틀만 만든다.

- [x] **Step 1: 실패하는 테스트 — `src/components/TabBar.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TabBar } from './TabBar'

const items = [
  { to: '/', label: '식권', icon: '🎫' },
  { to: '/history', label: '내역', icon: '🧾' },
]

describe('TabBar', () => {
  it('항목을 링크로 그리고 현재 경로를 표시한다', () => {
    render(
      <MemoryRouter initialEntries={['/history']}>
        <TabBar items={items} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '식권' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: '내역' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '식권' })).not.toHaveAttribute('aria-current')
  })

  it('홈(/) 탭은 정확히 일치할 때만 활성화된다', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TabBar items={items} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '식권' })).toHaveAttribute('aria-current', 'page')
  })
})
```

> `MemoryRouter` 안의 `NavLink` 는 `href="/"` 를 만든다 (실제 앱은 `HashRouter` 라 `#/`). 테스트는 MemoryRouter 기준이다.

- [x] **Step 2: 실패하는 테스트 — `src/components/PersonShell.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import { PersonShell } from './PersonShell'

const member = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const admin = { ...member, id: 'p9', role: 'admin' } satisfies Person

function renderShell(person: Person, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PersonShell person={person}><p>내용</p></PersonShell>
    </MemoryRouter>,
  )
}

describe('PersonShell', () => {
  it('교인에게는 식권·내역 탭만', () => {
    renderShell(member, '/')
    expect(screen.getByText('내용')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🎫식권', '🧾내역'])
  })

  it('관리자에게는 교인 화면에서 관리 탭이 하나 더 보인다', () => {
    renderShell(admin, '/')
    expect(screen.getByRole('link', { name: '관리' })).toHaveAttribute('href', '/admin/meals')
  })

  it('관리자 영역에서는 식사·발급·내 식권 탭', () => {
    renderShell(admin, '/admin/issue')
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🍚식사', '🎟️발급', '🎫내 식권'])
  })
})
```

- [x] **Step 3: 실패하는 테스트 추가 — `src/features/auth/Gate.test.tsx`**

파일 상단을 다음처럼 바꾼다: `FakePerson` 의 `data` 타입에 `role`·`family_id` 를 추가하고(`{ id: string; name: string; role?: string; family_id?: string }`), `vi.hoisted` 에 `useCurrentPerson` 을 더해 **기존 `vi.mock('./usePerson', …)` 줄을 교체**하며, `renderAt` 이 레이아웃 라우트까지 포함하게 한다. 그 다음 아래 describe 둘을 덧붙인다.

```tsx
import { Gate, RequireAdmin, RequirePerson, RequireSession } from './Gate'

const { useAuth, usePerson, useCurrentPerson } = vi.hoisted(() => ({
  useAuth: vi.fn<() => FakeAuth>(),
  usePerson: vi.fn<() => FakePerson>(),
  useCurrentPerson: vi.fn<() => { role: string }>(),
}))
vi.mock('./AuthProvider', () => ({ useAuth }))
vi.mock('./usePerson', () => ({ usePerson, useCurrentPerson }))
vi.mock('../../pages/StartPage', () => ({ StartPage: () => <p>start</p> }))
vi.mock('../../pages/HomePage', () => ({ HomePage: () => <p>home</p> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Gate />} />
        <Route path="/onboarding" element={<RequireSession><p>onboarding</p></RequireSession>} />
        <Route element={<RequirePerson />}>
          <Route path="/history" element={<p>history</p>} />
          <Route path="/admin/meals" element={<RequireAdmin><p>admin</p></RequireAdmin>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequirePerson', () => {
  it('세션이 없으면 홈으로 보낸다 (홈이 시작 화면을 띄운다)', () => {
    useAuth.mockReturnValue({ status: 'ready', session: null })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/history')
    expect(screen.getByText('start')).toBeInTheDocument()
  })

  it('가입 전이면 가입 화면으로', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/history')
    expect(screen.getByText('onboarding')).toBeInTheDocument()
  })

  it('가입한 사람은 통과하고 하단 탭이 붙는다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수', role: 'member', family_id: 'f1' } })
    renderAt('/history')
    expect(screen.getByText('history')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument()
  })
})

describe('RequireAdmin', () => {
  it('교인은 홈으로 돌려보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수', role: 'member', family_id: 'f1' } })
    useCurrentPerson.mockReturnValue({ role: 'member' })
    renderAt('/admin/meals')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('관리자는 통과', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u9' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p9', name: '권사', role: 'admin', family_id: 'f9' } })
    useCurrentPerson.mockReturnValue({ role: 'admin' })
    renderAt('/admin/meals')
    expect(screen.getByText('admin')).toBeInTheDocument()
  })
})
```

- [x] **Step 4: 실패 확인**

Run: `npx vitest run src/components src/features/auth`
Expected: TabBar·PersonShell "Cannot find module", Gate 새 테스트 실패 (`RequirePerson` 없음).

- [x] **Step 5: 구현 — `src/components/TabBar.tsx`**

```tsx
import { NavLink } from 'react-router'

export type TabItem = { to: string; label: string; icon: string }

/** 화면 맨 아래 고정 탭. 항목은 PersonShell 이 역할·영역에 따라 고른다. */
export function TabBar({ items }: { items: readonly TabItem[] }) {
  return (
    <nav aria-label="주요 메뉴" className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-sm">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              // '/' 는 모든 경로의 접두사라 정확히 일치할 때만 활성화한다
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'font-bold text-blue-600' : 'text-gray-500'}`
              }
            >
              <span aria-hidden className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

- [x] **Step 6: 구현 — `src/components/PersonShell.tsx`**

```tsx
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import { TabBar, type TabItem } from './TabBar'

const MEMBER_TABS: readonly TabItem[] = [
  { to: '/', label: '식권', icon: '🎫' },
  { to: '/history', label: '내역', icon: '🧾' },
]
const ADMIN_LINK: TabItem = { to: '/admin/meals', label: '관리', icon: '🛠️' }
const ADMIN_TABS: readonly TabItem[] = [
  { to: '/admin/meals', label: '식사', icon: '🍚' },
  { to: '/admin/issue', label: '발급', icon: '🎟️' },
  { to: '/', label: '내 식권', icon: '🎫' },
]

/** 가입을 마친 사람의 화면 틀: 내용 + 하단 탭. 틀이 뷰포트 높이를 맡고(min-h-dvh), 고정 탭 높이 + 안전 영역만큼 아래 여백을 둔다. 자식 <main> 은 min-h-dvh 대신 flex-1 로 채운다. */
export function PersonShell({ person, children }: { person: Person; children: ReactNode }) {
  const { pathname } = useLocation()
  // 교인이 /admin 주소를 직접 치면 RequireAdmin 이 돌려보내기 전 한 프레임 동안 관리자 탭이 보이지 않게 역할도 본다
  const inAdminArea = person.role === 'admin' && (pathname === '/admin' || pathname.startsWith('/admin/'))
  const items = inAdminArea ? ADMIN_TABS : person.role === 'admin' ? [...MEMBER_TABS, ADMIN_LINK] : MEMBER_TABS
  return (
    <div className="flex min-h-dvh flex-col pb-[calc(5rem+env(safe-area-inset-bottom))]">
      {children}
      <TabBar items={items} />
    </div>
  )
}
```

- [x] **Step 7: 구현 — `src/features/auth/usePerson.ts` 에 추가**

```ts
import { useOutletContext } from 'react-router'

/** RequirePerson 레이아웃 아래 화면에서 현재 사람을 받는다 (Outlet context). */
export function useCurrentPerson(): Person {
  return useOutletContext<Person>()
}
```

- [x] **Step 8: 구현 — `src/features/auth/Gate.tsx` 수정**

```tsx
import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router'
import { PersonShell } from '../../components/PersonShell'
import { Spinner } from '../../components/ui'
import { HomePage } from '../../pages/HomePage'
import { StartPage } from '../../pages/StartPage'
import { useAuth } from './AuthProvider'
import { useCurrentPerson, usePerson } from './usePerson'

const CONNECTION_ERROR = '연결에 문제가 있어요. 새로고침해 주세요'

/** `#/` : 비로그인 → 시작 화면, 로그인·미가입 → 가입, 가입 완료 → 홈 */
export function Gate() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <StartPage />
  if (person.status === 'pending') return <Spinner />
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (!person.data) return <Navigate to="/onboarding" replace />
  return (
    <PersonShell person={person.data}>
      <HomePage person={person.data} />
    </PersonShell>
  )
}

/** 로그인은 했지만 아직 가입 전인 사람만 통과 (가입 화면용) */
export function RequireSession({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <Navigate to="/" replace />
  if (person.status === 'pending') return <Spinner />
  // 이미 가입한 사람일 수도 있다. 조회가 실패한 채로 가입을 진행시키지 않는다.
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (person.data) return <Navigate to="/" replace />
  return <>{children}</>
}

/** 가입을 마친 사람만 통과하는 레이아웃 라우트. 자식 화면은 useCurrentPerson() 으로 사람을 받는다. */
export function RequirePerson() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <Navigate to="/" replace />
  if (person.status === 'pending') return <Spinner />
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (!person.data) return <Navigate to="/onboarding" replace />
  return (
    <PersonShell person={person.data}>
      <Outlet context={person.data} />
    </PersonShell>
  )
}

/** 관리자만. RequirePerson 아래에서 쓴다. 교인이 주소를 직접 치면 홈으로 보낸다 (데이터는 RLS 가 따로 막는다). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const person = useCurrentPerson()
  if (person.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
```

- [x] **Step 9: 통과 확인**

Run: `npx vitest run src/components src/features/auth src/pages && npm run lint && npx tsc -b --noEmit`
Expected: 전부 통과. (기존 `HomePage.test.tsx` 는 `HomePage` 를 직접 그리므로 영향 없음.)

- [x] **Step 10: 커밋**

```bash
git add src/components/TabBar.tsx src/components/TabBar.test.tsx src/components/PersonShell.tsx src/components/PersonShell.test.tsx src/features/auth/Gate.tsx src/features/auth/Gate.test.tsx src/features/auth/usePerson.ts
git commit -m "feat: RequirePerson/RequireAdmin 가드와 하단 탭 틀

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 식권 데이터 — `groupTickets` (순수) + `useFamilyTickets` (조회·5초 폴링)

**Files:**
- Create: `src/features/tickets/groupTickets.ts`, `src/features/tickets/groupTickets.test.ts`
- Create: `src/features/tickets/useFamilyTickets.ts`, `src/features/tickets/useFamilyTickets.test.tsx`
- Create: `src/test/fakeSupabase.ts` (테스트 전용 가짜 쿼리 빌더 — 이후 Task 들도 쓴다)

- [x] **Step 1: 실패하는 테스트 — `src/features/tickets/groupTickets.test.ts`**

```ts
import { groupTickets, type Balance, type Meal } from './groupTickets'

const meal = (id: string, served_on: string, title = '주일 점심'): Meal => ({
  id, title, served_on, note: null, created_by: 'admin', created_at: '2026-10-01T00:00:00Z',
})
const balance = (meal_id: string, issued: number, used: number): Balance => ({
  family_id: 'f1', meal_id, issued, used, remaining: issued - used, amount: issued * 5000,
})

describe('groupTickets', () => {
  const today = '2026-10-12'
  const meals = [meal('m-past', '2026-10-05'), meal('m-today', '2026-10-12'), meal('m-dinner', '2026-10-12', '저녁'), meal('m-next', '2026-10-19'), meal('m-far', '2026-10-26')]

  it('오늘 식사는 식권이 없어도 모두 나온다 (제목순). 잔량은 뷰 값, 없으면 0', () => {
    const { today: t } = groupTickets(meals, [balance('m-today', 4, 1)], today)
    expect(t.map((g) => g.meal.id)).toEqual(['m-dinner', 'm-today'])
    expect(t[1]).toMatchObject({ issued: 4, used: 1, remaining: 3, amount: 20000 })
    expect(t[0]).toMatchObject({ issued: 0, used: 0, remaining: 0, amount: 0 })
  })

  it('다가오는 식권은 날짜 오름차순, 식권이 있는 식사만', () => {
    const { upcoming } = groupTickets(meals, [balance('m-far', 1, 0), balance('m-next', 4, 0)], today)
    expect(upcoming.map((g) => g.meal.id)).toEqual(['m-next', 'm-far'])
  })

  it('지난 식권은 날짜 내림차순, 발급이 있는 것만', () => {
    const { past } = groupTickets([...meals, meal('m-older', '2026-09-28')], [balance('m-past', 2, 1), balance('m-older', 3, 3)], today)
    expect(past.map((g) => g.meal.id)).toEqual(['m-past', 'm-older'])
    expect(past[0]?.remaining).toBe(1)
  })

  it('식사 정보가 없는 잔량 행은 무시한다 (조회 사이에 식사가 지워진 경우)', () => {
    const { upcoming, past } = groupTickets(meals, [balance('m-deleted', 1, 0)], today)
    expect(upcoming).toEqual([])
    expect(past).toEqual([])
  })
})
```

- [x] **Step 2: 가짜 Supabase 빌더 — `src/test/fakeSupabase.ts`** (테스트 전용. 커버리지 제외 디렉터리에 있다)

```ts
import type { PostgrestError } from '@supabase/supabase-js'

type Filter = [method: string, ...args: unknown[]]

/**
 * supabase.from(table) 이 돌려주는 체이닝 빌더의 가짜. 어떤 메서드를 불러도 자기 자신을 돌려주고,
 * await 하면 미리 넣어 둔 응답을 준다. 어떤 필터가 걸렸는지 filters 로 확인한다.
 */
export class FakeQuery<T> {
  readonly filters: Filter[] = []
  constructor(private readonly response: { data: T; error: null } | { data: null; error: PostgrestError }) {}
  private chain(method: string) {
    return (...args: unknown[]) => {
      this.filters.push([method, ...args])
      return this
    }
  }
  select = this.chain('select')
  eq = this.chain('eq')
  is = this.chain('is')
  in = this.chain('in')
  or = this.chain('or')
  gte = this.chain('gte')
  order = this.chain('order')
  limit = this.chain('limit')
  maybeSingle = this.chain('maybeSingle')
  single = this.chain('single')
  insert = this.chain('insert')
  delete = this.chain('delete')
  abortSignal = this.chain('abortSignal')
  then<R>(resolve: (value: typeof this.response) => R): Promise<R> {
    return Promise.resolve(this.response).then(resolve)
  }
  has(method: string, ...args: unknown[]): boolean {
    return this.filters.some((f) => f[0] === method && args.every((a, i) => JSON.stringify(f[i + 1]) === JSON.stringify(a)))
  }
}

export function ok<T>(data: T): FakeQuery<T> {
  return new FakeQuery<T>({ data, error: null })
}

export function fail(message: string, code = 'P0001'): FakeQuery<never> {
  return new FakeQuery<never>({ data: null, error: { message, code, details: '', hint: '', name: 'PostgrestError' } as PostgrestError })
}
```

- [x] **Step 3: 실패하는 테스트 — `src/features/tickets/useFamilyTickets.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Person } from '../auth/usePerson'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { TICKETS_POLL_MS, useFamilyTickets } from './useFamilyTickets'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))
vi.mock('../../lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dates')>()),
  todaySeoul: () => '2026-10-12',
}))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

const todayMeal = { id: 'm1', title: '주일 점심', served_on: '2026-10-12', note: null, created_by: 'a', created_at: '2026-10-01T00:00:00Z' }
const nextMeal = { ...todayMeal, id: 'm2', served_on: '2026-10-19' }

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useFamilyTickets', () => {
  it('잔량·오늘 식사·가족·식사·사용을 읽어 묶는다', async () => {
    const queries: Record<string, FakeQuery<unknown>[]> = { ticket_balances: [], meals: [], people: [], usages: [] }
    from.mockImplementation((table: string) => {
      const q =
        table === 'ticket_balances' ? ok([{ family_id: 'f1', meal_id: 'm1', issued: 2, used: 1, remaining: 1, amount: 10000 }, { family_id: 'f1', meal_id: 'm2', issued: 1, used: 0, remaining: 1, amount: 5000 }])
        : table === 'meals' ? ok([todayMeal, nextMeal])
        : table === 'people' ? ok([{ id: 'p1', name: '김철수' }])
        : ok([{ id: 'u1', meal_id: 'm1', used_at: '2026-10-12T03:31:00Z', person_id: 'p1', used_via: 'self' }])
      queries[table]!.push(q)
      return q
    })

    const { result } = renderHook(() => useFamilyTickets(person), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))

    const data = result.current.data!
    expect(data.today.map((g) => g.meal.id)).toEqual(['m1'])
    expect(data.today[0]).toMatchObject({ issued: 2, used: 1, remaining: 1 })
    expect(data.upcoming.map((g) => g.meal.id)).toEqual(['m2'])
    expect(data.members).toEqual([{ id: 'p1', name: '김철수' }])
    expect(data.usages).toHaveLength(1)

    // 관리자도 이 훅을 쓰므로(관리자는 뷰에서 모든 가족을 본다) 자기 가족으로 좁혀야 한다
    expect(queries.ticket_balances![0]!.has('eq', 'family_id', 'f1')).toBe(true)
    expect(queries.people![0]!.has('eq', 'family_id', 'f1')).toBe(true)
    expect(queries.usages![0]!.has('eq', 'family_id', 'f1')).toBe(true)
    expect(queries.usages![0]!.has('in', 'meal_id', ['m1'])).toBe(true)
    expect(queries.usages![0]!.has('is', 'voided_at', null)).toBe(true)
  })

  it('잔량도 오늘 식사도 없으면 빈 결과 (추가 조회 없음)', async () => {
    from.mockImplementation((table: string) => (table === 'ticket_balances' || table === 'meals' || table === 'people' || table === 'usages' ? ok([]) : ok(null)))
    const { result } = renderHook(() => useFamilyTickets(person), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toEqual({ today: [], upcoming: [], past: [], usages: [], members: [] })
    // balances, today meals, people 세 번만 (ids 가 비어 meals/usages 재조회가 없다)
    expect(from).toHaveBeenCalledTimes(3)
  })

  it('5초 폴링 상수 (useQuery 의 refetchInterval 에 그대로 쓴다)', () => {
    expect(TICKETS_POLL_MS).toBe(5_000)
  })
})
```

- [x] **Step 4: 실패 확인**

Run: `npx vitest run src/features/tickets`
Expected: "Cannot find module".

- [x] **Step 5: 구현 — `src/features/tickets/groupTickets.ts`**

```ts
import type { Database } from '../../lib/database.types'

export type Meal = Database['public']['Tables']['meals']['Row']
export type Balance = Database['public']['Views']['ticket_balances']['Row']
export type Usage = Database['public']['Tables']['usages']['Row']

/** 한 식사에 대한 우리 가족 식권 묶음. 뷰에 행이 없으면(식권 없음) 0 으로 채운다. */
export type TicketGroup = { meal: Meal; issued: number; used: number; remaining: number; amount: number }
export type TicketGroups = { today: TicketGroup[]; upcoming: TicketGroup[]; past: TicketGroup[] }

const byTitle = (a: Meal, b: Meal) => a.title.localeCompare(b.title, 'ko')
const byDateAsc = (a: Meal, b: Meal) => a.served_on.localeCompare(b.served_on)
const byDateDesc = (a: Meal, b: Meal) => b.served_on.localeCompare(a.served_on)

/**
 * 뷰 행(가족·식사별 잔량)과 식사 목록을 홈 화면 구역으로 나눈다.
 * - 오늘: 오늘 날짜의 식사는 식권이 없어도 보여 준다 ("식권이 없어요" 안내용)
 * - 다가오는: 식권이 있는 미래 식사, 가까운 순
 * - 지난: 발급이 있었던 과거 식사, 최근 순 (미사용 장수 표시용)
 */
export function groupTickets(meals: readonly Meal[], balances: readonly Balance[], today: string): TicketGroups {
  const mealById = new Map(meals.map((m) => [m.id, m]))
  const balanceByMeal = new Map<string, Balance>()
  for (const b of balances) if (b.meal_id) balanceByMeal.set(b.meal_id, b)

  const toGroup = (meal: Meal): TicketGroup => {
    const b = balanceByMeal.get(meal.id)
    return { meal, issued: b?.issued ?? 0, used: b?.used ?? 0, remaining: b?.remaining ?? 0, amount: b?.amount ?? 0 }
  }
  const withTickets = [...balanceByMeal.keys()].map((id) => mealById.get(id)).filter((m): m is Meal => m !== undefined)

  return {
    today: meals.filter((m) => m.served_on === today).sort(byTitle).map(toGroup),
    upcoming: withTickets.filter((m) => m.served_on > today).sort(byDateAsc).map(toGroup),
    past: withTickets.filter((m) => m.served_on < today).sort(byDateDesc).map(toGroup).filter((g) => g.issued > 0),
  }
}
```

- [x] **Step 6: 구현 — `src/features/tickets/useFamilyTickets.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { todaySeoul } from '../../lib/dates'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'
import { groupTickets, type Meal, type TicketGroups, type Usage } from './groupTickets'

/** 화면이 보이는 동안의 재조회 주기 (설계 §8.2). 숨겨지면 멈추고(refetchIntervalInBackground=false), 돌아오면 즉시 다시 읽는다(refetchOnWindowFocus). */
export const TICKETS_POLL_MS = 5_000

export const ticketsQueryKey = ['tickets'] as const

export type Member = Pick<Person, 'id' | 'name'>
export type FamilyTickets = TicketGroups & { usages: Usage[]; members: Member[] }

/**
 * 우리 가족 식권 전체. 두 번의 왕복으로 끝낸다:
 *  1) 잔량(뷰) · 오늘 식사 · 가족 구성원  2) 식사 상세(id 목록) · 오늘 식사의 사용 기록
 * 뷰는 meals 임베딩이 안 되고(coalesce 열), 관리자는 뷰·people 에서 모든 가족을 보므로 family_id 로 좁힌다.
 */
export function useFamilyTickets(person: Person) {
  const today = todaySeoul()
  return useQuery({
    queryKey: [...ticketsQueryKey, person.family_id, today],
    queryFn: async (): Promise<FamilyTickets> => {
      // 자정을 넘겨도 다음 폴링이 새 날짜로 읽도록 queryFn 안에서 다시 계산한다 (결과가 바뀌면 리렌더로 키가 따라온다).
      const day = todaySeoul()
      const [balances, todayMeals, members] = await Promise.all([
        supabase.from('ticket_balances').select('*').eq('family_id', person.family_id).then(unwrap),
        supabase.from('meals').select('*').eq('served_on', day).then(unwrap),
        supabase.from('people').select('id, name').eq('family_id', person.family_id).is('deleted_at', null).then(unwrap),
      ])
      const todayIds = todayMeals.map((m) => m.id)
      // 오늘 식사는 이미 손에 있으니 잔량 행의 나머지 식사만 더 읽는다
      const mealIds = [...new Set(balances.map((b) => b.meal_id).filter((id): id is string => id !== null && !todayIds.includes(id)))]
      const [otherMeals, usages] = await Promise.all([
        mealIds.length ? supabase.from('meals').select('*').in('id', mealIds).then(unwrap) : Promise.resolve<Meal[]>([]),
        todayIds.length
          // 관리자는 RLS 로 모든 가족의 사용 기록을 볼 수 있으므로 여기서도 가족으로 좁힌다
          ? supabase.from('usages').select('*').eq('family_id', person.family_id).in('meal_id', todayIds).is('voided_at', null).order('used_at').then(unwrap)
          : Promise.resolve<Usage[]>([]),
      ])
      return { ...groupTickets([...todayMeals, ...otherMeals], balances, day), usages, members }
    },
    refetchInterval: TICKETS_POLL_MS,
  })
}
```

- [x] **Step 7: 통과 확인**

Run: `npx vitest run src/features/tickets && npm run lint && npx tsc -b --noEmit`
Expected: 통과. (타입 오류가 나면 `database.types.ts` 가 Task 4 에서 재생성되었는지 확인.)

- [x] **Step 8: 커밋**

```bash
git add src/features/tickets/groupTickets.ts src/features/tickets/groupTickets.test.ts src/features/tickets/useFamilyTickets.ts src/features/tickets/useFamilyTickets.test.tsx src/test/fakeSupabase.ts
git commit -m "feat: 가족 식권 조회 훅과 오늘/다가오는/지난 묶기

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 꾹 누르기 훅 · 온라인 감지 · 초 단위 시계 · `use_ticket` 호출 훅

**Files:**
- Create: `src/features/tickets/useHold.ts`, `src/features/tickets/useHold.test.ts`
- Create: `src/features/tickets/useOnline.ts`, `src/features/tickets/useOnline.test.ts`
- Create: `src/features/tickets/Clock.tsx`, `src/features/tickets/Clock.test.tsx`
- Create: `src/features/tickets/useUseTicket.ts`, `src/features/tickets/useUseTicket.test.tsx`

- [x] **Step 1: 실패하는 테스트 — `src/features/tickets/useHold.test.ts`**

```ts
import { act, renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { HOLD_MS, useHold } from './useHold'

const down = (button = 0) => ({ button, preventDefault: () => {} }) as unknown as PointerEvent<HTMLElement>

describe('useHold', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('600ms 누르고 있으면 onComplete 를 한 번 부른다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    expect(HOLD_MS).toBe(600)

    act(() => result.current.handlers.onPointerDown(down()))
    expect(result.current.holding).toBe(true)
    act(() => vi.advanceTimersByTime(599))
    expect(onComplete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onComplete).toHaveBeenCalledOnce()
    expect(result.current.holding).toBe(false)
  })

  it('먼저 떼면 취소된다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down()))
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.handlers.onPointerUp())
    expect(result.current.holding).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('손가락이 벗어나거나(leave) 스크롤로 끊기면(cancel) 취소된다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down()))
    act(() => result.current.handlers.onPointerLeave())
    act(() => vi.advanceTimersByTime(1000))
    act(() => result.current.handlers.onPointerDown(down()))
    act(() => result.current.handlers.onPointerCancel())
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('disabled 면 누름을 시작하지 않고, 누르는 중 disabled 가 되면 취소된다', () => {
    const onComplete = vi.fn<() => void>()
    const { result, rerender } = renderHook(({ disabled }) => useHold({ onComplete, disabled }), { initialProps: { disabled: true } })
    act(() => result.current.handlers.onPointerDown(down()))
    expect(result.current.holding).toBe(false)

    rerender({ disabled: false })
    act(() => result.current.handlers.onPointerDown(down()))
    expect(result.current.holding).toBe(true)
    rerender({ disabled: true })
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('마우스 오른쪽 버튼은 무시한다', () => {
    const onComplete = vi.fn<() => void>()
    const { result } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down(2)))
    expect(result.current.holding).toBe(false)
  })

  it('언마운트되면 타이머를 치운다', () => {
    const onComplete = vi.fn<() => void>()
    const { result, unmount } = renderHook(() => useHold({ onComplete }))
    act(() => result.current.handlers.onPointerDown(down()))
    unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: 실패하는 테스트 — `src/features/tickets/useOnline.test.ts`, `Clock.test.tsx`**

```ts
// src/features/tickets/useOnline.test.ts
import { act, renderHook } from '@testing-library/react'
import { useOnline } from './useOnline'

describe('useOnline', () => {
  it('navigator.onLine 을 따라가고 online/offline 이벤트로 바뀐다', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { result } = renderHook(() => useOnline())
    expect(result.current).toBe(true)

    onLine.mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)

    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })
})
```

```tsx
// src/features/tickets/Clock.test.tsx
import { act, render, screen } from '@testing-library/react'
import { Clock } from './Clock'

describe('Clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T03:31:07Z')) // 12:31:07 KST
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('서울 시각을 초 단위로 보여 주고 1초마다 간다', () => {
    render(<Clock />)
    expect(screen.getByText('12:31:07')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('12:31:08')).toBeInTheDocument()
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/features/tickets/useUseTicket.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, ok } from '../../test/fakeSupabase'
import { USE_TIMEOUT_MS, useUseTicket } from './useUseTicket'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<(fn: string, args: Record<string, unknown>) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

const usage = { id: 'u1', meal_id: 'm1', family_id: 'f1', person_id: 'p1', quantity: 1, used_via: 'self', recorded_by: 'p1', request_id: 'r1', used_at: '2026-10-12T03:31:00Z', voided_at: null, voided_by: null }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('useUseTicket', () => {
  const ids = ['id-1', 'id-2', 'id-3']
  beforeEach(() => {
    const randomUUID = vi.fn<() => string>(() => ids.shift() ?? 'id-x')
    vi.stubGlobal('crypto', { randomUUID })
    ids.splice(0, ids.length, 'id-1', 'id-2', 'id-3')
  })

  it('use_ticket 을 식사 id 와 새 request_id 로 부르고 식권 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok(usage))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenCalledWith('use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
    expect(USE_TIMEOUT_MS).toBe(5_000)
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tickets'] }))

    // 성공했으면 다음 누름은 새 request_id
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenLastCalledWith('use_ticket', { p_meal_id: 'm1', p_request_id: 'id-2' })
  })

  it('통신 오류 뒤 재시도는 같은 request_id 를 쓴다 (서버 멱등 → 이중 차감 없음)', async () => {
    rpc.mockReturnValueOnce(fail('TypeError: Failed to fetch', '')).mockReturnValueOnce(ok(usage))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined)
    })
    expect(result.current.isError).toBe(true)
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenNthCalledWith(1, 'use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'use_ticket', { p_meal_id: 'm1', p_request_id: 'id-1' })
  })

  it('서버가 판정한 오류(no_remaining 등) 뒤에는 새 request_id', async () => {
    rpc.mockReturnValueOnce(fail('no_remaining')).mockReturnValueOnce(ok(usage))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicket('m1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined)
    })
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenNthCalledWith(2, 'use_ticket', { p_meal_id: 'm1', p_request_id: 'id-2' })
  })
})
```

- [x] **Step 4: 실패 확인**

Run: `npx vitest run src/features/tickets`
Expected: 네 파일 모두 "Cannot find module".

- [x] **Step 5: 구현 — `src/features/tickets/useHold.ts`**

```ts
import { useCallback, useEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from 'react'

/** 식권 한 장을 사용 처리하는 데 필요한 누름 시간 (설계 §8.2) */
export const HOLD_MS = 600

type Options = { onComplete: () => void; disabled?: boolean; duration?: number }

/**
 * 꾹 누르기. 손가락이 duration 동안 머물면 onComplete 를 한 번 부르고, 그 전에 떼거나(up) 벗어나거나(leave)
 * 스크롤 등으로 끊기면(cancel) 아무 일도 없다. 짧은 탭·실수로 스친 손가락이 식권을 쓰지 못하게 하는 장치다.
 * 채워지는 색은 CSS 전환으로 그리고(holding 플래그), 완료 판정은 타이머가 한다.
 */
export function useHold({ onComplete, disabled = false, duration = HOLD_MS }: Options) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 콜백이 바뀌어도 진행 중인 누름은 최신 콜백을 부른다
  const latest = useRef(onComplete)
  useEffect(() => {
    latest.current = onComplete
  }, [onComplete])

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setHolding(false)
  }, [])

  const start = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (disabled || timer.current !== null) return
      // 마우스 오른쪽·가운데 버튼은 무시. 터치·펜은 button 0 (jsdom 의 generic Event 는 undefined → 통과)
      if (e.button > 0) return
      setHolding(true)
      timer.current = setTimeout(() => {
        timer.current = null
        setHolding(false)
        latest.current()
      }, duration)
    },
    [disabled, duration],
  )

  // 처리 중(disabled) 으로 바뀌면 진행 중인 누름을 끊는다. 언마운트 때도 타이머를 치운다.
  useEffect(() => {
    if (disabled) cancel()
  }, [disabled, cancel])
  useEffect(() => cancel, [cancel])

  return {
    holding,
    handlers: {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // 길게 누르면 모바일 브라우저가 컨텍스트 메뉴·텍스트 선택을 띄운다. 막는다.
      onContextMenu: (e: SyntheticEvent) => e.preventDefault(),
    },
  }
}
```

- [x] **Step 6: 구현 — `useOnline.ts`, `Clock.tsx`**

```ts
// src/features/tickets/useOnline.ts
import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** 브라우저가 보는 온라인 여부. 오프라인이면 사용 버튼을 잠근다 (설계 §9 — 오프라인 사용 처리는 지원하지 않는다). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}
```

```tsx
// src/features/tickets/Clock.tsx
import { useEffect, useState } from 'react'
import { formatClock } from '../../lib/dates'

/** 초 단위 실시간 시계. 스크린샷으로 식권 화면을 흉내 내기 어렵게 한다 (설계 §8.2 부정 사용 대비). */
export function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <time dateTime={now.toISOString()} className="font-mono text-2xl font-bold tabular-nums">
      {formatClock(now)}
    </time>
  )
}
```

- [x] **Step 7: 구현 — `src/features/tickets/useUseTicket.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { rpcCodeOf } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/timeout'
import { ticketsQueryKey } from './useFamilyTickets'

/** 누름 완료 뒤 응답을 기다리는 한계 (설계 §9). 넘기면 "통신이 불안정해요" 를 띄우고, 다음 누름은 같은 request_id 로 재시도한다. */
export const USE_TIMEOUT_MS = 5_000

/**
 * 식권 1장 사용. request_id 는 "한 번의 시도" 를 뜻한다:
 *  - 서버가 판정을 내리면(성공 또는 no_remaining 같은 코드) 시도가 끝난 것이라 다음엔 새 id
 *  - 통신 오류·타임아웃이면 서버에 닿았는지 모르므로 같은 id 로 재시도 (서버가 멱등 처리 → 이중 차감 없음)
 */
export function useUseTicket(mealId: string) {
  const queryClient = useQueryClient()
  const requestId = useRef<string | null>(null)

  return useMutation({
    mutationFn: async () => {
      requestId.current ??= crypto.randomUUID()
      const { signal, done } = withTimeout(USE_TIMEOUT_MS)
      try {
        return unwrap(
          await supabase.rpc('use_ticket', { p_meal_id: mealId, p_request_id: requestId.current }).abortSignal(signal),
        )
      } finally {
        done()
      }
    },
    onSuccess: () => {
      requestId.current = null
    },
    onError: (err) => {
      if (rpcCodeOf(err)) requestId.current = null
    },
    // 성공이든 실패든 잔량을 다시 읽는다 (no_remaining 이면 다른 폰이 쓴 것이라 목록이 바뀌어 있다)
    onSettled: () => queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
  })
}
```

- [x] **Step 8: 통과 확인**

Run: `npx vitest run src/features/tickets && npm run lint && npx tsc -b --noEmit`
Expected: 통과.

- [x] **Step 9: 커밋**

```bash
git add src/features/tickets/useHold.ts src/features/tickets/useHold.test.ts src/features/tickets/useOnline.ts src/features/tickets/useOnline.test.ts src/features/tickets/Clock.tsx src/features/tickets/Clock.test.tsx src/features/tickets/useUseTicket.ts src/features/tickets/useUseTicket.test.tsx
git commit -m "feat: 600ms 꾹 누르기 훅, 온라인 감지, 초 단위 시계, use_ticket 호출 훅

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 식권 세로 목록 · 오늘 식사 카드 · 홈 화면 재작성

**Files:**
- Create: `src/features/tickets/buildRows.ts`, `src/features/tickets/buildRows.test.ts`
- Create: `src/features/tickets/TicketList.tsx`, `src/features/tickets/TicketList.test.tsx`
- Create: `src/features/tickets/TodayMealCard.tsx`, `src/features/tickets/TodayMealCard.test.tsx`
- Rewrite: `src/pages/HomePage.tsx`, `src/pages/HomePage.test.tsx`

- [x] **Step 1: 실패하는 테스트 — `src/features/tickets/buildRows.test.ts`**

```ts
import { buildRows, FOLD_THRESHOLD } from './buildRows'
import type { Usage } from './groupTickets'

const usage = (i: number, person_id = 'p1', used_via: 'self' | 'admin' = 'self'): Usage => ({
  id: `u${i}`, meal_id: 'm1', family_id: 'f1', person_id, quantity: 1, used_via, recorded_by: person_id,
  request_id: `r${i}`, used_at: `2026-10-12T03:3${i}:00Z`, voided_at: null, voided_by: null,
})
const members = [{ id: 'p1', name: '김철수' }, { id: 'p2', name: '서연' }]

describe('buildRows', () => {
  it('사용된 장이 먼저, 번호는 1부터, 사용 시각과 누른 폰 이름을 붙인다', () => {
    const rows = buildRows({ issued: 4, used: 2, usages: [usage(1), usage(2, 'p2')], members })
    expect(rows.map((r) => r.state)).toEqual(['used', 'used', 'open', 'open'])
    expect(rows[0]).toMatchObject({ index: 1, label: '12:31 사용 · 김철수 폰' })
    expect(rows[1]).toMatchObject({ index: 2, label: '12:32 사용 · 서연 폰' })
    expect(rows[2]).toMatchObject({ index: 3, label: undefined })
  })

  it('사용 기록보다 사용 장수가 많으면(아직 안 읽힘) 시각 없이 "사용 완료"', () => {
    const rows = buildRows({ issued: 2, used: 1, usages: [], members })
    expect(rows[0]).toMatchObject({ state: 'used', label: undefined })
  })

  it('관리자 대신 처리는 "담당자 처리", 모르는 사람은 이름 없이', () => {
    const rows = buildRows({ issued: 2, used: 2, usages: [usage(1, 'p9', 'admin'), usage(2, 'p9')], members })
    expect(rows[0]?.label).toBe('12:31 담당자 처리')
    expect(rows[1]?.label).toBe('12:32 사용')
  })

  it('접기 기준은 3장', () => {
    expect(FOLD_THRESHOLD).toBe(3)
  })
})
```

- [x] **Step 2: 실패하는 테스트 — `src/features/tickets/TicketList.test.tsx`**

```tsx
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TicketList } from './TicketList'

const members = [{ id: 'p1', name: '김철수' }]

describe('TicketList', () => {
  it('식권을 세로로 한 장씩, 번호 "n / 전체" 로 그린다', () => {
    render(<TicketList issued={4} used={1} usages={[]} members={members} canUse onUse={() => {}} pending={false} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('사용 완료')
    expect(items[0]).toHaveTextContent('1 / 4')
    expect(items[3]).toHaveTextContent('4 / 4')
  })

  it('사용된 장이 3장 이상이면 한 줄로 접고, 누르면 펼친다', async () => {
    render(<TicketList issued={5} used={3} usages={[]} members={members} canUse onUse={() => {}} pending={false} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3) // 접힌 1 + 남은 2
    await userEvent.click(screen.getByRole('button', { name: '사용 완료 3장 펼치기' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('남은 장을 600ms 꾹 누르면 onUse 가 한 번 불린다. 짧게 누르면 아니다', () => {
    vi.useFakeTimers()
    const onUse = vi.fn<() => void>()
    render(<TicketList issued={2} used={0} usages={[]} members={members} canUse onUse={onUse} pending={false} />)
    const [first] = screen.getAllByRole('button', { name: /꾹 눌러 사용/ })

    act(() => {
      first!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(300))
    act(() => {
      first!.dispatchEvent(new Event('pointerup', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(600))
    expect(onUse).not.toHaveBeenCalled()

    act(() => {
      first!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(600))
    expect(onUse).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('사용할 수 없을 때(canUse=false)는 누름 버튼이 잠긴다', () => {
    render(<TicketList issued={2} used={0} usages={[]} members={members} canUse={false} onUse={() => {}} pending={false} />)
    for (const b of screen.getAllByRole('button', { name: /꾹 눌러 사용/ })) expect(b).toBeDisabled()
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/features/tickets/TodayMealCard.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TicketGroup } from './groupTickets'
import { TodayMealCard } from './TodayMealCard'

const { useUseTicket } = vi.hoisted(() => ({
  useUseTicket: vi.fn<() => { mutate: () => void; isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown }>(),
}))
vi.mock('./useUseTicket', () => ({ useUseTicket }))
vi.mock('./Clock', () => ({ Clock: () => <span>12:31:07</span> }))

const group: TicketGroup = {
  meal: { id: 'm1', title: '주일 점심', served_on: '2026-10-11', note: null, created_by: 'a', created_at: '2026-10-01T00:00:00Z' },
  issued: 4, used: 1, remaining: 3, amount: 20000,
}
const idle = { mutate: vi.fn<() => void>(), isPending: false, isError: false, isSuccess: false, error: null }

describe('TodayMealCard', () => {
  it('식사명·날짜·시계·남은 장수·안내문을 보여 준다', () => {
    useUseTicket.mockReturnValue(idle)
    render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('heading', { name: '주일 점심' })).toBeInTheDocument()
    expect(screen.getByText('오늘 · 10월 11일 (주일)')).toBeInTheDocument()
    expect(screen.getByText('12:31:07')).toBeInTheDocument()
    expect(screen.getByText('3장 남음')).toBeInTheDocument()
    expect(screen.getByText('담당자가 식권을 꾹 눌러 주세요')).toBeInTheDocument()
  })

  it('식권이 없으면 목록 대신 안내', () => {
    useUseTicket.mockReturnValue(idle)
    render(<TodayMealCard group={{ ...group, issued: 0, used: 0, remaining: 0 }} usages={[]} members={[]} online />)
    expect(screen.getByText('이 식사의 식권이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('처리 중이면 상태를 보여 주고, 오프라인이면 사용 버튼을 잠근다', () => {
    useUseTicket.mockReturnValue({ ...idle, isPending: true })
    const { rerender } = render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('status')).toHaveTextContent('처리 중…')

    useUseTicket.mockReturnValue(idle)
    rerender(<TodayMealCard group={group} usages={[]} members={[]} online={false} />)
    for (const b of screen.getAllByRole('button', { name: /꾹 눌러 사용/ })) expect(b).toBeDisabled()
  })

  it('오류는 문구로, 성공은 확인 문구로', () => {
    useUseTicket.mockReturnValue({ ...idle, isError: true, error: { message: 'no_remaining', code: 'P0001' } })
    const { rerender } = render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('alert')).toHaveTextContent('방금 다른 폰에서 사용되었어요.')

    useUseTicket.mockReturnValue({ ...idle, isSuccess: true })
    rerender(<TodayMealCard group={group} usages={[]} members={[]} online />)
    expect(screen.getByRole('status')).toHaveTextContent('사용 처리되었어요')
  })

  it('목록의 onUse 가 mutate 를 부른다 (키보드 Enter 로도 된다)', async () => {
    const mutate = vi.fn<() => void>()
    useUseTicket.mockReturnValue({ ...idle, mutate })
    render(<TodayMealCard group={group} usages={[]} members={[]} online />)
    const [first] = screen.getAllByRole('button', { name: /꾹 눌러 사용/ })
    first!.focus()
    await userEvent.keyboard('{Enter}')
    expect(mutate).toHaveBeenCalledOnce()
  })
})
```

- [x] **Step 4: 실패하는 테스트 — `src/pages/HomePage.test.tsx` 재작성**

기존 로그아웃 테스트 4개는 그대로 두고(`signOut` mock), 위쪽의 첫 테스트를 바꾸고 식권 구역 테스트를 더한다. 전체:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import type { FamilyTickets } from '../features/tickets/useFamilyTickets'
import { HomePage } from './HomePage'

const { signOut, useFamilyTickets, useOnline } = vi.hoisted(() => ({
  signOut: vi.fn<() => Promise<void>>(),
  useFamilyTickets: vi.fn<() => { status: 'pending' | 'error' | 'success'; data?: FamilyTickets; refetch: () => void }>(),
  useOnline: vi.fn<() => boolean>(),
}))
vi.mock('../features/auth/signIn', () => ({ signOut }))
vi.mock('../features/tickets/useFamilyTickets', () => ({ useFamilyTickets, ticketsQueryKey: ['tickets'] }))
vi.mock('../features/tickets/useOnline', () => ({ useOnline }))
vi.mock('../features/tickets/TodayMealCard', () => ({
  TodayMealCard: ({ group }: { group: { meal: { title: string } } }) => <p>오늘카드:{group.meal.title}</p>,
}))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

const meal = (id: string, served_on: string, title = '주일 점심') => ({ id, title, served_on, note: null, created_by: 'a', created_at: '2026-10-01T00:00:00Z' })
const group = (id: string, served_on: string, issued: number, used: number) => ({ meal: meal(id, served_on), issued, used, remaining: issued - used, amount: issued * 5000 })
const empty: FamilyTickets = { today: [], upcoming: [], past: [], usages: [], members: [{ id: 'p1', name: '김철수' }] }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['person', 'u1'], person)
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter><HomePage person={person} /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

beforeEach(() => {
  useOnline.mockReturnValue(true)
  useFamilyTickets.mockReturnValue({ status: 'success', data: empty, refetch: () => {} })
})

describe('HomePage · 머리말', () => {
  it('이름·가려진 번호·"내 식권"(1인 가족)·처리방침 링크', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '김철수 님' })).toBeInTheDocument()
    expect(screen.getByText('010-****-5678')).toBeInTheDocument()
    expect(screen.getByText('내 식권')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '개인정보 처리방침' })).toBeInTheDocument()
  })

  it('가족이 둘 이상이면 "우리 가족 식권 · N명"', () => {
    useFamilyTickets.mockReturnValue({ status: 'success', data: { ...empty, members: [{ id: 'p1', name: '김철수' }, { id: 'p2', name: '서연' }] }, refetch: () => {} })
    renderPage()
    expect(screen.getByText('우리 가족 식권 · 2명')).toBeInTheDocument()
  })

  it('오프라인이면 배지를 보여 준다', () => {
    useOnline.mockReturnValue(false)
    renderPage()
    expect(screen.getByText(/오프라인/)).toBeInTheDocument()
  })
})

describe('HomePage · 식권 구역', () => {
  it('불러오는 중 / 실패', () => {
    useFamilyTickets.mockReturnValue({ status: 'pending', refetch: () => {} })
    const { unmount } = renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    unmount()
    const refetch = vi.fn<() => void>()
    useFamilyTickets.mockReturnValue({ status: 'error', refetch })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('식권을 불러오지 못했어요')
  })

  it('오늘 식사가 없으면 안내 카드 + 다가오는 식권 + 접힌 지난 식권', async () => {
    useFamilyTickets.mockReturnValue({
      status: 'success', refetch: () => {},
      data: { ...empty, upcoming: [group('m2', '2026-10-18', 4, 0)], past: [group('m0', '2026-10-04', 2, 1)] },
    })
    renderPage()
    expect(screen.getByText('오늘은 식사가 없어요')).toBeInTheDocument()
    expect(screen.getByText('10월 18일 (주일) · 주일 점심')).toBeInTheDocument()
    expect(screen.getByText('4장')).toBeInTheDocument()
    const past = screen.getByText('지난 식권 1건')
    expect(screen.queryByText('미사용 1장')).not.toBeInTheDocument()
    await userEvent.click(past)
    expect(screen.getByText('미사용 1장')).toBeInTheDocument()
  })

  it('오늘 식사가 있으면 카드를 식사마다 그리고, 다음 식권 한 줄을 붙인다', () => {
    useFamilyTickets.mockReturnValue({
      status: 'success', refetch: () => {},
      data: { ...empty, today: [group('m1', '2026-10-12', 4, 1), { ...group('m3', '2026-10-12', 0, 0), meal: meal('m3', '2026-10-12', '저녁') }], upcoming: [group('m2', '2026-10-18', 4, 0)] },
    })
    renderPage()
    expect(screen.getByText('오늘카드:주일 점심')).toBeInTheDocument()
    expect(screen.getByText('오늘카드:저녁')).toBeInTheDocument()
    expect(screen.getByText('다음 · 10/18 주일 점심 · 4장')).toBeInTheDocument()
    expect(screen.queryByText('오늘은 식사가 없어요')).not.toBeInTheDocument()
  })
})

describe('HomePage · 로그아웃', () => {
  it('로그아웃 버튼이 signOut을 부르고 쿼리 캐시를 비운다', async () => {
    signOut.mockResolvedValue(undefined)
    const { client } = renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).toHaveBeenCalled()
    await waitFor(() => expect(client.getQueryData(['person', 'u1'])).toBeUndefined())
  })

  it('로그아웃 중에는 버튼을 잠가 두 번 호출되지 않는다', async () => {
    let settle: () => void = () => {}
    signOut.mockReturnValue(new Promise<void>((resolve) => { settle = resolve }))
    renderPage()
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledTimes(1)
    await act(async () => {
      settle()
    })
  })

  it('로그아웃이 실패하면 안내 문구를 보여 준다', async () => {
    signOut.mockRejectedValue(new Error('network'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
  })
})
```

- [x] **Step 5: 실패 확인**

Run: `npx vitest run src/features/tickets src/pages/HomePage.test.tsx`
Expected: 새 모듈 없음, HomePage 새 테스트 실패.

- [x] **Step 6: 구현 — `src/features/tickets/buildRows.ts`**

```ts
import { formatTime } from '../../lib/dates'
import type { Usage } from './groupTickets'
import type { Member } from './useFamilyTickets'

/** 사용된 장이 이 수 이상이면 "사용 완료 N장" 한 줄로 접는다 (설계 §8.2) */
export const FOLD_THRESHOLD = 3

export type TicketRow = { index: number; state: 'used' | 'open'; label?: string }

type Input = { issued: number; used: number; usages: readonly Usage[]; members: readonly Member[] }

function labelOf(usage: Usage, members: readonly Member[]): string {
  const time = formatTime(usage.used_at)
  if (usage.used_via === 'admin') return `${time} 담당자 처리`
  const name = members.find((m) => m.id === usage.person_id)?.name
  return name ? `${time} 사용 · ${name} 폰` : `${time} 사용`
}

/**
 * 발급 장수만큼 행을 만든다. 앞에서부터 used 장은 '사용 완료'(시각·누른 폰), 나머지는 누를 수 있는 장.
 * usages 는 시각 오름차순이라 i 번째 사용 기록이 i 번째 장에 붙는다. 기록이 아직 덜 읽혔으면 시각 없이 둔다.
 */
export function buildRows({ issued, used, usages, members }: Input): TicketRow[] {
  return Array.from({ length: issued }, (_, i) => {
    if (i < used) {
      const usage = usages[i]
      return { index: i + 1, state: 'used', label: usage ? labelOf(usage, members) : undefined }
    }
    return { index: i + 1, state: 'open' }
  })
}
```

- [x] **Step 7: 구현 — `src/features/tickets/TicketList.tsx`**

```tsx
import { useState, type KeyboardEvent } from 'react'
import { buildRows, FOLD_THRESHOLD, type TicketRow } from './buildRows'
import type { Usage } from './groupTickets'
import { HOLD_MS, useHold } from './useHold'
import type { Member } from './useFamilyTickets'

type Props = {
  issued: number
  used: number
  usages: readonly Usage[]
  members: readonly Member[]
  /** 지금 누를 수 있는가 (온라인 · 잔량 있음 · 처리 중 아님) */
  canUse: boolean
  pending: boolean
  onUse: () => void
}

/** 식권 한 장 = 좌우 꽉 찬 가로 막대. 아래로 쌓인다. */
export function TicketList({ issued, used, usages, members, canUse, pending, onUse }: Props) {
  const [expanded, setExpanded] = useState(false)
  const rows = buildRows({ issued, used, usages, members })
  const usedRows = rows.filter((r) => r.state === 'used')
  const openRows = rows.filter((r) => r.state === 'open')
  const fold = usedRows.length >= FOLD_THRESHOLD && !expanded

  return (
    <ul className="flex flex-col gap-2" aria-label="식권 목록">
      {fold ? (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-left text-sm text-gray-500"
          >
            사용 완료 {usedRows.length}장 펼치기
          </button>
        </li>
      ) : (
        usedRows.map((row) => <UsedRow key={row.index} row={row} total={issued} />)
      )}
      {openRows.map((row) => (
        <OpenRow key={row.index} row={row} total={issued} disabled={!canUse || pending} onUse={onUse} />
      ))}
    </ul>
  )
}

function UsedRow({ row, total }: { row: TicketRow; total: number }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-gray-500">
      <span aria-hidden className="text-xl">🎫</span>
      <div className="flex-1">
        <div className="text-sm font-bold">사용 완료</div>
        {row.label && <div className="text-xs">{row.label}</div>}
      </div>
      <span className="text-xs tabular-nums">{row.index} / {total}</span>
    </li>
  )
}

function OpenRow({ row, total, disabled, onUse }: { row: TicketRow; total: number; disabled: boolean; onUse: () => void }) {
  const { holding, handlers } = useHold({ onComplete: onUse, disabled })
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // 키보드·보조기기 사용자는 꾹 누를 수 없으므로 Enter/Space 로 바로 쓴다
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled) onUse()
    }
  }
  return (
    <li>
      <button
        type="button"
        aria-label={`식권 ${row.index}번 꾹 눌러 사용하기`}
        disabled={disabled}
        onKeyDown={onKeyDown}
        {...handlers}
        className="relative flex w-full touch-pan-y select-none items-center gap-3 overflow-hidden rounded-xl border-2 border-blue-600 bg-white px-4 py-4 text-left [-webkit-touch-callout:none] disabled:border-gray-300 disabled:text-gray-400"
      >
        {/* iOS 는 버튼 롱프레스에 contextmenu 를 내지 않고 콜아웃을 띄우므로 touch-callout 도 끈다 (Task 8 리뷰). */}
        {/* 왼쪽에서 차오르는 색. HOLD_MS 동안 꽉 차면 useHold 가 onUse 를 부른다 */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-blue-200"
          style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${HOLD_MS}ms linear` : 'none' }}
        />
        <span aria-hidden className="relative text-xl">🎫</span>
        <span className="relative flex-1 text-sm font-bold">{holding ? '누르는 중…' : '식권 1장'}</span>
        <span className="relative text-xs tabular-nums">{row.index} / {total}</span>
      </button>
    </li>
  )
}
```

- [x] **Step 8: 구현 — `src/features/tickets/TodayMealCard.tsx`**

```tsx
import { formatMealDate } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { Clock } from './Clock'
import type { TicketGroup, Usage } from './groupTickets'
import { TicketList } from './TicketList'
import type { Member } from './useFamilyTickets'
import { useUseTicket } from './useUseTicket'

type Props = { group: TicketGroup; usages: readonly Usage[]; members: readonly Member[]; online: boolean }

/** 오늘 식사 한 끼: 식사명·날짜·실시간 시계·남은 장수·식권 목록·사용 처리 상태 */
export function TodayMealCard({ group, usages, members, online }: Props) {
  const { meal, issued, used, remaining } = group
  const mutation = useUseTicket(meal.id)
  const mealUsages = usages.filter((u) => u.meal_id === meal.id)
  const canUse = online && remaining > 0 && !mutation.isPending

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby={`meal-${meal.id}`}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500">오늘 · {formatMealDate(meal.served_on)}</p>
          <h2 id={`meal-${meal.id}`} className="text-lg font-extrabold">{meal.title}</h2>
        </div>
        <div className="text-right">
          <Clock />
          <p className="text-sm font-bold text-blue-600">{remaining}장 남음</p>
        </div>
      </header>

      {issued === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">이 식사의 식권이 없어요</p>
      ) : (
        <>
          <TicketList issued={issued} used={used} usages={mealUsages} members={members} canUse={canUse} pending={mutation.isPending} onUse={() => mutation.mutate()} />
          {remaining > 0 && <p className="text-center text-xs text-gray-500">담당자가 식권을 꾹 눌러 주세요</p>}
        </>
      )}

      {mutation.isPending && <p role="status" className="text-center text-sm text-gray-600">처리 중…</p>}
      {mutation.isSuccess && !mutation.isPending && <p role="status" className="text-center text-sm font-bold text-green-700">사용 처리되었어요 ✓</p>}
      {mutation.isError && <p role="alert" className="text-center text-sm text-red-600">{toUserMessage(mutation.error)}</p>}
    </section>
  )
}
```

- [x] **Step 9: 구현 — `src/pages/HomePage.tsx` 재작성**

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Spinner } from '../components/ui'
import type { Person } from '../features/auth/usePerson'
import { signOut } from '../features/auth/signIn'
import type { TicketGroup } from '../features/tickets/groupTickets'
import { TodayMealCard } from '../features/tickets/TodayMealCard'
import { useFamilyTickets, type FamilyTickets } from '../features/tickets/useFamilyTickets'
import { useOnline } from '../features/tickets/useOnline'
import { formatMealDate, formatShortDate } from '../lib/dates'
import { toUserMessage } from '../lib/errors'
import { maskPhone } from '../lib/phone'

export function HomePage({ person }: { person: Person }) {
  const tickets = useFamilyTickets(person)
  const online = useOnline()

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-extrabold">{person.name} 님</h1>
          {/* data 가 아직 없을 때(처음 불러오는 중) "내 식권" 이 잠깐 떴다 가족 수로 바뀌는 깜빡임을 막는다 */}
          {tickets.data && (
            <p className="text-xs text-gray-500">
              {tickets.data.members.length > 1 ? `우리 가족 식권 · ${tickets.data.members.length}명` : '내 식권'}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-gray-600">
          <div>{maskPhone(person.phone)}</div>
          {!online && <div className="mt-1 rounded bg-gray-200 px-2 py-0.5 font-bold">오프라인 · 사용 처리 불가</div>}
        </div>
      </header>

      {/* 공통 규약: 조회 화면은 status 가 아니라 data 로 분기한다 — 폴링 한 번 실패에 목록이 통째로 사라지지 않게. */}
      {tickets.data ? (
        <>
          {tickets.status === 'error' && (
            <p role="status" className="text-center text-xs text-gray-500">최신 정보를 받지 못했어요. 다시 시도하는 중…</p>
          )}
          <Tickets data={tickets.data} online={online} />
        </>
      ) : tickets.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          식권을 불러오지 못했어요
          <button type="button" onClick={() => void tickets.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}

      <div className="flex-1" />
      <Footer />
    </main>
  )
}

function Tickets({ data, online }: { data: FamilyTickets; online: boolean }) {
  const next = data.upcoming[0]
  return (
    <>
      {data.today.length === 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-600">
          <div className="mb-2 text-3xl" aria-hidden>🍚</div>
          <p className="text-sm">오늘은 식사가 없어요</p>
        </section>
      ) : (
        data.today.map((group) => <TodayMealCard key={group.meal.id} group={group} usages={data.usages} members={data.members} online={online} />)
      )}

      {data.today.length > 0 && next && (
        <p className="text-center text-xs text-gray-500">다음 · {formatShortDate(next.meal.served_on)} {next.meal.title} · {next.remaining}장</p>
      )}
      {data.today.length === 0 && data.upcoming.length > 0 && <GroupList title="다가오는 식권" groups={data.upcoming} />}
      {data.past.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer text-gray-600">지난 식권 {data.past.length}건</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {data.past.map((g) => (
              <li key={g.meal.id} className="flex justify-between text-gray-600">
                <span>{formatShortDate(g.meal.served_on)} {g.meal.title}</span>
                <span>{g.remaining > 0 ? `미사용 ${g.remaining}장` : `${g.used}장 사용`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function GroupList({ title, groups }: { title: string; groups: TicketGroup[] }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-xs font-bold text-gray-500">{title}</h2>
      <ul className="flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.meal.id} className="flex items-center justify-between text-sm">
            <span>{formatMealDate(g.meal.served_on)} · {g.meal.title}</span>
            <span className="font-bold">{g.remaining}장</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Footer() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSignOut() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
      // 로그아웃 뒤 캐시(['person', uid] 등)가 gcTime 동안 남지 않도록 비운다 (공용 폰 대비).
      queryClient.clear()
      // 성공하면 Gate 가 시작 화면으로 바꾼다. 그 사이 두 번째 로그아웃이 나가지 않게 잠근 채 둔다.
    } catch (err) {
      setError(toUserMessage(err))
      setBusy(false)
    }
  }

  return (
    <footer className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-4">
        <Link to="/privacy" className="px-3 py-2 text-xs text-gray-600 underline">개인정보 처리방침</Link>
        <button type="button" onClick={() => void onSignOut()} disabled={busy} className="px-3 py-2 text-xs text-gray-600 underline">
          로그아웃
        </button>
      </div>
      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
    </footer>
  )
}
```

- [x] **Step 10: 통과 확인 + 눈으로 확인**

Run: `npx vitest run src/features/tickets src/pages && npm run lint && npx tsc -b --noEmit`
Expected: 통과.

브라우저 확인(`npm run dev`, 개발 로그인 후): 로컬 Studio(`http://127.0.0.1:54323`) 의 SQL 편집기에서 아래를 실행해 오늘 식사와 발급을 만든 뒤 홈을 본다. 식권 4장이 세로로 쌓이고, 한 장을 600ms 누르면 회색 "사용 완료" 로 바뀌고 "3장 남음" 이 되어야 한다. 짧게 탭하면 아무 일도 없어야 한다.

```sql
-- <본인 이메일> 은 개발 로그인에 쓴 주소
with me as (select id, family_id from public.people where auth_user_id = (select id from auth.users where email = '<본인 이메일>')),
     m as (insert into public.meals (title, served_on, created_by) values ('주일 점심', (now() at time zone 'Asia/Seoul')::date, (select id from me)) on conflict do nothing returning id)
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
select me.id, me.family_id, coalesce((select id from m), (select id from public.meals where served_on = (now() at time zone 'Asia/Seoul')::date limit 1)), 4, 5000, me.id from me;
```

- [x] **Step 11: 커밋**

```bash
git add src/features/tickets/buildRows.ts src/features/tickets/buildRows.test.ts src/features/tickets/TicketList.tsx src/features/tickets/TicketList.test.tsx src/features/tickets/TodayMealCard.tsx src/features/tickets/TodayMealCard.test.tsx src/pages/HomePage.tsx src/pages/HomePage.test.tsx
git commit -m "feat: 홈 식권 목록 — 세로 낱장, 사용분 회색·접기, 600ms 꾹 눌러 사용

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 내역 화면 (`#/history`) + 라우트 연결

**Files:**
- Create: `src/features/history/mergeLedger.ts`, `src/features/history/mergeLedger.test.ts`
- Create: `src/features/history/useFamilyLedger.ts`, `src/features/history/useFamilyLedger.test.tsx`
- Create: `src/pages/HistoryPage.tsx`, `src/pages/HistoryPage.test.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: 실패하는 테스트 — `src/features/history/mergeLedger.test.ts`**

```ts
import { mergeLedger, type IssuanceRow, type UsageRow } from './mergeLedger'

const meal = { title: '주일 점심', served_on: '2026-10-12' }
const issuance: IssuanceRow = {
  id: 'i1', issued_at: '2026-10-08T01:00:00Z', quantity: 4, unit_price: 5000, memo: '입금 확인', cancelled_at: null,
  meal, buyer: { name: '김철수' }, issuer: { name: '권사' },
}
const usage: UsageRow = { id: 'u1', used_at: '2026-10-12T03:31:00Z', used_via: 'self', voided_at: null, meal, person: { name: '김철수' } }

describe('mergeLedger', () => {
  it('발급과 사용을 합쳐 최근 순으로 늘어놓는다', () => {
    const entries = mergeLedger([issuance], [usage])
    expect(entries.map((e) => e.kind)).toEqual(['usage', 'issuance'])
    expect(entries[1]).toMatchObject({ kind: 'issuance', amount: 20000, quantity: 4, buyer: '김철수', issuer: '권사', mealTitle: '주일 점심', servedOn: '2026-10-12', memo: '입금 확인', cancelled: false })
    expect(entries[0]).toMatchObject({ kind: 'usage', person: '김철수', via: 'self', voided: false })
  })

  it('이름이 안 보이면(RLS 로 가려진 관리자 등) 자리를 비우지 않고 기본 문구', () => {
    const entries = mergeLedger([{ ...issuance, issuer: null, buyer: null }], [{ ...usage, person: null, meal: null }])
    expect(entries[1]).toMatchObject({ issuer: '관리자', buyer: '' })
    expect(entries[0]).toMatchObject({ person: '', mealTitle: '(삭제된 식사)', servedOn: '' })
  })

  it('취소·무효 표시를 옮긴다', () => {
    const entries = mergeLedger([{ ...issuance, cancelled_at: '2026-10-09T00:00:00Z' }], [{ ...usage, voided_at: '2026-10-12T04:00:00Z' }])
    expect(entries[1]).toMatchObject({ cancelled: true })
    expect(entries[0]).toMatchObject({ voided: true })
  })
})
```

- [x] **Step 2: 실패하는 테스트 — `src/features/history/useFamilyLedger.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Person } from '../auth/usePerson'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { useFamilyLedger } from './useFamilyLedger'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useFamilyLedger', () => {
  it('발급·사용을 가족으로 좁혀 최근 순으로 읽고 합친다', async () => {
    const queries: FakeQuery<unknown>[] = []
    from.mockImplementation((table: string) => {
      const q = table === 'issuances'
        ? ok([{ id: 'i1', issued_at: '2026-10-08T01:00:00Z', quantity: 4, unit_price: 5000, memo: null, cancelled_at: null, meal: { title: '주일 점심', served_on: '2026-10-12' }, buyer: { name: '김철수' }, issuer: null }])
        : ok([{ id: 'u1', used_at: '2026-10-12T03:31:00Z', used_via: 'self', voided_at: null, meal: { title: '주일 점심', served_on: '2026-10-12' }, person: { name: '김철수' } }])
      queries.push(q)
      return q
    })
    const { result } = renderHook(() => useFamilyLedger(person), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data?.map((e) => e.kind)).toEqual(['usage', 'issuance'])
    for (const q of queries) {
      expect(q.has('eq', 'family_id', 'f1')).toBe(true)
      expect(q.has('limit', 100)).toBe(true)
    }
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/pages/HistoryPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { LedgerEntry } from '../features/history/mergeLedger'
import { HistoryPage } from './HistoryPage'

const { useFamilyLedger } = vi.hoisted(() => ({
  useFamilyLedger: vi.fn<() => { status: 'pending' | 'error' | 'success'; data?: LedgerEntry[] }>(),
}))
vi.mock('../features/history/useFamilyLedger', () => ({ useFamilyLedger }))
vi.mock('../features/auth/usePerson', () => ({ useCurrentPerson: () => ({ id: 'p1', family_id: 'f1', name: '김철수' }) }))

const entries: LedgerEntry[] = [
  { kind: 'usage', id: 'u1', at: '2026-10-12T03:31:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', person: '서연', via: 'self', voided: false },
  { kind: 'usage', id: 'u2', at: '2026-10-12T03:30:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', person: '', via: 'admin', voided: true },
  { kind: 'issuance', id: 'i1', at: '2026-10-08T01:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-12', quantity: 4, amount: 20000, buyer: '김철수', issuer: '권사', memo: '입금 확인', cancelled: false },
  { kind: 'issuance', id: 'i2', at: '2026-10-01T01:00:00Z', mealTitle: '주일 점심', servedOn: '2026-10-05', quantity: 1, amount: 0, buyer: '김철수', issuer: '관리자', memo: '9/28 이월', cancelled: true },
]

describe('HistoryPage', () => {
  it('발급과 사용을 시간 역순으로 보여 준다', () => {
    useFamilyLedger.mockReturnValue({ status: 'success', data: entries })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '내역' })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('사용 1장 · 서연 폰')
    expect(items[0]).toHaveTextContent('10/12 12:31 · 주일 점심')
    expect(items[1]).toHaveTextContent('담당자 처리')
    expect(items[1]).toHaveTextContent('무효')
    expect(items[2]).toHaveTextContent('발급 4장 · 20,000원')
    expect(items[2]).toHaveTextContent('10/8 10:00 · 10/12 주일 점심 · 권사 · 입금 확인')
    expect(items[3]).toHaveTextContent('취소됨')
  })

  it('비어 있으면 안내', () => {
    useFamilyLedger.mockReturnValue({ status: 'success', data: [] })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByText('아직 내역이 없어요')).toBeInTheDocument()
  })

  it('불러오는 중 / 실패', () => {
    useFamilyLedger.mockReturnValue({ status: 'pending' })
    const { unmount } = render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()
    useFamilyLedger.mockReturnValue({ status: 'error' })
    render(<MemoryRouter><HistoryPage /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('내역을 불러오지 못했어요')
  })
})
```

- [x] **Step 4: 실패 확인**

Run: `npx vitest run src/features/history src/pages/HistoryPage.test.tsx`
Expected: "Cannot find module".

- [x] **Step 5: 구현 — `src/features/history/mergeLedger.ts`**

```ts
type MealRef = { title: string; served_on: string } | null
type NameRef = { name: string } | null

/** issuances 에 meals·people 을 임베딩한 행 (select 문자열은 useFamilyLedger 참고) */
export type IssuanceRow = {
  id: string
  issued_at: string
  quantity: number
  unit_price: number
  memo: string | null
  cancelled_at: string | null
  meal: MealRef
  buyer: NameRef
  issuer: NameRef
}
export type UsageRow = {
  id: string
  used_at: string
  used_via: 'self' | 'admin'
  voided_at: string | null
  meal: MealRef
  person: NameRef
}

export type IssuanceEntry = {
  kind: 'issuance'; id: string; at: string; mealTitle: string; servedOn: string
  quantity: number; amount: number; buyer: string; issuer: string; memo: string | null; cancelled: boolean
}
export type UsageEntry = {
  kind: 'usage'; id: string; at: string; mealTitle: string; servedOn: string
  person: string; via: 'self' | 'admin'; voided: boolean
}
export type LedgerEntry = IssuanceEntry | UsageEntry

const DELETED_MEAL = '(삭제된 식사)'

// 교인은 같은 가족만 볼 수 있어, 발급한 관리자 이름은 RLS 에 가려 null 로 온다 → '관리자'
function mealOf(meal: MealRef) {
  return { mealTitle: meal?.title ?? DELETED_MEAL, servedOn: meal?.served_on ?? '' }
}

/** 발급·사용 장부를 하나의 목록으로 합쳐 최근 것부터 */
export function mergeLedger(issuances: readonly IssuanceRow[], usages: readonly UsageRow[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    ...issuances.map((i): IssuanceEntry => ({
      kind: 'issuance', id: i.id, at: i.issued_at, ...mealOf(i.meal),
      quantity: i.quantity, amount: i.quantity * i.unit_price,
      buyer: i.buyer?.name ?? '', issuer: i.issuer?.name ?? '관리자', memo: i.memo, cancelled: i.cancelled_at !== null,
    })),
    ...usages.map((u): UsageEntry => ({
      kind: 'usage', id: u.id, at: u.used_at, ...mealOf(u.meal),
      person: u.person?.name ?? '', via: u.used_via, voided: u.voided_at !== null,
    })),
  ]
  return entries.sort((a, b) => b.at.localeCompare(a.at))
}
```

- [x] **Step 6: 구현 — `src/features/history/useFamilyLedger.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'
import { mergeLedger, type IssuanceRow, type UsageRow } from './mergeLedger'

const LIMIT = 100

// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다. 제약 이름은 Postgres 기본 규칙(<표>_<열>_fkey).
const ISSUANCE_SELECT =
  'id, issued_at, quantity, unit_price, memo, cancelled_at, meal:meals(title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, used_at, used_via, voided_at, meal:meals(title, served_on), person:people!usages_person_id_fkey(name)'

/** 우리 가족의 발급·사용 내역 (최근 100건씩). 관리자도 이 화면에선 자기 가족만 보도록 family_id 로 좁힌다. */
export function useFamilyLedger(person: Person) {
  return useQuery({
    queryKey: ['ledger', person.family_id],
    queryFn: async () => {
      const [issuances, usages] = await Promise.all([
        supabase.from('issuances').select(ISSUANCE_SELECT).eq('family_id', person.family_id).order('issued_at', { ascending: false }).limit(LIMIT).then(unwrap),
        supabase.from('usages').select(USAGE_SELECT).eq('family_id', person.family_id).order('used_at', { ascending: false }).limit(LIMIT).then(unwrap),
      ])
      return mergeLedger(issuances as IssuanceRow[], usages as UsageRow[])
    },
  })
}
```

> `as IssuanceRow[]` 캐스트는 supabase-js 가 추론한 임베딩 타입을 우리 행 타입으로 좁히는 용도다. 추론 타입이 이미 맞으면 캐스트를 지운다(tsc 가 알려 준다).

- [x] **Step 7: 구현 — `src/pages/HistoryPage.tsx`**

```tsx
import { Spinner } from '../components/ui'
import { useCurrentPerson } from '../features/auth/usePerson'
import type { LedgerEntry } from '../features/history/mergeLedger'
import { useFamilyLedger } from '../features/history/useFamilyLedger'
import { formatDateTime, formatShortDate } from '../lib/dates'
import { formatWon } from '../lib/money'

export function HistoryPage() {
  const person = useCurrentPerson()
  const ledger = useFamilyLedger(person)

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <h1 className="text-lg font-extrabold">내역</h1>
      {/* status 가 아니라 data 로 분기한다 — 포커스 복귀 재조회가 실패해도 보던 목록이 사라지지 않게 (공통 규약) */}
      {ledger.data ? (
        ledger.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">아직 내역이 없어요</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ledger.data.map((entry) => <Entry key={`${entry.kind}-${entry.id}`} entry={entry} />)}
          </ul>
        )
      ) : ledger.status === 'error' ? (
        <p role="alert" className="text-center text-sm text-red-600">내역을 불러오지 못했어요</p>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function Entry({ entry }: { entry: LedgerEntry }) {
  const struck = entry.kind === 'issuance' ? entry.cancelled : entry.voided
  const servedOn = entry.servedOn ? `${formatShortDate(entry.servedOn)} ` : ''
  return (
    <li className={`rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm ${struck ? 'text-gray-400' : ''}`}>
      {entry.kind === 'issuance' ? (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>발급 {entry.quantity}장 · {formatWon(entry.amount)}</div>
          <div className="text-xs">
            {formatDateTime(entry.at)} · {servedOn}{entry.mealTitle} · {entry.issuer}{entry.memo ? ` · ${entry.memo}` : ''}
          </div>
          {entry.cancelled && <div className="text-xs font-bold">취소됨</div>}
        </>
      ) : (
        <>
          <div className={`font-bold ${struck ? 'line-through' : ''}`}>
            사용 1장 · {entry.via === 'admin' ? '담당자 처리' : `${entry.person} 폰`}
          </div>
          <div className="text-xs">{formatDateTime(entry.at)} · {entry.mealTitle}</div>
          {entry.voided && <div className="text-xs font-bold">무효</div>}
        </>
      )}
    </li>
  )
}
```

- [x] **Step 8: 라우트 — `src/App.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './features/auth/AuthProvider'
import { Gate, RequirePerson, RequireSession } from './features/auth/Gate'
import { OnboardingPage } from './features/onboarding/OnboardingPage'
import { HistoryPage } from './pages/HistoryPage'
import { PrivacyPage } from './pages/PrivacyPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 },
    // 가입·발권 같은 쓰기는 자동 재시도하면 중복될 수 있다. 재시도는 사용자가 결정한다.
    mutations: { retry: 0 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Gate />} />
            <Route path="/onboarding" element={<RequireSession><OnboardingPage /></RequireSession>} />
            <Route path="/privacy" element={<PrivacyPage />} />
            {/* 가입을 마친 사람만. 하단 탭이 붙는다. 관리자 화면은 Task 11·12 에서 이 아래에 추가한다. */}
            <Route element={<RequirePerson />}>
              <Route path="/history" element={<HistoryPage />} />
            </Route>
            {/* 모르는 주소는 홈 주소로 정리한다 (Gate 를 그대로 띄우면 주소가 그대로 남는다). */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
```

- [x] **Step 9: 통과 확인**

Run: `npx vitest run && npm run lint && npx tsc -b --noEmit`
Expected: 전부 통과. 브라우저에서 홈 하단 탭 "내역" 을 누르면 Task 9 에서 만든 발급·사용이 보인다.

- [x] **Step 10: 커밋**

```bash
git add src/features/history src/pages/HistoryPage.tsx src/pages/HistoryPage.test.tsx src/App.tsx
git commit -m "feat: 내역 화면 — 가족 발급·사용 시간 역순

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 관리자 식사 화면 (`#/admin/meals`)

**Files:**
- Modify: `src/lib/dates.ts`, `src/lib/dates.test.ts` (`addDays` 추가)
- Create: `src/features/admin/nextSundayLunch.ts`, `src/features/admin/nextSundayLunch.test.ts`
- Create: `src/features/admin/summarizeByMeal.ts`, `src/features/admin/summarizeByMeal.test.ts`
- Create: `src/features/admin/mealSchema.ts`, `src/features/admin/mealSchema.test.ts`
- Create: `src/features/admin/useMeals.ts`, `src/features/admin/useMeals.test.tsx`
- Create: `src/features/admin/MealForm.tsx`, `src/features/admin/MealForm.test.tsx`
- Create: `src/pages/admin/AdminMealsPage.tsx`, `src/pages/admin/AdminMealsPage.test.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: 실패하는 테스트 — 순수 함수 셋**

`src/lib/dates.test.ts` 에 추가:

```ts
import { addDays } from './dates'

describe('addDays', () => {
  it('날짜 문자열에 날수를 더한다 (월·연 넘김 포함)', () => {
    expect(addDays('2026-10-12', -1)).toBe('2026-10-11')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
```

`src/features/admin/nextSundayLunch.test.ts`:

```ts
import { nextSundayLunchDate, SUNDAY_LUNCH_TITLE } from './nextSundayLunch'

const meal = (served_on: string, title = SUNDAY_LUNCH_TITLE) => ({ id: served_on + title, title, served_on, note: null, created_by: null, created_at: '' })

describe('nextSundayLunchDate (DB create_next_sunday_lunch 와 같은 규칙)', () => {
  it('가장 늦은 주일 점심 다음 일요일', () => {
    expect(nextSundayLunchDate([meal('2026-10-11'), meal('2026-10-04')], '2026-10-08')).toBe('2026-10-18')
  })
  it('주일 점심이 없거나 과거면 오늘 이후 첫 일요일 (오늘이 일요일이면 오늘)', () => {
    expect(nextSundayLunchDate([], '2026-10-08')).toBe('2026-10-11')
    expect(nextSundayLunchDate([meal('2026-09-06')], '2026-12-06')).toBe('2026-12-06')
    expect(nextSundayLunchDate([meal('2026-09-06')], '2026-12-07')).toBe('2026-12-13')
  })
  it('다른 제목의 식사는 기준이 아니다', () => {
    expect(nextSundayLunchDate([meal('2026-10-18', '추수감사 점심')], '2026-10-08')).toBe('2026-10-11')
  })
})
```

`src/features/admin/summarizeByMeal.test.ts`:

```ts
import { summarizeByMeal } from './summarizeByMeal'

describe('summarizeByMeal', () => {
  it('식사별로 발급·사용·금액을 더하고 가족 수를 센다', () => {
    const s = summarizeByMeal([
      { family_id: 'f1', meal_id: 'm1', issued: 4, used: 2, remaining: 2, amount: 20000 },
      { family_id: 'f2', meal_id: 'm1', issued: 2, used: 0, remaining: 2, amount: 10000 },
      { family_id: 'f1', meal_id: 'm2', issued: 1, used: 0, remaining: 1, amount: 0 },
      { family_id: null, meal_id: null, issued: null, used: null, remaining: null, amount: null },
    ])
    expect(s.get('m1')).toEqual({ issued: 6, used: 2, amount: 30000, families: 2 })
    expect(s.get('m2')).toEqual({ issued: 1, used: 0, amount: 0, families: 1 })
    expect(s.size).toBe(2)
  })
})
```

`src/features/admin/mealSchema.test.ts`:

```ts
import { validateMeal } from './mealSchema'

describe('validateMeal', () => {
  it('제목 공백 정리, 날짜 형식, 비고 선택', () => {
    expect(validateMeal({ title: ' 추수감사 점심 ', served_on: '2026-11-15', note: '' })).toEqual({
      ok: true, values: { title: '추수감사 점심', served_on: '2026-11-15', note: null },
    })
  })
  it('오류를 칸별로 돌려준다', () => {
    const r = validateMeal({ title: '', served_on: '2026/11/15', note: '가'.repeat(101) })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.title).toBe('식사 이름을 적어 주세요')
      expect(r.errors.served_on).toBe('날짜를 골라 주세요')
      expect(r.errors.note).toBe('비고는 100자까지예요')
    }
    const long = validateMeal({ title: '가'.repeat(31), served_on: '2026-11-15', note: '' })
    expect(!long.ok && long.errors.title).toBe('식사 이름은 30자까지예요')
  })
})
```

- [x] **Step 2: 실패하는 테스트 — `src/features/admin/useMeals.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { useAddMeal, useAdminBalances, useCreateNextSundayLunch, useDeleteMeal, useMeals } from './useMeals'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => unknown>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-12', note: null, created_by: 'a', created_at: '' }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('useMeals / useAdminBalances', () => {
  it('식사는 날짜 내림차순, 잔량은 전체(관리자)', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = table === 'meals' ? ok([meal]) : ok([])))
    const { wrapper } = makeWrapper()
    const meals = renderHook(() => useMeals(), { wrapper })
    const balances = renderHook(() => useAdminBalances(), { wrapper })
    await waitFor(() => expect(meals.result.current.status).toBe('success'))
    await waitFor(() => expect(balances.result.current.status).toBe('success'))
    expect(meals.result.current.data).toEqual([meal])
    expect(queries.meals!.has('order', 'served_on', { ascending: false })).toBe(true)
    expect(queries.ticket_balances!.has('select', '*')).toBe(true)
  })
})

describe('mutations', () => {
  it('다음 주일 점심: rpc 호출 후 식사 캐시 무효화', async () => {
    rpc.mockReturnValue(ok(meal))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCreateNextSundayLunch(), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(rpc).toHaveBeenCalledWith('create_next_sunday_lunch')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meals'] })
  })

  it('직접 추가: insert 후 single, 무효화', async () => {
    const q = ok(meal)
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useAddMeal(), { wrapper })
    await act(() => result.current.mutateAsync({ title: '주일 점심', served_on: '2026-10-12', note: null }))
    expect(q.has('insert', { title: '주일 점심', served_on: '2026-10-12', note: null })).toBe(true)
    expect(q.has('single')).toBe(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meals'] })
  })

  it('삭제: id 로 delete, 식사·잔량 캐시 무효화', async () => {
    const q = ok(null)
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useDeleteMeal(), { wrapper })
    await act(() => result.current.mutateAsync('m1'))
    expect(q.has('delete')).toBe(true)
    expect(q.has('eq', 'id', 'm1')).toBe(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meals'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-balances'] })
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/features/admin/MealForm.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MealForm } from './MealForm'

describe('MealForm', () => {
  it('날짜 기본값은 오늘이고, 검증을 통과하면 정리된 값으로 onSubmit', async () => {
    const onSubmit = vi.fn<(v: { title: string; served_on: string; note: string | null }) => void>()
    render(<MealForm today="2026-10-08" pending={false} onSubmit={onSubmit} onCancel={() => {}} />)
    expect(screen.getByLabelText('날짜')).toHaveValue('2026-10-08')
    await userEvent.type(screen.getByLabelText('식사 이름'), ' 추수감사 점심 ')
    await userEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    expect(onSubmit).toHaveBeenCalledWith({ title: '추수감사 점심', served_on: '2026-10-08', note: null })
  })

  it('비어 있으면 오류를 보여 주고 제출하지 않는다', async () => {
    const onSubmit = vi.fn<() => void>()
    render(<MealForm today="2026-10-08" pending={false} onSubmit={onSubmit} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    expect(screen.getByText('식사 이름을 적어 주세요')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('처리 중이면 버튼이 잠긴다 · 취소 버튼', async () => {
    const onCancel = vi.fn<() => void>()
    render(<MealForm today="2026-10-08" pending onSubmit={() => {}} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: '추가 중…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [x] **Step 4: 실패하는 테스트 — `src/pages/admin/AdminMealsPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AdminMealsPage } from './AdminMealsPage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T }
type M = { mutate: (...args: never[]) => void; mutateAsync: (...args: never[]) => Promise<unknown>; isPending: boolean; isError: boolean; error: unknown; reset: () => void }
const { useMeals, useAdminBalances, useCreateNextSundayLunch, useAddMeal, useDeleteMeal } = vi.hoisted(() => ({
  useMeals: vi.fn<() => Q<unknown[]>>(),
  useAdminBalances: vi.fn<() => Q<unknown[]>>(),
  useCreateNextSundayLunch: vi.fn<() => M>(),
  useAddMeal: vi.fn<() => M>(),
  useDeleteMeal: vi.fn<() => M>(),
}))
vi.mock('../../features/admin/useMeals', () => ({ useMeals, useAdminBalances, useCreateNextSundayLunch, useAddMeal, useDeleteMeal }))
vi.mock('../../lib/dates', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/dates')>()), todaySeoul: () => '2026-10-08' }))

const idle = (): M => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null, reset: () => {} })
const meal = (id: string, served_on: string, title = '주일 점심') => ({ id, title, served_on, note: null, created_by: 'a', created_at: '' })

beforeEach(() => {
  useMeals.mockReturnValue({ status: 'success', data: [meal('m-past', '2026-10-04'), meal('m1', '2026-10-11'), meal('m2', '2026-10-18')] })
  useAdminBalances.mockReturnValue({ status: 'success', data: [
    { family_id: 'f1', meal_id: 'm1', issued: 4, used: 2, remaining: 2, amount: 20000 },
    { family_id: 'f2', meal_id: 'm1', issued: 2, used: 0, remaining: 2, amount: 10000 },
  ] })
  useCreateNextSundayLunch.mockReturnValue(idle())
  useAddMeal.mockReturnValue(idle())
  useDeleteMeal.mockReturnValue(idle())
})

function renderPage() {
  return render(<MemoryRouter><AdminMealsPage /></MemoryRouter>)
}

describe('AdminMealsPage', () => {
  it('관리자 배지, 다음 주일 점심 버튼에 날짜, 다가오는/지난 구분', () => {
    renderPage()
    expect(screen.getByText('관리자')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 다음 주일 점심 만들기 (10/25)' })).toBeInTheDocument()
    const upcoming = screen.getByRole('region', { name: '다가오는 식사' })
    expect(upcoming).toHaveTextContent('10월 11일 (주일)')
    expect(upcoming).toHaveTextContent('10월 18일 (주일)')
    expect(screen.getByText('지난 식사 1건')).toBeInTheDocument()
  })

  it('카드에 발급·가족·금액·사용률을 보여 주고, 발급 없는 식사만 지울 수 있다', async () => {
    const del = idle()
    useDeleteMeal.mockReturnValue(del)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    const card = screen.getByRole('article', { name: /10월 11일/ })
    expect(card).toHaveTextContent('발급 6장 · 가족 2 · 30,000원')
    expect(card).toHaveTextContent('사용 2 / 6')
    expect(card.querySelector('button')).toBeNull()

    const empty = screen.getByRole('article', { name: /10월 18일/ })
    await userEvent.click(empty.querySelector('button')!)
    expect(window.confirm).toHaveBeenCalled()
    expect(del.mutate).toHaveBeenCalledWith('m2')
  })

  it('다음 주일 점심 버튼은 rpc mutate, 직접 추가는 폼을 열어 add mutate', async () => {
    const next = idle()
    const add = idle()
    useCreateNextSundayLunch.mockReturnValue(next)
    useAddMeal.mockReturnValue(add)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /다음 주일 점심 만들기/ }))
    expect(next.mutate).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '+ 식사 직접 추가' }))
    await userEvent.type(screen.getByLabelText('식사 이름'), '추수감사 점심')
    await userEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    expect(add.mutate).toHaveBeenCalledWith({ title: '추수감사 점심', served_on: '2026-10-08', note: null }, expect.anything())
  })

  it('중복 식사(23505)·발급 있는 식사 삭제(23503) 오류를 문구로', () => {
    useAddMeal.mockReturnValue({ ...idle(), isError: true, error: { code: '23505', message: 'duplicate key' } })
    useDeleteMeal.mockReturnValue({ ...idle(), isError: true, error: { code: '23503', message: 'violates foreign key' } })
    renderPage()
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(expect.arrayContaining(['같은 값이 이미 있어요.', '연결된 기록이 있어 지울 수 없어요.']))
  })
})
```

- [x] **Step 5: 실패 확인**

Run: `npx vitest run src/lib/dates.test.ts src/features/admin src/pages/admin`
Expected: `addDays` 없음, 나머지 "Cannot find module".

- [x] **Step 6: 구현 — `src/lib/dates.ts` 에 추가**

```ts
/** 'YYYY-MM-DD' 에 날수를 더한다 (UTC 산술이라 시간대·서머타임 영향 없음) */
export function addDays(ymdText: string, days: number): string {
  const [y, m, d] = parts(ymdText)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
```

- [x] **Step 7: 구현 — 순수 함수 셋**

```ts
// src/features/admin/nextSundayLunch.ts
import { addDays, nextSundayAfter } from '../../lib/dates'
import type { Meal } from '../tickets/groupTickets'

/** 주일 점심의 고정 제목. DB create_next_sunday_lunch 의 리터럴과 같아야 한다. */
export const SUNDAY_LUNCH_TITLE = '주일 점심'

/** 버튼에 미리 보여 줄 "다음 주일 점심" 날짜. 기준일 = max(가장 늦은 주일 점심, 어제), 그 다음 일요일. */
export function nextSundayLunchDate(meals: readonly Pick<Meal, 'title' | 'served_on'>[], today: string): string {
  const yesterday = addDays(today, -1)
  const latest = meals.filter((m) => m.title === SUNDAY_LUNCH_TITLE).map((m) => m.served_on).sort().at(-1)
  const base = latest && latest > yesterday ? latest : yesterday
  return nextSundayAfter(base)
}
```

```ts
// src/features/admin/summarizeByMeal.ts
import type { Balance } from '../tickets/groupTickets'

export type MealSummary = { issued: number; used: number; amount: number; families: number }

/** 관리자 식사 카드용: 모든 가족의 잔량 행을 식사별로 합친다 */
export function summarizeByMeal(balances: readonly Balance[]): Map<string, MealSummary> {
  const out = new Map<string, MealSummary>()
  for (const b of balances) {
    if (!b.meal_id) continue
    const s = out.get(b.meal_id) ?? { issued: 0, used: 0, amount: 0, families: 0 }
    out.set(b.meal_id, {
      issued: s.issued + (b.issued ?? 0),
      used: s.used + (b.used ?? 0),
      amount: s.amount + (b.amount ?? 0),
      families: s.families + 1,
    })
  }
  return out
}
```

```ts
// src/features/admin/mealSchema.ts
import { z } from 'zod'

const schema = z.object({
  title: z.string().trim().min(1, '식사 이름을 적어 주세요').max(30, '식사 이름은 30자까지예요'),
  served_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜를 골라 주세요'),
  note: z.string().trim().max(100, '비고는 100자까지예요'),
})

export type MealInput = { title: string; served_on: string; note: string }
export type MealValues = { title: string; served_on: string; note: string | null }
export type MealErrors = Partial<Record<keyof MealInput, string>>

export function validateMeal(input: MealInput): { ok: true; values: MealValues } | { ok: false; errors: MealErrors } {
  const result = schema.safeParse(input)
  if (!result.success) {
    const errors: MealErrors = {}
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof MealInput
      errors[key] ??= issue.message
    }
    return { ok: false, errors }
  }
  const { title, served_on, note } = result.data
  return { ok: true, values: { title, served_on, note: note || null } }
}
```

- [x] **Step 8: 구현 — `src/features/admin/useMeals.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { MealValues } from './mealSchema'

export const mealsQueryKey = ['meals'] as const
export const adminBalancesQueryKey = ['admin-balances'] as const

/** 모든 식사, 최근 날짜부터 (교인도 읽을 수 있지만 쓰는 곳은 관리자 화면·발급 화면) */
export function useMeals() {
  return useQuery({
    queryKey: mealsQueryKey,
    queryFn: () => supabase.from('meals').select('*').order('served_on', { ascending: false }).then(unwrap),
  })
}

/** 관리자가 보는 모든 가족의 잔량 (RLS 가 관리자에게 전부 연다) */
export function useAdminBalances() {
  return useQuery({
    queryKey: adminBalancesQueryKey,
    queryFn: () => supabase.from('ticket_balances').select('*').then(unwrap),
  })
}

export function useCreateNextSundayLunch() {
  const queryClient = useQueryClient()
  return useMutation({
    // 이 RPC 는 순차 재호출마다 "다음" 일요일을 만든다(동시 클릭만 수렴). 자동 재시도 금지 — App 의 mutations.retry=0 을 바꾸지 말 것.
    mutationFn: () => supabase.rpc('create_next_sunday_lunch').then(unwrap),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mealsQueryKey }),
  })
}

export function useAddMeal() {
  const queryClient = useQueryClient()
  return useMutation({
    // created_by 는 DB 기본값(현재 관리자). 열 권한에도 없으니 보내지 않는다.
    mutationFn: (values: MealValues) => supabase.from('meals').insert(values).select().single().then(unwrap),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mealsQueryKey }),
  })
}

export function useDeleteMeal() {
  const queryClient = useQueryClient()
  return useMutation({
    // 발급이 있으면 FK 가 23503 으로 막는다 → toUserMessage 가 문구로 바꾼다
    mutationFn: (id: string) => supabase.from('meals').delete().eq('id', id).then(unwrap),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mealsQueryKey })
      await queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey })
    },
  })
}
```

- [x] **Step 9: 구현 — `src/features/admin/MealForm.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Button, TextField } from '../../components/ui'
import { validateMeal, type MealErrors, type MealValues } from './mealSchema'

type Props = { today: string; pending: boolean; onSubmit: (values: MealValues) => void; onCancel: () => void }

/** 식사 직접 추가 (제목·날짜·비고). 주일 점심은 버튼으로 만들고, 이 폼은 특별 식사용이다. */
export function MealForm({ today, pending, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [servedOn, setServedOn] = useState(today)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<MealErrors>({})

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateMeal({ title, served_on: servedOn, note })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onSubmit(result.values)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <TextField label="식사 이름" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={30} placeholder="예: 추수감사 점심" error={errors.title} />
      <TextField label="날짜" name="served_on" type="date" value={servedOn} onChange={(e) => setServedOn(e.target.value)} error={errors.served_on} />
      <TextField label="비고 (선택)" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} error={errors.note} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>취소</Button>
        <Button type="submit" disabled={pending}>{pending ? '추가 중…' : '식사 추가'}</Button>
      </div>
    </form>
  )
}
```

- [x] **Step 10: 구현 — `src/pages/admin/AdminMealsPage.tsx`**

```tsx
import { useState } from 'react'
import { Button, Spinner } from '../../components/ui'
import { MealForm } from '../../features/admin/MealForm'
import { nextSundayLunchDate } from '../../features/admin/nextSundayLunch'
import { summarizeByMeal, type MealSummary } from '../../features/admin/summarizeByMeal'
import { useAddMeal, useAdminBalances, useCreateNextSundayLunch, useDeleteMeal, useMeals } from '../../features/admin/useMeals'
import type { Meal } from '../../features/tickets/groupTickets'
import { formatMealDate, formatShortDate, todaySeoul } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { formatWon } from '../../lib/money'

export function AdminMealsPage() {
  const today = todaySeoul()
  const meals = useMeals()
  const balances = useAdminBalances()
  const createNext = useCreateNextSundayLunch()
  const addMeal = useAddMeal()
  const deleteMeal = useDeleteMeal()
  const [adding, setAdding] = useState(false)

  const list = meals.data ?? []
  const summary = summarizeByMeal(balances.data ?? [])
  const upcoming = list.filter((m) => m.served_on >= today).sort((a, b) => a.served_on.localeCompare(b.served_on))
  const past = list.filter((m) => m.served_on < today)

  function onDelete(meal: Meal) {
    if (window.confirm(`${formatMealDate(meal.served_on)} ${meal.title} 식사를 지울까요?`)) deleteMeal.mutate(meal.id)
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">식사</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      <Button onClick={() => createNext.mutate()} disabled={createNext.isPending || meals.status !== 'success'}>
        + 다음 주일 점심 만들기 ({formatShortDate(nextSundayLunchDate(list, today))})
      </Button>
      {createNext.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(createNext.error)}</p>}

      {adding ? (
        <MealForm today={today} pending={addMeal.isPending} onCancel={() => setAdding(false)}
          onSubmit={(values) => addMeal.mutate(values, { onSuccess: () => setAdding(false) })} />
      ) : (
        <Button variant="ghost" onClick={() => { addMeal.reset(); setAdding(true) }}>+ 식사 직접 추가</Button>
      )}
      {addMeal.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(addMeal.error)}</p>}
      {deleteMeal.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(deleteMeal.error)}</p>}

      {meals.status === 'pending' && <Spinner inline />}
      {meals.status === 'error' && <p role="alert" className="text-sm text-red-600">식사를 불러오지 못했어요</p>}

      <section aria-label="다가오는 식사" className="flex flex-col gap-2">
        <h2 className="text-xs font-bold text-gray-500">다가오는 식사</h2>
        {upcoming.length === 0 && meals.status === 'success' && <p className="text-sm text-gray-500">예정된 식사가 없어요</p>}
        {upcoming.map((m) => <MealCard key={m.id} meal={m} summary={summary.get(m.id)} onDelete={onDelete} deleting={deleteMeal.isPending} />)}
      </section>

      {past.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer text-xs font-bold text-gray-500">지난 식사 {past.length}건</summary>
          <div className="mt-2 flex flex-col gap-2">
            {past.map((m) => <MealCard key={m.id} meal={m} summary={summary.get(m.id)} onDelete={onDelete} deleting={deleteMeal.isPending} />)}
          </div>
        </details>
      )}
    </main>
  )
}

function MealCard({ meal, summary, onDelete, deleting }: { meal: Meal; summary?: MealSummary; onDelete: (m: Meal) => void; deleting: boolean }) {
  const s = summary ?? { issued: 0, used: 0, amount: 0, families: 0 }
  const rate = s.issued > 0 ? Math.round((s.used / s.issued) * 100) : 0
  const label = `${formatMealDate(meal.served_on)} ${meal.title}`
  return (
    <article aria-label={label} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500">{formatMealDate(meal.served_on)}</p>
          <h3 className="font-bold">{meal.title}</h3>
          {meal.note && <p className="text-xs text-gray-500">{meal.note}</p>}
        </div>
        {/* 발급이 있으면 FK 가 막으므로 버튼 자체를 감춘다 */}
        {s.issued === 0 && (
          <button type="button" onClick={() => onDelete(meal)} disabled={deleting} className="text-xs text-red-600 underline">삭제</button>
        )}
      </div>
      <p className="mt-2 text-sm">발급 {s.issued}장 · 가족 {s.families} · {formatWon(s.amount)}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <div className="h-2 flex-1 overflow-hidden rounded bg-gray-200"><div className="h-full bg-blue-600" style={{ width: `${rate}%` }} /></div>
        <span>사용 {s.used} / {s.issued}</span>
      </div>
    </article>
  )
}
```

- [x] **Step 11: 라우트 — `src/App.tsx` 의 `RequirePerson` 아래에 추가**

```tsx
import { RequireAdmin } from './features/auth/Gate'   // 기존 import 줄에 합친다
import { AdminMealsPage } from './pages/admin/AdminMealsPage'
…
            <Route element={<RequirePerson />}>
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/admin/meals" element={<RequireAdmin><AdminMealsPage /></RequireAdmin>} />
            </Route>
```

- [x] **Step 12: 통과 확인 + 눈으로 확인**

Run: `npx vitest run && npm run lint && npx tsc -b --noEmit`
Expected: 통과.

브라우저: 개발 로그인한 계정을 관리자로 만든다(Studio SQL: `update public.people set role = 'admin' where auth_user_id = (select id from auth.users where email = '<본인 이메일>');`). 새로고침하면 하단 탭에 "관리" 가 생기고, 식사 화면에서 "다음 주일 점심 만들기" 를 누르면 카드가 생긴다. 발급 없는 식사는 삭제가 되고, Task 9 에서 발급을 넣은 식사는 삭제 버튼이 없다.

- [x] **Step 13: 커밋**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts src/features/admin src/pages/admin/AdminMealsPage.tsx src/pages/admin/AdminMealsPage.test.tsx src/App.tsx
git commit -m "feat: 관리자 식사 화면 — 다음 주일 점심 생성, 직접 추가, 발급·사용률 카드, 삭제

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 관리자 발급 화면 (`#/admin/issue`)

**Files:**
- Create: `src/features/admin/issueSchema.ts`, `src/features/admin/issueSchema.test.ts`
- Create: `src/features/admin/usePeopleSearch.ts`, `src/features/admin/usePeopleSearch.test.tsx`
- Create: `src/features/admin/useIssue.ts`, `src/features/admin/useIssue.test.tsx`
- Create: `src/pages/admin/IssuePage.tsx`, `src/pages/admin/IssuePage.test.tsx`
- Modify: `src/test/fakeSupabase.ts` (`ilike` 체인 추가), `src/App.tsx`

- [x] **Step 1: 실패하는 테스트 — `src/features/admin/issueSchema.test.ts`**

```ts
import { validateIssue, validateNewPerson } from './issueSchema'

describe('validateIssue', () => {
  it('장수·단가(쉼표 허용)·메모를 정리한다', () => {
    expect(validateIssue({ quantity: 4, unitPrice: '5,000', memo: ' 입금 확인 ' })).toEqual({
      ok: true, values: { quantity: 4, unitPrice: 5000, memo: '입금 확인' },
    })
    expect(validateIssue({ quantity: 1, unitPrice: '0', memo: '' })).toEqual({ ok: true, values: { quantity: 1, unitPrice: 0, memo: null } })
  })

  it('범위 밖·빈 단가·숫자 아님', () => {
    expect(validateIssue({ quantity: 0, unitPrice: '5000', memo: '' })).toMatchObject({ ok: false, errors: { quantity: '장수는 1~99장이에요' } })
    expect(validateIssue({ quantity: 100, unitPrice: '5000', memo: '' })).toMatchObject({ ok: false, errors: { quantity: '장수는 1~99장이에요' } })
    expect(validateIssue({ quantity: 1, unitPrice: '', memo: '' })).toMatchObject({ ok: false, errors: { unitPrice: '단가를 적어 주세요 (이월은 0)' } })
    expect(validateIssue({ quantity: 1, unitPrice: '오천', memo: '' })).toMatchObject({ ok: false, errors: { unitPrice: '단가는 숫자로 적어 주세요' } })
    expect(validateIssue({ quantity: 1, unitPrice: '1000001', memo: '' })).toMatchObject({ ok: false, errors: { unitPrice: '단가는 0~1,000,000원이에요' } })
    expect(validateIssue({ quantity: 1, unitPrice: '5000', memo: '가'.repeat(101) })).toMatchObject({ ok: false, errors: { memo: '메모는 100자까지예요' } })
  })
})

describe('validateNewPerson', () => {
  it('이름 공백 정리, 번호 정규화', () => {
    expect(validateNewPerson({ name: ' 이순자 ', phone: '010-2222-0001' })).toEqual({ ok: true, values: { name: '이순자', phone: '01022220001' } })
  })
  it('오류', () => {
    expect(validateNewPerson({ name: '', phone: '01022220001' })).toMatchObject({ ok: false, errors: { name: '이름을 적어 주세요' } })
    expect(validateNewPerson({ name: '이순자', phone: '02-123-4567' })).toMatchObject({ ok: false, errors: { phone: '휴대폰 번호를 확인해 주세요' } })
  })
})
```

- [x] **Step 2: 실패하는 테스트 — `src/features/admin/usePeopleSearch.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { sanitizeQuery, SEARCH_MIN, usePeopleSearch, useRegisterPerson } from './usePeopleSearch'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('sanitizeQuery', () => {
  it('글자·숫자·공백만 남긴다 (PostgREST 필터 문법 문자 제거)', () => {
    expect(sanitizeQuery(' 김,철수.(1234) ')).toBe('김철수1234')
    expect(sanitizeQuery('이 영희')).toBe('이 영희')
  })
})

describe('usePeopleSearch', () => {
  it('2글자 미만이면 조회하지 않는다', () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePeopleSearch('김'), { wrapper })
    expect(SEARCH_MIN).toBe(2)
    expect(result.current.fetchStatus).toBe('idle')
    expect(from).not.toHaveBeenCalled()
  })

  it('이름은 ilike, 숫자가 섞이면 번호 뒷자리도 함께 (or)', async () => {
    let q!: FakeQuery<unknown>
    from.mockImplementation(() => (q = ok([{ id: 'p1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', family_id: 'f1', is_minor: false }])))
    const { wrapper } = makeWrapper()
    const { result, rerender } = renderHook(({ query }) => usePeopleSearch(query), { wrapper, initialProps: { query: '김철' } })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(q.has('ilike', 'name', '%김철%')).toBe(true)
    expect(q.has('is', 'deleted_at', null)).toBe(true)
    expect(q.has('eq', 'is_minor', false)).toBe(true)
    expect(q.has('limit', 20)).toBe(true)

    rerender({ query: '5678' })
    await waitFor(() => expect(q.has('or', 'name.ilike.%5678%,phone.like.%5678%')).toBe(true))
  })
})

describe('useRegisterPerson', () => {
  it('이름·번호로 사람을 만들고 검색 캐시를 무효화한다', async () => {
    const q = ok({ id: 'p2', name: '이순자', phone: '01022220001', auth_user_id: null, family_id: 'f2', is_minor: false })
    from.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useRegisterPerson(), { wrapper })
    const person = await act(() => result.current.mutateAsync({ name: '이순자', phone: '01022220001' }))
    expect(person.id).toBe('p2')
    expect(q.has('insert', { name: '이순자', phone: '01022220001' })).toBe(true)
    expect(q.has('single')).toBe(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['people-search'] })
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/features/admin/useIssue.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { DUPLICATE_WINDOW_MS, findRecentDuplicate, useIssueTickets, useLatestUnitPrice } from './useIssue'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args: Record<string, unknown>) => unknown>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { wrapper, invalidate }
}

describe('useLatestUnitPrice', () => {
  it('누구에게든 가장 최근 발급의 단가. 발급이 없으면 null', async () => {
    let q!: FakeQuery<unknown>
    from.mockImplementation(() => (q = ok({ unit_price: 5000 })))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useLatestUnitPrice(), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(5000))
    expect(q.has('order', 'issued_at', { ascending: false })).toBe(true)
    expect(q.has('limit', 1)).toBe(true)
    expect(q.has('maybeSingle')).toBe(true)
  })
})

describe('findRecentDuplicate', () => {
  it('60초 안에 같은 사람·식사·장수 발급(취소 제외)이 있으면 true', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T01:00:00Z'))
    let q!: FakeQuery<unknown>
    from.mockImplementation(() => (q = ok([{ id: 'i1' }])))
    expect(DUPLICATE_WINDOW_MS).toBe(60_000)
    await expect(findRecentDuplicate({ personId: 'p1', mealId: 'm1', quantity: 4 })).resolves.toBe(true)
    expect(q.has('eq', 'person_id', 'p1')).toBe(true)
    expect(q.has('eq', 'meal_id', 'm1')).toBe(true)
    expect(q.has('eq', 'quantity', 4)).toBe(true)
    expect(q.has('is', 'cancelled_at', null)).toBe(true)
    expect(q.has('gte', 'issued_at', '2026-10-08T00:59:00.000Z')).toBe(true)
    vi.useRealTimers()
  })
  it('없으면 false', async () => {
    from.mockImplementation(() => ok([]))
    await expect(findRecentDuplicate({ personId: 'p1', mealId: 'm1', quantity: 4 })).resolves.toBe(false)
  })
})

describe('useIssueTickets', () => {
  it('issue_tickets 를 부르고 잔량·단가·식권 캐시를 무효화한다', async () => {
    rpc.mockReturnValue(ok({ id: 'i1' }))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useIssueTickets(), { wrapper })
    await act(() => result.current.mutateAsync({ personId: 'p1', mealId: 'm1', quantity: 4, unitPrice: 5000, memo: null }))
    expect(rpc).toHaveBeenCalledWith('issue_tickets', { p_person_id: 'p1', p_meal_id: 'm1', p_quantity: 4, p_unit_price: 5000, p_memo: null })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-balances'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['latest-unit-price'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tickets'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ledger'] })
  })
})
```

- [x] **Step 4: 실패하는 테스트 — `src/pages/admin/IssuePage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { IssuePage } from './IssuePage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T; fetchStatus?: string }
type M<A> = { mutate: (args: A, opts?: unknown) => void; mutateAsync: (args: A) => Promise<unknown>; isPending: boolean; isError: boolean; error: unknown; reset: () => void }
const { useMeals, usePeopleSearch, useRegisterPerson, useLatestUnitPrice, useIssueTickets, findRecentDuplicate } = vi.hoisted(() => ({
  useMeals: vi.fn<() => Q<unknown[]>>(),
  usePeopleSearch: vi.fn<(q: string) => Q<unknown[]>>(),
  useRegisterPerson: vi.fn<() => M<unknown>>(),
  useLatestUnitPrice: vi.fn<() => Q<number | null>>(),
  useIssueTickets: vi.fn<() => M<unknown>>(),
  findRecentDuplicate: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('../../features/admin/useMeals', () => ({ useMeals }))
vi.mock('../../features/admin/usePeopleSearch', () => ({ usePeopleSearch, useRegisterPerson, sanitizeQuery: (s: string) => s.trim(), SEARCH_MIN: 2 }))
vi.mock('../../features/admin/useIssue', () => ({ useLatestUnitPrice, useIssueTickets, findRecentDuplicate }))
vi.mock('../../lib/dates', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/dates')>()), todaySeoul: () => '2026-10-08' }))

const meal = (id: string, served_on: string, title = '주일 점심') => ({ id, title, served_on, note: null, created_by: 'a', created_at: '' })
const hit = { id: 'p1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', family_id: 'f1', is_minor: false }
const visitor = { ...hit, id: 'p2', name: '이순자', phone: '01022220001', auth_user_id: null }
const idle = <A,>(): M<A> => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null, reset: () => {} })

beforeEach(() => {
  useMeals.mockReturnValue({ status: 'success', data: [meal('m-next', '2026-10-18'), meal('m1', '2026-10-11'), meal('m-past', '2026-10-04')] })
  usePeopleSearch.mockReturnValue({ status: 'pending', fetchStatus: 'idle' })
  useRegisterPerson.mockReturnValue(idle())
  useLatestUnitPrice.mockReturnValue({ status: 'success', data: 5000 })
  useIssueTickets.mockReturnValue(idle())
  findRecentDuplicate.mockResolvedValue(false)
})

const renderPage = () => render(<MemoryRouter><IssuePage /></MemoryRouter>)

describe('IssuePage · 1단계 (식사·사람)', () => {
  it('다음 식사가 기본 선택되고 "변경" 으로 바꿀 수 있다', async () => {
    renderPage()
    expect(screen.getByText('10월 11일 (주일) · 주일 점심')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '변경' }))
    await userEvent.click(screen.getByRole('button', { name: '10월 18일 (주일) · 주일 점심' }))
    expect(screen.getByText('10월 18일 (주일) · 주일 점심')).toBeInTheDocument()
  })

  it('검색어를 훅에 넘기고 결과에 가입/미가입 태그와 번호를 보여 준다', async () => {
    usePeopleSearch.mockReturnValue({ status: 'success', data: [hit, visitor] })
    renderPage()
    await userEvent.type(screen.getByLabelText('이름 또는 번호 뒷자리'), '김철')
    expect(usePeopleSearch).toHaveBeenLastCalledWith('김철')
    const rows = screen.getAllByRole('button', { name: /김철수|이순자/ })
    expect(rows[0]).toHaveTextContent('010-1234-5678')
    expect(rows[0]).toHaveTextContent('가입')
    expect(rows[1]).toHaveTextContent('미가입')
  })

  it('"새로 등록" 으로 사람을 만들면 바로 선택된다', async () => {
    const register = idle<{ name: string; phone: string }>()
    register.mutateAsync = vi.fn(async () => visitor)
    useRegisterPerson.mockReturnValue(register)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '+ 새로 등록' }))
    await userEvent.type(screen.getByLabelText('이름'), '이순자')
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-2222-0001')
    await userEvent.click(screen.getByRole('button', { name: '등록하고 선택' }))
    expect(register.mutateAsync).toHaveBeenCalledWith({ name: '이순자', phone: '01022220001' })
    expect(await screen.findByRole('heading', { name: '이순자 님께 발급' })).toBeInTheDocument()
  })
})

describe('IssuePage · 2단계 (장수·단가)', () => {
  async function goToAmount() {
    usePeopleSearch.mockReturnValue({ status: 'success', data: [hit] })
    renderPage()
    await userEvent.type(screen.getByLabelText('이름 또는 번호 뒷자리'), '김철')
    await userEvent.click(screen.getByRole('button', { name: /김철수/ }))
  }

  it('장수 −/+, 최근 단가 기본값, 합계', async () => {
    await goToAmount()
    expect(screen.getByLabelText('단가 (원)')).toHaveValue('5000')
    expect(screen.getByText('합계 5,000원')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '장수 늘리기' }))
    await userEvent.click(screen.getByRole('button', { name: '장수 늘리기' }))
    await userEvent.click(screen.getByRole('button', { name: '장수 줄이기' }))
    expect(screen.getByText('합계 10,000원')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2장 발급하기' })).toBeInTheDocument()
  })

  it('발급하면 issue_tickets 인자가 넘어가고, 성공 뒤 1단계로 돌아가 완료 문구를 띄운다', async () => {
    const issue = idle<{ personId: string }>()
    issue.mutateAsync = vi.fn(async () => ({ id: 'i1' }))
    useIssueTickets.mockReturnValue(issue)
    await goToAmount()
    await userEvent.type(screen.getByLabelText('메모 (선택)'), '입금 확인')
    await userEvent.click(screen.getByRole('button', { name: '1장 발급하기' }))
    await waitFor(() => expect(issue.mutateAsync).toHaveBeenCalledWith({ personId: 'p1', mealId: 'm1', quantity: 1, unitPrice: 5000, memo: '입금 확인' }))
    expect(await screen.findByRole('status')).toHaveTextContent('김철수 님께 1장 발급했어요')
    expect(screen.getByLabelText('이름 또는 번호 뒷자리')).toHaveValue('')
  })

  it('60초 안에 같은 발급이 있으면 확인 창을 거친다 (취소하면 발급 안 함)', async () => {
    findRecentDuplicate.mockResolvedValue(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const issue = idle()
    useIssueTickets.mockReturnValue(issue)
    await goToAmount()
    await userEvent.click(screen.getByRole('button', { name: '1장 발급하기' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(issue.mutateAsync).not.toHaveBeenCalled()
  })

  it('단가가 비면 오류를 보여 주고 보내지 않는다', async () => {
    const issue = idle()
    useIssueTickets.mockReturnValue(issue)
    await goToAmount()
    await userEvent.clear(screen.getByLabelText('단가 (원)'))
    await userEvent.click(screen.getByRole('button', { name: '1장 발급하기' }))
    expect(screen.getByText('단가를 적어 주세요 (이월은 0)')).toBeInTheDocument()
    expect(issue.mutateAsync).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 5: 실패 확인**

Run: `npx vitest run src/features/admin src/pages/admin/IssuePage.test.tsx`
Expected: "Cannot find module".

- [x] **Step 6: 구현 — `src/test/fakeSupabase.ts` 에 `ilike = this.chain('ilike')` 한 줄 추가. `src/features/admin/issueSchema.ts`:**

```ts
import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'

export const QUANTITY_MIN = 1
export const QUANTITY_MAX = 99
export const PRICE_MAX = 1_000_000

const QUANTITY_MSG = '장수는 1~99장이에요'
const PRICE_RANGE_MSG = '단가는 0~1,000,000원이에요'

const schema = z.object({
  quantity: z.number().int(QUANTITY_MSG).min(QUANTITY_MIN, QUANTITY_MSG).max(QUANTITY_MAX, QUANTITY_MSG),
  unitPrice: z.number().int(PRICE_RANGE_MSG).min(0, PRICE_RANGE_MSG).max(PRICE_MAX, PRICE_RANGE_MSG),
  memo: z.string().trim().max(100, '메모는 100자까지예요'),
})

export type IssueInput = { quantity: number; unitPrice: string; memo: string }
export type IssueValues = { quantity: number; unitPrice: number; memo: string | null }
export type IssueErrors = Partial<Record<keyof IssueInput, string>>

/** 단가는 입력칸의 문자열이다. 쉼표를 허용하고, 비었거나 숫자가 아니면 칸별 오류를 낸다. */
export function validateIssue(input: IssueInput): { ok: true; values: IssueValues } | { ok: false; errors: IssueErrors } {
  const priceText = input.unitPrice.replace(/,/g, '').trim()
  const errors: IssueErrors = {}
  if (priceText === '') errors.unitPrice = '단가를 적어 주세요 (이월은 0)'
  else if (!/^\d+$/.test(priceText)) errors.unitPrice = '단가는 숫자로 적어 주세요'

  const result = schema.safeParse({ quantity: input.quantity, unitPrice: errors.unitPrice ? 0 : Number(priceText), memo: input.memo })
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof IssueInput
      errors[key] ??= issue.message
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const { quantity, unitPrice, memo } = result.data!
  return { ok: true, values: { quantity, unitPrice, memo: memo || null } }
}

export type NewPersonInput = { name: string; phone: string }
export type NewPersonErrors = Partial<Record<keyof NewPersonInput, string>>

/** 선발급용 "새로 등록". 가입 화면과 같은 규칙(이름 1~20자, 휴대폰 형식)이되 동의 체크는 없다(가입 때 받는다). */
export function validateNewPerson(input: NewPersonInput): { ok: true; values: NewPersonInput } | { ok: false; errors: NewPersonErrors } {
  const name = input.name.trim().normalize('NFC')
  const phone = normalizePhone(input.phone)
  const errors: NewPersonErrors = {}
  if (name.length === 0) errors.name = '이름을 적어 주세요'
  else if (name.length > 20) errors.name = '이름은 20자까지예요'
  if (!isValidMobile(phone)) errors.phone = '휴대폰 번호를 확인해 주세요'
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: { name, phone } }
}
```

> `result.data!` 는 오류가 없을 때만 닿는 분기라 안전하다. oxlint 가 non-null 단언을 막으면 `if (!result.success) return { ok: false, errors }` 로 분기를 나눠 쓴다.

- [x] **Step 7: 구현 — `src/features/admin/usePeopleSearch.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'

export const SEARCH_MIN = 2
const SEARCH_LIMIT = 20
const COLUMNS = 'id, name, phone, auth_user_id, family_id, is_minor'

export type PersonHit = Pick<Person, 'id' | 'name' | 'phone' | 'auth_user_id' | 'family_id' | 'is_minor'>

/** 검색어에서 글자·숫자·공백만 남긴다. PostgREST 필터 문법 문자(쉼표·점·괄호)가 섞이면 or() 조건이 깨진다. */
export function sanitizeQuery(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
}

/** 이름 일부 또는 번호 뒷자리로 사람 찾기 (2글자부터). 탈퇴자 제외. 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다. */
export function usePeopleSearch(raw: string) {
  const q = sanitizeQuery(raw)
  const digits = q.replace(/\D/g, '')
  return useQuery({
    queryKey: ['people-search', q],
    enabled: q.length >= SEARCH_MIN,
    staleTime: 10_000,
    queryFn: (): Promise<PersonHit[]> => {
      // 자녀는 발급 대상이 아니다 (DB 도 person_is_minor 로 거부). 검색 결과에서 아예 뺀다.
      const base = supabase.from('people').select(COLUMNS).is('deleted_at', null).eq('is_minor', false).order('name').limit(SEARCH_LIMIT)
      const filtered = digits.length >= SEARCH_MIN ? base.or(`name.ilike.%${q}%,phone.like.%${digits}%`) : base.ilike('name', `%${q}%`)
      return filtered.then(unwrap)
    },
  })
}

/** 선발급 대상 "새로 등록". people 의 insert 정책(관리자, name·phone 열)으로 바로 넣는다. 번호 중복은 23505 → 문구. */
export function useRegisterPerson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: { name: string; phone: string }): Promise<PersonHit> =>
      supabase.from('people').insert(values).select(COLUMNS).single().then(unwrap),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['people-search'] }),
  })
}
```

- [x] **Step 8: 구현 — `src/features/admin/useIssue.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import type { IssueValues } from './issueSchema'
import { adminBalancesQueryKey } from './useMeals'

export const latestUnitPriceQueryKey = ['latest-unit-price'] as const

/** 같은 사람·식사·장수 발급이 이 시간 안에 있으면 확인 창을 띄운다 (설계 §8.3 중복 방어) */
export const DUPLICATE_WINDOW_MS = 60_000

/** 누구에게든 가장 최근에 발급한 단가. 첫 발급이면 null (칸을 비워 둔다). */
export function useLatestUnitPrice() {
  return useQuery({
    queryKey: latestUnitPriceQueryKey,
    queryFn: async (): Promise<number | null> => {
      const row = await supabase.from('issuances').select('unit_price').order('issued_at', { ascending: false }).limit(1).maybeSingle().then(unwrap)
      return row?.unit_price ?? null
    },
  })
}

export async function findRecentDuplicate(args: { personId: string; mealId: string; quantity: number }): Promise<boolean> {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
  const rows = await supabase
    .from('issuances')
    .select('id')
    .eq('person_id', args.personId)
    .eq('meal_id', args.mealId)
    .eq('quantity', args.quantity)
    .is('cancelled_at', null)
    .gte('issued_at', since)
    .limit(1)
    .then(unwrap)
  return rows.length > 0
}

export type IssueArgs = IssueValues & { personId: string; mealId: string }

export function useIssueTickets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: IssueArgs) =>
      supabase
        .rpc('issue_tickets', { p_person_id: args.personId, p_meal_id: args.mealId, p_quantity: args.quantity, p_unit_price: args.unitPrice, p_memo: args.memo })
        .then(unwrap),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey })
      await queryClient.invalidateQueries({ queryKey: latestUnitPriceQueryKey })
      // 관리자 본인 가족에게 발급했을 수도 있다 (식권·내역 모두)
      await queryClient.invalidateQueries({ queryKey: ticketsQueryKey })
      await queryClient.invalidateQueries({ queryKey: ledgerQueryKey })
    },
  })
}
```

> `p_memo: null` 전달: 생성된 타입이 `p_memo?: string` 이면 `args.memo ?? undefined` 로 바꾼다 (PostgREST 는 빠진 인자를 기본값 null 로 본다). 테스트의 기대값도 그에 맞춘다.

- [x] **Step 9: 구현 — `src/pages/admin/IssuePage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Button, TextField } from '../../components/ui'
import { validateIssue, validateNewPerson, QUANTITY_MAX, QUANTITY_MIN, type IssueErrors, type NewPersonErrors } from '../../features/admin/issueSchema'
import { findRecentDuplicate, useIssueTickets, useLatestUnitPrice } from '../../features/admin/useIssue'
import { useMeals } from '../../features/admin/useMeals'
import { SEARCH_MIN, sanitizeQuery, usePeopleSearch, useRegisterPerson, type PersonHit } from '../../features/admin/usePeopleSearch'
import type { Meal } from '../../features/tickets/groupTickets'
import { formatMealDate, todaySeoul } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { formatWon } from '../../lib/money'
import { formatPhone } from '../../lib/phone'

const mealLabel = (m: Meal) => `${formatMealDate(m.served_on)} · ${m.title}`

export function IssuePage() {
  const today = todaySeoul()
  const meals = useMeals()
  const upcoming = (meals.data ?? []).filter((m) => m.served_on >= today).sort((a, b) => a.served_on.localeCompare(b.served_on))
  const [mealId, setMealId] = useState<string | null>(null)
  const meal = (mealId ? meals.data?.find((m) => m.id === mealId) : upcoming[0]) ?? null
  const [person, setPerson] = useState<PersonHit | null>(null)
  const [done, setDone] = useState<string | null>(null)

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">발급</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>
      {done && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{done}</p>}

      {person && meal ? (
        <AmountStep person={person} meal={meal} onBack={() => setPerson(null)}
          onDone={(message) => { setDone(message); setPerson(null) }} />
      ) : (
        <PickStep meal={meal} meals={upcoming} onMeal={setMealId} onPerson={(p) => { setDone(null); setPerson(p) }} />
      )}
    </main>
  )
}

function PickStep({ meal, meals, onMeal, onPerson }: { meal: Meal | null; meals: Meal[]; onMeal: (id: string) => void; onPerson: (p: PersonHit) => void }) {
  const [changing, setChanging] = useState(false)
  const [query, setQuery] = useState('')
  const [registering, setRegistering] = useState(false)
  const search = usePeopleSearch(query)
  const ready = sanitizeQuery(query).length >= SEARCH_MIN

  return (
    <>
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-bold text-gray-500">식사</h2>
        {meal ? (
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{mealLabel(meal)}</span>
            <button type="button" onClick={() => setChanging((v) => !v)} className="text-xs text-blue-600 underline">변경</button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">예정된 식사가 없어요. 식사 탭에서 먼저 만들어 주세요.</p>
        )}
        {changing && (
          <ul className="mt-2 flex flex-col gap-1">
            {meals.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => { onMeal(m.id); setChanging(false) }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${m.id === meal?.id ? 'bg-blue-50 font-bold' : 'hover:bg-gray-50'}`}>
                  {mealLabel(m)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <TextField label="이름 또는 번호 뒷자리" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="2글자부터 찾아요" autoComplete="off" />
        {ready && search.status === 'pending' && <p className="text-xs text-gray-500">찾는 중…</p>}
        {ready && search.status === 'error' && <p role="alert" className="text-xs text-red-600">{toUserMessage(search.error)}</p>}
        {ready && search.status === 'success' && (
          search.data.length === 0 ? <p className="text-sm text-gray-500">찾는 사람이 없어요</p> : (
            <ul className="flex flex-col gap-1">
              {search.data.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPerson(p)} disabled={!meal}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40">
                    <span><strong>{p.name}</strong> <span className="text-gray-500">{p.phone ? formatPhone(p.phone) : '번호 없음'}</span></span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${p.auth_user_id ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {p.auth_user_id ? '가입' : '미가입'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {registering ? (
          <NewPersonForm onCancel={() => setRegistering(false)} onRegistered={(p) => { setRegistering(false); onPerson(p) }} />
        ) : (
          <Button variant="ghost" onClick={() => setRegistering(true)} disabled={!meal}>+ 새로 등록</Button>
        )}
      </section>
    </>
  )
}

function NewPersonForm({ onCancel, onRegistered }: { onCancel: () => void; onRegistered: (p: PersonHit) => void }) {
  const register = useRegisterPerson()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<NewPersonErrors>({})

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateNewPerson({ name, phone })
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    try {
      onRegistered(await register.mutateAsync(result.values))
    } catch {
      // register.isError 가 문구를 띄운다
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3 rounded-xl border border-dashed border-gray-300 p-3">
      <p className="text-xs text-gray-500">입금자명과 같게 적어 주세요. 이 사람이 나중에 같은 이름·번호로 가입하면 자동으로 연결돼요.</p>
      <TextField label="이름" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} error={errors.name} />
      <TextField label="휴대폰 번호" name="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" error={errors.phone} />
      {register.isError && <p role="alert" className="text-xs text-red-600">{toUserMessage(register.error)}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={register.isPending}>취소</Button>
        <Button type="submit" disabled={register.isPending}>{register.isPending ? '등록 중…' : '등록하고 선택'}</Button>
      </div>
    </form>
  )
}

function AmountStep({ person, meal, onBack, onDone }: { person: PersonHit; meal: Meal; onBack: () => void; onDone: (message: string) => void }) {
  const latest = useLatestUnitPrice()
  const issue = useIssueTickets()
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState<string | null>(null) // null = 아직 손대지 않음 → 최근 단가
  const [memo, setMemo] = useState('')
  const [errors, setErrors] = useState<IssueErrors>({})
  const [busy, setBusy] = useState(false)

  const priceText = unitPrice ?? (latest.data === null || latest.data === undefined ? '' : String(latest.data))
  const priceNumber = Number(priceText.replace(/,/g, '')) || 0
  const total = quantity * priceNumber

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateIssue({ quantity, unitPrice: priceText, memo })
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    setBusy(true) // 버튼을 즉시 잠근다 (이중 클릭 방어 1)
    try {
      // 60초 안에 같은 사람·식사·장수 발급이 있으면 묻는다 (이중 클릭 방어 2)
      if (await findRecentDuplicate({ personId: person.id, mealId: meal.id, quantity })) {
        if (!window.confirm(`1분 안에 ${person.name} 님께 같은 식사 ${quantity}장을 발급한 기록이 있어요. 그래도 발급할까요?`)) return
      }
      await issue.mutateAsync({ personId: person.id, mealId: meal.id, ...result.values })
      onDone(`${person.name} 님께 ${quantity}장 발급했어요`)
    } catch {
      // issue.isError 가 문구를 띄운다
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-extrabold">{person.name} 님께 발급</h2>
          <p className="text-xs text-gray-500">{mealLabel(meal)}</p>
        </div>
        <button type="button" onClick={onBack} className="text-xs text-blue-600 underline">다른 사람</button>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-gray-500">장수</p>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="장수 줄이기" onClick={() => setQuantity((q) => Math.max(QUANTITY_MIN, q - 1))} className="h-11 w-11 rounded-xl border border-gray-300 text-xl">−</button>
          <span className="w-12 text-center text-2xl font-extrabold tabular-nums">{quantity}</span>
          <button type="button" aria-label="장수 늘리기" onClick={() => setQuantity((q) => Math.min(QUANTITY_MAX, q + 1))} className="h-11 w-11 rounded-xl border border-gray-300 text-xl">+</button>
        </div>
        {errors.quantity && <p role="alert" className="mt-1 text-xs text-red-600">{errors.quantity}</p>}
      </div>

      <TextField label="단가 (원)" name="unitPrice" inputMode="numeric" value={priceText} onChange={(e) => setUnitPrice(e.target.value)} placeholder="첫 발급이에요. 단가를 적어 주세요" error={errors.unitPrice} />
      <TextField label="메모 (선택)" name="memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} placeholder="예: 10/5 이월" error={errors.memo} />

      <p className="text-right text-sm">합계 <strong>{formatWon(total)}</strong></p>
      {issue.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(issue.error)}</p>}
      <Button type="submit" disabled={busy || issue.isPending}>{busy || issue.isPending ? '발급 중…' : `${quantity}장 발급하기`}</Button>
    </form>
  )
}
```

- [x] **Step 10: 라우트 — `src/App.tsx` 의 `RequirePerson` 아래에 추가**

```tsx
import { IssuePage } from './pages/admin/IssuePage'
…
              <Route path="/admin/issue" element={<RequireAdmin><IssuePage /></RequireAdmin>} />
```

- [x] **Step 11: 통과 확인 + 눈으로 확인**

Run: `npx vitest run && npm run lint && npx tsc -b --noEmit`
Expected: 통과.

브라우저(관리자 계정): 발급 탭 → 다음 식사가 기본 선택 → 이름 두 글자 검색 → 선택 → 장수 2, 단가 5000 → 발급 → 완료 문구. 같은 발급을 60초 안에 반복하면 확인 창. "새로 등록" 으로 이름·번호를 넣으면 바로 선택된다. 홈(내 식권)에서 자기에게 발급한 식권이 보인다.

- [x] **Step 12: 커밋**

```bash
git add src/features/admin src/pages/admin/IssuePage.tsx src/pages/admin/IssuePage.test.tsx src/test/fakeSupabase.ts src/App.tsx
git commit -m "feat: 관리자 발급 화면 — 식사 선택, 이름·번호 검색, 새로 등록, 장수·단가·메모, 60초 중복 확인

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: E2E — 관리자 발급 → 선발급 가입 자동 연결 → 꾹 눌러 사용

**Files:**
- Create: `supabase/seeds/010_e2e_admin.sql`
- Create: `e2e/tickets.spec.ts`

- [x] **Step 1: 관리자 시드 — `supabase/seeds/010_e2e_admin.sql`**

운영에는 적용되지 않는다(`db push` 는 migrations 만 올린다). 로컬 `db reset` 과 CI 의 `supabase start` 에서만 돈다.

```sql
-- 로컬·CI 전용 관리자 계정. E2E(e2e/tickets.spec.ts)와 수동 확인에 쓴다.
--   이메일 e2e-admin@test.local / 비밀번호 password123 (개발 로그인 폼)
-- 운영 DB 에는 들어가지 않는다 (seeds 는 db reset/start 에서만 적용).
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-000000000001';
  v_email text := 'e2e-admin@test.local';
begin
  if not exists (select 1 from auth.users where id = v_uid) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at
    ) values (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
      extensions.crypt('password123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now()
    );
    -- GoTrue 는 이메일 로그인 때 identities 행도 본다
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, 'email',
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), now(), now(), now());
  end if;
  if not exists (select 1 from public.people where auth_user_id = v_uid) then
    insert into public.people (name, phone, auth_user_id, role, consented_at, consent_version)
    values ('권사', '01000000001', v_uid, 'admin', now(), '2026-10-07');
  end if;
end
$$;
```

- [x] **Step 2: 시드 적용 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 시드 오류 없이 reset 완료, pgTAP 전부 통과(테스트들은 자기 트랜잭션의 행만 세므로 시드 행에 영향받지 않는다). `npm run dev` 후 개발 로그인 폼에 `e2e-admin@test.local / password123` 을 넣으면 "권사 님" 홈과 하단 "관리" 탭이 보인다.

- [x] **Step 3: E2E 작성 — `e2e/tickets.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'

// supabase/seeds/010_e2e_admin.sql
const ADMIN = { email: 'e2e-admin@test.local', password: 'password123' }

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

async function devLogin(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '개발용 로그인' }).click()
}

async function logout(page: Page) {
  await page.getByRole('link', { name: '내 식권' }).click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
}

/** 식권 한 장을 꾹 누른다 (마우스 다운 → 대기 → 업). Playwright 의 mouse 는 pointer 이벤트도 함께 낸다. */
async function hold(page: Page, name: string, ms: number) {
  const button = page.getByRole('button', { name })
  const box = await button.boundingBox()
  if (!box) throw new Error(`버튼을 찾지 못했다: ${name}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

test('관리자 발급 → 선발급 가입 자동 연결 → 꾹 눌러 사용 → 내역', async ({ page }) => {
  const digits = Date.now().toString().slice(-5) + String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
  const phone = `01${digits}`
  const mealTitle = `E2E 점심 ${digits}`
  const today = todaySeoul()
  const mealLabel = `${formatMealDate(today)} · ${mealTitle}`

  await test.step('관리자: 오늘 식사 만들기', async () => {
    await devLogin(page, ADMIN.email, ADMIN.password)
    await expect(page.getByRole('heading', { name: '권사 님' })).toBeVisible()
    await page.getByRole('link', { name: '관리' }).click()
    await page.getByRole('button', { name: '+ 식사 직접 추가' }).click()
    await page.getByLabel('식사 이름').fill(mealTitle)
    // 날짜 기본값은 오늘
    await page.getByRole('button', { name: '식사 추가' }).click()
    await expect(page.getByRole('article', { name: new RegExp(mealTitle) })).toBeVisible()
  })

  await test.step('관리자: 새로 등록한 사람에게 2장 발급', async () => {
    await page.getByRole('link', { name: '발급' }).click()
    await page.getByRole('button', { name: '변경' }).click()
    await page.getByRole('button', { name: mealLabel }).click()
    await page.getByRole('button', { name: '+ 새로 등록' }).click()
    await page.getByLabel('이름').fill('김철수')
    await page.getByLabel('휴대폰 번호').fill(phone)
    await page.getByRole('button', { name: '등록하고 선택' }).click()
    await expect(page.getByRole('heading', { name: '김철수 님께 발급' })).toBeVisible()

    await page.getByLabel('단가 (원)').fill('5000')
    await page.getByRole('button', { name: '장수 늘리기' }).click()
    await expect(page.getByText('합계 10,000원')).toBeVisible()
    await page.getByRole('button', { name: '2장 발급하기' }).click()
    await expect(page.getByRole('status')).toHaveText('김철수 님께 2장 발급했어요')
    await logout(page)
  })

  await test.step('교인: 같은 이름·번호로 가입하면 선발급 식권이 보인다', async () => {
    await devLogin(page, `e2e-${digits}@test.local`, 'password123')
    await expect(page.getByRole('heading', { name: '처음 오셨네요' })).toBeVisible()
    await page.getByLabel('이름').fill('김철수')
    await page.getByLabel('휴대폰 번호').fill(phone)
    await page.getByLabel(/개인정보 수집·이용 동의/).check()
    await page.getByRole('button', { name: '동의하고 시작하기' }).click()

    await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()
    await expect(page.getByRole('heading', { name: mealTitle })).toBeVisible()
    await expect(page.getByText('2장 남음')).toBeVisible()
    await expect(page.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(2)
  })

  await test.step('짧게 탭하면 아무 일도 없다', async () => {
    await hold(page, '식권 1번 꾹 눌러 사용하기', 100)
    await page.waitForTimeout(700)
    await expect(page.getByText('2장 남음')).toBeVisible()
  })

  await test.step('600ms 꾹 누르면 1장이 회색이 된다', async () => {
    await hold(page, '식권 1번 꾹 눌러 사용하기', 900)
    await expect(page.getByRole('status')).toHaveText(/사용 처리되었어요/)
    await expect(page.getByText('1장 남음')).toBeVisible()
    const items = page.getByRole('list', { name: '식권 목록' }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText('사용 완료')
    await expect(items.first()).toContainText('김철수 폰')
    await expect(page.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(1)
  })

  await test.step('내역에 발급과 사용이 남는다', async () => {
    await page.getByRole('link', { name: '내역' }).click()
    await expect(page.getByText('발급 2장 · 10,000원')).toBeVisible()
    await expect(page.getByText('사용 1장 · 김철수 폰')).toBeVisible()
  })
})
```

- [x] **Step 4: 실행**

Run: `npm run e2e`
Expected: 기존 onboarding 2개 + 이번 1개 통과. 실패하면 `npx playwright show-report` 로 스크린샷·트레이스를 본다. 흔한 원인: (a) 꾹 누르기 시간이 모자람 → `hold(…, 900)` 은 600ms 에 여유를 둔 값이니 그대로 두고 버튼 위치(boundingBox)를 확인, (b) 발급 화면 기본 식사가 다른 식사 → "변경" 단계가 있으니 라벨 문자열(`mealLabel`)이 화면과 같은지 확인.

- [x] **Step 5: 커밋**

```bash
git add supabase/seeds/010_e2e_admin.sql e2e/tickets.spec.ts
git commit -m "test(e2e): 관리자 발급 → 선발급 가입 연결 → 꾹 눌러 사용 → 내역

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: 문서 동기화 · 전체 검증 · 마무리

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md` (§7.1 제약, §7.3 함수 시그니처·코드)
- Modify: `docs/superpowers/plans/2026-10-08-phase2-tickets.md` (체크박스, 실제 코드와 어긋난 곳)

- [x] **Step 1: README 보강**

"로컬 개발" 절에 추가:

```markdown
- 로컬 관리자 계정: `e2e-admin@test.local / password123` (`supabase/seeds/010_e2e_admin.sql`, 운영에는 없음). 개발 로그인 폼에 넣으면 하단 "관리" 탭이 보인다.
- 마이그레이션을 추가하면 `npm run db:reset && npm run db:types` 로 타입을 다시 만들어 커밋한다.
```

"운영 체크리스트" 절에 추가:

```markdown
### 발급 실수 정정 (4단계 전 임시 절차)
화면에 취소 기능이 들어오기 전까지는 개발자가 Supabase SQL 편집기에서 처리한다. 장부는 지우지 않고 취소 표시만 한다.
```sql
-- 1) 잘못된 발급 찾기
select i.id, p.name, m.served_on, m.title, i.quantity, i.unit_price, i.issued_at
  from public.issuances i join public.people p on p.id = i.person_id join public.meals m on m.id = i.meal_id
 where i.cancelled_at is null order by i.issued_at desc limit 20;
-- 2) 취소 표시 (이미 사용된 장수보다 적게 남지 않는지 ticket_balances 로 먼저 확인)
update public.issuances set cancelled_at = now(), cancelled_by = (select id from public.people where role = 'admin' limit 1), cancel_reason = '관리자 요청'
 where id = '<발급 id>';
```
```

- [x] **Step 2: 설계 문서 동기화**

§8.3 발급의 단가 기본값 문구를 "**가장 최근의 유료(0원 제외)·미취소 발급 단가**" 로 고친다 (Task 12 리뷰: 이월 0원 발급 뒤 다음 단가 기본값이 0원이 되는 문제). 또 §8.3 발급 검색 결과의 "방문자 태그·가족 수" 는 2단계 범위 밖(3·4단계)임을 적는다.

§7.1 `issuances`·`usages` 표 아래에 한 줄: "제약: `(cancelled_at is null) = (cancelled_by is null)`, `(voided_at is null) = (voided_by is null)`. `usages.request_id` 는 not null unique." §7.3 표에서 `use_ticket` 행의 코드를 `not_registered | invalid_request | meal_not_found | not_today | no_remaining | duplicate_request` 로, `create_next_sunday_lunch` 를 `create_next_sunday_lunch(p_today date default 서울 오늘)` 로 적고 "기준일 = max(가장 늦은 주일 점심, 어제)" 규칙을 덧붙인다. §7.2 뷰 설명에 "`meal_id`/`family_id` 가 coalesce 식이라 PostgREST 임베딩 불가 → 프론트는 id 목록으로 meals 를 따로 읽는다" 를 추가한다.

- [ ] **Step 3: 전체 검증**

```bash
npm run db:reset && npm run db:test      # pgTAP 159 assertions
npm run lint
npm run test:coverage                      # 80% 이상 (lines/functions/statements), branches 70%
npm run build
VITE_BASE_PATH=/meal-ticket/ npm run build && grep -q 'src="/meal-ticket/assets/' dist/index.html
npm run e2e
```

Expected: 전부 통과. 커버리지가 모자라면 수치가 낮은 파일을 `--coverage` 출력에서 찾아 테스트를 더한다(보통 `IssuePage.tsx`, `HomePage.tsx` 의 분기).

- [ ] **Step 4: 계획 체크박스 동기화 후 커밋**

이 파일의 `- [ ]` 를 `- [x]` 로 바꾸고, 구현 중 코드가 계획과 달라진 곳(테스트 기대값, 함수 시그니처)은 계획을 실제 코드에 맞춘다.

```bash
git add README.md docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md docs/superpowers/plans/2026-10-08-phase2-tickets.md
git commit -m "docs: 2단계 반영 — README 로컬 관리자·발급 정정 절차, 설계 §7 동기화, 계획 체크

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: 브랜치 마무리**

`superpowers:finishing-a-development-branch` 로 PR 을 만든다. CI(`DB · 단위 · E2E 테스트`)가 초록이면 merge → Deploy 가 마이그레이션 4개를 운영 DB 에 올리고 Pages 를 배포한다. **merge 전 확인**: `supabase/seeds/*` 는 운영에 가지 않는다(Deploy 는 `db push`). 운영 관리자 지정은 README §4 절차(SQL 로 `role = 'admin'`)대로 한다.

---

## 완료 기준

- `npm run db:test`(pgTAP 189 assertions), `npm run lint`, `npm run test:coverage`(Vitest 270개, 80%+), `npm run build`, `npm run e2e`(3개) 모두 통과.
- 로컬에서: 관리자 로그인 → 식사 만들기 → 발급(검색·새로 등록) → 교인 가입(선발급 자동 연결) → 홈에 식권 낱장 → 600ms 꾹 → 회색 전환 + 잔량 감소 → 내역 표시. 짧은 탭·오프라인·당일 아님에서는 사용되지 않는다.
- 운영에서: Deploy 성공 후 권사님 계정을 SQL 로 관리자 지정 → 실제 폰에서 발급·사용 확인(감도는 수동 확인 항목, 설계 §12.6).

## 3단계로 넘기는 것 (이 계획이 만든 토대 위에)

- `pairing_codes` 테이블·`create_pairing_code`·`add_family_member`·`relink_child`·`leave_family`·`remove_child`·`delete_my_account`, 시작 화면 "아이 계정으로 시작하기", 가입 화면 14세 미만 토글, `#/pair`, `#/family` 탭, pg_cron 3건.
- 홈 머리말 "우리 가족 식권 · N명" 은 이미 `members.length` 로 동작한다. 가족이 생기면 자동으로 바뀐다.
- `use_ticket` 은 자녀(익명 계정)도 통과하도록 이미 테스트되어 있다(`090_use_ticket.sql`).
- **PWA(홈 화면에 추가) 때 상단 안전 영역.** `index.html` 에 `viewport-fit=cover` 를 넣었다(하단 탭의 `env(safe-area-inset-bottom)` 용). 매니페스트로 standalone 표시가 생기면 상태바 인셋이 실제로 생기므로, 시작·가입·홈 머리말(또는 PersonShell)에 `pt-[env(safe-area-inset-top)]` 를 더해야 한다 (Task 6 리뷰 메모).
- **가족 이동과 장부 `family_id` (Task 2 리뷰에서 드러난 설계 긴장 — 3단계 계획에 반영할 결정).** 장부의 `family_id` 는 발급·사용 시점의 가족이고 FK 는 NO ACTION 이라, 장부가 있는 가족은 지울 수 없다. 설계 §7.3 의 "빈 가족 삭제" 와 §5.1 의 "식권을 산 뒤 배우자 가족에 합류" 가 그대로는 양립하지 않는다(옛 가족의 잔량이 새 가족에서 보이지 않고 `use_ticket` 도 못 쓴다). **결정: 가족 "합치기"(`add_family_member` adult 경로)는 옮겨 가는 쪽 가족이 비게 되므로, 그 가족의 장부 전체(issuances·usages)를 새 가족 `family_id` 로 옮긴 뒤 빈 가족을 지운다(잔량 풀 병합 — 수학이 그대로 맞는다). "가족 나가기"(`leave_family`)는 장부를 옛 가족에 두고 간다(산 사람이 아니라 함께 쓰던 풀의 것).** pg_cron 의 빈 가족 정리도 `not exists (issuances|usages)` 조건을 붙인다. 이 결정은 2단계 스키마를 바꾸지 않는다.

## 4단계로 넘기는 것

- `cancel_issuance` · `use_ticket_as_admin` · `void_usage` · `merge_people` · `link_person` · `admin_reset_person`, 식사 상세 현황판(`#/admin/meals/:id`), 사람 탭, 통계·CSV·카톡 공유.
- 발급 화면 검색 결과의 "가족 수" 태그(3단계 뒤 의미가 생긴다).
- **잔량을 바꾸는 4단계 함수(`cancel_issuance` · `void_usage` · `use_ticket_as_admin`)는 `use_ticket` 과 같은 잠금 키 `pg_advisory_xact_lock(hashtext(family_id::text), hashtext(meal_id::text))` 을 잡아야 한다** (Task 4 리뷰 권고 — 동시 취소+사용이 잔량을 음수로 만들 수 있다). 키가 어긋나지 않게 `public.lock_family_meal(uuid, uuid)` 헬퍼를 4단계 첫 마이그레이션에서 만들고 `use_ticket` 도 그 헬퍼를 쓰도록 바꾼다.
- `groupTickets` 는 `remaining` 이 음수가 될 수 있다고 가정하지 않는다. 4단계 `cancel_issuance` 는 설계대로 `would_go_negative` 로 거부해야 하며(아니면 홈에 "−1장 남음" 이 뜬다), 홈의 지난 식권·잔량 뷰 조회는 가족 이력 전체를 매 폴링마다 읽으므로(1년 ≈ 52행, URL 한계 ≈ 210개 id) 이력이 쌓이면 `meals` 조회에 `served_on` 기간 창(예: 90일)을 두는 것을 4단계에서 검토한다 (Task 7 리뷰 메모).
- **취소된 발급과 식사 삭제의 긴장 (Task 11 리뷰 메모).** `ticket_balances` 는 취소된 발급을 빼고 세지만 `issuances.meal_id` FK 는 어떤 행이든 있으면 식사 삭제를 막는다. 4단계에서 `cancel_issuance` 가 생기면 "발급 0장" 인데 삭제가 23503 으로 실패하는 식사가 생긴다. 4단계에서 식사 soft-delete(`deleted_at`) 또는 "발급 이력이 하나라도 있으면 삭제 버튼 숨김" 중 하나로 정한다. 그때까지 삭제 실패 문구는 일반 23503 문구를 쓴다.
- 2단계 pgTAP 실제 개수: 060=23, 070=31, 080=33, 090=22 (계획 본문의 16/20/22/21 은 리뷰 보강 전 수치). 전체 189.
