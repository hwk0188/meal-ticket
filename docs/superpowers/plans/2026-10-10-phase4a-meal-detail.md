# 4a단계 · 식사 상세 현황판 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 식사 탭에서 식사 하나를 열어 **누구에게 몇 장을 발급했고 누가 썼는지**를 가족 단위로 보고(발급·사용·남음·금액 네 숫자 + 이름 검색 + 명단), 같은 화면에서 **발급 취소 · 1장 대신 사용 처리 · 사용 무효 처리**를 할 수 있게 한다. 그 세 동작의 DB 함수(`cancel_issuance` · `use_ticket_as_admin` · `void_usage`)를 만들고, 3단계 최종 리뷰가 넘긴 `use_ticket` 재정의(사람 행 `for update` + `lock_family_meal`)를 함께 한다.

**Architecture:** 조회는 RLS(관리자는 전부 열람)로 `meals`·`issuances`·`usages`·`ticket_balances` 를 식사 id 로 읽고, 순수 함수 `groupMealLedger` 가 가족별 행으로 묶는다(5초 폴링 — 설계 §8.3). 조작은 SECURITY DEFINER 함수 3개로만 한다(프론트는 호출만). 잠금은 3단계 규칙 그대로 — ② 사람 행 `for update`(대신 사용) → ④ `lock_family_meal(family, meal)` → 장부 행 잠금은 ④ 뒤에(합류의 장부 이동과 같은 순서라 40P01 이 없다). `use_ticket` 은 같은 시그니처로 `create or replace` 해 사람 행 `for update` 와 헬퍼 잠금을 넣는다(2단계 파일은 운영에 적용됐으므로 고치지 않고 새 마이그레이션으로 재정의한다).

**Tech Stack:** 3단계와 동일 — React 19 · Vite 8 · TypeScript 6(strict) · Tailwind v4 · react-router 7(HashRouter) · TanStack Query 5 · supabase-js 2 · Vitest 4 · Playwright 1.63 · Supabase CLI 2.120.0 · pgTAP.

**설계 문서:** `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md` §7.3(`cancel_issuance` · `use_ticket_as_admin` · `void_usage`), §8.3(식사 상세(현황판)), §9(발급: 취소 불가 문구), §12. 3단계 계획 `docs/superpowers/plans/2026-10-09-phase3-family.md` 의 "4단계로 넘기는 것"(`use_ticket` 재정의, `lock_family_meal` 로 잠금, `family_id` 를 바꾸는 동작의 패널 처리 — 이 계획엔 해당 없음).

**4단계 분할:** 설계 §14 의 4단계(관리 확장)는 서로 독립인 세 묶음이라 계획도 셋으로 나눈다. **4a(이 계획)** 식사 상세 현황판 + 식권 조작 3종 + `use_ticket` 재정의. **4b** 사람 탭(`merge_people` · `link_person` · `admin_reset_person`, 번호 수정, 가족 보기, 이력). **4c** 통계·CSV·카톡 공유. 4a 는 Task 2 가 끝나면 식사별 발급 명단만으로도 배포 가치가 있다 — 필요하면 그 시점에 먼저 PR 을 만든다(아래 "중간 배포" 참고).

---

## 범위

| 영역 | 이 계획에서 하는 것 |
|---|---|
| DB | `cancel_issuance(id, reason)` · `use_ticket_as_admin(person_id, meal_id)` · `void_usage(id)` 신설(잠금 규칙 적용, 코드 목록은 각 함수 헤더). `use_ticket` 재정의(사람 행 `for update`, `lock_family_meal`). pgTAP `140_admin_ticket_ops.sql`(44). 타입 재생성 |
| 관리자 화면 | 식사 카드에 "현황" 링크 → `#/admin/meals/:mealId` 식사 상세: 발급·사용·남음·금액 한 줄, 이름 검색, 가족별 블록(구매자 이름 · "N장 중 M장 사용" · 발급 줄 · 사용 줄), 5초 폴링. 행 동작: 발급 줄 "발급 취소"(남은 장수보다 많으면 비활성 + 안내), 사용 줄 "무효", 가족 블록 "1장 대신 사용" — 모두 `ConfirmButton` 두 단계 확인 |
| 공통 | 오류 문구 7개. E2E `admin.spec.ts`(현황판 → 대신 사용 → 무효 → 취소). README 임시 SQL 절차 제거, 설계 §7.3·§8.3·§14·§15 동기화 |

**설계와 다른 점(의도적):** §8.3 의 "행의 ⋯ 메뉴" 대신 줄마다 작은 `ConfirmButton`(3단계 가족 탭과 같은 패턴 — 긴 누름·메뉴보다 발견하기 쉽고 접근성이 낫다). 취소 **사유 입력 칸은 두지 않는다**(DB 는 받는다 — `p_reason` 선택 인자; 화면 입력은 4b 사람 탭 이력과 함께 검토). §9 의 "N장까지만 취소" 는 발급 단위 취소라 "남은 장수(N)보다 많아 취소할 수 없어요" 로 쓴다.

**중간 배포:** Task 2 커밋 직후 `main` 과 다른 파일을 건드리지 않았으므로 바로 PR 을 만들어 merge 할 수 있다(마이그레이션 없음 → 운영 DB 변화 없음). 사용자가 원하면 그렇게 하고, 나머지 Task 는 같은 브랜치에서 이어 간 뒤 두 번째 PR 로 보낸다.

## 구현 결과와 계획의 차이 (실행 중 리뷰로 바뀐 것)

- **Task 5** (동작): 품질 리뷰(프로브 테스트로 검증)로 ① 페이지가 `mealOpsErrorMessage` 를 쓴다(Task 4 의 관리자 맥락 문구), ② 행별 접근성 이름을 고유하게 — 발급 `"<발급 시각> <구매자> N장"`, 사용 `"<누구> <시각> 사용"` (같은 사람 1장 두 번·같은 분 사용 두 건이 겹치던 것; Task 6 선택자는 정규식 `$` 일치), ③ 알림·오류를 `sticky` 로 위에 고정하고 **포커스를 옮긴다**(누른 버튼이 성공 뒤 사라지면 포커스가 body 로 떨어진다), ④ 취소 불가 안내에 "먼저 사용을 무효 처리해 주세요", ⑤ 무효 알림에 대상(`"<누구> 사용을 무효 처리했어요"`), ⑥ `break-words`, `NO_NAME` export, `startAction` → `clearFeedback`, ⑦ 테스트: 공허하던 '무효' 개수 단언에 무효 처리된 사용 줄 추가, 처리 중 버튼 수 7 고정, buyerId null 안내, 알림이 다음 동작에서 사라짐, `no_remaining` 관리자 문구, 포커스 이동. 재리뷰로 피드백 상자에 바탕색·포커스 링(스크롤 시 오류 문구가 행에 가려지던 것). 남는 것(기록): 같은 사람 몫을 같은 분(分)에 두 번 대신 사용하면 두 사용 줄의 접근성 이름이 같다 — 기능상 동일한 두 줄이라 그대로 둔다(E2E 는 이름 고유성을 가정하지 말 것; 필요하면 초 단위나 가족 내 순번). 미룸(5단계 a11y·레이아웃): 조건부 마운트 라이브 리전(iOS VoiceOver), 32px 탭 영역, 열린 확인 프롬프트가 행 안에서 좁게 접히는 것, 행 안 피드백, 포커스가 위로 점프한 뒤 Tab 순서.
- **Task 4** (뮤테이션): 품질 리뷰로 ① `onError` 의 현황 재조회는 **서버가 판단한 거부(코드 있음)일 때만**(통신 실패 때 재조회를 기다리면 오류 문구가 늦거나 오프라인이면 안 보인다 — `rpcCodeOf` 게이트), ② `useVoidUsage` 도 `onError` 재조회(`already_voided` 는 낡은 화면), ③ 세 RPC 에 `withTimeout`(`OPS_TIMEOUT_MS` 8초 — 매달린 요청이 모든 버튼을 '처리 중…' 에 가두지 않게), ④ `mealOpsErrorMessage`: `no_remaining` 을 관리자 맥락("남은 식권이 없어요")으로 — 교인 폰 문구 "방금 다른 폰에서 사용되었어요" 는 관리자에게 오해를 준다(Task 5 페이지가 쓴다), ⑤ 문구: `*_not_found` 는 "현황을 다시 불러왔어요", `would_go_negative` 는 "먼저 사용 기록을 무효 처리해 주세요". ⑥ (Task 3 리뷰 뒤) `use_ticket_as_admin` 이 `p_request_id` 를 받게 되어 훅이 **재시도 키**를 보낸다 — `useUseTicket` 과 같은 규칙으로 대상(사람·가족)별로 키를 쥐고 있다가 서버가 판단한 응답(성공·코드 있는 오류)이 오면 버리고 통신 실패·타임아웃이면 남겨 재사용한다(새로고침 뒤에는 새 키 — 메모리 ref). 재리뷰로 키를 **대상별 Map**(`식사:사람:가족`)으로 — 한 칸짜리 ref 는 다른 가족을 누르는 순간 첫 대상의 키를 버려 재탭이 두 번 깎을 수 있었다. Task 6 E2E 는 한 번 누름 → 사용 1건을 단언한다. 위 스니펫은 반영본. `invalidateMealOps` 단독 테스트는 단언이 헬퍼 안에만 있어 oxlint `vitest/expect-expect` 가 경고하므로 그 `it` 위에 `oxlint-disable-next-line` 을 둔다(스니펫 반영).
- **Task 3** (DB): 품질 리뷰(두 세션 psql 로 잠금 실험 — 역순이면 실제 40P01, 구현 순서는 교착 없음; `use_ticket` 재정의가 합류 중 새 가족에 기록함을 확인; `db push` 는 함수·권한만 건드림)로 ① ④ 뒤 재조회에 `not found` 가드(행이 사라지면 NULL 행을 돌려주던 틈), ② **`use_ticket_as_admin` 에 `p_request_id`(선택) 멱등** — 운영에 올라간 뒤 기본값 인자를 더하려면 `drop function` 이 필요해(`20261009000002:39`) 지금 넣었다; 시그니처 `(uuid, uuid, uuid, uuid)`, `duplicate_request` 코드, ③ 헤더에 재잠금 경로의 이론상 상호 합류 교착이 앱 경로로는 닿지 않음을 기록, ④ pgTAP +11(not_authenticated ×3 — `set local role authenticated` 로 grant 누락도 드러나게, `pg_locks` ④ 키 고정, 가족 일치 happy path, 멱등 ×4) → 140 = 43; 재리뷰로 ④ 단언을 **잠긴 적 없는 (B, 지난 식사) 쌍의 호출 전/후 비교**로 바꿈(앞선 성공 호출이 같은 키를 이미 쥐고 있어 공허하던 단언; `throws_ok` 안의 실패 호출은 서브트랜잭션 롤백으로 잠금이 풀린다) → 140 = 44, 총 392. 옛 3인자 overload 는 `drop function if exists` 로 정리(로컬 `migration up` 전용, 운영 no-op). 위 Task 3 스니펫은 반영본. 리뷰어 메모: 가족 블록의 `ticket_balances` 행이 사라질 수 있다(마지막 발급 취소 + 사용 없음) — `groupMealLedger` 가 0 으로 채운다(Task 1 테스트).
- **Task 2** (화면): 품질 리뷰 + 로컬 실데이터 스모크(관리자 발급 → 현황 → 명단·검색·없는 식사·비관리자 리다이렉트·로그아웃 상태, PostgREST 임베딩 200 확인). 반영: ① 발급이 없는 식사(내일 식사를 미리 연 경우)는 "찾는 가족이 없어요" 대신 **"아직 발급이 없어요"**(`searching` 로 분기), ② 없는 식사(`null`)는 폴링 중지(`refetchInterval` 콜백), ③ 정렬 보조 키 `.order('id')`, ④ 내역 목록 `aria-label`, 가족 제목 `title`, 현황 링크 탭 영역 확대, ⑤ 테스트는 스피너를 `getByText('불러오는 중…')` 로(Task 5 의 ConfirmButton 프롬프트가 `role="status"`). 위 Task 1·2 스니펫은 반영본. 미룬 것: `text-gray-500` 의 바탕색 대비(4.44:1, 기존 화면과 동일 → 5단계 a11y 일괄), 로딩·오류 상태의 h1 부재, 음수 잔량 표시 강조(Task 5 이후), 가상 스크롤(가족 수백 규모에서만).
- **Task 1** (조회): 계획 초안의 라벨 계산이 최근 발급부터 이름을 나열해 테스트의 기대(`'김철수 · 이영희'` — 먼저 산 사람 먼저)와 어긋났다. 구현은 `buyerId` 는 최근 활성 발급에서, 라벨은 오래된 발급부터(활성 → 취소 순)로 계산한다. 품질 리뷰로 ① `FamilyRow` → **`FamilyGroup`**(이후 Task 는 이 이름을 쓴다), ② 두 표 읽기에 `.order(…, desc)` 고정(ms 동률이 폴링마다 뒤바뀌어 `buyerId` 가 바뀌는 것 방지), ③ uuid 가 아닌 주소는 조회 없이 `null`(손으로 고친 `#/admin/meals/zzz` 가 22P02 → 영원한 '다시 시도' 가 되던 것), ④ 임베딩에 `deleted_at` 을 더해 **`buyerId` 는 탈퇴자를 건너뛰고** 산 사람(없으면 이 가족에서 쓴 산 사람)을 고른다 — `use_ticket_as_admin` 이 탈퇴자를 거부하므로, ⑤ 검색어 NFC 정규화, 이름 없는 가족은 맨 뒤, 사용만 남은 가족의 라벨도 오래된 순, ⑥ 오류 경로 테스트. 네 요청이 각자 스냅샷이라 합계와 줄이 잠깐 어긋날 수 있는 것은 5초 폴링으로 두고(조작 판단은 서버), 조작이 거부되면 현황을 바로 다시 읽는다(Task 4 `onError`). Task 1 스니펫은 리뷰 전 버전(이름만 `FamilyGroup` 으로 바꿔 둠). 재리뷰가 찾은 것: 장부의 `family_id` 는 발급 시점 스냅샷이고 `use_ticket_as_admin` 은 사람의 **현재** 가족에서 깎으므로, 가족을 옮긴 구매자를 옛 가족 블록에서 누르면 새 가족 풀이 깎인다 → ⑦ 임베딩에 `family_id` 를 더해 `buyerId` 는 **이 블록 가족에 아직 속한** 산 사람만 고르고(Task 1 후속 커밋; 테스트 픽스처의 `buyer`/`person` 에 `family_id` 가 들어간다), Task 3 의 `use_ticket_as_admin` 이 `p_family_id` 를 받아 `family_changed` 로 거부한다(5초 창도 닫음). 타입 이름은 `PersonRef`(name·deleted_at·family_id)·`NameRef`(name) 로 정리.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20261010000001_admin_ticket_ops.sql` | `cancel_issuance` · `use_ticket_as_admin` · `void_usage` + `use_ticket` 재정의 |
| `supabase/tests/database/140_admin_ticket_ops.sql` | 위 네 함수 pgTAP (44) |
| `src/lib/database.types.ts` (재생성) | RPC 3개 추가 |
| `src/features/admin/groupMealLedger.ts` (+test) | 순수: 식사 하나의 발급·사용·잔량 행 → 합계 + 가족별 블록, 이름 필터 |
| `src/features/admin/useMealDetail.ts` (+test) | 식사·발급·사용·잔량 네 조회 → `groupMealLedger`. 5초 폴링. 키 `['meal-detail', mealId]` |
| `src/features/admin/useMealOps.ts` (+test) | 뮤테이션 3개 + 무효화 묶음 `invalidateMealOps` |
| `src/pages/admin/MealDetailPage.tsx` (+test) | `#/admin/meals/:mealId` 화면 조립 |
| `src/pages/admin/AdminMealsPage.tsx` (수정, +test) | 카드에 "현황" 링크 |
| `src/App.tsx` (수정) | 라우트 |
| `src/lib/errors.ts` (수정, +test) | `issuance_not_found` `already_cancelled` `invalid_reason` `would_go_negative` `usage_not_found` `already_voided` `family_changed` |
| `e2e/admin.spec.ts` (신규) | 현황판 흐름 |
| `README.md` · 설계 문서 · 이 계획 | 동기화 |

## 공통 규약 (3단계 계획의 것을 그대로 적용 — 요약)

- 새 함수마다 `revoke execute … from public, anon` + `grant … to authenticated`. SECURITY DEFINER 는 `set search_path = public, pg_temp`. 오류는 `raise exception '<snake_case>'`(값 보간 금지). pgTAP `020` 이 "anon 에 열린 public 함수는 `{ping}` 뿐" 을 고정한다.
- **잠금 규칙:** ② 쓸 `people` 행 `for update` → ③ `lock_family` → ④ `lock_family_meal(family, meal)`(meal_id 순) → **장부 행(`issuances`/`usages`) 잠금은 ④ 뒤에**. 장부 행을 먼저 잠그고 ④ 를 기다리면 합류(③→④→장부 update)와 교착한다.
- pgTAP 에서 `issuances`·`usages`·`ticket_balances` 를 **직접 읽기 전에 `tests.clear_auth()`**, RPC 를 부르기 전에 다시 `tests.authenticate_as(...)`. 테스트 식사 제목은 `'테스트 점심 140'` 처럼 파일 번호를 박는다.
- 프론트: 조회 화면은 `data` 로 분기(`data !== undefined` — 이 화면은 `null` 이 "식사 없음" 이라는 정상 값이다). 뮤테이션 오류는 다음 동작 시작 때 `reset()`. `onSuccess` 는 무효화 promise 를 return. 무효화 테스트는 훅마다 새 QueryClient + 키 목록 전체 단언. 알림은 `getByText`. `vi.fn<…>()` 타입 인자 필수. 컴포넌트 파일은 컴포넌트만 export.
- `ConfirmButton` 계약: `label`(바쁘면 `'처리 중…'`), `message`, `confirmLabel`, `onConfirm`, `disabled`, `context`(같은 라벨이 여러 줄일 때 sr-only 접두사). **동작 라벨에 '취소' 를 단독으로 쓰지 않는다** — ConfirmButton 의 그만두기 버튼이 '취소' 다. 이 계획의 라벨: `발급 취소`/`취소하기`, `무효`/`무효 처리`, `1장 대신 사용`/`사용 처리`.
- **새 DB 오류 코드는 같은 커밋에서 `src/lib/errors.ts` 에 문구를 더한다.** 훅의 "서버가 판단한 거부" 판별(`rpcCodeOf`)이 MESSAGES 소속 여부로 돌아가므로, 문구가 빠진 코드는 일반 문구로 떨어질 뿐 아니라 현황 재조회·재시도 키 폐기도 건너뛴다(Task 4 리뷰).
- 커밋 메시지 `<type>: <설명>` + `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 작업 브랜치 `feat/phase4a-meal-detail`. `main` 직접 커밋 금지. PR 은 사용자가 merge 한다(merge 가 운영 마이그레이션을 실행한다).

```bash
cd /Users/hong-wongi/Dev/sample/meal-ticket
git checkout main && git pull --ff-only && git checkout -b feat/phase4a-meal-detail
git add docs/superpowers/plans/2026-10-10-phase4a-meal-detail.md && git commit -m "docs: 4a단계(식사 상세 현황판) 구현 계획

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: 순수 함수 `groupMealLedger` · 조회 훅 `useMealDetail`

**Files:**
- Create: `src/features/admin/groupMealLedger.ts`, `src/features/admin/groupMealLedger.test.ts`
- Create: `src/features/admin/useMealDetail.ts`, `src/features/admin/useMealDetail.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`src/features/admin/groupMealLedger.test.ts`:

```ts
import { filterFamilies, groupMealLedger, type MealIssuanceRow, type MealUsageRow } from './groupMealLedger'
import type { Balance } from '../tickets/groupTickets'

const issuance = (over: Partial<MealIssuanceRow>): MealIssuanceRow => ({
  id: 'i1', person_id: 'p1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: null,
  issued_at: '2026-10-09T05:00:00Z', cancelled_at: null, cancel_reason: null,
  buyer: { name: '김철수' }, issuer: { name: '권사' }, ...over,
})
const usage = (over: Partial<MealUsageRow>): MealUsageRow => ({
  id: 'u1', person_id: 'p2', family_id: 'f1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  person: { name: '서연' }, ...over,
})
const balance = (over: Partial<Balance>): Balance => ({ family_id: 'f1', meal_id: 'm1', issued: 0, used: 0, remaining: 0, amount: 0, ...over })

describe('groupMealLedger', () => {
  it('가족별로 묶고, 구매자 이름(활성 발급 먼저·중복 제거)을 라벨로, 최근 것부터 정렬한다', () => {
    const rows = groupMealLedger(
      [
        issuance({ id: 'i1', issued_at: '2026-10-09T05:00:00Z' }),
        issuance({ id: 'i2', person_id: 'p3', buyer: { name: '이영희' }, issued_at: '2026-10-10T05:00:00Z', quantity: 1 }),
        issuance({ id: 'i3', issued_at: '2026-10-08T05:00:00Z', cancelled_at: '2026-10-08T06:00:00Z', cancel_reason: '실수' }),
        issuance({ id: 'i4', family_id: 'f2', person_id: 'p9', buyer: { name: '박민수' }, issued_at: '2026-10-09T05:00:00Z', quantity: 4 }),
      ],
      [usage({ id: 'u1' }), usage({ id: 'u2', used_at: '2026-10-11T03:40:00Z', used_via: 'admin', person: { name: '김철수' } })],
      [balance({ family_id: 'f1', issued: 3, used: 2, remaining: 1, amount: 15000 }), balance({ family_id: 'f2', issued: 4, used: 0, remaining: 4, amount: 20000 })],
    )
    expect(rows.totals).toEqual({ issued: 7, used: 2, remaining: 5, amount: 35000 })
    expect(rows.families.map((f) => f.label)).toEqual(['김철수 · 이영희', '박민수'])
    const f1 = rows.families[0]!
    expect(f1).toMatchObject({ familyId: 'f1', issued: 3, used: 2, remaining: 1, amount: 15000, buyerId: 'p3' })
    expect(f1.issuances.map((i) => i.id)).toEqual(['i2', 'i1', 'i3'])
    expect(f1.issuances[0]).toMatchObject({ buyer: '이영희', quantity: 1, amount: 5000, issuer: '권사', cancelled: false })
    expect(f1.issuances[2]).toMatchObject({ cancelled: true, cancelReason: '실수' })
    expect(f1.usages.map((u) => u.id)).toEqual(['u2', 'u1'])
    expect(f1.usages[0]).toMatchObject({ person: '김철수', via: 'admin', voided: false })
  })

  it('발급 없이 사용만 남은 가족(장부가 옮겨진 경우)은 사용자 이름을 라벨로 쓴다', () => {
    const rows = groupMealLedger([], [usage({ family_id: 'f3', person: { name: '최은지' } })], [balance({ family_id: 'f3', used: 1, remaining: -1 })])
    expect(rows.families[0]).toMatchObject({ label: '최은지', buyerId: null, used: 1, remaining: -1 })
  })

  it('이름이 가려진 행(RLS·탈퇴)은 빈 이름을 건너뛰고, 아무 이름도 없으면 "(이름 없음)"', () => {
    const rows = groupMealLedger([issuance({ buyer: null }), issuance({ id: 'i2', buyer: { name: '' } })], [], [balance({})])
    expect(rows.families[0]!.label).toBe('(이름 없음)')
  })

  it('잔량 행이 없는 가족도(발급만 있고 뷰가 아직 안 읽힘) 0 으로 채운다', () => {
    const rows = groupMealLedger([issuance({})], [], [])
    expect(rows.families[0]).toMatchObject({ issued: 0, used: 0, remaining: 0, amount: 0 })
    expect(rows.totals).toEqual({ issued: 0, used: 0, remaining: 0, amount: 0 })
  })
})

describe('filterFamilies', () => {
  const families = groupMealLedger(
    [issuance({}), issuance({ id: 'i2', family_id: 'f2', person_id: 'p9', buyer: { name: '박민수' } })],
    [usage({ family_id: 'f2', person: { name: '박서준' } })],
    [],
  ).families
  it('빈 검색어는 전부', () => {
    expect(filterFamilies(families, '  ')).toHaveLength(2)
  })
  it('구매자 이름 일부로 찾는다', () => {
    expect(filterFamilies(families, '철수').map((f) => f.label)).toEqual(['김철수'])
  })
  it('사용한 사람(자녀) 이름으로도 찾는다', () => {
    expect(filterFamilies(families, '서준').map((f) => f.label)).toEqual(['박민수'])
  })
})
```

`src/features/admin/useMealDetail.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FakeQuery, ok } from '../../test/fakeSupabase'
import { MEAL_DETAIL_POLL_MS, mealDetailQueryKey, useMealDetail } from './useMealDetail'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11', note: null, created_by: 'a', created_at: '' }
const issuanceRow = {
  id: 'i1', person_id: 'p1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: null, issued_at: '2026-10-09T05:00:00Z',
  cancelled_at: null, cancel_reason: null, buyer: { name: '김철수' }, issuer: { name: '권사' },
}
const usageRow = { id: 'u1', person_id: 'p1', family_id: 'f1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null, person: { name: '김철수' } }
const balanceRow = { family_id: 'f1', meal_id: 'm1', issued: 2, used: 1, remaining: 1, amount: 10000 }

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useMealDetail', () => {
  it('식사·발급·사용·잔량을 식사 id 로 읽어 가족별 현황으로 묶는다', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => {
      const data = table === 'meals' ? meal : table === 'issuances' ? [issuanceRow] : table === 'usages' ? [usageRow] : [balanceRow]
      return (queries[table] = ok(data))
    })
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useMealDetail('m1'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.meal).toEqual(meal)
    expect(result.current.data?.ledger.totals).toEqual({ issued: 2, used: 1, remaining: 1, amount: 10000 })
    expect(result.current.data?.ledger.families[0]).toMatchObject({ label: '김철수', issued: 2, used: 1 })
    expect(queries.meals?.has('eq', 'id', 'm1')).toBe(true)
    expect(queries.meals?.has('maybeSingle')).toBe(true)
    expect(queries.issuances?.has('eq', 'meal_id', 'm1')).toBe(true)
    expect(queries.usages?.has('eq', 'meal_id', 'm1')).toBe(true)
    expect(queries.ticket_balances?.has('eq', 'meal_id', 'm1')).toBe(true)
    // 캐시 키에 식사 id 가 들어간다 (다른 식사와 섞이지 않는다)
    expect(client.getQueryData(mealDetailQueryKey('m1'))).toBeDefined()
  })

  it('식사가 없으면 null (오류가 아니다)', async () => {
    from.mockImplementation((table: string) => ok(table === 'meals' ? null : []))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMealDetail('gone'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBeNull()
  })

  it('5초마다 다시 읽는다 (설계 §8.3)', () => {
    expect(MEAL_DETAIL_POLL_MS).toBe(5_000)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/features/admin/groupMealLedger src/features/admin/useMealDetail`
Expected: 모듈 없음.

- [ ] **Step 3: 구현**

`src/features/admin/groupMealLedger.ts`:

```ts
import type { Balance } from '../tickets/groupTickets'

type NameRef = { name: string } | null

/** issuances 에 구매자·발급자 이름을 임베딩한 행 (select 문자열은 useMealDetail 참고) */
export type MealIssuanceRow = {
  id: string
  person_id: string
  family_id: string
  quantity: number
  unit_price: number
  memo: string | null
  issued_at: string
  cancelled_at: string | null
  cancel_reason: string | null
  buyer: NameRef
  issuer: NameRef
}
export type MealUsageRow = {
  id: string
  person_id: string
  family_id: string
  used_at: string
  used_via: string // DB 는 check 제약뿐인 text
  voided_at: string | null
  person: NameRef
}

export type MealIssuance = {
  id: string; personId: string; buyer: string; quantity: number; unitPrice: number; amount: number
  memo: string | null; issuedAt: string; issuer: string; cancelled: boolean; cancelReason: string | null
}
export type MealUsage = { id: string; personId: string; person: string; via: 'self' | 'admin'; usedAt: string; voided: boolean }
export type FamilyGroup = {
  familyId: string
  /** 구매자 이름들(활성 발급 먼저, 중복 제거) — "김철수 · 이영희". 발급이 없으면 사용자 이름. */
  label: string
  issued: number
  used: number
  remaining: number
  amount: number
  /** 최근 발급부터 */
  issuances: MealIssuance[]
  /** 최근 사용부터 */
  usages: MealUsage[]
  /** "1장 대신 사용" 의 누구 몫 — 가장 최근 활성 발급의 구매자. 활성 발급이 없으면 null (버튼 비활성) */
  buyerId: string | null
}
export type MealTotals = { issued: number; used: number; remaining: number; amount: number }
export type MealLedger = { totals: MealTotals; families: FamilyGroup[] }

export const NO_NAME = '(이름 없음)'
const byTimeDesc = (a: string, b: string) => Date.parse(b) - Date.parse(a)

/** 식사 하나의 발급·사용·잔량 행을 가족별 블록과 합계로 묶는다. 이름이 가려진 행(RLS·탈퇴)은 빈 이름으로 둔다. */
export function groupMealLedger(issuances: readonly MealIssuanceRow[], usages: readonly MealUsageRow[], balances: readonly Balance[]): MealLedger {
  const byFamily = new Map<string, FamilyGroup>()
  const rowOf = (familyId: string): FamilyGroup => {
    const existing = byFamily.get(familyId)
    if (existing) return existing
    const fresh: FamilyGroup = { familyId, label: NO_NAME, issued: 0, used: 0, remaining: 0, amount: 0, issuances: [], usages: [], buyerId: null }
    byFamily.set(familyId, fresh)
    return fresh
  }
  for (const i of issuances.toSorted((a, b) => byTimeDesc(a.issued_at, b.issued_at))) {
    rowOf(i.family_id).issuances.push({
      id: i.id, personId: i.person_id, buyer: i.buyer?.name ?? '', quantity: i.quantity, unitPrice: i.unit_price,
      amount: i.quantity * i.unit_price, memo: i.memo, issuedAt: i.issued_at, issuer: i.issuer?.name ?? '관리자',
      cancelled: i.cancelled_at !== null, cancelReason: i.cancel_reason,
    })
  }
  for (const u of usages.toSorted((a, b) => byTimeDesc(a.used_at, b.used_at))) {
    rowOf(u.family_id).usages.push({
      id: u.id, personId: u.person_id, person: u.person?.name ?? '', via: u.used_via === 'admin' ? 'admin' : 'self',
      usedAt: u.used_at, voided: u.voided_at !== null,
    })
  }
  for (const b of balances) {
    if (!b.family_id) continue
    const r = rowOf(b.family_id)
    r.issued = b.issued ?? 0
    r.used = b.used ?? 0
    r.remaining = b.remaining ?? 0
    r.amount = b.amount ?? 0
  }
  for (const r of byFamily.values()) {
    // r.issuances 는 최근 발급부터(내림차순) — "1장 대신 사용" 버튼은 가장 최근 활성 발급의 구매자를 쓴다.
    const activeDesc = r.issuances.filter((i) => !i.cancelled)
    r.buyerId = activeDesc[0]?.personId ?? null
    // 라벨은 오래된 발급부터 나열한다("먼저 산 사람 먼저") — 활성 발급을 모두 앞세우고, 그 다음 취소된 발급.
    const ascending = [...r.issuances].toReversed()
    const names = [...ascending.filter((i) => !i.cancelled), ...ascending.filter((i) => i.cancelled)].map((i) => i.buyer)
    const fallback = r.usages.map((u) => u.person)
    const unique = [...new Set([...names, ...(names.some(Boolean) ? [] : fallback)].filter(Boolean))]
    r.label = unique.length > 0 ? unique.join(' · ') : NO_NAME
  }
  const families = [...byFamily.values()].toSorted((a, b) => a.label.localeCompare(b.label, 'ko'))
  const totals = families.reduce<MealTotals>(
    (t, f) => ({ issued: t.issued + f.issued, used: t.used + f.used, remaining: t.remaining + f.remaining, amount: t.amount + f.amount }),
    { issued: 0, used: 0, remaining: 0, amount: 0 },
  )
  return { totals, families }
}

/** 이름 검색: 구매자·사용자 이름 어디든 검색어가 들어 있는 가족만. 빈 검색어는 전부. */
export function filterFamilies(families: readonly FamilyGroup[], query: string): FamilyGroup[] {
  const q = query.trim()
  if (!q) return [...families]
  return families.filter((f) => f.label.includes(q) || f.issuances.some((i) => i.buyer.includes(q)) || f.usages.some((u) => u.person.includes(q)))
}
```

`src/features/admin/useMealDetail.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Meal } from '../tickets/groupTickets'
import { groupMealLedger, type MealLedger } from './groupMealLedger'

/** 화면이 보이는 동안의 재조회 주기 (설계 §8.3 식사 상세 5초 폴링). 숨겨지면 멈추고 돌아오면 즉시 다시 읽는다. */
export const MEAL_DETAIL_POLL_MS = 5_000

export const mealDetailQueryKey = (mealId: string) => ['meal-detail', mealId] as const

// FK 가 둘(person_id, issued_by)이라 임베딩에 제약 이름 힌트가 필요하다 (useFamilyLedger 와 같은 규칙).
const ISSUANCE_SELECT =
  'id, person_id, family_id, quantity, unit_price, memo, issued_at, cancelled_at, cancel_reason, buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name)'
const USAGE_SELECT = 'id, person_id, family_id, used_at, used_via, voided_at, person:people!usages_person_id_fkey(name)'

export type MealDetail = { meal: Meal; ledger: MealLedger }

/** 식사 하나의 현황. 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다. 식사가 없으면 null. */
export function useMealDetail(mealId: string) {
  return useQuery({
    queryKey: mealDetailQueryKey(mealId),
    queryFn: async (): Promise<MealDetail | null> => {
      const [meal, issuances, usages, balances] = await Promise.all([
        // queryFn 문맥 타입과 maybeSingle 의 제네릭 추론이 부딪히므로(useLatestUnitPrice 참고) unwrap 에 타입 인자를 준다
        supabase.from('meals').select('*').eq('id', mealId).maybeSingle().then((r) => unwrap<Meal | null>(r)),
        supabase.from('issuances').select(ISSUANCE_SELECT).eq('meal_id', mealId).order('issued_at', { ascending: false }).order('id').then(unwrap),
        supabase.from('usages').select(USAGE_SELECT).eq('meal_id', mealId).order('used_at', { ascending: false }).order('id').then(unwrap),
        supabase.from('ticket_balances').select('*').eq('meal_id', mealId).then(unwrap),
      ])
      if (!meal) return null
      // 두 select 문자열은 MealIssuanceRow·MealUsageRow 와 구조적으로 일치한다 (tsc 가 검증)
      return { meal, ledger: groupMealLedger(issuances, usages, balances) }
    },
    // 없는 식사(null)는 다시 읽어도 달라지지 않는다 — 폴링을 멈춘다 (포커스 복귀 재조회는 그대로)
    refetchInterval: (q) => (q.state.data === null ? false : MEAL_DETAIL_POLL_MS),
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/features/admin && npm run lint && npx tsc -b`
Expected: 전부 통과. (`tsc` 가 임베딩 행 타입을 `MealIssuanceRow` 에 맞추지 못하면 select 문자열의 열 이름을 다시 확인한다 — `useFamilyLedger.ts` 의 문자열과 같은 규칙이다.)

- [ ] **Step 5: 커밋**

```bash
git add src/features/admin/groupMealLedger.ts src/features/admin/groupMealLedger.test.ts src/features/admin/useMealDetail.ts src/features/admin/useMealDetail.test.tsx
git commit -m "feat(admin): 식사 현황 조회 — groupMealLedger, useMealDetail(5초 폴링)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 2: 식사 상세 화면(읽기 전용) — `MealDetailPage` · 라우트 · 식사 카드 "현황" 링크

**Files:**
- Create: `src/pages/admin/MealDetailPage.tsx`, `src/pages/admin/MealDetailPage.test.tsx`
- Modify: `src/pages/admin/AdminMealsPage.tsx` (카드에 링크), `src/pages/admin/AdminMealsPage.test.tsx` (단언 1개 추가)
- Modify: `src/App.tsx` (라우트)

- [ ] **Step 1: 실패하는 테스트**

`src/pages/admin/MealDetailPage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { groupMealLedger, type MealIssuanceRow, type MealUsageRow } from '../../features/admin/groupMealLedger'
import type { MealDetail } from '../../features/admin/useMealDetail'
import { MealDetailPage } from './MealDetailPage'

type Q = { status: 'pending' | 'error' | 'success'; data?: MealDetail | null; refetch: () => void }
const { useMealDetail } = vi.hoisted(() => ({ useMealDetail: vi.fn<(mealId: string) => Q>() }))
vi.mock('../../features/admin/useMealDetail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useMealDetail')>()),
  useMealDetail,
}))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11', note: null, created_by: 'a', created_at: '' }
const issuance = (over: Partial<MealIssuanceRow>): MealIssuanceRow => ({
  id: 'i1', person_id: 'p1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: null, issued_at: '2026-10-09T05:00:00Z',
  cancelled_at: null, cancel_reason: null, buyer: { name: '김철수', deleted_at: null, family_id: 'f1' }, issuer: { name: '권사' }, ...over,
})
const usage = (over: Partial<MealUsageRow>): MealUsageRow => ({
  id: 'u1', person_id: 'p2', family_id: 'f1', used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null, person: { name: '서연', deleted_at: null, family_id: 'f1' }, ...over,
})
const ledger = groupMealLedger(
  [
    issuance({ id: 'i1' }),
    issuance({ id: 'i2', person_id: 'p3', buyer: { name: '이영희', deleted_at: null, family_id: 'f1' }, quantity: 1, issued_at: '2026-10-10T05:00:00Z', memo: '입금 확인' }),
    issuance({ id: 'i3', quantity: 1, issued_at: '2026-10-08T05:00:00Z', cancelled_at: '2026-10-08T06:00:00Z', cancel_reason: '실수' }),
    issuance({ id: 'i4', family_id: 'f2', person_id: 'p9', buyer: { name: '박민수', deleted_at: null, family_id: 'f2' }, quantity: 4, issued_at: '2026-10-09T05:00:00Z' }),
  ],
  [usage({ id: 'u1' }), usage({ id: 'u2', used_at: '2026-10-11T03:40:00Z', used_via: 'admin', person: { name: '김철수', deleted_at: null, family_id: 'f1' } })],
  [
    { family_id: 'f1', meal_id: 'm1', issued: 3, used: 2, remaining: 1, amount: 15000 },
    { family_id: 'f2', meal_id: 'm1', issued: 4, used: 0, remaining: 4, amount: 20000 },
  ],
)
const detail: MealDetail = { meal, ledger }

function renderPage(path = '/admin/meals/m1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/meals/:mealId" element={<MealDetailPage />} />
        <Route path="/admin/meals" element={<p>식사 목록</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useMealDetail.mockReturnValue({ status: 'success', data: detail, refetch: vi.fn<() => void>() })
})

describe('MealDetailPage', () => {
  it('식사 제목, 네 숫자 한 줄, 가족별 블록(라벨 · N장 중 M장 사용 · 발급·사용 줄)', () => {
    renderPage()
    expect(useMealDetail).toHaveBeenCalledWith('m1')
    expect(screen.getByRole('heading', { level: 1, name: '10월 11일 (주일) · 주일 점심' })).toBeInTheDocument()
    expect(screen.getByText('발급 7장 · 사용 2장 · 남음 5장 · 35,000원')).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: '가족별 현황' })).getAllByRole('listitem', { name: /./ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['김철수 · 이영희', '박민수'])
    const f1 = rows[0]!
    expect(f1).toHaveTextContent('3장 중 2장 사용')
    expect(f1).toHaveTextContent('남음 1장 · 15,000원')
    // 발급 줄: 최근 것부터, 취소된 것은 취소됨 표시
    expect(f1).toHaveTextContent('발급 1장 · 이영희 · 5,000원')
    expect(f1).toHaveTextContent('10/10 14:00 · 권사 · 입금 확인')
    expect(f1).toHaveTextContent('취소됨 · 실수')
    // 사용 줄: 자녀 폰 / 담당자 처리
    expect(f1).toHaveTextContent('사용 1장 · 김철수 몫 · 담당자 처리')
    expect(f1).toHaveTextContent('사용 1장 · 서연 폰')
  })

  it('이름으로 찾으면 그 가족만 남고, 없으면 안내', async () => {
    renderPage()
    const box = screen.getByLabelText('이름으로 찾기')
    await userEvent.type(box, '민수')
    expect(within(screen.getByRole('list', { name: '가족별 현황' })).getAllByRole('listitem', { name: /./ }).map((r) => r.getAttribute('aria-label'))).toEqual(['박민수'])
    await userEvent.clear(box)
    await userEvent.type(box, '없는사람')
    expect(screen.getByText('찾는 가족이 없어요')).toBeInTheDocument()
  })

  it('발급이 하나도 없는 식사는 "아직 발급이 없어요" (검색 중이 아닐 때)', () => {
    useMealDetail.mockReturnValue({ status: 'success', data: { meal, ledger: { totals: { issued: 0, used: 0, remaining: 0, amount: 0 }, families: [] } }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('발급 0장 · 사용 0장 · 남음 0장 · 0원')).toBeInTheDocument()
    expect(screen.getByText('아직 발급이 없어요')).toBeInTheDocument()
  })

  it('"← 식사" 링크는 식사 목록으로', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('link', { name: '← 식사' }))
    expect(screen.getByText('식사 목록')).toBeInTheDocument()
  })

  it('식사가 없으면(null) 안내만', () => {
    useMealDetail.mockReturnValue({ status: 'success', data: null, refetch: vi.fn<() => void>() })
    renderPage('/admin/meals/gone')
    expect(screen.getByRole('alert')).toHaveTextContent('식사를 찾을 수 없어요')
    expect(screen.queryByRole('list', { name: '가족별 현황' })).not.toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useMealDetail.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { rerender } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    const refetch = vi.fn<() => void>()
    useMealDetail.mockReturnValue({ status: 'error', refetch })
    rerender(
      <MemoryRouter initialEntries={['/admin/meals/m1']}>
        <Routes>
          <Route path="/admin/meals/:mealId" element={<MealDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('데이터가 있는 채 재조회가 실패하면 작은 안내만 덧붙인다 (data 로 분기)', () => {
    useMealDetail.mockReturnValue({ status: 'error', data: detail, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('최신 현황을 받지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '가족별 현황' })).toBeInTheDocument()
  })
})
```

`src/pages/admin/AdminMealsPage.test.tsx` — 기존 "카드에 발급·가족·금액·사용률을 보여 주고…" 테스트 안, `expect(card).toHaveTextContent('사용 2 / 6')` 다음 줄에 추가:

```tsx
    expect(within(card).getByRole('link', { name: '10월 11일 (주일) 주일 점심 현황' })).toHaveAttribute('href', '/admin/meals/m1')
```

(파일 상단 import 를 `import { render, screen, within } from '@testing-library/react'` 로 바꾼다.)

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/pages/admin`
Expected: `MealDetailPage` 모듈 없음, AdminMealsPage 링크 단언 실패.

- [ ] **Step 3: 구현**

`src/pages/admin/MealDetailPage.tsx`:

```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Spinner, TextField } from '../../components/ui'
import { filterFamilies, type FamilyGroup, type MealIssuance, type MealUsage } from '../../features/admin/groupMealLedger'
import { useMealDetail } from '../../features/admin/useMealDetail'
import { formatDateTime, formatMealDate } from '../../lib/dates'
import { formatWon } from '../../lib/money'

/** `#/admin/meals/:mealId` — 식사 하나의 현황판 (설계 §8.3). 발급·사용·남음·금액, 이름 검색, 가족별 명단. 5초 폴링은 훅이 한다. */
export function MealDetailPage() {
  const { mealId = '' } = useParams()
  const detail = useMealDetail(mealId)
  const [query, setQuery] = useState('')

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link to="/admin/meals" className="text-sm text-blue-600 underline">← 식사</Link>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* data 로 분기한다 (공통 규약). 이 화면은 null 이 "식사 없음" 이라는 정상 값이라 undefined 와 구분한다. */}
      {detail.data !== undefined ? (
        detail.data === null ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
            식사를 찾을 수 없어요. 목록으로 돌아가 주세요.
          </p>
        ) : (
          <>
            <h1 className="text-lg font-extrabold">{formatMealDate(detail.data.meal.served_on)} · {detail.data.meal.title}</h1>
            {detail.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 현황을 받지 못했어요</p>}
            <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold">
              발급 {detail.data.ledger.totals.issued}장 · 사용 {detail.data.ledger.totals.used}장 · 남음 {detail.data.ledger.totals.remaining}장 · {formatWon(detail.data.ledger.totals.amount)}
            </p>
            <TextField label="이름으로 찾기" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="구매자·사용자 이름" autoComplete="off" />
            <FamilyList families={filterFamilies(detail.data.ledger.families, query)} searching={query.trim() !== ''} />
          </>
        )
      ) : detail.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          현황을 불러오지 못했어요
          <button type="button" onClick={() => void detail.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function FamilyList({ families, searching }: { families: readonly FamilyGroup[]; searching: boolean }) {
  // 검색 중이 아닌데 비었으면 "아직 발급 없음" — 내일 식사를 미리 열어 본 관리자가 고장으로 오해하지 않게 (Task 2 리뷰)
  if (families.length === 0) return <p className="py-6 text-center text-sm text-gray-500">{searching ? '찾는 가족이 없어요' : '아직 발급이 없어요'}</p>
  return (
    <ul aria-label="가족별 현황" className="flex flex-col gap-2">
      {families.map((f) => <FamilyBlock key={f.familyId} family={f} />)}
    </ul>
  )
}

/** 가족 한 블록: 구매자 이름들 · "N장 중 M장 사용" · 남음·금액 · 발급 줄 · 사용 줄 */
function FamilyBlock({ family }: { family: FamilyGroup }) {
  return (
    <li aria-label={family.label} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate font-bold" title={family.label}>{family.label}</h2>
        <span className="shrink-0 text-sm">{family.issued}장 중 {family.used}장 사용</span>
      </div>
      <p className="text-xs text-gray-500">남음 {family.remaining}장 · {formatWon(family.amount)}</p>
      <ul aria-label="발급·사용 내역" className="mt-2 flex flex-col gap-2 text-sm">
        {family.issuances.map((i) => <IssuanceLine key={i.id} issuance={i} />)}
        {family.usages.map((u) => <UsageLine key={u.id} usage={u} />)}
      </ul>
    </li>
  )
}

function IssuanceLine({ issuance: i }: { issuance: MealIssuance }) {
  return (
    <li className={i.cancelled ? 'text-gray-500' : ''}>
      <div className={i.cancelled ? 'line-through' : ''}>발급 {i.quantity}장 · {i.buyer || '(이름 없음)'} · {formatWon(i.amount)}</div>
      <div className="text-xs text-gray-500">{formatDateTime(i.issuedAt)} · {i.issuer}{i.memo ? ` · ${i.memo}` : ''}</div>
      {i.cancelled && <div className="text-xs font-bold">취소됨{i.cancelReason ? ` · ${i.cancelReason}` : ''}</div>}
    </li>
  )
}

function UsageLine({ usage: u }: { usage: MealUsage }) {
  // admin 이면 person 은 "누구 몫으로", self 면 "어느 폰에서". 이름이 가려졌으면(탈퇴) 자리를 비우지 않는다.
  const who = u.via === 'admin' ? `${u.person || '가족'} 몫 · 담당자 처리` : `${u.person || '가족'} 폰`
  return (
    <li className={u.voided ? 'text-gray-500' : ''}>
      <div className={u.voided ? 'line-through' : ''}>사용 1장 · {who}</div>
      <div className="text-xs text-gray-500">{formatDateTime(u.usedAt)}</div>
      {u.voided && <div className="text-xs font-bold">무효</div>}
    </li>
  )
}
```

`src/pages/admin/AdminMealsPage.tsx` — `MealCard` 머리 줄의 삭제 버튼 옆에 링크를 둔다 (import 에 `Link` 추가: `import { Link } from 'react-router'`):

```tsx
        <div className="flex shrink-0 items-center gap-3">
          <Link to={`/admin/meals/${meal.id}`} aria-label={`${label} 현황`} className="-my-2 px-2 py-2 text-xs text-blue-600 underline">현황</Link>
          {/* 발급이 있으면 FK 가 막으므로 버튼 자체를 감춘다 */}
          {s.issued === 0 && (
            <button type="button" onClick={() => onDelete(meal)} disabled={deleting} aria-label={`${label} 삭제`} className="text-xs text-red-600 underline">삭제</button>
          )}
        </div>
```

(기존의 `{s.issued === 0 && (<button …>삭제</button>)}` 블록을 위 `div` 로 감싸 바꾼다. 다른 곳은 그대로.)

`src/App.tsx` — import `MealDetailPage` from `./pages/admin/MealDetailPage`, `RequirePerson` 아래 관리자 라우트에 추가:

```tsx
              <Route path="/admin/meals/:mealId" element={<RequireAdmin><MealDetailPage /></RequireAdmin>} />
```

- [ ] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과. (`PersonShell` 은 `/admin/` 접두사로 관리자 탭을 고르고, `TabBar` 의 "식사" 탭은 `end` 가 아니라 `/admin/meals/:id` 에서도 활성이다 — 별도 수정 없음.)

- [ ] **Step 5: 수동 확인 (로컬)**

Run: `npm run dev`. 개발 로그인 `e2e-admin@test.local` → 관리 › 식사 › 카드의 "현황" → 네 숫자·가족 블록·검색 확인. (Task 6 의 E2E 가 같은 흐름을 자동화한다.)

- [ ] **Step 6: 커밋**

```bash
git add src/pages/admin/MealDetailPage.tsx src/pages/admin/MealDetailPage.test.tsx src/pages/admin/AdminMealsPage.tsx src/pages/admin/AdminMealsPage.test.tsx src/App.tsx
git commit -m "feat(admin): 식사 상세 현황판(#/admin/meals/:mealId) — 네 숫자, 이름 검색, 가족별 발급·사용 명단

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**중간 배포 지점.** 여기까지가 "식사별 발급 명단" 이다. 사용자가 당장 쓰고 싶어 하면 이 커밋으로 PR 을 만들어 merge 할 수 있다(마이그레이션 없음). 이후 Task 는 같은 브랜치에서 이어 간다.

---
### Task 3: 마이그레이션 ⑬ `cancel_issuance` · `use_ticket_as_admin` · `void_usage` · `use_ticket` 재정의

**Files:**
- Create: `supabase/migrations/20261010000001_admin_ticket_ops.sql`
- Create: `supabase/tests/database/140_admin_ticket_ops.sql`
- Regenerate: `src/lib/database.types.ts`

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/database/140_admin_ticket_ops.sql`:

```sql
begin;
select plan(44);

-- 권한: anon 은 셋 다 실행 불가, authenticated 는 재정의된 use_ticket 을 여전히 실행할 수 있다
select is(has_function_privilege('anon', 'public.cancel_issuance(uuid,text)', 'EXECUTE'), false, 'anon 은 cancel_issuance 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.use_ticket_as_admin(uuid,uuid,uuid,uuid)', 'EXECUTE'), false, 'anon 은 use_ticket_as_admin 을 실행할 수 없다');
select is(has_function_privilege('anon', 'public.void_usage(uuid)', 'EXECUTE'), false, 'anon 은 void_usage 를 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.use_ticket(uuid,uuid)', 'EXECUTE'), true, '재정의된 use_ticket 은 authenticated 가 실행할 수 있다');

-- 준비: 가족 A = 김철수 + 자녀 서연(익명 계정), 가족 B = 이영희, 관리자, 사람 행 없는 계정. 오늘 식사 + 지난 식사.
select tests.create_user('ops-a@test.local') as a_uid \gset
select tests.create_user() as kid_uid \gset
select tests.create_user('ops-b@test.local') as b_uid \gset
select tests.create_user('ops-admin@test.local') as admin_uid \gset
select tests.create_user('ops-ghost@test.local') as ghost_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01077770001', :'a_uid', now(), '2026-10-07'),
       ('이영희', '01077770002', :'b_uid', now(), '2026-10-07'),
       ('권사',   '01077770009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid, family_id as b_fid from public.people where auth_user_id = :'b_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'a_fid', :'kid_uid', true, :'a_pid', now()) returning id as kid_pid \gset
insert into public.people (name, phone, deleted_at) values ('탈퇴자', null, now()) returning id as deleted_pid \gset
select (now() at time zone 'Asia/Seoul')::date as today \gset
-- ★ 제목은 이 테스트만 쓰는 고유값 (로컬에 남은 행과 (served_on, title) 충돌 방지)
insert into public.meals (title, served_on, created_by) values ('테스트 점심 140', :'today', :'admin_pid') returning id as today_meal \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 140 지난주', :'today'::date - 7, :'admin_pid') returning id as past_meal \gset
-- A 오늘: 3장(i1) + 2장(i2). B 지난주: 1장(i3). B 오늘: 없음.
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'today_meal', 3, 5000, :'admin_pid') returning id as i1 \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'today_meal', 2, 5000, :'admin_pid') returning id as i2 \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'b_pid', :'b_fid', :'past_meal', 1, 5000, :'admin_pid') returning id as i3 \gset

-- 교인(비관리자)은 셋 다 forbidden
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'forbidden', '교인은 발급을 취소할 수 없다');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'a_pid', :'today_meal'), 'P0001', 'forbidden', '교인은 대신 사용 처리를 할 수 없다');
select throws_ok(format($$ select public.void_usage(%L) $$, gen_random_uuid()), 'P0001', 'forbidden', '교인은 사용을 무효 처리할 수 없다');
-- 사람 행이 없는 계정도 forbidden
select tests.authenticate_as(:'ghost_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'forbidden', '사람 행이 없는 계정은 취소할 수 없다');

-- JWT 없이 직접 호출 (세 함수 모두, 090 의 규약에 set local role authenticated 를 더한 것 — grant 가 빠지면 42501 로 드러난다)
select tests.clear_auth();
set local role authenticated;
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'not_authenticated', 'JWT 가 없으면 cancel_issuance 는 not_authenticated');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'a_pid', :'today_meal'), 'P0001', 'not_authenticated', 'JWT 가 없으면 use_ticket_as_admin 은 not_authenticated');
select throws_ok(format($$ select public.void_usage(%L) $$, gen_random_uuid()), 'P0001', 'not_authenticated', 'JWT 가 없으면 void_usage 는 not_authenticated');
reset role;

-- 관리자: 취소
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, gen_random_uuid()), 'P0001', 'issuance_not_found', '없는 발급은 거부');
select throws_ok(format($$ select public.cancel_issuance(%L, %L) $$, :'i2', repeat('가', 101)), 'P0001', 'invalid_reason', '101자 사유는 거부');
select lives_ok(format($$ select public.cancel_issuance(%L, '  실수  ') $$, :'i2'), '관리자는 발급을 취소할 수 있다');
select tests.clear_auth();
select is((select cancel_reason from public.issuances where id = :'i2'), '실수', '사유 공백이 정리돼 기록된다');
select is((select cancelled_by from public.issuances where id = :'i2'), :'admin_pid'::uuid, '취소한 관리자가 기록된다');
select is((select issued from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 3, '취소된 발급은 잔량에서 빠진다');
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'already_cancelled', '이미 취소된 발급은 다시 취소할 수 없다');

-- 관리자: 대신 사용
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, gen_random_uuid(), :'today_meal'), 'P0001', 'person_not_found', '없는 사람은 거부');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'deleted_pid', :'today_meal'), 'P0001', 'person_not_found', '탈퇴한 사람은 거부');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'a_pid', gen_random_uuid()), 'P0001', 'meal_not_found', '없는 식사는 거부');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'b_pid', :'today_meal'), 'P0001', 'no_remaining', '잔량이 없는 가족은 거부');
-- 화면이 본 가족(p_family_id)과 사람의 현재 가족이 다르면 거부 — A 의 김철수를 B 가족 블록에서 누른 상황
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L) $$, :'a_pid', :'today_meal', :'b_fid'), 'P0001', 'family_changed', '그 사이 가족이 바뀐 사람은 거부');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'kid_pid', :'today_meal'), '자녀 몫으로도 대신 사용 처리할 수 있다 (잔량은 가족 것)');
-- ④ 잠금: 아직 아무도 잠그지 않은 (B, 지난 식사) 쌍으로 호출 전/후를 비교한다.
-- 주의: throws_ok 안에서 실패한 호출은 서브트랜잭션이 롤백되며 advisory xact 잠금도 풀린다 — 잠금 단언은 성공한 호출 뒤에만 의미가 있다.
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'b_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'past_meal'::text)::bigint & 4294967295)),
          0::bigint, '호출 전에는 (B, 지난 식사) ④ 잠금이 없다');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'b_pid', :'past_meal'), '지난 식사도 대신 사용 처리할 수 있다 (날짜 제한 없음)');
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'b_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'past_meal'::text)::bigint & 4294967295)),
          1::bigint, 'use_ticket_as_admin 이 (가족, 식사) ④ 잠금을 쥔다');
select tests.clear_auth();
select results_eq(
  format($$ select family_id, person_id, used_via, recorded_by, quantity, voided_at from public.usages where meal_id = %L $$, :'today_meal'),
  format($$ values (%L::uuid, %L::uuid, 'admin'::text, %L::uuid, 1, null::timestamptz) $$, :'a_fid', :'kid_pid', :'admin_pid'),
  '대신 사용은 가족·대상(자녀)·admin·처리한 관리자로 기록된다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 2, '대신 사용 뒤 A 가족 남은 장수는 2');
select id as admin_usage from public.usages where meal_id = :'today_meal' and used_via = 'admin' \gset

-- 정상 경로: 화면이 본 가족이 지금 가족과 같으면(p_family_id 일치) 그대로 처리된다
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L) $$, :'a_pid', :'today_meal', :'a_fid'), '화면이 본 가족이 지금 가족과 같으면 대신 사용할 수 있다 (정상 경로)');
select tests.clear_auth();
select id as a_usage from public.usages where meal_id = :'today_meal' and used_via = 'admin' and person_id = :'a_pid' \gset
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 1, '정상 경로 사용 뒤 A 가족 남은 장수는 1');

-- 관리자: 무효
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.void_usage(%L) $$, gen_random_uuid()), 'P0001', 'usage_not_found', '없는 사용 기록은 거부');
select lives_ok(format($$ select public.void_usage(%L) $$, :'admin_usage'), '관리자는 사용 기록을 무효 처리할 수 있다');
select lives_ok(format($$ select public.void_usage(%L) $$, :'a_usage'), '정상 경로로 쓴 사용 기록도 무효 처리할 수 있다 (상쇄)');
select tests.clear_auth();
select is((select voided_by from public.usages where id = :'admin_usage'), :'admin_pid'::uuid, '무효 처리한 관리자가 기록된다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 3, '무효 처리된 사용은 잔량에서 빠진다');
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.void_usage(%L) $$, :'admin_usage'), 'P0001', 'already_voided', '이미 무효인 기록은 다시 무효 처리할 수 없다');

-- 관리자: 대신 사용 멱등(p_request_id) — 같은 값은 처음 결과를 돌려준다(use_ticket 과 같은 규칙)
select tests.authenticate_as(:'admin_uid');
select gen_random_uuid() as rid \gset
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L, %L) $$, :'kid_pid', :'today_meal', :'a_fid', :'rid'), '같은 request_id 로 첫 호출은 기록된다');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L, %L) $$, :'kid_pid', :'today_meal', :'a_fid', :'rid'), '같은 request_id 로 다시 호출해도 살아 있다 (멱등)');
select tests.clear_auth();
select is((select count(*)::integer from public.usages where request_id = :'rid'), 1, '같은 request_id 는 한 건만');
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L, %L) $$, :'b_pid', :'past_meal', :'b_fid', :'rid'), 'P0001', 'duplicate_request', '다른 사람·식사에 같은 request_id 를 재사용하면 거부');

-- 재정의된 use_ticket: 교인이 그대로 쓸 수 있고, 그 뒤 잔량보다 큰 발급의 취소는 would_go_negative
select tests.authenticate_as(:'a_uid');
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), '재정의된 use_ticket 으로 교인이 1장 쓴다');
select tests.clear_auth();
select is((select count(*)::integer from public.usages where meal_id = :'today_meal' and used_via = 'self' and voided_at is null), 1, 'self 사용 1건이 남는다');
select tests.authenticate_as(:'admin_uid');
-- A 오늘: 발급 3(i1), 이미 쓴 장수(멱등 대신 사용 1 + self 1)가 있어 i1(3장) 전체 취소는 잔량을 음수로 만든다
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i1'), 'P0001', 'would_go_negative', '이미 사용된 장수가 있어 잔량이 음수가 되는 취소는 거부');

select * from finish();
rollback;
```

- [ ] **Step 2: 실패 확인**

Run: `npm run db:test`
Expected: `140` 이 함수 없음으로 실패 (010~130 은 통과).

- [ ] **Step 3: 마이그레이션**

`supabase/migrations/20261010000001_admin_ticket_ops.sql`:

```sql
-- =========================================================
-- 4a단계: 관리자 식권 조작 3종 + use_ticket 재정의
-- 잠금 규칙(3단계 20261009000002_family_functions.sql 헤더): ② 쓸 people 행 for update → ③ lock_family →
--   ④ lock_family_meal(family, meal) → 장부 행(issuances·usages) 잠금은 ④ 뒤에.
--   합류(add_family_member)는 ③ → ④ → 장부 update 순이라, 장부 행을 먼저 잠그고 ④ 를 기다리면 40P01 이 난다.
--   그래서 cancel_issuance·void_usage 는 행을 잠그지 않고 읽어 (family, meal) 을 알아낸 뒤 ④ → 행 for update 재조회 순으로 간다.
--   과거 식사는 합류가 ④ 를 잡지 않아 그 사이 family_id 가 바뀔 수 있다 → 재조회한 가족이 다르면 그 쌍도 잠근다.
--   (이론상 두 세션이 서로 다른 가족의 재조회에서 서로를 기다리는 상호 합류 40P01 도 생각해 볼 수 있지만, 앱에서는
--   합류의 도착 가족이 항상 호출자 자신의 가족이고 leave_family 는 새 가족을 만들 뿐이라 이 경로로는 닿지 않는다 —
--   혹시 나타나면 40P01 은 그대로 일반 오류 문구로 보여도 된다.)
-- use_ticket: 2단계 파일(20261008000004)은 운영에 적용됐으므로 고치지 않고 여기서 같은 시그니처로 재정의한다.
--   바뀐 점 = 사람 행 for update(합류 중이면 끝날 때까지 기다려 새 family_id 를 읽는다 — 3단계 최종 리뷰가 넘긴 틈) +
--   잠금을 lock_family_meal 헬퍼로(키는 100_pairing_codes.sql 이 같음을 고정). 멱등·당일·잔량 규칙은 그대로.
-- =========================================================

-- =========================================================
-- 발급 취소: 발급 한 건을 통째로 취소한다. 취소 뒤 가족 잔량이 음수가 되면 거부(이미 쓴 장수가 남은 발급으로 덮여야 한다).
-- 코드: not_authenticated | forbidden | invalid_reason | issuance_not_found | already_cancelled | would_go_negative
-- =========================================================
create or replace function public.cancel_issuance(p_issuance_id uuid, p_reason text default null)
returns public.issuances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.issuances;
  v_locked_family uuid;
  v_remaining integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if v_reason is not null and char_length(v_reason) > 100 then
    raise exception 'invalid_reason';
  end if;

  select * into v_row from public.issuances where id = p_issuance_id;
  if not found then
    raise exception 'issuance_not_found';
  end if;
  -- ④ 를 먼저, 행 잠금은 그 뒤 (파일 헤더 참고)
  perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  v_locked_family := v_row.family_id;
  select * into v_row from public.issuances where id = p_issuance_id for update;
  if not found then
    raise exception 'issuance_not_found';
  end if;
  if v_row.family_id <> v_locked_family then
    perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'already_cancelled';
  end if;

  select coalesce(sum(i.quantity), 0)
         - (select coalesce(sum(u.quantity), 0) from public.usages u
             where u.family_id = v_row.family_id and u.meal_id = v_row.meal_id and u.voided_at is null)
    into v_remaining
    from public.issuances i
   where i.family_id = v_row.family_id and i.meal_id = v_row.meal_id and i.cancelled_at is null;
  if v_remaining - v_row.quantity < 0 then
    raise exception 'would_go_negative';
  end if;

  update public.issuances
     set cancelled_at = now(), cancelled_by = v_admin, cancel_reason = v_reason
   where id = v_row.id
  returning * into v_row;
  return v_row;
end
$$;

comment on function public.cancel_issuance(uuid, text) is '관리자 발급 취소(잔량 음수 거부, ④ 뒤 행 잠금). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.cancel_issuance(uuid, text) from public, anon;
grant execute on function public.cancel_issuance(uuid, text) to authenticated;

-- =========================================================
-- 사용 무효: 사용 기록 한 건을 무효로 표시한다(잔량 +1). 삭제하지 않는다.
-- 코드: not_authenticated | forbidden | usage_not_found | already_voided
-- =========================================================
create or replace function public.void_usage(p_usage_id uuid)
returns public.usages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_row public.usages;
  v_locked_family uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.usages where id = p_usage_id;
  if not found then
    raise exception 'usage_not_found';
  end if;
  perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  v_locked_family := v_row.family_id;
  select * into v_row from public.usages where id = p_usage_id for update;
  if not found then
    raise exception 'usage_not_found';
  end if;
  if v_row.family_id <> v_locked_family then
    perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  end if;
  if v_row.voided_at is not null then
    raise exception 'already_voided';
  end if;

  update public.usages set voided_at = now(), voided_by = v_admin where id = v_row.id returning * into v_row;
  return v_row;
end
$$;

comment on function public.void_usage(uuid) is '관리자 사용 무효 처리(④ 뒤 행 잠금). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.void_usage(uuid) from public, anon;
grant execute on function public.void_usage(uuid) to authenticated;

-- =========================================================
-- 대신 사용: 담당자가 교인 폰 없이 1장을 사용 처리한다(사후 기록 포함 — 날짜 제한 없음). 자녀 몫도 허용(잔량은 가족 것).
-- p_family_id(선택): 화면이 본 가족. 그 사이 사람이 가족을 옮겼으면(가족 나가기·합류) family_changed 로 거부한다 — 옛 가족 블록에서 눌렀는데
-- 새 가족 풀에서 깎이는 것을 막는다(장부의 family_id 는 발급 시점 스냅샷, 함수는 현재 가족으로 깎는다 — Task 1 리뷰).
-- p_request_id(선택): 클라이언트가 만든 재시도 키 — 같은 값은 처음 결과를 돌려준다(use_ticket 과 같은 규칙). 없으면 서버가 만든다(멱등 아님).
-- 코드: not_authenticated | forbidden | person_not_found | family_changed | meal_not_found | no_remaining | duplicate_request
-- =========================================================
-- 로컬에서 3인자 버전을 이미 만든 DB 가 있을 수 있다(migration up). 운영에는 간 적 없어 no-op.
drop function if exists public.use_ticket_as_admin(uuid, uuid, uuid);

create or replace function public.use_ticket_as_admin(
  p_person_id uuid,
  p_meal_id uuid,
  p_family_id uuid default null,
  p_request_id uuid default null
)
returns public.usages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
  v_remaining integer;
  v_row public.usages;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- ② 대상 사람 행 for update: 합류 중이면 끝날 때까지 기다렸다 새 family_id 를 읽는다
  select * into v_person from public.people where id = p_person_id and deleted_at is null for update;
  if not found then
    raise exception 'person_not_found';
  end if;
  if p_family_id is not null and v_person.family_id <> p_family_id then
    raise exception 'family_changed';
  end if;
  if not exists (select 1 from public.meals where id = p_meal_id) then
    raise exception 'meal_not_found';
  end if;

  -- ④
  perform public.lock_family_meal(v_person.family_id, p_meal_id);

  if p_request_id is not null then
    select * into v_row from public.usages where request_id = p_request_id;
    if found then
      if v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
        raise exception 'duplicate_request';
      end if;
      return v_row;
    end if;
  end if;

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
    values (v_person.family_id, v_person.id, p_meal_id, 1, 'admin', v_admin, coalesce(p_request_id, gen_random_uuid()))
    returning * into v_row;
  exception when unique_violation then
    select * into v_row from public.usages where request_id = p_request_id;
    if not found or v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
      raise exception 'duplicate_request';
    end if;
  end;
  return v_row;
end
$$;

comment on function public.use_ticket_as_admin(uuid, uuid, uuid, uuid) is '관리자 대신 사용 처리(날짜 제한 없음, ② 사람 행 → ④, 가족 확인, p_request_id 로 멱등). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.use_ticket_as_admin(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.use_ticket_as_admin(uuid, uuid, uuid, uuid) to authenticated;

-- =========================================================
-- use_ticket 재정의 (시그니처·동작 동일, 잠금만 보강). 원본 설명은 20261008000004_use_ticket.sql 참고.
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
  -- ② 내 사람 행 for update: 합류가 커밋되는 사이에 옛 가족 풀에 기록되는 틈을 막는다 (3단계 최종 리뷰)
  select * into v_person from public.people where auth_user_id = auth.uid() and deleted_at is null for update;
  if not found then
    raise exception 'not_registered';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request';
  end if;

  -- ④ 잠금을 멱등 조회보다 먼저 건다 (같은 request_id 의 동시 재시도가 먼저 커밋된 행을 보게 된다)
  perform public.lock_family_meal(v_person.family_id, p_meal_id);

  select * into v_row from public.usages where request_id = p_request_id;
  if found then
    if v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
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
    select * into v_row from public.usages where request_id = p_request_id;
    if not found or v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
      raise exception 'duplicate_request';
    end if;
  end;
  return v_row;
end
$$;

comment on function public.use_ticket(uuid, uuid) is '식권 1장 사용(멱등·당일·② 사람 행 for update·④ lock_family_meal). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.use_ticket(uuid, uuid) from public, anon;
grant execute on function public.use_ticket(uuid, uuid) to authenticated;
```

- [ ] **Step 4: 통과 확인 · 타입 재생성**

Run: `npm run db:reset && npm run db:test`
Expected: `Files=14, Tests=392, Result: PASS` (348 + 44). `090_use_ticket.sql` 22건이 재정의 뒤에도 그대로 통과한다(동작 동일의 증거).

Run: `npm run db:types && git diff --stat src/lib/database.types.ts`
Expected: `Functions` 에 `cancel_issuance`(`p_issuance_id: string; p_reason?: string`), `use_ticket_as_admin`(`p_family_id?: string`, `p_request_id?: string`), `void_usage` 추가.

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/20261010000001_admin_ticket_ops.sql supabase/tests/database/140_admin_ticket_ops.sql src/lib/database.types.ts
git commit -m "feat(db): cancel_issuance·void_usage·use_ticket_as_admin + use_ticket 재정의(사람 행 for update, lock_family_meal)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 뮤테이션 훅 `useMealOps` · 오류 문구

**Files:**
- Create: `src/features/admin/useMealOps.ts`, `src/features/admin/useMealOps.test.tsx`
- Modify: `src/lib/errors.ts`, `src/lib/errors.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`src/features/admin/useMealOps.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, ok } from '../../test/fakeSupabase'
import { invalidateMealOps, mealOpsErrorMessage, OPS_TIMEOUT_MS, useCancelIssuance, useUseTicketAsAdmin, useVoidUsage } from './useMealOps'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

const OPS_KEYS = [['meal-detail', 'm1'], ['admin-balances'], ['tickets'], ['ledger']]

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper, invalidate }
}
// 키 목록 전체를 정확히 — 스파이를 여러 훅이 공유하면 한 훅의 onSuccess 가 빠져도 통과한다 (공통 규약)
function expectExactInvalidation(invalidate: ReturnType<typeof makeWrapper>['invalidate']) {
  expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(OPS_KEYS)
}

describe('invalidateMealOps', () => {
  // oxlint-disable-next-line vitest/expect-expect -- 단언은 expectExactInvalidation 안의 expect() 가 한다
  it('식사 현황·관리자 합계·식권·내역을 무효화한다', async () => {
    const { client, invalidate } = makeWrapper()
    await invalidateMealOps(client, 'm1')
    expectExactInvalidation(invalidate)
  })
})

describe('useCancelIssuance', () => {
  it('cancel_issuance 를 발급 id 로 부르고 성공 시 네 키를 무효화한다 (abortSignal 포함)', async () => {
    const q = ok({ id: 'i1', cancelled_at: '2026-10-10T00:00:00Z' })
    rpc.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('i1')
    })
    expect(rpc).toHaveBeenCalledWith('cancel_issuance', { p_issuance_id: 'i1' })
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('서버가 거부하면(코드 있음) 코드를 보존한 Error 로 던지고 현황만 다시 읽는다', async () => {
    rpc.mockReturnValue(fail('would_go_negative'))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await expect(result.current.mutateAsync('i1')).rejects.toMatchObject({ message: 'would_go_negative', code: 'P0001' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    // 거부되면 화면의 잔량이 낡았을 수 있다 → 현황만 다시 읽는다
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['meal-detail', 'm1']])
  })

  it('통신 오류(코드 없음)는 현황을 다시 읽지 않는다 — 오류 토스트가 재조회를 기다리지 않게', async () => {
    rpc.mockReturnValue(fail('TimeoutError: signal timed out', ''))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useCancelIssuance('m1'), { wrapper })
    await expect(result.current.mutateAsync('i1')).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useVoidUsage', () => {
  it('void_usage 를 사용 id 로 부르고 성공 시 네 키를 무효화한다 (abortSignal 포함)', async () => {
    const q = ok({ id: 'u1', voided_at: '2026-10-10T00:00:00Z' })
    rpc.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useVoidUsage('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('u1')
    })
    expect(rpc).toHaveBeenCalledWith('void_usage', { p_usage_id: 'u1' })
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('서버가 거부하면(코드 있음) 현황만 다시 읽는다', async () => {
    rpc.mockReturnValue(fail('already_voided'))
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useVoidUsage('m1'), { wrapper })
    await expect(result.current.mutateAsync('u1')).rejects.toMatchObject({ message: 'already_voided', code: 'P0001' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['meal-detail', 'm1']])
  })
})

describe('useUseTicketAsAdmin', () => {
  it('use_ticket_as_admin 을 사람·식사 id 와 새 request_id 로 부르고 성공 시 네 키를 무효화한다 (abortSignal 포함)', async () => {
    const q = ok({ id: 'u9', used_via: 'admin' })
    rpc.mockReturnValue(q)
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })
    })
    expect(rpc).toHaveBeenCalledWith(
      'use_ticket_as_admin',
      expect.objectContaining({ p_person_id: 'p1', p_meal_id: 'm1', p_family_id: 'f1', p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
    )
    expect(q.has('abortSignal')).toBe(true)
    expectExactInvalidation(invalidate)
  })

  it('통신 오류(코드 없음) 뒤 같은 대상 재시도는 같은 request_id 를 쓴다 (서버 멱등 → 이중 차감 없음)', async () => {
    rpc.mockReturnValueOnce(fail('TimeoutError: signal timed out', '')).mockReturnValueOnce(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).toBe(secondArgs?.p_request_id)
    expect(firstArgs?.p_request_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('서버가 판정한 오류(코드 있음) 뒤에는 같은 대상이라도 새 request_id', async () => {
    rpc.mockReturnValueOnce(fail('no_remaining')).mockReturnValueOnce(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })).rejects.toThrow('no_remaining')
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).not.toBe(secondArgs?.p_request_id)
  })

  it('성공 뒤 같은 대상을 다시 쓰면 새 request_id', async () => {
    rpc.mockReturnValue(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).not.toBe(secondArgs?.p_request_id)
  })

  it('통신 오류 뒤 다른 대상(가족이 다름)을 쓰면 새 request_id (키가 다르다)', async () => {
    rpc.mockReturnValueOnce(fail('TimeoutError: signal timed out', '')).mockReturnValueOnce(ok({ id: 'u9', used_via: 'admin' }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'p1', familyId: 'f1' })).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(() => result.current.mutateAsync({ personId: 'p1', familyId: 'f2' }))

    const firstArgs = rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined
    const secondArgs = rpc.mock.calls[1]?.[1] as { p_request_id?: string } | undefined
    expect(firstArgs?.p_request_id).not.toBe(secondArgs?.p_request_id)
  })

  it('대상 A 가 타임아웃으로 재시도 id 를 들고 있는 동안 대상 B 를 처리해도 A 의 슬롯을 덮어쓰지 않는다', async () => {
    rpc.mockReturnValueOnce(fail('TimeoutError: signal timed out', '')) // A 1차: 통신 오류
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    await expect(result.current.mutateAsync({ personId: 'pA', familyId: 'fA' })).rejects.toThrow('TimeoutError: signal timed out')
    await waitFor(() => expect(result.current.isError).toBe(true))
    const idA = (rpc.mock.calls[0]?.[1] as { p_request_id?: string } | undefined)?.p_request_id

    rpc.mockReturnValueOnce(ok({ id: 'u-b', used_via: 'admin' })) // B: 다른 대상, 성공
    await act(() => result.current.mutateAsync({ personId: 'pB', familyId: 'fB' }))

    rpc.mockReturnValueOnce(ok({ id: 'u-a', used_via: 'admin' })) // A 재시도: 1차와 같은 id 를 보내야 한다
    await act(() => result.current.mutateAsync({ personId: 'pA', familyId: 'fA' }))

    const idARetry = (rpc.mock.calls[2]?.[1] as { p_request_id?: string } | undefined)?.p_request_id
    expect(idARetry).toBe(idA)
    expect(idA).toMatch(/^[0-9a-f-]{36}$/)
  })

  it(`OPS_TIMEOUT_MS(${OPS_TIMEOUT_MS}ms) 안에 응답이 없으면 요청을 끊는다`, async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUseTicketAsAdmin('m1'), { wrapper })

    vi.useFakeTimers()
    try {
      const pending = {
        signal: undefined as AbortSignal | undefined,
        abortSignal(s: AbortSignal) {
          this.signal = s
          return this
        },
        then(resolve: (value: unknown) => void) {
          this.signal?.addEventListener('abort', () => resolve({ data: null, error: { message: 'TimeoutError: signal timed out', code: '' } }))
        },
      }
      rpc.mockReturnValue(pending)

      act(() => {
        void result.current.mutateAsync({ personId: 'p1', familyId: 'f1' }).catch(() => undefined)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPS_TIMEOUT_MS)
      })

      expect(pending.signal?.aborted).toBe(true)
      expect((pending.signal?.reason as { name?: string } | undefined)?.name).toBe('TimeoutError')

      await act(async () => {
        await vi.runAllTimersAsync()
      })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('mealOpsErrorMessage', () => {
  it('no_remaining 은 관리자 맥락 문구로 바꾼다', () => {
    expect(mealOpsErrorMessage(new Error('no_remaining'))).toBe('남은 식권이 없어요. 현황을 다시 불러왔어요.')
  })

  it('그 외 코드는 toUserMessage 그대로', () => {
    expect(mealOpsErrorMessage(new Error('would_go_negative'))).toBe(
      '이미 사용된 장수가 있어 이 발급은 취소할 수 없어요. 먼저 사용 기록을 무효 처리해 주세요.',
    )
  })
})
```

`src/lib/errors.test.ts` — 기존 스타일대로(코드 문자열을 `message` 에 담은 `Error`) 다음 여섯 줄을 추가한다:

```ts
  it('4a단계 관리자 식권 조작 코드에 문구가 있다', () => {
    expect(toUserMessage(new Error('issuance_not_found'))).toBe('발급 기록을 찾을 수 없어요. 현황을 다시 불러왔어요.')
    expect(toUserMessage(new Error('already_cancelled'))).toBe('이미 취소된 발급이에요.')
    expect(toUserMessage(new Error('invalid_reason'))).toBe('취소 사유는 100자까지예요.')
    expect(toUserMessage(new Error('would_go_negative'))).toBe('이미 사용된 장수가 있어 이 발급은 취소할 수 없어요. 먼저 사용 기록을 무효 처리해 주세요.')
    expect(toUserMessage(new Error('usage_not_found'))).toBe('사용 기록을 찾을 수 없어요. 현황을 다시 불러왔어요.')
    expect(toUserMessage(new Error('already_voided'))).toBe('이미 무효 처리된 기록이에요.')
    expect(toUserMessage(new Error('family_changed'))).toBe('그 사이 이 분의 가족이 바뀌었어요. 현황을 다시 불러왔어요.')
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/features/admin/useMealOps src/lib/errors`
Expected: 모듈 없음 · 문구 없음(폴백 문구가 나온다).

- [ ] **Step 3: 구현**

`src/lib/errors.ts` 의 `MESSAGES` 에 `over_request_rate_limit` 줄 다음에 추가:

```ts
  // 4a단계 · 관리자 식권 조작
  issuance_not_found: '발급 기록을 찾을 수 없어요. 현황을 다시 불러왔어요.',
  already_cancelled: '이미 취소된 발급이에요.',
  invalid_reason: '취소 사유는 100자까지예요.',
  would_go_negative: '이미 사용된 장수가 있어 이 발급은 취소할 수 없어요. 먼저 사용 기록을 무효 처리해 주세요.',
  usage_not_found: '사용 기록을 찾을 수 없어요. 현황을 다시 불러왔어요.',
  already_voided: '이미 무효 처리된 기록이에요.',
  family_changed: '그 사이 이 분의 가족이 바뀌었어요. 현황을 다시 불러왔어요.',
```

`src/features/admin/useMealOps.ts`:

```ts
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { rpcCodeOf, toUserMessage } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { withTimeout } from '../../lib/timeout'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { mealDetailQueryKey } from './useMealDetail'
import { adminBalancesQueryKey } from './useMeals'

/** RPC 응답 대기 한계. 넘기면 요청을 끊어 버튼이 영원히 '처리 중…' 에 머무르지 않게 한다 (useUseTicket 과 같은 패턴, 다른 값). */
export const OPS_TIMEOUT_MS = 8_000

/**
 * 식권 조작 뒤 다시 읽어야 하는 것 전부: 이 식사의 현황, 관리자 식사 카드 합계,
 * (관리자 본인 가족에게 한 조작일 수도 있으니) 식권·내역. 순서는 테스트가 그대로 단언한다.
 */
export function invalidateMealOps(queryClient: QueryClient, mealId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: mealDetailQueryKey(mealId) }),
    queryClient.invalidateQueries({ queryKey: adminBalancesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
  ])
}

// 서버가 판단한 거부(코드 있음)일 때만 현황을 다시 읽는다 — 통신 실패 때 재조회까지 기다리면 오류 문구가 늦거나(오프라인이면 영영) 안 보인다.
// 같은 이유로 await 되는 onError 안에서 하므로 "현황을 다시 불러왔어요" 문구가 사실이 된다.
const makeRefreshBoard = (queryClient: QueryClient, mealId: string) => (err: unknown) =>
  rpcCodeOf(err) ? queryClient.invalidateQueries({ queryKey: mealDetailQueryKey(mealId) }) : undefined

/** 발급 한 건 취소. 사유 입력 칸은 4a 에 두지 않는다(DB 의 p_reason 은 선택 인자). */
export function useCancelIssuance(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (issuanceId: string) => {
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(await supabase.rpc('cancel_issuance', { p_issuance_id: issuanceId }).abortSignal(signal))
      } finally {
        done()
      }
    },
    // promise 를 돌려줘야 재조회가 끝날 때까지 isPending 이 유지된다
    onSuccess: () => invalidateMealOps(queryClient, mealId),
    onError: makeRefreshBoard(queryClient, mealId),
  })
}

export function useVoidUsage(mealId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (usageId: string) => {
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        return unwrap(await supabase.rpc('void_usage', { p_usage_id: usageId }).abortSignal(signal))
      } finally {
        done()
      }
    },
    onSuccess: () => invalidateMealOps(queryClient, mealId),
    // already_voided·usage_not_found 도 "화면이 낡았다" 는 뜻 — cancel 과 똑같이 현황을 다시 읽는다.
    onError: makeRefreshBoard(queryClient, mealId),
  })
}

export type AdminUseArgs = { personId: string; familyId: string }

/** 담당자가 교인 폰 없이 1장 사용 처리. personId 는 "누구 몫"(가족 블록의 산 사람), familyId 는 화면이 본 가족 — 그 사이 옮겼으면 서버가 family_changed 로 거부한다. */
export function useUseTicketAsAdmin(mealId: string) {
  const queryClient = useQueryClient()
  // 재시도 키: 대상(식사·사람·가족)마다 하나씩 들고 있는다(한 훅 인스턴스가 여러 가족 블록을 처리하므로, 슬롯 하나였다면
  // 다른 대상을 처리하는 사이 먼저 걸려 있던 재시도 id 를 덮어써 버린다). 서버가 판단한 응답(성공 또는 코드 있는 오류)이
  // 오면 그 대상의 id 를 버린다; 통신 실패·타임아웃이면 남겨 둔다(use_ticket 과 같은 규칙).
  const retry = useRef(new Map<string, string>())
  return useMutation({
    mutationFn: async ({ personId, familyId }: AdminUseArgs) => {
      const key = `${mealId}:${personId}:${familyId}`
      const requestId = retry.current.get(key) ?? crypto.randomUUID()
      retry.current.set(key, requestId)
      const { signal, done } = withTimeout(OPS_TIMEOUT_MS)
      try {
        const row = unwrap(
          await supabase
            .rpc('use_ticket_as_admin', { p_person_id: personId, p_meal_id: mealId, p_family_id: familyId, p_request_id: requestId })
            .abortSignal(signal),
        )
        retry.current.delete(key)
        return row
      } catch (err) {
        if (rpcCodeOf(err)) retry.current.delete(key)
        throw err
      } finally {
        done()
      }
    },
    onSuccess: () => invalidateMealOps(queryClient, mealId),
    onError: makeRefreshBoard(queryClient, mealId),
  })
}

/** 현황판 동작 오류 문구. no_remaining 은 교인 폰 문구("방금 다른 폰에서…")가 아니라 관리자 맥락으로. */
export function mealOpsErrorMessage(err: unknown): string {
  return rpcCodeOf(err) === 'no_remaining' ? '남은 식권이 없어요. 현황을 다시 불러왔어요.' : toUserMessage(err)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/features/admin/useMealOps.ts src/features/admin/useMealOps.test.tsx src/lib/errors.ts src/lib/errors.test.ts
git commit -m "feat(admin): 식권 조작 뮤테이션(취소·무효·대신 사용) + 오류 문구

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: 현황판 동작 — 발급 취소 · 1장 대신 사용 · 무효 (`ConfirmButton`)

**Files:**
- Modify: `src/pages/admin/MealDetailPage.tsx`, `src/pages/admin/MealDetailPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`src/pages/admin/MealDetailPage.test.tsx` 에 목과 테스트를 추가한다. 상단 `vi.mock` 들 다음에:

```tsx
type M = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useCancelIssuance, useVoidUsage, useUseTicketAsAdmin } = vi.hoisted(() => ({
  useCancelIssuance: vi.fn<(mealId: string) => M>(),
  useVoidUsage: vi.fn<(mealId: string) => M>(),
  useUseTicketAsAdmin: vi.fn<(mealId: string) => M>(),
}))
vi.mock('../../features/admin/useMealOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useMealOps')>()),
  useCancelIssuance,
  useVoidUsage,
  useUseTicketAsAdmin,
}))
const idle = (): M => ({ isPending: false, isError: false, mutate: vi.fn<M['mutate']>(), reset: vi.fn<() => void>() })
```

`beforeEach` 에 세 줄 추가:

```tsx
  useCancelIssuance.mockReturnValue(idle())
  useVoidUsage.mockReturnValue(idle())
  useUseTicketAsAdmin.mockReturnValue(idle())
```

`describe('MealDetailPage')` 끝에 추가:

```tsx
  it('"1장 대신 사용" 은 확인을 거쳐 가장 최근 구매자 몫으로 use_ticket_as_admin, 성공하면 알림', async () => {
    const use = idle()
    use.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUseTicketAsAdmin.mockReturnValue(use)
    renderPage()
    expect(useUseTicketAsAdmin).toHaveBeenCalledWith('m1')
    await userEvent.click(screen.getByRole('button', { name: '김철수 · 이영희 1장 대신 사용' }))
    expect(use.mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '사용 처리' }))
    expect(use.mutate).toHaveBeenCalledWith({ personId: 'p3', familyId: 'f1' }, expect.anything()) // f1 의 최근 활성 발급 구매자 = 이영희(p3)
    expect(screen.getByText('김철수 · 이영희 가족 식권 1장을 사용 처리했어요')).toBeInTheDocument()
  })

  it('남은 장수가 0 이면 "1장 대신 사용" 이 잠긴다', () => {
    const zero = groupMealLedger([issuance({ quantity: 1 })], [usage({})], [{ family_id: 'f1', meal_id: 'm1', issued: 1, used: 1, remaining: 0, amount: 5000 }])
    useMealDetail.mockReturnValue({ status: 'success', data: { meal, ledger: zero }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByRole('button', { name: '김철수 1장 대신 사용' })).toBeDisabled()
  })

  it('"발급 취소" 는 남은 장수 안의 발급에만 열리고, 확인을 거쳐 cancel_issuance', async () => {
    const cancel = idle()
    cancel.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useCancelIssuance.mockReturnValue(cancel)
    renderPage()
    // f1: 남음 1. 이영희 1장(i2) → 가능. 김철수 2장(i1) → 불가 + 안내. 취소된 i3 에는 버튼이 없다.
    const blocked = screen.getByRole('button', { name: '김철수 2장 발급 취소' })
    expect(blocked).toBeDisabled()
    expect(screen.getByText('남은 장수(1)보다 많아 취소할 수 없어요')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /발급 취소$/ })).toHaveLength(3) // i1, i2, f2 의 박민수 4장
    await userEvent.click(screen.getByRole('button', { name: '이영희 1장 발급 취소' }))
    await userEvent.click(screen.getByRole('button', { name: '취소하기' }))
    expect(cancel.mutate).toHaveBeenCalledWith('i2', expect.anything())
    expect(screen.getByText('이영희 님 1장 발급을 취소했어요')).toBeInTheDocument()
  })

  it('"무효" 는 무효 아닌 사용 줄에만 있고, 확인을 거쳐 void_usage', async () => {
    const voidUsage = idle()
    voidUsage.mutate = vi.fn<M['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useVoidUsage.mockReturnValue(voidUsage)
    renderPage()
    expect(screen.getAllByRole('button', { name: /무효$/ })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '10/11 12:40 사용 무효' }))
    await userEvent.click(screen.getByRole('button', { name: '무효 처리' }))
    expect(voidUsage.mutate).toHaveBeenCalledWith('u2', expect.anything())
    expect(screen.getByText('사용 기록을 무효 처리했어요')).toBeInTheDocument()
  })

  it('처리 중에는 모든 동작 버튼이 "처리 중…" 으로 잠긴다', () => {
    useCancelIssuance.mockReturnValue({ ...idle(), isPending: true })
    renderPage()
    const busy = screen.getAllByRole('button', { name: /처리 중…$/ })
    expect(busy.length).toBeGreaterThan(0)
    for (const b of busy) expect(b).toBeDisabled()
    expect(screen.queryByRole('button', { name: /발급 취소$/ })).not.toBeInTheDocument()
  })

  it('동작 오류 문구를 보여 주고, 다음 동작이 시작되면 세 뮤테이션을 reset 한다', async () => {
    const cancel = { ...idle(), isError: true, error: new Error('would_go_negative') }
    const voidUsage = idle()
    useCancelIssuance.mockReturnValue(cancel)
    useVoidUsage.mockReturnValue(voidUsage)
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('이미 사용된 장수가 있어 이 발급은 취소할 수 없어요. 먼저 사용 기록을 무효 처리해 주세요.')
    await userEvent.click(screen.getByRole('button', { name: '10/11 12:40 사용 무효' }))
    await userEvent.click(screen.getByRole('button', { name: '무효 처리' }))
    expect(cancel.reset).toHaveBeenCalled()
    expect(voidUsage.reset).toHaveBeenCalled()
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/pages/admin/MealDetailPage`
Expected: 버튼 없음으로 새 테스트 실패, Task 2 테스트는 통과.

- [ ] **Step 3: 구현**

`src/pages/admin/MealDetailPage.tsx` 를 아래처럼 바꾼다 (Task 2 코드에 동작을 더한 전체):

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ConfirmButton } from '../../components/ConfirmButton'
import { Spinner, TextField } from '../../components/ui'
import { filterFamilies, NO_NAME, type FamilyGroup, type MealIssuance, type MealUsage } from '../../features/admin/groupMealLedger'
import { useMealDetail } from '../../features/admin/useMealDetail'
import { mealOpsErrorMessage, useCancelIssuance, useUseTicketAsAdmin, useVoidUsage } from '../../features/admin/useMealOps'
import { formatDateTime, formatMealDate } from '../../lib/dates'
import { formatWon } from '../../lib/money'

type Actions = {
  pending: boolean
  onCancel: (issuance: MealIssuance) => void
  onVoid: (usage: MealUsage) => void
  onUseAsAdmin: (family: FamilyGroup) => void
}

// 사용 줄과 알림에 공통으로 쓰는 "누구 몫으로/어느 폰에서" 문구. admin 이면 담당자가 대신 처리했다는 뜻.
function usageWho(u: MealUsage): string {
  return u.via === 'admin' ? `${u.person || '가족'} 몫 · 담당자 처리` : `${u.person || '가족'} 폰`
}

/** `#/admin/meals/:mealId` — 식사 하나의 현황판 (설계 §8.3). 발급·사용·남음·금액, 이름 검색, 가족별 명단 + 취소·대신 사용·무효. 5초 폴링은 훅이 한다. */
export function MealDetailPage() {
  const { mealId = '' } = useParams()
  const detail = useMealDetail(mealId)
  const cancel = useCancelIssuance(mealId)
  const voidUsage = useVoidUsage(mealId)
  const useAsAdmin = useUseTicketAsAdmin(mealId)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)

  const pending = cancel.isPending || voidUsage.isPending || useAsAdmin.isPending
  // 관리자 맥락 문구(no_remaining 은 교인 폰 문구가 아니라 "남은 식권이 없어요")
  const opsError = cancel.isError
    ? mealOpsErrorMessage(cancel.error)
    : voidUsage.isError
      ? mealOpsErrorMessage(voidUsage.error)
      : useAsAdmin.isError
        ? mealOpsErrorMessage(useAsAdmin.error)
        : null

  // 피드백(성공 알림·오류)이 생기면 그 영역으로 포커스를 옮긴다 — 눌렸던 버튼이 성공으로 사라질 때 포커스를 잃지 않게 한다.
  useEffect(() => {
    if (notice || opsError) feedbackRef.current?.focus()
  }, [notice, opsError])

  // 다음 동작이 시작되면 이전 동작의 오류·알림을 지운다 (공통 규약)
  function clearFeedback() {
    cancel.reset()
    voidUsage.reset()
    useAsAdmin.reset()
    setNotice(null)
  }
  const actions: Actions = {
    pending,
    onCancel: (i) => {
      clearFeedback()
      cancel.mutate(i.id, { onSuccess: () => setNotice(`${i.buyer ? `${i.buyer} 님` : NO_NAME} ${i.quantity}장 발급을 취소했어요`) })
    },
    onVoid: (u) => {
      clearFeedback()
      voidUsage.mutate(u.id, { onSuccess: () => setNotice(`${usageWho(u)} 사용을 무효 처리했어요`) })
    },
    onUseAsAdmin: (f) => {
      if (!f.buyerId) return // 버튼이 이미 잠겨 있어 도달하지 않는다 (타입 좁히기용)
      clearFeedback()
      useAsAdmin.mutate({ personId: f.buyerId, familyId: f.familyId }, { onSuccess: () => setNotice(`${f.label} 가족 식권 1장을 사용 처리했어요`) })
    },
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link to="/admin/meals" className="text-sm text-blue-600 underline">← 식사</Link>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* data 로 분기한다 (공통 규약). 이 화면은 null 이 "식사 없음" 이라는 정상 값이라 undefined 와 구분한다. */}
      {detail.data !== undefined ? (
        detail.data === null ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
            식사를 찾을 수 없어요. 목록으로 돌아가 주세요.
          </p>
        ) : (
          <>
            <h1 className="text-lg font-extrabold">{formatMealDate(detail.data.meal.served_on)} · {detail.data.meal.title}</h1>
            {detail.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 현황을 받지 못했어요</p>}
            <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold">
              발급 {detail.data.ledger.totals.issued}장 · 사용 {detail.data.ledger.totals.used}장 · 남음 {detail.data.ledger.totals.remaining}장 · {formatWon(detail.data.ledger.totals.amount)}
            </p>
            {(notice || opsError) && (
              <div
                ref={feedbackRef}
                tabIndex={-1}
                className="sticky top-0 z-10 flex flex-col gap-2 bg-[#f5f5f7] py-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</p>}
                {opsError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{opsError}</p>}
              </div>
            )}
            <TextField label="이름으로 찾기" name="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="구매자·사용자 이름" autoComplete="off" />
            <FamilyList families={filterFamilies(detail.data.ledger.families, query)} searching={query.trim() !== ''} actions={actions} />
          </>
        )
      ) : detail.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          현황을 불러오지 못했어요
          <button type="button" onClick={() => void detail.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function FamilyList({ families, searching, actions }: { families: readonly FamilyGroup[]; searching: boolean; actions: Actions }) {
  if (families.length === 0) return <p className="py-6 text-center text-sm text-gray-500">{searching ? '찾는 가족이 없어요' : '아직 발급이 없어요'}</p>
  return (
    <ul aria-label="가족별 현황" className="flex flex-col gap-2">
      {families.map((f) => <FamilyBlock key={f.familyId} family={f} actions={actions} />)}
    </ul>
  )
}

/** 가족 한 블록: 구매자 이름들 · "N장 중 M장 사용" · 남음·금액 · 1장 대신 사용 · 발급 줄 · 사용 줄 */
function FamilyBlock({ family, actions }: { family: FamilyGroup; actions: Actions }) {
  return (
    <li aria-label={family.label} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate font-bold" title={family.label}>{family.label}</h2>
        <span className="shrink-0 text-sm">{family.issued}장 중 {family.used}장 사용</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500">남음 {family.remaining}장 · {formatWon(family.amount)}</p>
        {/* 교인 폰 없이 담당자가 처리할 때. 산 사람이 없으면(buyerId null — 활성 발급 없음·탈퇴·가족 이동) 누구 몫인지 정할 수 없어 잠근다. */}
        <ConfirmButton
          label={actions.pending ? '처리 중…' : '1장 대신 사용'}
          context={family.label}
          message={`${family.label} 가족의 식권 1장을 담당자가 대신 사용 처리할까요?`}
          confirmLabel="사용 처리"
          onConfirm={() => actions.onUseAsAdmin(family)}
          disabled={actions.pending || family.remaining < 1 || family.buyerId === null}
        />
      </div>
      {family.buyerId === null && family.remaining > 0 && (
        <p className="text-xs text-gray-500">대신 사용 처리할 구매자가 없어요 (탈퇴했거나 가족을 옮겼어요)</p>
      )}
      <ul aria-label="발급·사용 내역" className="mt-2 flex flex-col gap-2 text-sm">
        {family.issuances.map((i) => <IssuanceLine key={i.id} issuance={i} remaining={family.remaining} actions={actions} />)}
        {family.usages.map((u) => <UsageLine key={u.id} usage={u} actions={actions} />)}
      </ul>
    </li>
  )
}

function IssuanceLine({ issuance: i, remaining, actions }: { issuance: MealIssuance; remaining: number; actions: Actions }) {
  const buyer = i.buyer || NO_NAME
  // 발급 단위 취소라, 이 발급 장수가 가족 남은 장수보다 많으면 DB 가 would_go_negative 로 거부한다 → 미리 잠그고 이유를 적는다 (설계 §9)
  const blocked = !i.cancelled && i.quantity > remaining
  return (
    <li className={`flex items-start justify-between gap-2 ${i.cancelled ? 'text-gray-500' : ''}`}>
      <div className="min-w-0 break-words">
        <div className={i.cancelled ? 'line-through' : ''}>발급 {i.quantity}장 · {buyer} · {formatWon(i.amount)}</div>
        <div className="text-xs text-gray-500">{formatDateTime(i.issuedAt)} · {i.issuer}{i.memo ? ` · ${i.memo}` : ''}</div>
        {i.cancelled && <div className="text-xs font-bold">취소됨{i.cancelReason ? ` · ${i.cancelReason}` : ''}</div>}
        {blocked && <div className="text-xs text-gray-500">남은 장수({remaining})보다 많아 취소할 수 없어요 — 먼저 사용을 무효 처리해 주세요</div>}
      </div>
      {!i.cancelled && (
        <ConfirmButton
          label={actions.pending ? '처리 중…' : '발급 취소'}
          context={`${formatDateTime(i.issuedAt)} ${buyer} ${i.quantity}장`}
          message={`${buyer} 님의 ${i.quantity}장 발급을 취소할까요? 가족 잔량이 ${i.quantity}장 줄어요.`}
          confirmLabel="취소하기"
          onConfirm={() => actions.onCancel(i)}
          disabled={actions.pending || blocked}
        />
      )}
    </li>
  )
}

function UsageLine({ usage: u, actions }: { usage: MealUsage; actions: Actions }) {
  // admin 이면 person 은 "누구 몫으로", self 면 "어느 폰에서". 이름이 가려졌으면(탈퇴) 자리를 비우지 않는다.
  const who = usageWho(u)
  const when = formatDateTime(u.usedAt)
  return (
    <li className={`flex items-start justify-between gap-2 ${u.voided ? 'text-gray-500' : ''}`}>
      <div className="min-w-0 break-words">
        <div className={u.voided ? 'line-through' : ''}>사용 1장 · {who}</div>
        <div className="text-xs text-gray-500">{when}</div>
        {u.voided && <div className="text-xs font-bold">무효</div>}
      </div>
      {!u.voided && (
        <ConfirmButton
          label={actions.pending ? '처리 중…' : '무효'}
          context={`${who} ${when} 사용`}
          message="이 사용 기록을 무효 처리할까요? 가족 잔량이 1장 늘어요."
          confirmLabel="무효 처리"
          onConfirm={() => actions.onVoid(u)}
          disabled={actions.pending}
        />
      )}
    </li>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과.

- [ ] **Step 5: 수동 확인 (로컬)**

Run: `npm run dev`. 관리자로 현황 화면에서 대신 사용 → 2장 중 1장 → 무효 → 다시 0 → 발급 취소(남은 장수 안) → 취소됨. 홈(내 식권)에 관리자 본인 가족이면 즉시 반영. (Task 6 이 자동화.)

- [ ] **Step 6: 커밋**

```bash
git add src/pages/admin/MealDetailPage.tsx src/pages/admin/MealDetailPage.test.tsx
git commit -m "feat(admin): 현황판 동작 — 발급 취소(남은 장수 안), 1장 대신 사용, 사용 무효 (두 단계 확인)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: E2E — 관리자 현황판 흐름

**Files:**
- Create: `e2e/admin.spec.ts`

- [ ] **Step 1: 스펙 작성**

`e2e/admin.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { ADMIN, adminCreateTodayMealAndIssueTwo, devLogin, uniqueDigits } from './helpers.ts'

// 발급 → 현황판 → 대신 사용 → 무효 → 취소까지 한 흐름
test.describe.configure({ timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

test('관리자 식사 현황판: 발급 명단 → 1장 대신 사용 → 무효 → 발급 취소', async ({ page }) => {
  const digits = uniqueDigits()
  const phone = `01${digits}`
  const mealTitle = `E2E 현황 ${digits}`
  const dateLabel = formatMealDate(todaySeoul())
  const mealLabel = `${dateLabel} · ${mealTitle}`

  await test.step('관리자: 오늘 식사 + 김철수 2장 발급', async () => {
    await adminCreateTodayMealAndIssueTwo(page, { mealTitle, mealLabel, name: '김철수', phone }) // 끝에 로그아웃한다
  })

  await test.step('식사 탭 › 현황: 네 숫자와 가족 블록', async () => {
    await devLogin(page, ADMIN.email, ADMIN.password)
    await expect(page.getByRole('heading', { name: '권사 님' })).toBeVisible()
    await page.getByRole('link', { name: '관리' }).click()
    await page.getByRole('link', { name: `${dateLabel} ${mealTitle} 현황` }).click()
    await expect(page.getByRole('heading', { level: 1, name: mealLabel })).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 0장 · 남음 2장 · 10,000원')).toBeVisible()
    const family = page.getByRole('listitem', { name: '김철수', exact: true })
    await expect(family).toContainText('2장 중 0장 사용')
    await expect(family).toContainText('발급 2장 · 김철수 · 10,000원')
  })

  await test.step('1장 대신 사용 → 2장 중 1장, 취소 불가 안내', async () => {
    await page.getByRole('button', { name: '김철수 1장 대신 사용' }).click()
    await page.getByRole('button', { name: '사용 처리', exact: true }).click()
    await expect(page.getByText('김철수 가족 식권 1장을 사용 처리했어요')).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 1장 · 남음 1장 · 10,000원')).toBeVisible()
    await expect(page.getByRole('listitem', { name: '김철수', exact: true })).toContainText('김철수 몫 · 담당자 처리')
    // 한 번 눌렀으니 사용 줄도 하나 (대신 사용은 멱등이 아니다 — Task 4 리뷰)
    // ConfirmButton 의 sr-only 접두사에도 같은 글자가 있어 행 안 getByText 는 '$' 로 줄 본문만 맞춘다 (Task 5 리뷰)
    await expect(page.getByRole('listitem', { name: '김철수', exact: true }).getByText(/담당자 처리$/)).toHaveCount(1)
    // 남은 1장 < 발급 2장 → 이 발급은 취소할 수 없다
    await expect(page.getByRole('button', { name: /김철수 2장 발급 취소$/ })).toBeDisabled() // 접근성 이름은 '<발급 시각> 김철수 2장 발급 취소'
    await expect(page.getByText('남은 장수(1)보다 많아 취소할 수 없어요')).toBeVisible()
  })

  await test.step('무효 처리 → 다시 2장 남음', async () => {
    await page.getByRole('button', { name: /사용 무효$/ }).click()
    await page.getByRole('button', { name: '무효 처리', exact: true }).click()
    await expect(page.getByText('김철수 몫 · 담당자 처리 사용을 무효 처리했어요')).toBeVisible()
    await expect(page.getByText('발급 2장 · 사용 0장 · 남음 2장 · 10,000원')).toBeVisible()
    // '무효' 글자는 버튼 이름에도 있으므로, 버튼이 사라지고 줄이 남는 것으로 확인한다
    await expect(page.getByRole('button', { name: /사용 무효$/ })).toHaveCount(0)
    await expect(page.getByRole('listitem', { name: '김철수', exact: true })).toContainText('사용 1장 · 김철수 몫 · 담당자 처리')
    await expect(page.getByRole('button', { name: /김철수 2장 발급 취소$/ })).toBeEnabled()
  })

  await test.step('발급 취소 → 0장', async () => {
    await page.getByRole('button', { name: /김철수 2장 발급 취소$/ }).click()
    await page.getByRole('button', { name: '취소하기', exact: true }).click()
    await expect(page.getByText('김철수 님 2장 발급을 취소했어요')).toBeVisible()
    await expect(page.getByText('발급 0장 · 사용 0장 · 남음 0장 · 0원')).toBeVisible()
    await expect(page.getByRole('listitem', { name: '김철수', exact: true })).toContainText('취소됨')
  })
})
```

- [ ] **Step 2: 실행**

Run: `npm run e2e`
Expected: **5 passed** (admin 1 · family 1 · onboarding 2 · tickets 1). 실패하면 `test-results/` 의 오류·스크린샷을 본다. 흔한 원인: (1) `getByRole('listitem', { name: '김철수' })` 가 여러 개 — 가족 라벨은 `aria-label` 이라 `exact: true` 로 좁혔다; (2) ConfirmButton 의 접근성 이름은 `context + ' ' + label` 이다(`김철수 1장 대신 사용`); (3) 폴링(5초)과 무효화가 겹쳐 숫자가 잠깐 전 값 — 모두 재시도 단언(`toBeVisible`)이라 기다린다.

- [ ] **Step 3: 커밋**

```bash
git add e2e/admin.spec.ts
git commit -m "test(e2e): 관리자 식사 현황판 — 발급 명단, 1장 대신 사용, 무효, 발급 취소

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 문서 동기화 · 전체 검증 · 마무리

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md`
- Modify: `docs/superpowers/plans/2026-10-10-phase4a-meal-detail.md` (이 파일)

- [ ] **Step 1: README**

"### 5. 운영 체크리스트" 의 하위 절 `#### 발급 실수 정정 (4단계 전 임시 절차)` 와 그 SQL 블록을 지우고, 체크리스트 목록 끝에 한 줄을 넣는다:

```markdown
- 발급 실수 정정은 **관리 › 식사 › 현황** 에서 한다: 발급 취소(가족 남은 장수 안에서만 — 이미 쓴 장수가 있으면 먼저 "무효" 로 되돌린다), 담당자 "1장 대신 사용", 사용 "무효". 모두 기록이 남고 지워지지 않는다. SQL 로 직접 고치지 않는다.
```

- [ ] **Step 2: 설계 문서**

- §7.3 표: 행 이름을 실제 시그니처로 — `cancel_issuance(id, reason)`, `use_ticket_as_admin(person_id, meal_id, family_id, request_id)`(둘 다 선택; `family_id` 가 다르면 `family_changed`, `request_id` 는 재시도 키 — 같은 값은 처음 결과를 돌려주고 다른 대상에 재사용하면 `duplicate_request`), `void_usage(id)`. `cancel_issuance(id, reason)` 행 — "발급 한 건 통째로 취소. 취소 뒤 가족 잔량이 음수면 `would_go_negative`. 코드: `not_authenticated \| forbidden \| invalid_reason \| issuance_not_found \| already_cancelled \| would_go_negative`". `use_ticket_as_admin(person_id, meal_id)` 행 — "날짜 제한 없음. 자녀 몫도 허용(잔량은 가족 것). `used_via='admin'`, `recorded_by`=관리자, `request_id` 는 서버 생성. 코드: `not_authenticated \| forbidden \| person_not_found \| meal_not_found \| no_remaining`". `void_usage(id)` 행 — "코드: `not_authenticated \| forbidden \| usage_not_found \| already_voided`". `use_ticket` 행 끝에 "4a 에서 재정의: 사람 행 `for update` + `lock_family_meal`". 잠금 순서 문단에 "장부 행(issuances·usages) 잠금은 ④ 뒤에 — 합류의 장부 이동과 같은 순서" 한 줄.
- §8.3 **식사 상세(현황판)**: 구현대로 — "네 숫자 한 줄, 이름 검색(구매자·사용자), 가족 블록(구매자 이름들 · N장 중 M장 사용 · 남음·금액 · 발급 줄 · 사용 줄). 동작은 ⋯ 메뉴가 아니라 줄마다 작은 두 단계 확인 버튼: 가족 블록 '1장 대신 사용'(활성 발급의 최근 구매자 몫), 발급 줄 '발급 취소'(가족 남은 장수보다 많으면 잠기고 이유 표시), 사용 줄 '무효'. 취소 사유 입력 칸은 두지 않는다(DB 는 받는다). 5초 폴링."
- §9 발급: "취소 불가" 문구를 "남은 장수(N)보다 많아 취소할 수 없어요 — 먼저 사용을 무효 처리" 로.
- §12 item 1 의 `cancel_issuance` 항목에 "대신 사용 멱등(request_id)·가족 확인·④ 잠금 키 고정" 을, item 3 의 "식사 상세 ⋯ 메뉴" 를 "식사 상세 행 버튼(취소·대신 사용·무효, 두 단계 확인)" 으로, item 4 에 `e2e/admin.spec.ts`(현황판 흐름) 추가.
- §14: 4단계를 "4a 식사 상세 현황판·식권 조작·`use_ticket` 재정의 (완료, 2026-10-10) · 4b 사람 탭 · 4c 통계·CSV·공유" 로 (완료일은 merge 날짜로 맞춘다).
- §15: "4단계에서 잔량을 바꾸는 함수(…)는 … `lock_family_meal` 을 통해 잠근다 … 그때 `use_ticket` 도 재정의해 …" 항목 전체를 "(4a 에서 완료 — `cancel_issuance`·`void_usage`·`use_ticket_as_admin` 이 `lock_family_meal` 로 잠그고 `use_ticket` 은 사람 행 `for update` 로 재정의됨)" 로 줄이고, `would_go_negative` 항목도 "(4a 에서 구현)" 표시. 새 항목: "대신 사용의 재시도 키는 메모리에만 있다(새로고침 뒤 새 키) — 발급과 같은 60초 중복 확인은 4b/4c 검토".

- [ ] **Step 3: 이 계획 파일**

"구현 결과와 계획의 차이" 절을 범위 절 다음에 만들어 Task 별로 실제 바뀐 것을 적고, 완료 기준의 수치를 실제 값으로. 모든 Step 체크박스를 `[x]` 로(PR 본문의 Test Plan 세 항목은 그대로 둔다).

- [ ] **Step 4: 전체 검증**

```bash
npm run db:reset && npm run db:test        # pgTAP 392
npm run lint && npx tsc -b
npm run test:coverage                      # 임계값(80/80/70/80) 통과
npm run build && VITE_BASE_PATH=/meal-ticket/ npm run build && grep -q '/meal-ticket/assets/' dist/index.html
npm run e2e                                # 5 passed
```

- [ ] **Step 5: 커밋 · push · PR** (push·PR 은 컨트롤러가 한다)

```bash
git add README.md docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md docs/superpowers/plans/2026-10-10-phase4a-meal-detail.md
git commit -m "docs: 4a단계 문서 동기화 — README 정정 절차, 설계 §7.3·§8.3·§9·§12·§14·§15, 계획 차이·수치

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/phase4a-meal-detail
gh pr create --title "4a단계: 식사 상세 현황판 — 발급 명단, 취소·대신 사용·무효, use_ticket 재정의" --body-file <PR 본문 파일>
```

PR 본문:

```markdown
## Summary
- 관리자 식사 탭 카드 → **현황**: 발급·사용·남음·금액, 이름 검색, 가족별 발급·사용 명단(5초 폴링). 줄마다 두 단계 확인으로 **발급 취소**(가족 남은 장수 안에서만) · **1장 대신 사용** · **사용 무효**.
- DB: `cancel_issuance` · `use_ticket_as_admin` · `void_usage` 신설(잠금 규칙 ②→④→장부 행), `use_ticket` 재정의(사람 행 `for update` + `lock_family_meal` — 3단계 최종 리뷰 인계). pgTAP +44 (총 392).
- E2E `admin.spec.ts`(현황판 흐름). README 의 임시 SQL 정정 절차 제거.

## 운영 (merge 전 확인)
- 마이그레이션 1개(함수만, 테이블 변경 없음). `use_ticket` 은 같은 시그니처로 재정의되어 교인 화면은 바뀌지 않는다.

## Test Plan
- [ ] CI 녹색 (pgTAP 392 · vitest · E2E 5)
- [ ] merge 후 Deploy 성공, 운영에서 관리 › 식사 › 현황 열어 내일 식사의 발급 명단 확인
- [ ] 실제 폰: 대신 사용 1건 → 교인 홈 잔량 반영 → 무효 → 복구

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

PR 은 사용자가 merge 한다.

---

## 완료 기준

- pgTAP: 010~140 전부 통과, 총 392 (140 = 44).
- Vitest 전부 통과, 커버리지 임계값 통과.
- `npm run lint` · `npx tsc -b` · `npm run build` · 하위 경로 빌드 통과.
- Playwright: 5 passed (admin 1 · family 1 · onboarding 2 · tickets 1).
- 운영: merge 뒤 Deploy 성공, 관리 › 식사 › 현황에서 명단이 보인다.

## 다음 계획(4b·4c)으로 넘기는 것

- **4b 사람 탭**: `merge_people(from, into)`(대상 보호자 행 `for update` — 3단계 인계), `link_person`, `admin_reset_person`, 번호 수정, 가족 보기, 발급·사용 이력, 필터 칩. 취소 **사유 입력 칸**(DB 는 `p_reason` 을 이미 받는다)과 "취소 내역 보기" 는 이력 화면과 함께. `admin_reset_person` 이 생기면 README 운영 체크리스트의 "자녀 삭제·탈퇴 대신 처리 SQL" 을 지운다.
- **4b 또는 4c**: 대신 사용의 재시도 키는 메모리에만 있다(새로고침하면 새 키). 발급의 60초 중복 확인 창과 같은 완화를 대신 사용에도 둘지 검토.
- **4c 통계**: 월 선택 → 발급·금액·사용 → 식사별 → 교인별, CSV(취소·무효 행 포함), Web Share. 식사 상세의 이름 검색은 지금 클라이언트 필터다 — 명단이 수백 가족이 되면 서버 검색으로.
- 식사 상세의 가족 블록은 `aria-label` 로 가족을 식별한다. 같은 이름 조합의 가족이 둘이면 E2E `getByRole('listitem', { name })` 이 strict 모드에 걸린다 — 그때 `data-family-id` 로.
- 3단계 계획이 넘긴 나머지(ConfirmButton 터치 영역, 포커스 복귀, `maxLength` NFD, 두 초록 알림 합치기, E2E 헬퍼 분해)는 그대로 4b/4c 또는 5단계로.
