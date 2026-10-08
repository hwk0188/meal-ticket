# 3단계 · 가족·아이 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카카오 없는 아이가 "아이 계정으로 시작" → 8자리 연결 코드 → 보호자 앱 "자녀 추가" 로 한 가족이 되고, 배우자도 코드로 가족을 합쳐, 네 식구가 한 잔량을 각자 폰에서 쓰게 한다. 가족 탭(구성원·자녀 추가·재연결·가족 연결·가족 나가기·자녀 삭제·내 정보 수정·탈퇴)과 pg_cron 정리 작업까지 포함한다.

**Architecture:** 설계 §7 의 `pairing_codes` 테이블(정책 없음 — 함수로만)과 SECURITY DEFINER 함수 7개(`create_pairing_code` · `add_family_member` · `relink_child` · `leave_family` · `remove_child` · `delete_my_account` + 잠금 헬퍼 `lock_family_meal`)를 추가한다. 2단계 스키마는 바꾸지 않는다 — 가족 공유 잔량은 이미 `family_id` 로 계산된다. 가족 합치기는 옛 가족이 비면 장부(`issuances`·`usages`)의 `family_id` 를 통째로 옮긴다(풀 병합, 2단계 인계 결정). 프론트는 익명 로그인(`signInAnonymously`)과 `#/pair`(코드 표시 + 3초 폴링으로 연결 감지), `#/family` 탭을 더하고, 가드는 "익명·미가입 → `/pair`, 카카오·미가입 → `/onboarding`" 으로 갈라진다. 정리 작업 3건은 함수로 두고 pg_cron 이 호출한다(pgTAP 이 함수를 직접 검증).

**Tech Stack:** 2단계와 동일 — React 19 · Vite 8 · TypeScript 6(strict) · Tailwind v4 · react-router 7(HashRouter) · TanStack Query 5 · supabase-js 2 · zod 4 · Vitest 4 · Playwright 1.63 · Supabase CLI 2.120.0(고정) · pgTAP · **pg_cron(새로 사용, 무료)** · pgcrypto(이미 켜져 있음).

**설계 문서:** `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md` §4(연결 코드), §5.1(준비 3·4·5, 예외 2), §7.1(`pairing_codes`), §7.3(함수), §7.4(RLS), §7.5(pg_cron), §8.1(라우트 `#/pair` `#/family`), §8.2(시작·가입·연결 코드·가족), §9(가입·연결), §10(파기·증빙), §12(E2E (b)), §15(장부 이동 결정). 2단계 계획 `docs/superpowers/plans/2026-10-08-phase2-tickets.md` 의 "3단계로 넘기는 것".

**사전 검증(2026-10-09, 계획 작성 중):** 아래 Task 1~4 의 마이그레이션 SQL 과 pgTAP 4개 파일은 로컬 Supabase(Postgres 17, 비슈퍼유저 `postgres`)에서 트랜잭션 롤백 방식으로 미리 실행해 전부 통과(29·62·46·20 — Task 1~4 리뷰로 테스트가 늘었다)를 확인했다. `create extension pg_cron`·`cron.schedule`·`delete from auth.users` 가 로컬의 비슈퍼유저 `postgres` 로 되는 것도 확인했다(운영 Supabase 의 권한 모델과 같다). 그대로 옮겨 적으면 된다 — 바꿀 때만 다시 검증한다.

---

## 범위

**이번 단계에 넣는 것**

| 영역 | 내용 |
|---|---|
| DB | `pairing_codes`(RLS 켜고 정책 없음), `lock_family_meal` 헬퍼, `create_pairing_code(kind)`, `add_family_member(code, child_name)`(child/adult, 어른 합류 때 빈 가족의 장부 이동), `relink_child(child_id, code)`, `leave_family()`, `remove_child(child_id)`, `delete_my_account()`, pg_cron 3건(코드 정리·고아 익명 계정 정리·빈 가족 정리 — 함수 + `cron.schedule`) |
| 교인 | 시작 화면 "아이 계정으로 시작하기(카카오 없이 · 보호자 연결 필요)". 가입 화면 "어른이에요 / 만 14세 미만이에요" 토글. `#/pair` 연결 코드(8자리·남은 시간·새 코드·연결되면 자동 홈). `#/family` 가족 탭(어른만): 구성원 목록(이름·가려진 번호·자녀/미가입 태그·동의 날짜), 자녀 추가(이름·코드·법정대리인 동의 / 기존 자녀 고르면 재연결), 가족 연결(코드 입력 또는 내 코드 보여 주기), 가족 나가기, 자녀 삭제, 내 정보 수정(이름·번호), 탈퇴. 아이 폰: 가족 탭 없음, 로그아웃 전 확인. |
| 공통 | 로그아웃 시 캐시 정리를 `AuthProvider` 의 `SIGNED_OUT` 처리로 이동(설계 §15 — 탈퇴·코드 화면 "처음으로" 라는 두 번째 로그아웃 경로가 생긴다). 오류 코드 문구 추가. |
| 테스트 | pgTAP 4개 파일(+157), Vitest 단위·컴포넌트, Playwright E2E 1개(아이 익명 시작 → 코드 → 보호자 자녀 추가 → 아이 폰 가족 잔량 → 아이 폰에서 사용 → 보호자 폰 반영) |
| 운영 | README: Supabase **Anonymous sign-ins 켜기**(운영 콘솔, 사용자 작업), pg_cron 안내. 설계 문서 상태 갱신. |

**이번 단계에서 의도적으로 미루는 것**

- `merge_people` · `link_person` · `admin_reset_person`, 사람 탭, 발급 검색의 "가족 수" 태그, 식사 상세, 통계 → **4단계**.
- `use_ticket` 을 `lock_family_meal` 헬퍼로 바꾸는 일 → 4단계 첫 마이그레이션(2단계 인계대로). 이번 단계는 헬퍼를 만들고 `add_family_member` 에서만 쓴다. 키가 같다는 것은 pgTAP(`100_pairing_codes.sql`)이 `pg_locks` 로 고정한다. **4단계에서 잔량을 바꾸는 함수(`use_ticket_as_admin`·`cancel_issuance`·`void_usage`)는 날짜 제한이 없으므로 `lock_family_meal` 만으로는 부족하다 — `lock_family(family)` 도 함께 잡아야 합류 중인 가족의 옛 식사에 사용이 떨어져 잔량이 어긋나는 일을 막는다**(Task 2 리뷰). 가장 깔끔한 변형은 `use_ticket` 에도 `lock_family` 를 넣고 `add_family_member` 의 식사 잠금 루프를 없애는 것.
- 연결 코드 무차별 대입 완화(실패 횟수 제한) → 보류. RPC 가 예외로 끝나면 같은 트랜잭션의 기록도 롤백되어 "실패 기록" 을 남길 수 없다. 코드 공간 100만·유효 10분·얻을 것이 식권 몇 장이라 교회 앱에서는 감수한다(§15 에 적는다).
- 탈퇴한 카카오 계정의 `auth.users` 행 삭제 → 보류(사람 행만 익명화. 계정은 다음 로그인 때 가입 화면으로 간다). 5단계 운영 문서에서 결정.
- PWA 매니페스트·상단 안전 영역(`pt-[env(safe-area-inset-top)]`) → 5단계(매니페스트가 생겨야 인셋이 생긴다). `#/pair` 의 "홈 화면에 추가" 는 안내 문구만.
- 홈 머리말의 가족 아바타(설계 §8.2) → 두지 않는다. "우리 가족 식권 · N명" 문구로 충분하다(YAGNI).
- 가족 탭의 "길게 눌러 가족 나가기/자녀 삭제"(설계 §8.2) → **행마다 보이는 작은 버튼 + 두 단계 확인**으로 바꾼다. 길게 누르기는 식권 사용 동작과 겹쳐 혼동을 주고, 보조기기·E2E 에서 닿지 않는다(설계 문서는 Task 14 에서 반영).

---

## 구현 결과와 계획의 차이 (실행 중 리뷰로 바뀐 것)

실행하면서 리뷰로 바뀐 것을 Task 별로 여기에 적는다. 긴 코드 스니펫은 고치지 않고, 실제 동작은 각 Task 의 커밋과 코드를 기준으로 본다.

- **Task 1** (`pairing_codes`): 품질 리뷰가 같은 계정의 동시 호출이 살아 있는 코드를 둘 만드는 것을 재현해, `create_pairing_code` 가 삭제 전에 계정 단위 advisory lock(`pg_advisory_xact_lock(hashtext('pairing_code:' || uid))`, 단일 키라 `lock_family_meal` 의 두 키 공간과 겹치지 않음)을 잡도록 바꿨다. 테스트 전화번호 블록을 020 과 겹치지 않는 `0107700…` 으로, "토큰은 유효하지만 계정이 지워진 경우 → not_authenticated" 테스트 추가(`100` 은 29건), 재활용 upsert 테스트는 새 사용자를 쓰고 함수·테스트에 상호 참조 주석, pgcrypto 스키마 확인용 `do $$ perform extensions.gen_random_bytes(1) $$` 추가, `lock_family_meal` 본문 `pg_catalog` 한정, 죽은 `v_try` 선언 제거. 아래 Task 1 스니펫은 리뷰 전 버전이다.
- **Task 2** (`add_family_member` · `relink_child`): 품질 리뷰(두 세션 재현)로 크게 보강했다. ① **연결 코드를 8자리로**(`^[0-9]{8}$`, `gen_random_bytes(8)`): 어른 코드를 맞히면 상대 가족·장부·전체 번호까지 넘어오는데 속도 제한이 없어 공간을 100배 키웠다 — 프런트(Task 9~13)의 6자리 가정도 모두 8자리로 바꿨다. ② **잠금 순서 규칙**(가족 함수 공통, 공통 규약에 명문화): "① `pairing_codes` 행 → ② 쓸 사람 행을 id 순으로 `for update` → ③ `lock_family(uuid)`(새 단일 키 헬퍼) 를 가족 id 순으로 → ④ `lock_family_meal`". `relink_child` 는 처음 코드 행을 사람 행 뒤에 잠갔다가(교착 가능) 코드 행을 먼저 잠그도록 고쳤다. 호출자 행을 잠그지 않아 합류 도중 호출자가 다른 가족으로 옮겨지면 엉뚱한 가족에 붙거나 FK 23503 이 나던 것, 자녀 삭제·나가기와 "빈 가족" 판정이 어긋나던 것을 막는다. ③ `issue_tickets` 가 사람 행을 `for update` 로 읽도록 재정의(합류 중 발급이 옛 가족에 떨어지는 경합). ④ 빈 가족 삭제는 `cleanup_empty_families` 와 같은 조건(사람·장부 모두 없음)에서만. ⑤ 사용된 코드로 재시도하면 이미 연결된 그 사람 행을 돌려준다(RPC 멱등 규약). ⑥ 자녀 추가에 `p_consent_version`(YYYY-MM-DD, `consent_required`) 를 받아 자녀 행 `consent_version` 에 남긴다(§10 증빙) — 프런트 `useAddChild` 가 `church.consentVersion` 을 보낸다. ⑦ 이름 유효성은 `normalize_name`, 코드 입력은 공백·개행 제거, `relink_child` 의 `unique_violation` → `already_registered`, 자녀 이동은 옛 가족 범위로만, 잠그는 식사는 오늘 이후만. `110` 은 62건(식사 잠금 범위를 `pg_locks` 로 고정하는 2건 포함). "코드 계정의 auth.users 행이 없는" 분기는 FK cascade 때문에 닿을 수 없어 테스트하지 않는다(방어 코드는 둔다). 아래 Task 1·2 스니펫은 리뷰 전 버전이다.
- **Task 3** (계획 단계에서 미리 반영): 위 잠금 규칙에 맞춰 `leave_family` 는 내 행 → 옮길 자녀 행(id 순) → `lock_family`, `remove_child` 는 (잠금 없이 자녀를 읽어) 자녀 계정의 코드 행 삭제 → 자녀 행 `for update` → `lock_family`, `delete_my_account` 는 내 코드 행 삭제 → 내 행 → `lock_family` 순으로 잠근다(코드 행이 ① 클래스라 사람 행보다 먼저). 나가기는 내 가족 범위의 자녀만 옮긴다(다른 가족에 사는 자녀 테스트 추가). `120` 은 리뷰 반영 뒤 46건. 아래 Task 3 스니펫은 반영된 버전이며 2026-10-09 에 다시 롤백 검증했다. **품질 리뷰 뒤**: `delete_my_account` 에 마지막 관리자 보호(`last_admin` — 관리자 지정이 SQL 로만 가능해 마지막 관리자가 탈퇴하면 운영이 멈춘다) 추가, 헤더에 "어른 행을 자녀 행보다 먼저 잠근다" 불변식과 식사 잠금 생략 이유 주석, 테스트 보강(`not_registered`·본인 코드 삭제·`pg_locks`·익명 구성원 no-op·마지막 관리자). 가족 나가기 확인 문구는 발급·사용 내역도 남는다는 말을 넣었다(Task 11).
- **Task 5** (프론트 공통): 품질 리뷰로 `toUserMessage` 가 `code` 필드의 값도 MESSAGES 에서 찾도록 바꿨다 — supabase-js 인증 오류(`AuthApiError.code = 'anonymous_provider_disabled'`, 익명 로그인이 꺼져 있을 때)는 코드가 `message` 가 아니라 `code` 에 온다. 문구 `anonymous_provider_disabled` 추가(총 8개). `usePerson` 의 "옵션 없음" 테스트와 `validateWith` 의 "한 필드 여러 오류" 분기 테스트를 실제로 검증하도록 보강, `formatDateTime` 이 `formatDate` 를 재사용, `UsePersonOptions` 타입 export, `mealSchema` 도 `validateWith` 로 통일(경로 없는 오류가 `"undefined"` 키로 가던 버그 수정). TanStack 은 관찰자마다 타이머를 따로 가지며 가드는 공유 Query 의 갱신만 받는다(계획의 "가장 짧은 주기" 설명은 틀렸고 결론만 맞다).
- **Task 7** (가드·가족 탭): 품질 리뷰로 세 가드를 **data 기준**으로 바꿨다(위 공통 규약) — 백그라운드 재조회가 실패해도 `data` 가 있으면 화면을 유지한다. `/pair` 라우트를 Task 7 에서 Spinner 자리표시자로 미리 두었다(가드가 보내는 경로에 라우트가 없으면 무한 리다이렉트; `App.test.tsx` 에 익명 세션 → `#/pair` 테스트). `ConfirmButton` 의 포커스 복귀는 ref 를 effect 안에서만 만지고 `disabled` 를 의존성에 넣어, 처리 중 비활성이었다가 다시 활성화될 때 원래 버튼으로 돌아간다(Task 11·12 의 자녀 삭제·가족 나가기·탈퇴가 이 모양이다).
- **Task 8** (시작·가입 화면): 품질 리뷰로 가입 유형 토글을 **공용 `SegmentedControl`**(`src/components/SegmentedControl.tsx`, 숨긴 네이티브 라디오 + peer 스타일)로 바꿨다 — 손으로 만든 `role="radio"` 버튼은 방향키·단일 탭 정지가 없고 선택 안 된 라벨(`text-gray-500` on `bg-gray-100`, 14px bold)이 4.39:1 로 AA 미달이었다. 네이티브 라디오라 `getByRole('radio', { name })`·`toBeChecked()` 테스트가 그대로 산다. Task 12 의 `JoinFamilyPanel` 도 같은 컴포넌트를 쓴다(스니펫 반영). 아이 계정 버튼에 진행 안내(role=status) 추가, iPhone Safari bfcache 복원(`pageshow` persisted)으로 `pending` 이 되살아나 두 버튼이 영구 잠기던 2단계 버그 수정, `/pair` 링크에 `active:` 피드백. 아이 계정 시작 실패 테스트는 supabase-js 의 `AuthApiError` 모양(`code: 'anonymous_provider_disabled'`)으로 바꿔 전용 문구('아이 계정 시작이 꺼져 있어요…')를 단언한다(Task 5 리뷰 반영의 결과).
- **Task 6** (로그아웃 경로 통합): 품질 리뷰로 `ConfirmButton` 의 접근성을 다듬었다 — 열리면 취소 버튼에 포커스, 취소하면 원래 버튼으로 포커스 복귀, 취소를 먼저(파괴적 버튼은 뒤) 배치, 버튼 `py-3`, `aria-describedby` 로 확인 버튼에 문구 연결, 정렬 `align` prop(기본 `end`, SignOutButton 은 `center`), 열린 채 `disabled` 가 되면 닫힘. 홈 바닥글은 세로 배치로 되돌려 문구·오류가 전체 폭을 쓴다. `signOut` 은 `scope: 'local'`(이 폰만 — 공용 폰에서 로그아웃해도 본인 폰은 유지). `AuthProvider` 는 SIGNED_OUT 타이머를 정리하고, 캐시 비움이 꼭 필요한 이유(`['pairing-code', kind]` 키가 사용자 범위가 아니라 새 익명 계정이 이전 계정의 코드를 캐시에서 읽을 수 있다)를 주석에 적었다. 리스트 행의 ConfirmButton 은 처리 중일 때 `label` 을 '처리 중…' 으로 바꾼다(Task 11·12). `useDeleteAccount` 는 onSuccess/onSettled 무효화를 두지 않는다(그 콜백이 clear 보다 먼저 돌아 폐기된 토큰으로 401 재조회를 쏜다).
- **Task 4** (정리 작업, 계획 단계에서 미리 반영): Task 1 리뷰 권고에 따라 `cleanup_orphan_anonymous_users` 가 **살아 있는 연결 코드를 가진 익명 계정은 지우지 않도록** 조건을 더했다(하루 전에 로그인해 둔 아이 폰이 지금 코드를 보여 주는 중일 수 있다 — 지우면 cascade 로 코드가 사라지고 그 폰이 로그아웃된다). `130` 은 18건. 아래 Task 4 스니펫은 반영된 버전(코드 리터럴도 8자리)이며 2026-10-09 에 다시 롤백 검증했다 — 구현 중 코드 리터럴이 6자리로 남아 있던 것을 8자리로 고쳤다. **품질 리뷰 뒤**: Supabase 공식 문서의 `grant … on schema cron to postgres` 두 줄을 **제거**했다(supautils 가 이미 권한을 주고, 그 grant 가 남으면 Supabase 의 pg_cron after-create 스크립트의 CASCADE 없는 revoke 가 2BP01 로 실패해 `db push` 가 깨진다) — 대신 그런 grant 가 있으면 먼저 거두는 prelude 를 둔다. 정리 함수는 SECURITY INVOKER(cron 이 postgres 로 실행; DEFINER 는 service_role 에 auth.users 삭제 권한을 넘겨 준다), 세 건수 단언은 다른 세션이 남긴 행에 깨지지 않게 `>=` 로, `cron.job` 의 command·active 를 고정하는 테스트 2건 추가(`130` 은 20건). 아래 Task 4 스니펫은 반영된 최종 버전이다.

---

## 파일 구조

**DB (`supabase/`)**

| 파일 | 책임 |
|---|---|
| `migrations/20261009000001_pairing_codes.sql` | pgcrypto 보장, `pairing_codes` 테이블(RLS·권한 회수·정책 없음), `lock_family_meal(uuid,uuid)`, `create_pairing_code(text)` |
| `migrations/20261009000002_family_functions.sql` | `add_family_member(text,text)`(child/adult + 장부 이동), `relink_child(uuid,text)` |
| `migrations/20261009000003_leave_remove_delete.sql` | `leave_family()`, `remove_child(uuid)`, `delete_my_account()` |
| `migrations/20261009000004_cleanup_jobs.sql` | `pg_cron` 확장, `cleanup_pairing_codes()` · `cleanup_orphan_anonymous_users()` · `cleanup_empty_families()`, `cron.schedule` 3건 |
| `tests/database/100_pairing_codes.sql` · `110_add_family_member.sql` · `120_leave_remove_delete.sql` · `130_cleanup_jobs.sql` | pgTAP (29 · 62 · 46 · 20) |

**프론트 (`src/`)** — 기능별 폴더. 한 파일 하나의 책임, 테스트는 옆에 둔다.

| 파일 | 책임 |
|---|---|
| `lib/errors.ts` (수정) | 3단계 오류 코드 문구(`invalid_kind` `not_adult` `invalid_code` `child_not_found` `has_children` `code_generation_failed` `last_admin`) |
| `lib/validate.ts` | zod 스키마 → `{ok, values}` 또는 필드별 첫 오류 (`validateWith`). 가입 화면의 `validateOnboarding` 도 이것을 쓰도록 바꾼다 |
| `lib/dates.ts` (수정) | `formatDate(iso)` → 서울 'M/D' (동의 날짜 표시) |
| `features/auth/signIn.ts` (수정) | `signInAsChild()` = `supabase.auth.signInAnonymously()` |
| `features/auth/usePerson.ts` (수정) | `usePerson(userId, { refetchInterval })` — 연결 대기·합류 대기 폴링 |
| `features/auth/AuthProvider.tsx` (수정) | `SIGNED_OUT` 이벤트에서 `queryClient.clear()` (한 틱 미룸) |
| `features/auth/Gate.tsx` (수정) | 미가입 분기: 익명 → `/pair`, 카카오 → `/onboarding`. `RequireSession` 에 `allowAnonymous`. `RequireAdult` |
| `components/ConfirmButton.tsx` | 누르면 확인 문구 + [확인][취소] 가 열리는 작은 버튼 (가족 나가기·자녀 삭제·탈퇴·아이 로그아웃) |
| `components/SignOutButton.tsx` | 로그아웃 버튼(실패 안내·잠금). 홈 바닥글과 `#/pair` 가 같이 쓴다 |
| `components/PersonShell.tsx` (수정) | 어른에게 가족 탭 추가. 자녀 계정은 식권·내역만 |
| `pages/StartPage.tsx` (수정) | "아이 계정으로 시작하기" 버튼 |
| `features/onboarding/OnboardingPage.tsx` (수정) | "어른이에요 / 만 14세 미만이에요" 토글. 14세 미만 → `/pair` 안내 |
| `features/pairing/usePairingCode.ts` | `create_pairing_code` 호출(자동 재조회 전부 끔), `PAIR_POLL_MS` |
| `features/pairing/useCountdown.ts` | 만료까지 남은 초(1초 간격) + `formatRemaining` |
| `features/pairing/PairingCodeCard.tsx` | 8자리 큰 글씨·남은 시간·새 코드 받기 (아이 화면과 가족 탭 "내 코드" 가 공유) |
| `pages/PairPage.tsx` | `#/pair`: 코드 카드 + 안내 + 3초 폴링 + 처음으로(로그아웃) |
| `features/family/familySchema.ts` | zod: 자녀 추가·재연결·가족 연결·내 정보 (`nameSchema` `codeSchema` 공유) |
| `features/family/useFamilyMembers.ts` | 가족 구성원 조회 (`family-members` 키) |
| `features/family/useFamilyActions.ts` | 뮤테이션 7개 + 무효화 묶음 (`invalidateFamily`) |
| `features/family/MemberList.tsx` | 구성원 행(태그·번호·동의 날짜) + 행 버튼(가족 나가기·자녀 삭제, 두 단계 확인) |
| `features/family/AddChildForm.tsx` | 자녀 추가 / 기존 자녀 재연결 폼 |
| `features/family/JoinFamilyPanel.tsx` | 가족 연결: 코드 입력(상대를 우리 가족으로) / 내 코드 보여 주기(내가 상대 가족으로) |
| `features/family/ProfileSection.tsx` | 내 정보 수정(이름·번호) · 탈퇴 |
| `pages/FamilyPage.tsx` | `#/family` 조립 |
| `pages/HomePage.tsx` (수정) | 바닥글이 `SignOutButton` 을 쓴다(아이 계정은 확인 문구). 캐시 정리 코드 제거 |
| `App.tsx` (수정) | `/pair`, `/family` 라우트 |
| `test/fakeSupabase.ts` (수정) | `update` 체인 |
| `e2e/helpers.ts` · `e2e/family.spec.ts` · `e2e/tickets.spec.ts`(수정) | 공통 헬퍼 추출, 가족 E2E |

---

## 공통 규약 (1·2단계에서 이어받음 — 모든 Task 에 적용)

- **새 함수 체크리스트.** `auto_expose_new_tables = true` 는 새 함수에 `anon=X` 를 자동으로 붙인다. 함수마다 `revoke execute … from public, anon` 을 명시하고 필요한 역할에만 `grant`. pgTAP `020_people_schema.sql` 이 "anon 에게 열린 public 함수는 `{ping}` 뿐" 을 고정한다. **새 테이블·뷰도 `revoke all … from anon, authenticated`** 를 명시하고 필요한 권한만 다시 준다. 내부 전용 함수(`lock_family_meal`, `cleanup_*`)는 `authenticated` 에서도 revoke 한다.
- SECURITY DEFINER 함수는 `set search_path = public, pg_temp`. 객체는 스키마 한정. 정책·뷰의 `auth.uid()`/헬퍼 호출은 `(select …)` 로 감싼다(행마다 재평가 방지). plpgsql 함수 본문의 `where auth_user_id = auth.uid()` 는 그대로 둔다(문장당 한 번 평가되고 표가 작다 — 2·3단계 함수가 그렇게 쓴다).
- RPC 오류는 `raise exception '<snake_case 코드>'` (값 보간 금지). 프론트는 `toUserMessage` 로 문구화. 알려진 DB 원시 오류(23505 등)는 함수 안에서 코드로 번역한다.
- **가족 함수 잠금 규칙(Task 2 리뷰로 확정, 모든 가족·장부 함수에 적용):** ① `pairing_codes` 행(`for update` 또는 delete) → ② 쓸 `people` 행을 **id 순**으로 `for update`(한 문장 `… order by id for update`) → ③ `public.lock_family(uuid)` 를 **가족 id 순**으로 → ④ `public.lock_family_meal(uuid, uuid)` 를 meal_id 순으로. 가족 잠금을 쥔 채 사람 행을 새로 잠그지 않는다. 구성원을 세는 판단("빈 가족인가", "자녀가 있나", "나뿐인가")은 ③ 뒤에서 한다. 이 순서를 어기면 두 세션에서 40P01(교착)이 원시 오류로 샌다. 예외: 시간당 `cleanup_pairing_codes` 의 일괄 삭제(①)는 `delete_my_account`·`remove_child` 의 코드 삭제와 교착할 수 있는데, pg_cron 은 재시도하지 않고 다음 예정 실행 때 다시 돌 뿐이므로(실패는 `cron.job_run_details` 에만 남는다) 정리 작업에는 그대로 둔다.
- 테스트 데이터는 다른 테스트·E2E 가 남긴 행과 섞이지 않게 **고정 id 또는 `created_at = now()`** 로 범위를 좁힌다. 식사 제목은 `'테스트 점심 110'` 처럼 파일 번호를 박아 고유하게. **pgTAP 에서 `pairing_codes`·`issuances` 같은 테이블을 직접 읽거나 쓰기 전에는 반드시 `tests.clear_auth()`** — API 역할에는 권한이 없어 `permission denied` 로 트랜잭션이 깨진다(사전 검증에서 두 번 걸렸다).
- plpgsql 함수가 `returns table (code text, …)` 처럼 테이블 열과 같은 이름의 반환 열을 가지면 본문의 `on conflict (code)` 가 "ambiguous" 로 깨진다. 그 열을 변수로 쓰지 않을 때는 `#variable_conflict use_column` 을 선언부 위에 둔다(`create_pairing_code` 참고).
- 프론트: `verbatimModuleSyntax` 라 타입은 `import type`. `vi.fn<() => T>()` 처럼 타입 인자를 적는다(`vitest/require-mock-type-parameters`). 컴포넌트 파일에서 컴포넌트가 아닌 것을 export 하지 않는다(`react/only-export-components`) — 상수·훅은 `.ts` 파일로. effect 안에서 `setState` 를 바로 부르지 않는다(`react/set-state-in-effect`) — 인터벌·구독 콜백 안에서만.
- **조회 화면은 `status` 가 아니라 `data` 로 분기한다.** 패턴: `data ? <본문 + (error 면 작은 안내)> : status === 'error' ? <alert + 다시 시도> : <Spinner inline />`.
- **가드(`Gate`·`RequireSession`·`RequirePerson`)도 `data` 로 먼저 분기한다** — `data !== undefined`(성공한 `null` 포함)이면 그대로 가고, `status === 'error'` 는 한 번도 성공한 적이 없을 때만 본다. 폴링 한 번 실패로 연결 코드 화면이 내려가면 코드가 재발급돼 보호자가 적던 코드가 죽는다 (Task 7 리뷰).
- **가드가 보내는 경로는 같은 커밋 안에 라우트가 있어야 한다.** 라우트 없는 경로로 보내면 `*` → `/` → 가드 → … 무한 리다이렉트가 된다. `/pair` 는 Task 7 에서 자리만 잡고 Task 9 가 화면을 넣는다 (Task 7 리뷰).
- **뮤테이션의 `onSuccess`/`onSettled` 는 무효화 promise 를 반드시 return** 한다(끝나기 전에 버튼이 열리면 묵은 데이터로 또 누른다).
- `PersonShell` 아래 화면은 `<main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">`. `PersonShell` 밖(시작·가입·`/pair`)은 `min-h-dvh` 를 스스로 갖는다.
- 커밋 메시지는 `<type>: <설명>` 형식, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 작업 브랜치 `feat/phase3-family` 에서 시작한다. `main` 에 직접 커밋하지 않는다. PR 은 사용자가 merge 한다(merge 가 운영 마이그레이션을 실행한다).

```bash
cd /Users/hong-wongi/Dev/sample/meal-ticket
git checkout main && git pull --ff-only && git checkout -b feat/phase3-family
git add docs/superpowers/plans/2026-10-09-phase3-family.md && git commit -m "docs: 3단계(가족·아이) 구현 계획

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
npm ci && npm run db:start   # 로컬 Supabase (Docker 필요). 이미 떠 있으면 생략
```

---
### Task 1: 마이그레이션 ⑨ `pairing_codes` + `lock_family_meal` + `create_pairing_code`

**Files:**
- Create: `supabase/migrations/20261009000001_pairing_codes.sql`
- Test: `supabase/tests/database/100_pairing_codes.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/100_pairing_codes.sql`**

```sql
begin;
select plan(28);

-- 테이블: 함수로만 쓴다. 정책 없음, API 역할 권한 없음.
select has_table('public', 'pairing_codes', 'pairing_codes 테이블이 있다');
select table_privs_are('public', 'pairing_codes', 'anon', '{}'::text[], 'anon 은 pairing_codes 에 아무 권한이 없다');
select table_privs_are('public', 'pairing_codes', 'authenticated', '{}'::text[], 'authenticated 도 pairing_codes 를 직접 읽지 못한다 (함수로만)');
select is((select relrowsecurity from pg_class where oid = 'public.pairing_codes'::regclass), true, 'pairing_codes 에 RLS 가 켜져 있다');
select policies_are('public', 'pairing_codes', '{}'::name[], 'pairing_codes 에는 정책이 하나도 없다');
select is(has_function_privilege('anon', 'public.create_pairing_code(text)', 'EXECUTE'), false, 'anon 은 create_pairing_code 를 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.lock_family_meal(uuid,uuid)', 'EXECUTE'), false, 'lock_family_meal 은 API 역할에 열려 있지 않다 (함수 안에서만)');

-- 잠금 헬퍼: use_ticket 과 같은 키 (classid = hashtext(family), objid = hashtext(meal), 두 int4 키 → objsubid 2)
select gen_random_uuid() as fam \gset
select gen_random_uuid() as meal \gset
select lives_ok(format($$ select public.lock_family_meal(%L, %L) $$, :'fam', :'meal'), 'lock_family_meal 을 잡을 수 있다');
select is(
  (select count(*) from pg_locks
    where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
      and classid::bigint = (hashtext(:'fam'::text)::bigint & 4294967295)
      and objid::bigint = (hashtext(:'meal'::text)::bigint & 4294967295)),
  1::bigint, '잠금 키는 hashtext(family), hashtext(meal) 이다 (use_ticket 과 같은 키)');

-- 준비: 어른 A(가입), 자녀 계정 M(어른 A 의 자녀로 등록된 카카오 계정), 익명 계정 K(가입 전), 카카오 계정 N(가입 전)
select tests.create_user('pair-a@test.local') as a_uid \gset
select tests.create_user('pair-m@test.local') as m_uid \gset
select tests.create_user() as k_uid \gset
select tests.create_user('pair-n@test.local') as n_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01077770001', :'a_uid', now(), '2026-10-07');
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('민준', :'a_fid', :'m_uid', true, :'a_pid', now());

-- child: 사람 행이 없는 계정(익명·카카오 모두)만
select tests.authenticate_as(:'k_uid');
select results_eq(
  $$ select code ~ '^[0-9]{6}$', expires_at between now() + interval '9 minutes' and now() + interval '10 minutes' from public.create_pairing_code('child') $$,
  $$ values (true, true) $$,
  '익명 계정은 6자리 자녀 코드를 받고 10분 뒤 만료된다');
select tests.clear_auth();
select results_eq(
  format($$ select kind, used_at from public.pairing_codes where auth_user_id = %L $$, :'k_uid'),
  $$ values ('child'::text, null::timestamptz) $$,
  '코드 행에 계정·종류가 남고 아직 사용되지 않았다');
select (select code from public.pairing_codes where auth_user_id = :'k_uid') as k_code1 \gset
select tests.authenticate_as(:'k_uid');
select lives_ok($$ select public.create_pairing_code('child') $$, '같은 계정이 다시 요청하면 새 코드');
select tests.clear_auth();
select is((select count(*) from public.pairing_codes where auth_user_id = :'k_uid'), 1::bigint, '한 계정에 코드는 하나뿐이다 (이전 코드는 지워진다)');
select isnt((select code from public.pairing_codes where auth_user_id = :'k_uid'), :'k_code1', '새 코드는 이전 코드와 다르다');
select tests.authenticate_as(:'n_uid');
select lives_ok($$ select public.create_pairing_code('child') $$, '카카오 로그인 뒤 "만 14세 미만" 을 고른 계정(사람 행 없음)도 자녀 코드를 받는다');
select tests.clear_auth();

-- child: 이미 사람 행이 있는 계정은 거부
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.create_pairing_code('child') $$, 'P0001', 'already_registered', '가입을 마친 어른은 자녀 코드를 받을 수 없다');
select tests.authenticate_as(:'m_uid');
select throws_ok($$ select public.create_pairing_code('child') $$, 'P0001', 'already_registered', '이미 연결된 자녀 계정도 자녀 코드를 받을 수 없다');

-- adult: 가입을 마친 어른만
select throws_ok($$ select public.create_pairing_code('adult') $$, 'P0001', 'not_adult', '자녀 계정은 어른 코드를 받을 수 없다');
select tests.authenticate_as(:'k_uid');
select throws_ok($$ select public.create_pairing_code('adult') $$, 'P0001', 'not_registered', '가입 전 계정은 어른 코드를 받을 수 없다');
select tests.authenticate_as(:'a_uid');
select lives_ok($$ select public.create_pairing_code('adult') $$, '어른은 어른 코드를 받는다');
select tests.clear_auth();
select is((select kind from public.pairing_codes where auth_user_id = :'a_uid'), 'adult', '어른 코드의 종류는 adult');

-- 잘못된 종류
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.create_pairing_code('spouse') $$, 'P0001', 'invalid_kind', '모르는 종류는 거부한다');
select throws_ok($$ select public.create_pairing_code(null) $$, 'P0001', 'invalid_kind', 'null 종류도 거부한다');
select tests.clear_auth();

-- 만료·사용된 남의 코드 자리는 재활용된다: 그 코드와 같은 값을 뽑는 상황은 강제할 수 없으므로 upsert 문장만 직접 검증한다
select tests.create_user() as old_uid \gset
insert into public.pairing_codes (code, auth_user_id, kind, expires_at, used_at)
values ('00000000', :'old_uid', 'child', now() - interval '1 minute', now() - interval '2 minutes');
insert into public.pairing_codes as pc (code, auth_user_id, kind, expires_at)
values ('00000000', :'k_uid', 'child', now() + interval '10 minutes')
on conflict (code) do update set auth_user_id = excluded.auth_user_id, kind = excluded.kind, created_at = now(), expires_at = excluded.expires_at, used_at = null
  where pc.used_at is not null or pc.expires_at < now();
select results_eq(
  $$ select auth_user_id, used_at from public.pairing_codes where code = '00000000' $$,
  format($$ values (%L::uuid, null::timestamptz) $$, :'k_uid'),
  '사용된 코드 자리는 새 계정의 코드로 덮어쓸 수 있다');
-- 살아 있는 코드는 덮어쓰지 못한다
insert into public.pairing_codes as pc (code, auth_user_id, kind, expires_at)
values ('00000000', :'old_uid', 'child', now() + interval '10 minutes')
on conflict (code) do update set auth_user_id = excluded.auth_user_id, kind = excluded.kind, created_at = now(), expires_at = excluded.expires_at, used_at = null
  where pc.used_at is not null or pc.expires_at < now();
select is((select auth_user_id from public.pairing_codes where code = '00000000'), :'k_uid'::uuid, '살아 있는 남의 코드는 덮어쓰지 않는다');

-- 형식 제약
select throws_ok(
  format($$ insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('12345', %L, 'child', now()) $$, :'old_uid'),
  '23514', null, '6자리 숫자가 아닌 코드는 거부한다');

-- JWT 없이 직접 호출
select tests.clear_auth();
set local role authenticated;
select throws_ok($$ select public.create_pairing_code('child') $$, 'P0001', 'not_authenticated', 'JWT 가 없으면 not_authenticated');
reset role;

-- anon 에게 열린 함수는 여전히 ping 뿐 (020 과 같은 검사를 여기서도 고정)
select is(
  (select coalesce(array_agg(p.proname order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  '{ping}'::name[], '3단계 함수들도 anon 에게 열려 있지 않다');

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: `100_pairing_codes.sql` 에서 `has_table` 등 실패(`pairing_codes` 없음). 기존 010~090 은 통과.

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261009000001_pairing_codes.sql`**

```sql
-- =========================================================
-- 연결 코드: 아이 폰(또는 합류할 어른 폰)에 뜨는 6자리 1회용 코드. 10분. 함수로만 읽고 쓴다 (정책 없음).
-- =========================================================
-- 코드 난수는 pgcrypto 의 gen_random_bytes 로 뽑는다. Supabase 는 기본으로 켜 두지만 명시해 로컬·운영을 같게 한다.
create extension if not exists pgcrypto with schema extensions;

create table public.pairing_codes (
  code text primary key check (code ~ '^[0-9]{6}$'),
  auth_user_id uuid not null references auth.users(id) on delete cascade, -- 코드를 띄운 폰의 계정
  kind text not null check (kind in ('child', 'adult')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index pairing_codes_auth_user_idx on public.pairing_codes (auth_user_id);

-- 기본 차단. 정책을 하나도 두지 않으므로 API 역할은 직접 읽지도 쓰지도 못한다 (설계 §7.4).
alter table public.pairing_codes enable row level security;
revoke all on public.pairing_codes from anon, authenticated;

-- =========================================================
-- 가족·식사 잠금 헬퍼. use_ticket 의 pg_advisory_xact_lock(hashtext(family), hashtext(meal)) 과 같은 키.
-- 잔량을 바꾸거나 장부를 옮기는 함수는 이 헬퍼로 잠근다 (4단계에서 use_ticket 도 이 헬퍼로 바꾼다).
-- =========================================================
create or replace function public.lock_family_meal(p_family_id uuid, p_meal_id uuid)
returns void
language sql
set search_path = ''
as $$ select pg_advisory_xact_lock(hashtext(p_family_id::text), hashtext(p_meal_id::text)) $$;
comment on function public.lock_family_meal(uuid, uuid) is '가족·식사 단위 트랜잭션 advisory lock. use_ticket 과 같은 키.';
revoke execute on function public.lock_family_meal(uuid, uuid) from public, anon, authenticated;

-- =========================================================
-- 연결 코드 발급.
--   child: 사람 행이 없는 계정만 (익명 계정, 또는 카카오 로그인 뒤 "만 14세 미만" 을 고른 계정).
--   adult: 가입을 마친 어른만 (배우자 가족에 합류할 때 보여 주는 코드).
--   같은 계정의 이전 코드는 지운다 (한 폰에 코드는 하나). 만료·사용된 남의 코드 자리는 재활용한다.
-- 코드: not_authenticated | invalid_kind | already_registered | not_registered | not_adult | code_generation_failed
-- =========================================================
create or replace function public.create_pairing_code(p_kind text)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 반환 열 이름(code, expires_at)이 테이블 열과 같다. 본문은 그 열을 변수로 쓰지 않으므로(v_code·v_expires 를 쓴다)
-- 이름이 겹치는 자리(on conflict (code) 등)는 열로 해석하게 한다.
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_person public.people;
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
  v_try integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_kind is null or p_kind not in ('child', 'adult') then
    raise exception 'invalid_kind';
  end if;
  -- 토큰은 유효한데 계정이 지워진 경우: FK 원시 오류(23503) 대신 약속된 코드
  if not exists (select 1 from auth.users u where u.id = v_uid) then
    raise exception 'not_authenticated';
  end if;

  select * into v_person from public.people p where p.auth_user_id = v_uid and p.deleted_at is null;
  if p_kind = 'child' then
    if found then
      raise exception 'already_registered';
    end if;
  else
    if not found then
      raise exception 'not_registered';
    end if;
    if v_person.is_minor then
      raise exception 'not_adult';
    end if;
  end if;

  delete from public.pairing_codes pc where pc.auth_user_id = v_uid;

  for v_try in 1..10 loop
    -- 암호학적 난수 4바이트 → 0..999999 (random() 은 예측 가능해 쓰지 않는다)
    v_code := lpad((((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000))::text, 6, '0');
    -- 살아 있는 남의 코드와 겹치면 where 절이 막아 아무 행도 바뀌지 않는다(found = false) → 다시 뽑는다.
    insert into public.pairing_codes as pc (code, auth_user_id, kind, expires_at)
    values (v_code, v_uid, p_kind, v_expires)
    on conflict (code) do update
      set auth_user_id = excluded.auth_user_id, kind = excluded.kind,
          created_at = now(), expires_at = excluded.expires_at, used_at = null
      where pc.used_at is not null or pc.expires_at < now();
    if found then
      return query select v_code, v_expires;
      return;
    end if;
  end loop;
  raise exception 'code_generation_failed';
end
$$;

comment on function public.create_pairing_code(text) is '연결 코드 발급(10분·1회용). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.create_pairing_code(text) from public, anon;
grant execute on function public.create_pairing_code(text) to authenticated;
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 100 의 29건 포함 전부 통과 (리뷰 반영 뒤 기준). 020 의 "anon 에게 열린 public 함수는 ping 뿐" 도 그대로 통과.

- [x] **Step 5: 커밋**

```bash
git add supabase/migrations/20261009000001_pairing_codes.sql supabase/tests/database/100_pairing_codes.sql
git commit -m "feat(db): pairing_codes 테이블, lock_family_meal 헬퍼, create_pairing_code

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 마이그레이션 ⑩ `add_family_member` · `relink_child`

**Files:**
- Create: `supabase/migrations/20261009000002_family_functions.sql`
- Test: `supabase/tests/database/110_add_family_member.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/110_add_family_member.sql`**

```sql
begin;
select plan(41);

select is(has_function_privilege('anon', 'public.add_family_member(text,text)', 'EXECUTE'), false, 'anon 은 add_family_member 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.relink_child(uuid,text)', 'EXECUTE'), false, 'anon 은 relink_child 를 실행할 수 없다');

-- 준비: 가족 A(김철수), 가족 B(이영희), 가족 C(박민수+최지우), 관리자, 익명 자녀 계정 K1·K2·K3, 가입 전 카카오 G
select tests.create_user('fam-a@test.local') as a_uid \gset
select tests.create_user('fam-b@test.local') as b_uid \gset
select tests.create_user('fam-c@test.local') as c_uid \gset
select tests.create_user('fam-d@test.local') as d_uid \gset
select tests.create_user('fam-admin@test.local') as admin_uid \gset
select tests.create_user('fam-ghost@test.local') as ghost_uid \gset
select tests.create_user() as k1_uid \gset
select tests.create_user() as k2_uid \gset
select tests.create_user() as k3_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01088880001', :'a_uid', now(), '2026-10-07'),
       ('이영희', '01088880002', :'b_uid', now(), '2026-10-07'),
       ('박민수', '01088880003', :'c_uid', now(), '2026-10-07'),
       ('권사',   '01088880009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid, family_id as b_fid from public.people where auth_user_id = :'b_uid' \gset
select id as c_pid, family_id as c_fid from public.people where auth_user_id = :'c_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, phone, family_id, auth_user_id, consented_at, consent_version)
values ('최지우', '01088880004', :'c_fid', :'d_uid', now(), '2026-10-07');
select id as d_pid from public.people where auth_user_id = :'d_uid' \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 110', '2026-10-18', :'admin_pid') returning id as meal_id \gset

-- ---------- child ----------
select tests.authenticate_as(:'k1_uid');
select (select code from public.create_pairing_code('child')) as k1_code \gset
select tests.authenticate_as(:'a_uid');
select results_eq(
  format($$ select name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at is not null, consented_at
              from public.add_family_member(%L, ' 서연 ') $$, :'k1_code'),
  format($$ values ('서연'::text, %L::uuid, %L::uuid, true, %L::uuid, true, null::timestamptz) $$, :'a_fid', :'k1_uid', :'a_pid'),
  '자녀 추가: 이름(공백 제거)·호출자 가족·코드 계정·is_minor·보호자·보호자 동의 시각이 기록된다');
select tests.clear_auth();
select id as seoyeon_pid from public.people where auth_user_id = :'k1_uid' \gset
select isnt((select used_at from public.pairing_codes where code = :'k1_code'), null, '쓴 코드는 used_at 이 기록된다');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.add_family_member(%L, '서연') $$, :'k1_code'), 'P0001', 'invalid_code', '사용된 코드는 다시 쓸 수 없다');
select throws_ok($$ select public.add_family_member('999999', '서연') $$, 'P0001', 'invalid_code', '없는 코드는 거부한다');
select throws_ok($$ select public.add_family_member(null, '서연') $$, 'P0001', 'invalid_code', 'null 코드도 거부한다');

-- 자녀 계정이 된 K1 은 더 이상 자녀 코드를 못 받는다 (100 에서도 고정) — 여기서는 자녀 계정의 add_family_member 호출을 본다
select tests.authenticate_as(:'k1_uid');
select throws_ok($$ select public.add_family_member('123456', '누구') $$, 'P0001', 'not_adult', '자녀 계정은 가족을 추가할 수 없다');
select tests.authenticate_as(:'ghost_uid');
select throws_ok($$ select public.add_family_member('123456', '누구') $$, 'P0001', 'not_registered', '가입 전 계정은 가족을 추가할 수 없다');

-- 이름 검증
select tests.authenticate_as(:'k2_uid');
select (select code from public.create_pairing_code('child')) as k2_code \gset
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.add_family_member(%L, '   ') $$, :'k2_code'), 'P0001', 'invalid_name', '자녀 이름이 비면 거부한다');
select throws_ok(format($$ select public.add_family_member(%L, null) $$, :'k2_code'), 'P0001', 'invalid_name', '자녀 코드에 이름이 없으면 거부한다');
select throws_ok(format($$ select public.add_family_member(%L, repeat('가', 21)) $$, :'k2_code'), 'P0001', 'invalid_name', '21자 이름은 거부한다');
select tests.clear_auth();
select is((select used_at from public.pairing_codes where code = :'k2_code'), null, '거부된 시도는 코드를 소모하지 않는다');

-- 만료된 코드
update public.pairing_codes set expires_at = now() - interval '1 second' where code = :'k2_code';
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.add_family_member(%L, '서연') $$, :'k2_code'), 'P0001', 'invalid_code', '만료된 코드는 거부한다');

-- 코드 계정에 이미 사람이 있으면 (코드를 받은 뒤 어른으로 가입해 버린 경우) 거부
select tests.authenticate_as(:'k3_uid');
select (select code from public.create_pairing_code('child')) as k3_code \gset
select tests.clear_auth();
-- K3 를 B 의 자녀로 먼저 연결해 둔다 (다른 어른이 먼저 연결한 상황)
select tests.authenticate_as(:'b_uid');
select lives_ok(format($$ select public.add_family_member(%L, '민준') $$, :'k3_code'), 'B 가 K3 를 자녀로 연결한다');
select tests.clear_auth();
select id as minjun_pid from public.people where auth_user_id = :'k3_uid' \gset
-- 같은 계정이 살아 있는 코드를 또 갖고 있었다면(이론상) 두 번째 어른은 already_registered 를 받는다: 코드 행을 직접 심어 재현
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00001111', :'k3_uid', 'child', now() + interval '10 minutes');
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.add_family_member('00001111', '민준') $$, 'P0001', 'already_registered', '이미 사람 행이 있는 계정의 코드는 거부한다');

-- 자기 코드는 쓸 수 없다
select (select code from public.create_pairing_code('adult')) as a_code \gset
select throws_ok(format($$ select public.add_family_member(%L) $$, :'a_code'), 'P0001', 'invalid_code', '자기 코드는 쓸 수 없다');
select tests.clear_auth();

-- ---------- adult: 빈 가족 → 장부까지 이동 ----------
-- B 가족에 발급 2장·사용 1장을 적어 둔다
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'b_pid', :'b_fid', :'meal_id', 2, 5000, :'admin_pid') returning id as b_issuance \gset
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id)
values (:'b_fid', :'b_pid', :'meal_id', 'self', :'b_pid', gen_random_uuid()) returning id as b_usage \gset
select tests.authenticate_as(:'b_uid');
select (select code from public.create_pairing_code('adult')) as b_code \gset
select tests.authenticate_as(:'a_uid');
select results_eq(
  format($$ select id, family_id from public.add_family_member(%L) $$, :'b_code'),
  format($$ values (%L::uuid, %L::uuid) $$, :'b_pid', :'a_fid'),
  '어른 합류: 코드 계정의 사람이 호출자 가족으로 옮겨진 행이 돌아온다');
select tests.clear_auth();
select is((select family_id from public.people where id = :'minjun_pid'), :'a_fid'::uuid, '그 사람의 자녀도 함께 옮겨진다');
select is((select family_id from public.issuances where id = :'b_issuance'), :'a_fid'::uuid, '옛 가족이 비었으므로 발급 장부가 새 가족으로 옮겨진다 (풀 병합)');
select is((select family_id from public.usages where id = :'b_usage'), :'a_fid'::uuid, '사용 장부도 함께 옮겨진다');
select is((select count(*) from public.families where id = :'b_fid'), 0::bigint, '비어 버린 옛 가족 행은 지워진다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'meal_id'), 1, '새 가족 잔량 = 옮겨 온 발급 2 − 사용 1');
select isnt((select used_at from public.pairing_codes where code = :'b_code'), null, '어른 코드도 사용 처리된다');

-- 같은 가족 안에서 다시 합류하면 아무것도 바뀌지 않고 그 행을 돌려준다
select tests.authenticate_as(:'b_uid');
select (select code from public.create_pairing_code('adult')) as b_code2 \gset
select tests.authenticate_as(:'a_uid');
select is((select family_id from public.add_family_member(:'b_code2')), :'a_fid'::uuid, '이미 같은 가족이면 그대로 (오류 아님)');
select tests.clear_auth();

-- ---------- adult: 남는 사람이 있는 가족 → 장부는 남는다 ----------
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'c_pid', :'c_fid', :'meal_id', 3, 5000, :'admin_pid') returning id as c_issuance \gset
select tests.authenticate_as(:'c_uid');
select (select code from public.create_pairing_code('adult')) as c_code \gset
select tests.authenticate_as(:'a_uid');
select lives_ok(format($$ select public.add_family_member(%L) $$, :'c_code'), '박민수가 A 가족에 합류한다');
select tests.clear_auth();
select is((select family_id from public.people where id = :'c_pid'), :'a_fid'::uuid, '박민수는 A 가족으로 옮겨졌다');
select is((select family_id from public.people where id = :'d_pid'), :'c_fid'::uuid, '최지우는 C 가족에 남는다');
select is((select family_id from public.issuances where id = :'c_issuance'), :'c_fid'::uuid, '남는 사람이 있으므로 장부는 C 가족에 남는다');
select is((select count(*) from public.families where id = :'c_fid'), 1::bigint, 'C 가족 행은 남는다');

-- 코드 계정의 사람이 사라졌으면(탈퇴) invalid_code
select tests.authenticate_as(:'d_uid');
select (select code from public.create_pairing_code('adult')) as d_code \gset
select tests.clear_auth();
update public.people set deleted_at = now(), auth_user_id = null, phone = null, name = '탈퇴한 사용자' where id = :'d_pid';
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.add_family_member(%L) $$, :'d_code'), 'P0001', 'invalid_code', '탈퇴한 사람의 어른 코드는 거부한다');
select tests.clear_auth();

-- ---------- relink_child ----------
select tests.create_user() as k4_uid \gset
select tests.authenticate_as(:'k4_uid');
select (select code from public.create_pairing_code('child')) as k4_code \gset
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, :'seoyeon_pid', :'k4_code'), 'P0001', 'child_not_found', '남의 자녀는 재연결할 수 없다 (보호자만)');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, :'seoyeon_pid', :'b_code2'), 'P0001', 'invalid_code', '어른 코드로는 자녀를 재연결할 수 없다');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, gen_random_uuid(), :'k4_code'), 'P0001', 'child_not_found', '없는 자녀 id 는 거부한다');
select is((select auth_user_id from public.relink_child(:'seoyeon_pid', :'k4_code')), :'k4_uid'::uuid, '재연결: 자녀 계정이 새 폰의 계정으로 바뀐다');
select tests.clear_auth();
select is((select count(*) from public.people where auth_user_id = :'k1_uid'), 0::bigint, '옛 폰의 계정은 사람 행을 잃는다 (접근 차단)');
select isnt((select used_at from public.pairing_codes where code = :'k4_code'), null, '재연결에 쓴 코드도 사용 처리된다');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, :'seoyeon_pid', :'k4_code'), 'P0001', 'invalid_code', '사용된 코드로는 재연결할 수 없다');
select tests.authenticate_as(:'k4_uid');
select throws_ok(format($$ select public.relink_child(%L, '123456') $$, :'seoyeon_pid'), 'P0001', 'not_adult', '자녀 계정은 재연결을 호출할 수 없다');
select tests.clear_auth();

-- JWT 없이 직접 호출
set local role authenticated;
select throws_ok($$ select public.add_family_member('123456', '서연') $$, 'P0001', 'not_authenticated', 'add_family_member: JWT 가 없으면 not_authenticated');
select throws_ok(format($$ select public.relink_child(%L, '123456') $$, :'seoyeon_pid'), 'P0001', 'not_authenticated', 'relink_child: JWT 가 없으면 not_authenticated');
reset role;

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 110 에서 `add_family_member` 가 없어 실패. 010~100 통과.

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261009000002_family_functions.sql`**

```sql
-- =========================================================
-- 가족 연결: 코드를 띄운 폰의 계정을 호출자(어른 교인)의 가족에 붙인다.
--   child: 자녀 사람 행을 새로 만든다 (이름만. is_minor, guardian=호출자, 보호자 동의 시각=now, 계정=코드 계정).
--   adult: 코드 계정의 사람(과 그 자녀)을 호출자 가족으로 옮긴다. 옛 가족에 산 사람이 아무도 남지 않으면
--          그 가족의 장부(issuances·usages)도 통째로 새 가족으로 옮긴다 — 잔량 풀 병합(2단계 계획 인계 결정).
--          누군가 남으면 장부는 옛 가족에 둔다 (가족 나가기와 같은 의미: 함께 쓰던 풀의 것).
-- 코드: not_authenticated | not_registered | not_adult | invalid_code | invalid_name | already_registered
-- =========================================================
create or replace function public.add_family_member(p_code text, p_child_name text default null)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_code public.pairing_codes;
  v_name text := normalize(btrim(coalesce(p_child_name, '')), NFC);
  v_target public.people;
  v_old_family uuid;
  v_meal uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;

  -- 코드 행을 잠근다: 같은 코드로 두 어른이 동시에 연결해도 한 쪽만 성공한다. 자기 코드는 쓸 수 없다.
  select * into v_code from public.pairing_codes where code = btrim(coalesce(p_code, '')) for update;
  if not found or v_code.used_at is not null or v_code.expires_at < now() or v_code.auth_user_id = auth.uid() then
    raise exception 'invalid_code';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_code.auth_user_id) then
    raise exception 'invalid_code';
  end if;

  if v_code.kind = 'child' then
    if char_length(v_name) not between 1 and 20 then
      raise exception 'invalid_name';
    end if;
    -- 코드 계정에 이미 사람이 있으면(다른 어른이 먼저 연결했거나 어른으로 가입한 계정) 연결하지 않는다
    if exists (select 1 from public.people where auth_user_id = v_code.auth_user_id and deleted_at is null) then
      raise exception 'already_registered';
    end if;
    begin
      insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
      values (v_name, v_me.family_id, v_code.auth_user_id, true, v_me.id, now())
      returning * into v_target;
    exception when unique_violation then
      -- people_auth_user_id_key: 코드 행 잠금을 우회한 동시 연결(이론상) → 약속된 코드로
      raise exception 'already_registered';
    end;
  else
    select * into v_target from public.people
     where auth_user_id = v_code.auth_user_id and deleted_at is null and is_minor = false
       for update;
    if not found then
      raise exception 'invalid_code';
    end if;
    if v_target.family_id <> v_me.family_id then
      v_old_family := v_target.family_id;
      -- 옛 가족의 장부에 있는 식사마다 use_ticket 과 같은 잠금을 잡아, 옮기는 도중 사용 처리가 끼어들지 못하게 한다
      for v_meal in
        select meal_id from public.issuances where family_id = v_old_family
        union
        select meal_id from public.usages where family_id = v_old_family
        order by 1
      loop
        perform public.lock_family_meal(v_old_family, v_meal);
      end loop;
      update public.people set family_id = v_me.family_id
       where deleted_at is null and (id = v_target.id or (guardian_id = v_target.id and is_minor));
      if not exists (select 1 from public.people where family_id = v_old_family and deleted_at is null) then
        update public.issuances set family_id = v_me.family_id where family_id = v_old_family;
        update public.usages set family_id = v_me.family_id where family_id = v_old_family;
        -- 익명화된 옛 구성원 행이 남아 있으면 FK 때문에 못 지운다 — 그런 가족은 빈 껍데기로 남는다 (정리 작업도 건드리지 않는다)
        delete from public.families where id = v_old_family
           and not exists (select 1 from public.people where family_id = v_old_family);
      end if;
      select * into v_target from public.people where id = v_target.id;
    end if;
  end if;

  update public.pairing_codes set used_at = now() where code = v_code.code;
  return v_target;
end
$$;

comment on function public.add_family_member(text, text) is '자녀 추가(child 코드) / 어른 합류(adult 코드, 빈 가족의 장부는 함께 이동). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.add_family_member(text, text) from public, anon;
grant execute on function public.add_family_member(text, text) to authenticated;

-- =========================================================
-- 자녀 재연결: 폰을 바꾼 자녀의 계정을 새 폰의 코드 계정으로 교체한다. 보호자만.
-- 옛 계정은 사람 행을 잃어 다음 접속 때 가입 화면부터 다시 시작한다(옛 폰 접근 차단). 익명이면 하루 뒤 정리된다.
-- 코드: not_authenticated | not_registered | not_adult | child_not_found | invalid_code | already_registered
-- =========================================================
create or replace function public.relink_child(p_child_id uuid, p_code text)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_child public.people;
  v_code public.pairing_codes;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;
  select * into v_child from public.people
   where id = p_child_id and guardian_id = v_me.id and is_minor and deleted_at is null
     for update;
  if not found then
    raise exception 'child_not_found';
  end if;

  select * into v_code from public.pairing_codes where code = btrim(coalesce(p_code, '')) for update;
  if not found or v_code.kind <> 'child' or v_code.used_at is not null or v_code.expires_at < now()
     or v_code.auth_user_id = auth.uid() then
    raise exception 'invalid_code';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_code.auth_user_id) then
    raise exception 'invalid_code';
  end if;
  if exists (select 1 from public.people where auth_user_id = v_code.auth_user_id and deleted_at is null) then
    raise exception 'already_registered';
  end if;

  update public.people set auth_user_id = v_code.auth_user_id where id = v_child.id returning * into v_child;
  update public.pairing_codes set used_at = now() where code = v_code.code;
  return v_child;
end
$$;

comment on function public.relink_child(uuid, text) is '자녀 계정을 새 폰의 코드 계정으로 교체. 오류 코드는 파일 헤더 참고.';
revoke execute on function public.relink_child(uuid, text) from public, anon;
grant execute on function public.relink_child(uuid, text) to authenticated;
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 110 의 41건 포함 전부 통과 (리뷰 반영 뒤 62건).

- [x] **Step 5: 커밋**

```bash
git add supabase/migrations/20261009000002_family_functions.sql supabase/tests/database/110_add_family_member.sql
git commit -m "feat(db): add_family_member(자녀 추가·어른 합류, 빈 가족 장부 이동), relink_child

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 마이그레이션 ⑪ `leave_family` · `remove_child` · `delete_my_account`

**Files:**
- Create: `supabase/migrations/20261009000003_leave_remove_delete.sql`
- Test: `supabase/tests/database/120_leave_remove_delete.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/120_leave_remove_delete.sql`**

```sql
begin;
select plan(37);

select is(has_function_privilege('anon', 'public.leave_family()', 'EXECUTE'), false, 'anon 은 leave_family 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.remove_child(uuid)', 'EXECUTE'), false, 'anon 은 remove_child 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE'), false, 'anon 은 delete_my_account 를 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.lock_family(uuid)', 'EXECUTE'), false, 'lock_family 는 API 역할에 열려 있지 않다 (함수 안에서만)');

-- 준비: 가족 A = 김철수(a) + 이영희(b) + 서연(a 의 자녀, 익명) + 민준(b 의 자녀, 익명). 관리자. 가족 A 에 발급 2장.
select tests.create_user('leave-a@test.local') as a_uid \gset
select tests.create_user('leave-b@test.local') as b_uid \gset
select tests.create_user('leave-admin@test.local') as admin_uid \gset
select tests.create_user('leave-ghost@test.local') as ghost_uid \gset
select tests.create_user() as s_uid \gset
select tests.create_user() as m_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01099990001', :'a_uid', now(), '2026-10-07'),
       ('권사',   '01099990009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, phone, family_id, auth_user_id, consented_at, consent_version)
values ('이영희', '01099990002', :'a_fid', :'b_uid', now(), '2026-10-07');
select id as b_pid from public.people where auth_user_id = :'b_uid' \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'a_fid', :'s_uid', true, :'a_pid', now()),
       ('민준', :'a_fid', :'m_uid', true, :'b_pid', now());
select id as s_pid from public.people where auth_user_id = :'s_uid' \gset
select id as m_pid from public.people where auth_user_id = :'m_uid' \gset
-- a 의 자녀지만 다른 가족에 사는 아이 (4단계 merge_people 같은 흐름이 만들 수 있는 모양) — 나가기는 내 가족 범위만 옮겨야 한다
insert into public.families default values returning id as far_fid \gset
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('먼아이', :'far_fid', true, :'a_pid', now()) returning id as far_pid \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 120', '2026-10-25', :'admin_pid') returning id as meal_id \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'meal_id', 2, 5000, :'admin_pid') returning id as issuance \gset

-- ---------- leave_family ----------
select tests.authenticate_as(:'s_uid');
select throws_ok($$ select public.leave_family() $$, 'P0001', 'not_adult', '자녀 계정은 가족을 나갈 수 없다');
select tests.authenticate_as(:'ghost_uid');
select throws_ok($$ select public.leave_family() $$, 'P0001', 'not_registered', '가입 전 계정은 가족을 나갈 수 없다');

select tests.authenticate_as(:'a_uid');
select (select family_id from public.leave_family()) as new_fid \gset
select tests.clear_auth();
select isnt(:'new_fid'::uuid, :'a_fid'::uuid, '가족 나가기: 새 가족 id 를 받는다');
select is((select count(*) from public.families where id = :'new_fid'), 1::bigint, '새 가족 행이 실제로 있다');
select set_eq(
  format($$ select name from public.people where family_id = %L and deleted_at is null $$, :'new_fid'),
  $$ values ('김철수'::text), ('서연') $$,
  '나와 내 자녀만 새 가족으로 옮겨진다');
select set_eq(
  format($$ select name from public.people where family_id = %L and deleted_at is null $$, :'a_fid'),
  $$ values ('이영희'::text), ('민준') $$,
  '다른 어른과 그 자녀는 옛 가족에 남는다');
select is((select family_id from public.issuances where id = :'issuance'), :'a_fid'::uuid, '장부는 옛 가족에 남는다 (함께 쓰던 풀의 것)');
select is((select count(*) from public.ticket_balances where family_id = :'new_fid'), 0::bigint, '새 가족에는 잔량이 없다');
select is((select family_id from public.people where id = :'far_pid'), :'far_fid'::uuid, '보호자가 나여도 다른 가족에 사는 자녀는 옮기지 않는다 (옛 가족 범위로만)');

-- 나와 내 자녀뿐이면 아무것도 바뀌지 않는다
select count(*) as families_before from public.families \gset
select tests.authenticate_as(:'a_uid');
select is((select family_id from public.leave_family()), :'new_fid'::uuid, '혼자(자녀만 있는) 가족에서 나가기는 아무것도 바꾸지 않는다');
select tests.clear_auth();
select is((select count(*) from public.families), :'families_before'::bigint, '두 번째 호출은 가족 행을 더 만들지 않는다');

-- ---------- remove_child ----------
-- 민준 계정의 연결 코드가 남아 있어도 함께 지워진다 (사람 행이 있어 함수로는 못 만드니 직접 심는다)
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000222', :'m_uid', 'child', now() + interval '10 minutes');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), 'P0001', 'child_not_found', '남의 자녀는 삭제할 수 없다 (보호자만)');
select throws_ok(format($$ select public.remove_child(%L) $$, :'b_pid'), 'P0001', 'child_not_found', '어른은 자녀 삭제 대상이 아니다');
select tests.authenticate_as(:'s_uid');
select throws_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), 'P0001', 'not_adult', '자녀 계정은 자녀를 삭제할 수 없다');
select tests.authenticate_as(:'b_uid');
select lives_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), '보호자가 자녀를 삭제한다');
select tests.clear_auth();
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null, guardian_id from public.people where id = %L $$, :'m_pid'),
  format($$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true, %L::uuid) $$, :'b_pid'),
  '자녀는 익명화된다 (이름 치환, 번호·계정 NULL, deleted_at). 보호자 동의 기록은 남는다');
select is((select count(*) from public.pairing_codes where code = '00000222'), 0::bigint, '자녀 계정의 연결 코드도 지워진다');
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), 'P0001', 'child_not_found', '이미 삭제된 자녀는 다시 찾을 수 없다');
select tests.authenticate_as(:'m_uid');
select is((select public.current_person_id()), null, '삭제된 자녀의 계정은 사람 행이 없다 (다음 접속 때 시작 화면)');
select tests.clear_auth();

-- ---------- delete_my_account ----------
select tests.authenticate_as(:'s_uid');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'not_adult', '자녀 계정은 스스로 탈퇴할 수 없다 (보호자가 삭제)');
select tests.authenticate_as(:'ghost_uid');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'not_registered', '가입 전 계정은 탈퇴할 것이 없다');
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'has_children', '자녀가 있으면 먼저 자녀를 삭제해야 한다');
select lives_ok(format($$ select public.remove_child(%L) $$, :'s_pid'), '자녀를 삭제한다');
select lives_ok(format($$ select public.remove_child(%L) $$, :'far_pid'), '다른 가족에 사는 자녀도 보호자가 삭제할 수 있다 (탈퇴 전에 모두 정리)');
select lives_ok($$ select public.delete_my_account() $$, '자녀가 없으면 탈퇴할 수 있다');
select tests.clear_auth();
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null, consented_at is not null, consent_version from public.people where id = %L $$, :'a_pid'),
  $$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true, true, '2026-10-07'::text) $$,
  '본인은 익명화되고 동의 기록은 증빙으로 남는다');
select is((select family_id from public.issuances where id = :'issuance'), :'a_fid'::uuid, '장부는 익명 상태로 보존된다');
-- 같은 카카오 계정으로 다시 가입할 수 있고, 예전 번호도 다시 쓸 수 있다
select tests.authenticate_as(:'a_uid');
select is((select public.current_person_id()), null, '탈퇴한 계정은 사람 행이 없다 (가입 화면부터 다시)');
select lives_ok($$ select public.claim_person('김철수', '01099990001', '2026-10-07') $$, '탈퇴 뒤 같은 계정·같은 번호로 다시 가입할 수 있다');
select tests.clear_auth();
select is((select count(*) from public.people where phone = '01099990001' and deleted_at is null), 1::bigint, '다시 가입한 행은 새 행이다 (익명화된 옛 행은 그대로)');

-- JWT 없이 직접 호출
set local role authenticated;
select throws_ok($$ select public.leave_family() $$, 'P0001', 'not_authenticated', 'leave_family: JWT 가 없으면 not_authenticated');
select throws_ok(format($$ select public.remove_child(%L) $$, :'s_pid'), 'P0001', 'not_authenticated', 'remove_child: JWT 가 없으면 not_authenticated');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'not_authenticated', 'delete_my_account: JWT 가 없으면 not_authenticated');
reset role;

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 120 에서 `leave_family` 가 없어 실패. 나머지 통과.

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261009000003_leave_remove_delete.sql`**

```sql
-- =========================================================
-- 가족 나가기: 호출자와 그 자녀를 새 가족으로 옮긴다. 장부는 옛 가족에 남는다(함께 쓰던 풀의 것 — 2단계 계획 인계 결정).
-- 나와 내 자녀뿐인 가족이면 아무것도 바꾸지 않고 현재 행을 돌려준다 (옮기면 장부만 떨어져 나간다).
-- 잠금(가족 함수 공통 규칙 ①코드 행 → ②쓸 사람 행 id 순 → ③lock_family 가족 id 순 → ④lock_family_meal): 코드 행은 쓰지 않으므로
-- 내 행(for update) → 옮길 자녀 행(id 순) → lock_family(내 가족) 순이다. 가족 잠금을 쥔 채 사람 행을 새로 잠그지 않는다.
-- 코드: not_authenticated | not_registered | not_adult
-- =========================================================
create or replace function public.leave_family()
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_new_family uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null for update;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;
  -- 옮길 자녀 행을 먼저 잠그고(②), 가족 잠금(③) 뒤에 구성원을 세어야 동시에 진행되는 합류(add_family_member)·자녀 삭제와 판단이 어긋나지 않는다.
  perform 1 from public.people
    where guardian_id = v_me.id and is_minor and deleted_at is null and family_id = v_me.family_id
    order by id for update;
  perform public.lock_family(v_me.family_id);
  -- 나도 아니고 내 자녀도 아닌 산 구성원이 없으면 그대로
  if not exists (
    select 1 from public.people
     where family_id = v_me.family_id and deleted_at is null
       and id <> v_me.id and not (is_minor and guardian_id = v_me.id)
  ) then
    return v_me;
  end if;

  insert into public.families default values returning id into v_new_family;
  update public.people set family_id = v_new_family
   where deleted_at is null and family_id = v_me.family_id
     and (id = v_me.id or (guardian_id = v_me.id and is_minor));
  select * into v_me from public.people where id = v_me.id;
  return v_me;
end
$$;

comment on function public.leave_family() is '호출자와 자녀를 새 가족으로. 장부는 옛 가족에 남는다.';
revoke execute on function public.leave_family() from public, anon;
grant execute on function public.leave_family() to authenticated;

-- =========================================================
-- 자녀 삭제(파기): 이름 치환 · 번호·계정 NULL · deleted_at. 장부는 익명 상태로 남는다. 보호자만.
-- 자녀 계정(익명)은 사람 행을 잃어 하루 뒤 정리 작업이 지운다. 카카오 계정이면 다음 로그인 때 가입 화면부터.
-- 코드: not_authenticated | not_registered | not_adult | child_not_found
-- =========================================================
create or replace function public.remove_child(p_child_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_child public.people;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;
  -- 잠금 순서(가족 함수 공통): ① 코드 행 → ② 사람 행 → ③ 가족. 자녀 계정을 알아야 코드를 지울 수 있으므로
  -- 먼저 잠금 없이 읽고, 코드를 지운 뒤에 자녀 행을 잠그고 다시 읽는다.
  select * into v_child from public.people
   where id = p_child_id and guardian_id = v_me.id and is_minor and deleted_at is null;
  if not found then
    raise exception 'child_not_found';
  end if;
  delete from public.pairing_codes where auth_user_id = v_child.auth_user_id;
  select * into v_child from public.people
   where id = v_child.id and guardian_id = v_me.id and is_minor and deleted_at is null
     for update;
  if not found then
    raise exception 'child_not_found';
  end if;
  -- ③ 가족 잠금. 합류·나가기가 구성원을 세는 동안 자녀가 사라지지 않게 한다.
  perform public.lock_family(v_child.family_id);

  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_child.id;
end
$$;

comment on function public.remove_child(uuid) is '자녀 익명화(파기). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.remove_child(uuid) from public, anon;
grant execute on function public.remove_child(uuid) to authenticated;

-- =========================================================
-- 탈퇴(본인 익명화). 자녀가 있으면 먼저 자녀 삭제를 요구한다. 동의 시각·버전은 증빙으로 남긴다.
-- 카카오 계정 자체는 남지만 사람 행이 없어 다음 로그인 때 가입 화면부터 다시 시작한다 (번호도 다시 쓸 수 있다).
-- 코드: not_authenticated | not_registered | not_adult | has_children
-- =========================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- ① 내 연결 코드 행을 먼저 지운다 (잠금 순서: 코드 행 → 사람 행 → 가족). 뒤에서 예외가 나면 함께 롤백된다.
  delete from public.pairing_codes where auth_user_id = auth.uid();
  -- ② 내 행
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null for update;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;
  -- ③ 가족 잠금. 자녀 수를 세는 동안 자녀 추가가 끼어들지 않게 한다.
  perform public.lock_family(v_me.family_id);
  if exists (select 1 from public.people where guardian_id = v_me.id and is_minor and deleted_at is null) then
    raise exception 'has_children';
  end if;

  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_me.id;
end
$$;

comment on function public.delete_my_account() is '본인 익명화(탈퇴). 자녀가 있으면 has_children.';
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 120 의 37건 포함 전부 통과 (리뷰 반영 뒤 46건).

- [x] **Step 5: 커밋**

```bash
git add supabase/migrations/20261009000003_leave_remove_delete.sql supabase/tests/database/120_leave_remove_delete.sql
git commit -m "feat(db): leave_family, remove_child, delete_my_account

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 마이그레이션 ⑫ pg_cron 정리 작업 3건 + 타입 재생성

**Files:**
- Create: `supabase/migrations/20261009000004_cleanup_jobs.sql`
- Test: `supabase/tests/database/130_cleanup_jobs.sql`
- Modify: `src/lib/database.types.ts` (재생성)

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/130_cleanup_jobs.sql`**

```sql
begin;
select plan(20);

select has_extension('pg_cron', 'pg_cron 확장이 설치되어 있다');
select set_eq(
  $$ select jobname from cron.job where jobname like 'cleanup_%' $$,
  $$ values ('cleanup_pairing_codes'::name), ('cleanup_orphan_anonymous_users'), ('cleanup_empty_families') $$,
  '정리 작업 3건이 등록되어 있다');
select set_eq(
  $$ select jobname, command from cron.job where jobname like 'cleanup_%' $$,
  $$ values ('cleanup_pairing_codes'::name, 'select public.cleanup_pairing_codes()'),
            ('cleanup_orphan_anonymous_users', 'select public.cleanup_orphan_anonymous_users()'),
            ('cleanup_empty_families', 'select public.cleanup_empty_families()') $$,
  '작업이 올바른 함수를 부른다');
select is((select bool_and(active) from cron.job where jobname like 'cleanup_%'), true, '세 작업 모두 활성');
select is((select schedule from cron.job where jobname = 'cleanup_pairing_codes'), '0 * * * *', '연결 코드 정리는 매시간');
select is(has_function_privilege('authenticated', 'public.cleanup_pairing_codes()', 'EXECUTE'), false, '정리 함수는 API 역할에 열려 있지 않다');
select is(has_function_privilege('authenticated', 'public.cleanup_orphan_anonymous_users()', 'EXECUTE'), false, '익명 계정 정리 함수도 열려 있지 않다');
select is(has_function_privilege('authenticated', 'public.cleanup_empty_families()', 'EXECUTE'), false, '빈 가족 정리 함수도 열려 있지 않다');

-- ---------- 연결 코드 정리 ----------
select tests.create_user() as u1 \gset
select tests.create_user() as u2 \gset
select tests.create_user() as u3 \gset
insert into public.pairing_codes (code, auth_user_id, kind, expires_at, used_at) values
  ('00000301', :'u1', 'child', now() + interval '5 minutes', null),                    -- 살아 있음
  ('00000302', :'u2', 'child', now() - interval '1 minute', null),                     -- 만료
  ('00000303', :'u3', 'child', now() + interval '5 minutes', now() - interval '1 minute'); -- 사용됨
-- cmp_ok('>=') 로 느슨하게 잰다: 같은 DB 에서 돌던 E2E·수동 세션이 남긴 다른 만료 코드가 섞여 있어도 깨지지 않는다.
-- 정확한 집합은 바로 다음 set_eq 가 잡는다.
select cmp_ok(public.cleanup_pairing_codes(), '>=', 2, '만료·사용된 코드 2건 이상을 지운다 (다른 세션이 남긴 행이 더 있을 수 있다)');
select set_eq($$ select code from public.pairing_codes where code like '000003%' $$, $$ values ('00000301'::text) $$, '살아 있는 코드만 남는다');

-- ---------- 고아 익명 계정 정리 ----------
select tests.create_user() as old_orphan \gset
select tests.create_user() as old_live \gset
select tests.create_user() as old_linked \gset
select tests.create_user() as new_orphan \gset
select tests.create_user('cleanup-kakao@test.local') as old_kakao \gset
update auth.users set created_at = now() - interval '25 hours' where id in (:'old_orphan', :'old_live', :'old_linked', :'old_kakao');
select tests.create_user('cleanup-guardian@test.local') as g_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('보호자', '01011220001', :'g_uid', now(), '2026-10-07');
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('연결된아이', (select family_id from public.people where auth_user_id = :'g_uid'), :'old_linked', true,
        (select id from public.people where auth_user_id = :'g_uid'), now());
-- 고아 계정의 만료된 코드는 FK cascade 로 함께 지워져야 한다. 살아 있는 코드를 띄워 둔 폰(old_live)은 계정째 남아야 한다.
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000304', :'old_orphan', 'child', now() - interval '1 minute');
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000305', :'old_live', 'child', now() + interval '5 minutes');
-- cmp_ok('>=') 로 느슨하게 잰다: 같은 DB 에서 돌던 E2E·수동 세션이 남긴 다른 고아 계정이 섞여 있어도 깨지지 않는다.
-- 이 테스트가 만든 계정의 생사는 바로 다음 is 들이 정확히 잡는다.
select cmp_ok(public.cleanup_orphan_anonymous_users(), '>=', 1, '24시간 지난 미연결 익명 계정 중 살아 있는 코드가 없는 1건 이상을 지운다 (다른 세션이 남긴 행이 더 있을 수 있다)');
select is((select count(*) from auth.users where id = :'old_orphan'), 0::bigint, '고아 익명 계정이 지워졌다');
select is((select count(*) from public.pairing_codes where code = '00000304'), 0::bigint, '그 계정의 (만료된) 연결 코드도 함께 지워졌다');
select is((select count(*) from auth.users where id = :'old_live'), 1::bigint, '살아 있는 코드를 보여 주는 중인 익명 계정은 남는다 (코드가 사라지면 그 폰이 로그아웃된다)');
select is((select count(*) from auth.users where id in (:'old_linked', :'new_orphan', :'old_kakao')), 3::bigint, '연결된 익명 계정·새 익명 계정·카카오 계정은 남는다');

-- ---------- 빈 가족 정리 ----------
insert into public.families (created_at) values (now() - interval '2 hours') returning id as empty_old \gset
insert into public.families (created_at) values (now()) returning id as empty_new \gset
insert into public.families (created_at) values (now() - interval '2 hours') returning id as ledger_only \gset
select tests.create_user('cleanup-admin@test.local') as admin_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('권사', '01011220009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 130', '2026-11-01', :'admin_pid') returning id as meal_id \gset
-- 사람은 없고 장부만 남은 가족 (구성원이 전부 다른 가족으로 옮겨 간 뒤 남은 장부)
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'admin_pid', :'ledger_only', :'meal_id', 1, 0, :'admin_pid');
-- cmp_ok('>=') 로 느슨하게 잰다: 같은 DB 에서 돌던 E2E·수동 세션이 남긴 다른 빈 가족이 섞여 있어도 깨지지 않는다.
-- 이 테스트가 만든 세 가족의 생사는 바로 다음 is 들이 정확히 잡는다.
select cmp_ok(public.cleanup_empty_families(), '>=', 1, '사람도 장부도 없고 1시간 지난 가족 1건 이상을 지운다 (다른 세션이 남긴 행이 더 있을 수 있다)');
select is((select count(*) from public.families where id = :'empty_old'), 0::bigint, '오래된 빈 가족이 지워졌다');
select is((select count(*) from public.families where id = :'empty_new'), 1::bigint, '방금 만든 빈 가족은 남는다 (진행 중인 가입일 수 있다)');
select is((select count(*) from public.families where id = :'ledger_only'), 1::bigint, '장부가 있는 가족은 남는다');
select is((select count(*) from public.families where id = (select family_id from public.people where id = :'admin_pid')), 1::bigint, '구성원이 있는 가족은 남는다');

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 130 에서 `has_extension('pg_cron')` 실패. 나머지 통과. (아래 두 스니펫은 리뷰 반영 뒤의 최종 버전이다 — `plan(20)`.)

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261009000004_cleanup_jobs.sql`**

```sql
-- =========================================================
-- 주기 작업 (설계 §7.5). pg_cron 은 Supabase Free 에서도 쓸 수 있다 (비용 없음). 로컬 CLI 에도 들어 있다.
-- 작업 본문은 함수로 두어 pgTAP 이 직접 호출해 검증한다. cron 은 그 함수를 부르기만 한다.
-- pg_cron 권한은 supautils 가 postgres 에게 이미 주므로 grant 하지 않는다 (공식 문서 스니펫을 운영 콘솔에서 실행하지 말 것).
-- =========================================================

-- Supabase 의 pg_cron after-create 스크립트는 create extension 때마다(이미 있어도) `revoke all on cron.job from postgres` 를
-- CASCADE 없이 실행한다. postgres 가 직접 준 grant(공식 문서의 'grant … on schema cron to postgres' 스니펫)가 남아 있으면
-- 2BP01(dependent privileges exist) 로 마이그레이션이 실패하므로, 그런 grant 가 있으면 먼저 거둔다. supautils 가 준 권한은 건드리지 않는다.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute 'revoke all on all tables in schema cron from postgres';
    execute 'revoke usage on schema cron from postgres';
  end if;
end
$$;
create extension if not exists pg_cron with schema pg_catalog;

-- 만료·사용된 연결 코드 삭제 (매시간)
create or replace function public.cleanup_pairing_codes()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.pairing_codes where used_at is not null or expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function public.cleanup_pairing_codes() is '만료되었거나 사용된 연결 코드를 지운다 (cron, 매시간).';

-- 만든 지 24시간이 지났고 사람 행에 연결되지 않았으며 살아 있는 연결 코드도 없는 익명 계정 삭제 (매일).
-- 그 계정의 연결 코드(만료·사용된 것)는 FK cascade 로 함께 지워진다.
-- 살아 있는 코드를 띄워 둔 폰은 남긴다 — 하루 전에 "아이 계정으로 시작" 해 둔 폰이 지금 보호자 앞에서 코드를 보여 주는 중일 수 있다
-- (지우면 코드가 사라지고 그 폰이 로그아웃된다). 카카오 계정은 지우지 않는다 (가입 전 계정도 다음 로그인 때 가입 화면으로 이어진다).
create or replace function public.cleanup_orphan_anonymous_users()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '24 hours'
     and not exists (select 1 from public.people p where p.auth_user_id = u.id)
     and not exists (select 1 from public.pairing_codes pc
                      where pc.auth_user_id = u.id and pc.used_at is null and pc.expires_at > now());
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function public.cleanup_orphan_anonymous_users() is '24시간 지난 미연결·무효코드 익명 계정을 지운다 (cron, 매일).';

-- 구성원 행도 장부도 없는 가족 삭제 (매일). 만든 지 1시간 안 된 가족은 건드리지 않는다.
-- 장부가 있는 가족은 지우지 않는다 (2단계 계획 인계 결정 — 장부 FK 가 어차피 막지만 조건으로도 명시한다).
-- lock_family 를 잡지 않는다: 기존 가족에 행을 붙이는 모든 경로(합류·재연결)는 그 가족에 살아 있는 people 행이 있거나
-- 같은 트랜잭션 안에서 가족을 새로 만들므로, "people 행이 없다" 조건은 지금 누군가 참조하려는 가족을 절대 고르지 않는다.
-- 동시에 삽입이 들어와도 FK 의 key-share 잠금이 순서를 정리해 준다 — 이 delete 가 기다렸다가 자신의 not exists 재확인에서
-- 걸러지거나, 23503 으로 실패한다. cron 작업이 23503 으로 실패해도 된다 — 다음 예정 실행 때 다시 돈다
-- (pg_cron 은 재시도하지 않는다; 실패는 cron.job_run_details 에만 남는다).
create or replace function public.cleanup_empty_families()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.families f
   where f.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.people p where p.family_id = f.id)
     and not exists (select 1 from public.issuances i where i.family_id = f.id)
     and not exists (select 1 from public.usages u where u.family_id = f.id);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function public.cleanup_empty_families() is '구성원도 장부도 없고 만든 지 1시간 지난 가족을 지운다 (cron, 매일).';

revoke execute on function public.cleanup_pairing_codes(), public.cleanup_orphan_anonymous_users(), public.cleanup_empty_families()
  from public, anon, authenticated;

-- 같은 이름으로 다시 schedule 하면 갱신된다 (db reset 반복에 안전). pg_cron 은 UTC — 18:15 UTC = 03:15 KST.
select cron.schedule('cleanup_pairing_codes', '0 * * * *', $$select public.cleanup_pairing_codes()$$);
select cron.schedule('cleanup_orphan_anonymous_users', '15 18 * * *', $$select public.cleanup_orphan_anonymous_users()$$);
select cron.schedule('cleanup_empty_families', '30 18 * * *', $$select public.cleanup_empty_families()$$);
```

- [x] **Step 4: 통과 확인**

Run: `npm run db:reset && npm run db:test`
Expected: 010~130 전부 통과 (총 189 + 29 + 62 + 46 + 20 = **346**).

- [x] **Step 5: DB 타입 재생성 + 타입 검사**

Run: `npm run db:types && npx tsc -b`
Expected: `src/lib/database.types.ts` 에 `pairing_codes` 테이블과 함수 `add_family_member` · `create_pairing_code`(Returns `{ code: string; expires_at: string }[]`) · `relink_child` · `leave_family` · `remove_child` · `delete_my_account` · `lock_family_meal` · `cleanup_*` 가 생긴다. `tsc -b` 오류 없음(아직 호출하는 코드가 없다).

- [x] **Step 6: 커밋**

```bash
git add supabase/migrations/20261009000004_cleanup_jobs.sql supabase/tests/database/130_cleanup_jobs.sql src/lib/database.types.ts
git commit -m "feat(db): pg_cron 정리 작업 3건(연결 코드·고아 익명 계정·빈 가족) + 타입 재생성

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: 프론트 공통 — 오류 문구 · `validateWith` · `formatDate` · `signInAsChild` · `usePerson` 폴링 옵션 · 가짜 빌더

**Files:**
- Modify: `src/lib/errors.ts` (MESSAGES 에 7개 추가), `src/lib/errors.test.ts`
- Create: `src/lib/validate.ts`, `src/lib/validate.test.ts`
- Modify: `src/features/onboarding/onboardingSchema.ts` (`validateWith` 로 교체 — 동작 동일)
- Modify: `src/lib/dates.ts` (`formatDate`), `src/lib/dates.test.ts`
- Modify: `src/features/auth/signIn.ts` (`signInAsChild`), `src/features/auth/signIn.test.ts`
- Modify: `src/features/auth/usePerson.ts` (옵션), `src/features/auth/usePerson.test.tsx`
- Modify: `src/test/fakeSupabase.ts` (`update` 체인)

- [x] **Step 1: 실패하는 테스트 — `src/lib/errors.test.ts` 에 추가**

```ts
  it('3단계(가족·아이) 오류 코드를 문구로 바꾼다', () => {
    expect(toUserMessage(new Error('invalid_code'))).toBe('코드가 맞지 않거나 만료되었어요. 새 코드를 받아 다시 입력해 주세요.')
    expect(toUserMessage(new Error('not_adult'))).toBe('어른 계정만 할 수 있어요.')
    expect(toUserMessage(new Error('has_children'))).toBe('연결된 자녀가 있어요. 자녀를 먼저 삭제해 주세요.')
    expect(toUserMessage(new Error('child_not_found'))).toBe('자녀를 찾을 수 없어요. 목록을 새로고침해 주세요.')
    expect(toUserMessage(new Error('invalid_kind'))).toBe('잘못된 요청이에요.')
    expect(toUserMessage(new Error('code_generation_failed'))).toBe('코드를 만들지 못했어요. 다시 시도해 주세요.')
    expect(toUserMessage(new Error('last_admin'))).toBe('마지막 관리자는 탈퇴할 수 없어요. 다른 관리자를 먼저 지정해 주세요.')
    expect(rpcCodeOf(new Error('invalid_code'))).toBe('invalid_code')
  })
```

`src/lib/validate.test.ts` (새 파일):

```ts
import { z } from 'zod'
import { validateWith } from './validate'

const schema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요').max(3, '너무 길어요'),
  age: z.number().min(1, '1 이상'),
})

describe('validateWith', () => {
  it('통과하면 정규화된 값을 돌려준다', () => {
    expect(validateWith(schema, { name: ' 김 ', age: 3 }, 'name')).toEqual({ ok: true, values: { name: '김', age: 3 } })
  })

  it('필드별 첫 오류 문구만 모은다', () => {
    const r = validateWith(schema, { name: '', age: 0 }, 'name')
    expect(r).toEqual({ ok: false, errors: { name: '이름을 입력해 주세요', age: '1 이상' } })
  })

  it('어느 필드인지 모르는 오류는 fallbackKey 에 일반 문구를 둔다', () => {
    const r = validateWith(schema, 'not an object' as unknown as { name: string; age: number }, 'name')
    expect(r).toEqual({ ok: false, errors: { name: '입력 내용을 확인해 주세요' } })
  })
})
```

`src/lib/dates.test.ts` 에 추가:

```ts
describe('formatDate', () => {
  it('ISO 시각을 서울 날짜 M/D 로 (UTC 저녁은 서울의 다음 날)', () => {
    expect(formatDate('2026-10-07T15:30:00Z')).toBe('10/8')
    expect(formatDate('2026-10-07T03:00:00Z')).toBe('10/7')
  })
})
```

`src/features/auth/signIn.test.ts` — 가짜 `supabase.auth` 에 `signInAnonymously` 를 더하고 테스트 추가:

```ts
// hoisted 목록에 추가
  signInAnonymously: vi.fn<() => Promise<AuthResult>>(),
// vi.mock 의 auth 객체에 추가
  supabase: { auth: { signInWithOAuth, signInWithPassword, signUp, signOut: authSignOut, signInAnonymously } },
// import 에 signInAsChild 추가 후 테스트
  it('아이 계정 시작은 익명 로그인을 부른다', async () => {
    signInAnonymously.mockResolvedValue({ error: null })
    await signInAsChild()
    expect(signInAnonymously).toHaveBeenCalledOnce()
  })

  it('익명 로그인 오류는 그대로 던진다', async () => {
    signInAnonymously.mockResolvedValue({ error: new Error('anonymous_provider_disabled') })
    await expect(signInAsChild()).rejects.toThrow('anonymous_provider_disabled')
  })
```

`src/features/auth/usePerson.test.tsx` 에 추가 (기존 체인 목 그대로):

```ts
  it('refetchInterval 옵션을 주면 그 주기로 다시 읽는다', async () => {
    vi.useFakeTimers()
    try {
      maybeSingle.mockResolvedValue({ data: null, error: null })
      const { result } = renderHook(() => usePerson('u1', { refetchInterval: 3_000 }), { wrapper: makeWrapper() })
      // 첫 조회는 마운트 직후 (가짜 타이머 아래라 microtask 만 비운다)
      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.status).toBe('success')
      expect(maybeSingle).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000)
      })
      expect(maybeSingle).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('옵션이 없으면 자동 재조회 주기가 없다', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => usePerson('u1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(maybeSingle).toHaveBeenCalledTimes(1)
  })
```

(`act` 를 `@testing-library/react` 에서 import 한다. 첫 조회가 `Promise.resolve()` 한 번으로 끝나지 않으면 `await vi.advanceTimersByTimeAsync(0)` 를 쓴다.)

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/lib src/features/auth`
Expected: `validate.ts` 없음, `formatDate`·`signInAsChild` 없음, `usePerson` 두 번째 인자 무시로 실패.

- [x] **Step 3: 구현**

`src/lib/errors.ts` — `MESSAGES` 의 2단계 항목 뒤에:

```ts
  // 3단계 · 가족·아이
  invalid_kind: '잘못된 요청이에요.',
  not_adult: '어른 계정만 할 수 있어요.',
  invalid_code: '코드가 맞지 않거나 만료되었어요. 새 코드를 받아 다시 입력해 주세요.',
  child_not_found: '자녀를 찾을 수 없어요. 목록을 새로고침해 주세요.',
  has_children: '연결된 자녀가 있어요. 자녀를 먼저 삭제해 주세요.',
  code_generation_failed: '코드를 만들지 못했어요. 다시 시도해 주세요.',
  last_admin: '마지막 관리자는 탈퇴할 수 없어요. 다른 관리자를 먼저 지정해 주세요.',
```

`src/lib/validate.ts` (새 파일):

```ts
import type { z } from 'zod'

export type FieldErrors<In> = Partial<Record<keyof In & string, string>>
export type Validation<Out, In> = { ok: true; values: Out } | { ok: false; errors: FieldErrors<In> }

/**
 * 폼 입력을 zod 스키마로 검사해 정규화된 값, 또는 필드별 "첫" 오류 문구를 돌려준다 (화면에 한 줄씩만 둔다).
 * 어느 필드인지 모르는 오류(입력이 객체가 아닐 때처럼 타입이 막아 주는 경우)는 fallbackKey 자리에 일반 문구를 둔다 —
 * 화면이 아무 말도 못 하는 것보다 첫 칸에라도 띄우는 편이 낫다.
 */
export function validateWith<Out, In extends object>(
  schema: z.ZodType<Out, In>,
  input: In,
  fallbackKey: keyof In & string,
): Validation<Out, In> {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, values: result.data }
  const errors: FieldErrors<In> = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (typeof key !== 'string') {
      errors[fallbackKey] ??= '입력 내용을 확인해 주세요'
      continue
    }
    const field = key as keyof In & string
    if (!errors[field]) errors[field] = issue.message
  }
  return { ok: false, errors }
}
```

`src/features/onboarding/onboardingSchema.ts` — `validateOnboarding` 본문과 `OnboardingErrors` 를 공통 헬퍼로 교체 (스키마는 그대로):

```ts
import { validateWith, type FieldErrors, type Validation } from '../../lib/validate'
// … onboardingSchema 정의는 그대로 …
export type OnboardingInput = z.input<typeof onboardingSchema>
export type OnboardingValues = z.output<typeof onboardingSchema>
export type OnboardingErrors = FieldErrors<OnboardingInput>

/** 폼 입력을 검사해 정규화된 값 또는 필드별 첫 오류 문구를 돌려준다. */
export function validateOnboarding(input: OnboardingInput): Validation<OnboardingValues, OnboardingInput> {
  return validateWith(onboardingSchema, input, 'name')
}
```

`src/lib/dates.ts` 끝에:

```ts
/** ISO 시각 → 서울 'M/D' (동의 날짜처럼 날짜만 보여 줄 때) */
export function formatDate(iso: string): string {
  return formatShortDate(todaySeoul(new Date(iso)))
}
```

`src/features/auth/signIn.ts` 에 추가:

```ts
/**
 * 카카오 없는 아이: 익명 계정으로 시작한다. 보호자가 코드로 연결하기 전까지는 사람 행이 없어 아무것도 보지 못한다.
 * 호출할 때마다 새 계정이 생기므로 버튼 쪽에서 성공 뒤에도 잠근 채 둔다. 연결되지 않은 익명 계정은 하루 뒤 DB 정리 작업이 지운다.
 */
export async function signInAsChild(): Promise<void> {
  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw error
}
```

`src/features/auth/usePerson.ts`:

```ts
type Options = {
  /** 연결 코드 화면·가족 합류 대기처럼 "내 사람 행이 생기거나 바뀌기를" 기다릴 때만 준다. 기본은 없음. */
  refetchInterval?: number | false
}

/** 로그인한 계정에 연결된 사람 행. 없으면 null (가입 전). 같은 키의 다른 관찰자(가드)도 이 주기로 함께 갱신된다. */
export function usePerson(userId: string | undefined, { refetchInterval = false }: Options = {}) {
  return useQuery({
    queryKey: personQueryKey(userId),
    enabled: Boolean(userId),
    refetchInterval,
    queryFn: async (): Promise<Person | null> => {
      // (기존 본문 그대로)
    },
  })
}
```

`src/test/fakeSupabase.ts` — 체인에 `update` 추가:

```ts
  update = this.chain('update')
```

- [x] **Step 4: 통과 확인**

Run: `npm test -- src/lib src/features/auth src/features/onboarding && npm run lint && npx tsc -b`
Expected: 전부 통과. 가입 화면 테스트(`OnboardingPage.test.tsx`, `onboardingSchema.test.ts`)도 그대로 통과(동작 동일).

- [x] **Step 5: 커밋**

```bash
git add src/lib/errors.ts src/lib/errors.test.ts src/lib/validate.ts src/lib/validate.test.ts src/features/onboarding/onboardingSchema.ts src/lib/dates.ts src/lib/dates.test.ts src/features/auth/signIn.ts src/features/auth/signIn.test.ts src/features/auth/usePerson.ts src/features/auth/usePerson.test.tsx src/test/fakeSupabase.ts
git commit -m "feat: 3단계 오류 문구, validateWith 공통 검증, formatDate, signInAsChild, usePerson 폴링 옵션

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 로그아웃 경로 통합 — `AuthProvider` 캐시 정리 · `ConfirmButton` · `SignOutButton` · 홈 바닥글

**Files:**
- Modify: `src/features/auth/AuthProvider.tsx`, `src/features/auth/AuthProvider.test.tsx`
- Create: `src/components/ConfirmButton.tsx`, `src/components/ConfirmButton.test.tsx`
- Create: `src/components/SignOutButton.tsx`, `src/components/SignOutButton.test.tsx`
- Modify: `src/pages/HomePage.tsx` (Footer), `src/pages/HomePage.test.tsx`

- [x] **Step 1: 실패하는 테스트**

`src/features/auth/AuthProvider.test.tsx` — 모든 `render(<AuthProvider>…)` 를 `QueryClientProvider` 로 감싸는 헬퍼로 바꾸고 테스트 추가:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// …
function renderWithClient() {
  const client = new QueryClient()
  const utils = render(
    <QueryClientProvider client={client}>
      <AuthProvider><Probe /></AuthProvider>
    </QueryClientProvider>,
  )
  return { ...utils, client }
}
// 기존 테스트의 render(<AuthProvider><Probe /></AuthProvider>) 는 모두 renderWithClient() 로 바꾼다.

  it('로그아웃 이벤트가 오면 쿼리 캐시를 비운다 (어느 경로의 로그아웃이든 — 버튼·탈퇴·다른 탭)', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } as Session } })
    const { client } = renderWithClient()
    await waitFor(() => expect(screen.getByText('user:u1')).toBeInTheDocument())
    client.setQueryData(['person', 'u1'], { id: 'p1' })

    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_OUT', null))
    expect(screen.getByText('no-session')).toBeInTheDocument()
    // 콜백 안에서 바로 비우지 않고 한 틱 미룬다 (auth lock 재진입 회피) — 그래서 waitFor
    await waitFor(() => expect(client.getQueryData(['person', 'u1'])).toBeUndefined())
  })

  it('로그인 이벤트는 캐시를 비우지 않는다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { client } = renderWithClient()
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    client.setQueryData(['x'], 1)
    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_IN', { user: { id: 'u2' } } as Session))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(client.getQueryData(['x'])).toBe(1)
  })
```

`src/components/ConfirmButton.test.tsx` (새 파일):

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmButton } from './ConfirmButton'

describe('ConfirmButton', () => {
  it('확인 문구가 없으면 바로 실행한다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="로그아웃" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('확인 문구가 있으면 한 번 더 묻고, 확인을 눌러야 실행한다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="자녀 삭제" message="되돌릴 수 없어요" confirmLabel="삭제" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '자녀 삭제' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('되돌릴 수 없어요')
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    // 실행 뒤에는 처음 모양으로 돌아간다
    expect(screen.getByRole('button', { name: '자녀 삭제' })).toBeInTheDocument()
  })

  it('취소하면 실행하지 않고 닫힌다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '탈퇴' })).toBeInTheDocument()
  })

  it('disabled 면 열리지도 실행되지도 않는다', async () => {
    const onConfirm = vi.fn<() => void>()
    render(<ConfirmButton label="탈퇴" message="정말요?" onConfirm={onConfirm} disabled />)
    const button = screen.getByRole('button', { name: '탈퇴' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
```

`src/components/SignOutButton.test.tsx` (새 파일):

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignOutButton } from './SignOutButton'

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn<() => Promise<void>>() }))
vi.mock('../features/auth/signIn', () => ({ signOut }))

describe('SignOutButton', () => {
  it('누르면 로그아웃하고, 성공 뒤에도 잠근 채 둔다 (Gate 가 화면을 바꿀 때까지)', async () => {
    signOut.mockResolvedValue(undefined)
    render(<SignOutButton />)
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledOnce()
    await waitFor(() => expect(button).toBeDisabled())
  })

  it('실패하면 안내 문구를 띄우고 버튼을 다시 연다', async () => {
    signOut.mockRejectedValue(new Error('network'))
    render(<SignOutButton />)
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
    expect(button).not.toBeDisabled()
  })

  it('로그아웃 중에는 두 번 호출되지 않는다', async () => {
    let settle: () => void = () => {}
    signOut.mockReturnValue(new Promise<void>((resolve) => { settle = resolve }))
    render(<SignOutButton />)
    const button = screen.getByRole('button', { name: '로그아웃' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(signOut).toHaveBeenCalledTimes(1)
    await act(async () => {
      settle()
    })
  })

  it('확인 문구가 있으면(아이 계정) 한 번 더 묻는다', async () => {
    signOut.mockResolvedValue(undefined)
    render(<SignOutButton message="아이 계정은 다시 연결해야 해요" />)
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('아이 계정은 다시 연결해야 해요')
    await userEvent.click(screen.getByRole('button', { name: '네, 로그아웃' }))
    expect(signOut).toHaveBeenCalledOnce()
  })
})
```

`src/pages/HomePage.test.tsx` — `useAuth` 를 목으로 더하고(기본: 어른 세션) 로그아웃 묶음을 바꾼다:

```tsx
// hoisted 에 추가
  useAuth: vi.fn<() => { status: 'ready'; session: { user: { id: string; is_anonymous?: boolean } } }>(),
// mock 추가
vi.mock('../features/auth/AuthProvider', () => ({ useAuth }))
// beforeEach 에 추가
  useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1', is_anonymous: false } } })

describe('HomePage · 로그아웃', () => {
  it('로그아웃 버튼이 signOut 을 부른다 (캐시 정리는 AuthProvider 의 SIGNED_OUT 처리가 맡는다)', async () => {
    signOut.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('아이(익명) 계정은 로그아웃 전에 한 번 더 묻는다', async () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1', is_anonymous: true } } })
    signOut.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('보호자가 새 코드로 다시 연결해야 해요')
    await userEvent.click(screen.getByRole('button', { name: '네, 로그아웃' }))
    expect(signOut).toHaveBeenCalledOnce()
  })
  // 기존 "로그아웃 중에는 버튼을 잠가…", "실패하면 안내 문구…", "다시 시도해 성공하면…" 세 테스트는 그대로 둔다 (SignOutButton 이 같은 동작을 한다).
})
```

(`renderPage` 는 `useFamilyTickets` 등 다른 목을 그대로 쓴다. 홈의 `role="status"` 는 여러 개일 수 있으므로 위 단언이 모호해지면 `screen.getByText(/보호자가 새 코드로/)` 로 바꾼다.)

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/auth/AuthProvider src/components src/pages/HomePage`
Expected: `ConfirmButton`·`SignOutButton` 없음, AuthProvider 의 SIGNED_OUT 캐시 정리 없음, 홈의 익명 확인 없음.

- [x] **Step 3: 구현**

`src/features/auth/AuthProvider.tsx` — `useQueryClient` 를 쓰고 `onAuthStateChange` 콜백에 한 줄 추가:

```tsx
import { useQueryClient } from '@tanstack/react-query'
// …
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const queryClient = useQueryClient()

  useEffect(() => {
    // … (getSession 부분 그대로) …

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      settledByListener = true
      setState({ status: 'ready', session })
      stripOAuthParams()
      // 어떤 경로로 로그아웃되든(버튼·탈퇴·코드 화면 "처음으로"·다른 탭·세션 만료) 캐시를 비운다 — 공용 폰에 남은
      // 가족 정보가 다음 사람에게 보이지 않게. 콜백 안에서 supabase 를 다시 부르면 auth lock 에 재진입하므로
      // 한 틱 미룬다 (설계 §15). clear 자체는 supabase 를 부르지 않지만, 캐시가 비면 화면의 쿼리가 곧바로 다시 돌 수 있다.
      if (event === 'SIGNED_OUT') setTimeout(() => queryClient.clear(), 0)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])
  // …
}
```

`src/components/ConfirmButton.tsx` (새 파일):

```tsx
import { useState } from 'react'

type Props = {
  label: string
  /** 있으면 한 번 더 묻는다. 없으면 바로 onConfirm. */
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
}

/**
 * 되돌리기 어려운 동작(가족 나가기·자녀 삭제·탈퇴·아이 계정 로그아웃) 앞에 한 번 더 묻는 작은 글자 버튼.
 * window.confirm 은 iOS 홈 화면 앱에서 어색하고 테스트하기 어려워 화면 안에서 묻는다.
 */
export function ConfirmButton({ label, message, confirmLabel = '확인', onConfirm, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const base = 'px-3 py-2 text-xs underline disabled:cursor-not-allowed disabled:opacity-40'
  if (!message || !open) {
    return (
      <button type="button" disabled={disabled} onClick={() => (message ? setOpen(true) : onConfirm())} className={`${base} text-gray-600`}>
        {label}
      </button>
    )
  }
  return (
    <div role="group" aria-label={label} className="flex flex-col items-end gap-1">
      <p role="status" className="text-right text-xs text-gray-700">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(false)
            onConfirm()
          }}
          className={`${base} font-bold text-red-600`}
        >
          {confirmLabel}
        </button>
        <button type="button" disabled={disabled} onClick={() => setOpen(false)} className={`${base} text-gray-600`}>
          취소
        </button>
      </div>
    </div>
  )
}
```

`src/components/SignOutButton.tsx` (새 파일):

```tsx
import { useState } from 'react'
import { signOut } from '../features/auth/signIn'
import { toUserMessage } from '../lib/errors'
import { ConfirmButton } from './ConfirmButton'

type Props = { label?: string; message?: string }

/**
 * 로그아웃. 성공하면 AuthProvider 가 세션·캐시를 비우고 Gate 가 시작 화면을 띄우므로, 그 사이 두 번째 호출이
 * 나가지 않게 잠근 채 둔다. message 가 있으면(아이 계정) 한 번 더 묻는다.
 */
export function SignOutButton({ label = '로그아웃', message }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
    } catch (err) {
      setError(toUserMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <ConfirmButton label={label} message={message} confirmLabel="네, 로그아웃" onConfirm={() => void run()} disabled={busy} />
      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

`src/pages/HomePage.tsx` — `Footer` 를 교체하고, 더 이상 쓰지 않는 import(`useQueryClient`, `useState`, `signOut`, `toUserMessage` — 넷 다 바닥글에서만 쓰였다. `noUnusedLocals` 가 잡는다)를 지운다:

```tsx
import { SignOutButton } from '../components/SignOutButton'
import { useAuth } from '../features/auth/AuthProvider'
// …
const CHILD_SIGN_OUT_NOTICE = '아이 계정은 로그아웃하면 보호자가 새 코드로 다시 연결해야 해요. 정말 로그아웃할까요?'

function Footer() {
  const auth = useAuth()
  // 익명(아이) 계정은 로그아웃하면 그 계정을 되찾을 수 없다 (비밀번호도 카카오도 없다). 한 번 더 묻는다.
  const anonymous = auth.status === 'ready' && auth.session?.user.is_anonymous === true
  return (
    <footer className="flex items-center justify-center gap-4">
      <Link to="/privacy" className="px-3 py-2 text-xs text-gray-600 underline">개인정보 처리방침</Link>
      <SignOutButton message={anonymous ? CHILD_SIGN_OUT_NOTICE : undefined} />
    </footer>
  )
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과. `App.test.tsx` 는 `App` 이 `QueryClientProvider` 를 이미 갖고 있어 그대로 통과.

- [x] **Step 5: 커밋**

```bash
git add src/features/auth/AuthProvider.tsx src/features/auth/AuthProvider.test.tsx src/components/ConfirmButton.tsx src/components/ConfirmButton.test.tsx src/components/SignOutButton.tsx src/components/SignOutButton.test.tsx src/pages/HomePage.tsx src/pages/HomePage.test.tsx
git commit -m "feat: 로그아웃 캐시 정리를 AuthProvider SIGNED_OUT 으로 이동, ConfirmButton·SignOutButton, 아이 계정 로그아웃 확인

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 가드 분기(익명 → `/pair`) · `RequireAdult` · 가족 탭

**Files:**
- Modify: `src/features/auth/Gate.tsx`, `src/features/auth/Gate.test.tsx`
- Modify: `src/components/PersonShell.tsx`, `src/components/PersonShell.test.tsx`

- [x] **Step 1: 실패하는 테스트**

`src/features/auth/Gate.test.tsx` — 가짜 타입과 라우트를 넓히고 테스트 추가:

```tsx
type FakeAuth = { status: 'loading' | 'ready'; session?: { user: { id: string; is_anonymous?: boolean } } | null }
type FakePerson = {
  status: 'pending' | 'error' | 'success'
  data?: { id: string; name: string; role?: string; family_id?: string; is_minor?: boolean } | null
}
// import 에 RequireAdult 추가. renderAt 의 Routes 에 두 줄 추가:
        <Route path="/pair" element={<RequireSession allowAnonymous><p>pair</p></RequireSession>} />
        // RequirePerson 아래에
          <Route path="/family" element={<RequireAdult><p>family</p></RequireAdult>} />

// describe('Gate') 에 추가
  it('익명(아이) 계정에 사람이 없으면 가입이 아니라 연결 코드 화면으로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1', is_anonymous: true } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/')
    expect(screen.getByText('pair')).toBeInTheDocument()
  })

  it('RequireSession: 익명 계정은 가입 화면 대신 연결 코드 화면으로', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1', is_anonymous: true } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/onboarding')
    expect(screen.getByText('pair')).toBeInTheDocument()
  })

  it('RequireSession allowAnonymous: 익명도, 카카오 미가입도 통과한다 (14세 미만 토글 경로)', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1', is_anonymous: true } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/pair')
    expect(screen.getByText('pair')).toBeInTheDocument()
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1', is_anonymous: false } } })
    renderAt('/pair')
    expect(screen.getAllByText('pair')).toHaveLength(2)
  })

  it('RequireSession allowAnonymous: 연결이 끝나(사람이 생기면) 홈으로 간다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1', is_anonymous: true } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p2', name: '서연', is_minor: true } })
    renderAt('/pair')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

// describe('RequirePerson') 에 추가
  it('익명 계정이 가입 전이면 연결 코드 화면으로', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1', is_anonymous: true } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/history')
    expect(screen.getByText('pair')).toBeInTheDocument()
  })

describe('RequireAdult', () => {
  it('자녀 계정은 홈으로 돌려보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p2', name: '서연', role: 'member', family_id: 'f1', is_minor: true } })
    renderAt('/family')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('어른은 통과', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수', role: 'member', family_id: 'f1', is_minor: false } })
    renderAt('/family')
    expect(screen.getByText('family')).toBeInTheDocument()
  })
})
```

`src/components/PersonShell.test.tsx` — 기존 첫 테스트를 바꾸고 둘 추가:

```tsx
const child = { ...member, id: 'p2', phone: null, auth_user_id: 'k1', is_minor: true, guardian_id: 'p1', consented_at: null, consent_version: null, guardian_consented_at: '2026-10-07T00:00:00Z' } satisfies Person

  it('어른 교인에게는 식권·내역·가족 탭', () => {
    renderShell(member, '/')
    expect(screen.getByText('내용')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🎫식권', '🧾내역', '👪가족'])
    expect(screen.getByRole('link', { name: '가족' })).toHaveAttribute('href', '/family')
  })

  it('자녀 계정에는 가족 탭이 없다', () => {
    renderShell(child, '/')
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🎫식권', '🧾내역'])
  })

  it('관리자에게는 가족 탭과 관리 탭이 모두 보인다', () => {
    renderShell(admin, '/')
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🎫식권', '🧾내역', '👪가족', '🛠️관리'])
  })
  // "교인이 관리자 주소로 바로 들어와도…" 테스트의 기대값도 ['🎫식권', '🧾내역', '👪가족'] 으로 바꾼다.
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/auth/Gate src/components/PersonShell`
Expected: `allowAnonymous`·`RequireAdult` 없음, 익명 분기 없음, 가족 탭 없음으로 실패.

- [x] **Step 3: 구현**

`src/features/auth/Gate.tsx`:

```tsx
import type { Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router'
import { PersonShell } from '../../components/PersonShell'
import { Spinner } from '../../components/ui'
import { HomePage } from '../../pages/HomePage'
import { StartPage } from '../../pages/StartPage'
import { useAuth } from './AuthProvider'
import { useCurrentPerson, usePerson } from './usePerson'

const CONNECTION_ERROR = '연결에 문제가 있어요. 새로고침해 주세요'

/** 로그인은 했지만 사람 행이 없는 계정이 갈 곳. 익명(아이) 계정은 가입이 아니라 연결 코드 화면이다 (claim_person 이 익명을 거부한다). */
function unregisteredPath(session: Session): string {
  return session.user.is_anonymous ? '/pair' : '/onboarding'
}

/** `#/` : 비로그인 → 시작 화면, 로그인·미가입 → 가입(또는 연결 코드), 가입 완료 → 홈 */
export function Gate() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <StartPage />
  if (person.status === 'pending') return <Spinner />
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (!person.data) return <Navigate to={unregisteredPath(auth.session)} replace />
  return (
    <PersonShell person={person.data}>
      <HomePage person={person.data} />
    </PersonShell>
  )
}

type RequireSessionProps = {
  children: ReactNode
  /** 연결 코드 화면만 true. 그 외(가입 화면)에서 익명 계정은 /pair 로 보낸다. */
  allowAnonymous?: boolean
}

/** 로그인은 했지만 아직 가입 전인 사람만 통과 (가입·연결 코드 화면용) */
export function RequireSession({ children, allowAnonymous = false }: RequireSessionProps) {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <Navigate to="/" replace />
  if (person.status === 'pending') return <Spinner />
  // 이미 가입한 사람일 수도 있다. 조회가 실패한 채로 가입을 진행시키지 않는다.
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (person.data) return <Navigate to="/" replace />
  if (!allowAnonymous && auth.session.user.is_anonymous) return <Navigate to="/pair" replace />
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
  if (!person.data) return <Navigate to={unregisteredPath(auth.session)} replace />
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

/** 어른만 (가족 탭). 자녀 계정이 주소를 직접 치면 홈으로 보낸다 (함수들도 not_adult 로 막는다). */
export function RequireAdult({ children }: { children: ReactNode }) {
  const person = useCurrentPerson()
  if (person.is_minor) return <Navigate to="/" replace />
  return <>{children}</>
}
```

`src/components/PersonShell.tsx`:

```tsx
const MEMBER_TABS: readonly TabItem[] = [
  { to: '/', label: '식권', icon: '🎫' },
  { to: '/history', label: '내역', icon: '🧾' },
]
// 어른만. 1인 가족이어도 있다 (설계 §8.2). 자녀 계정에는 없다.
const FAMILY_TAB: TabItem = { to: '/family', label: '가족', icon: '👪' }
const ADMIN_LINK: TabItem = { to: '/admin/meals', label: '관리', icon: '🛠️' }
const ADMIN_TABS: readonly TabItem[] = [
  { to: '/admin/meals', label: '식사', icon: '🍚' },
  { to: '/admin/issue', label: '발급', icon: '🎟️' },
  { to: '/', label: '내 식권', icon: '🎫' },
]

export function PersonShell({ person, children }: { person: Person; children: ReactNode }) {
  const { pathname } = useLocation()
  const inAdminArea = person.role === 'admin' && (pathname === '/admin' || pathname.startsWith('/admin/'))
  const memberTabs = person.is_minor ? MEMBER_TABS : [...MEMBER_TABS, FAMILY_TAB]
  const items = inAdminArea ? ADMIN_TABS : person.role === 'admin' ? [...memberTabs, ADMIN_LINK] : memberTabs
  return (
    <div className="flex min-h-dvh flex-col pb-[calc(5rem+env(safe-area-inset-bottom))]">
      {children}
      <TabBar items={items} />
    </div>
  )
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과.

- [x] **Step 5: 커밋**

```bash
git add src/features/auth/Gate.tsx src/features/auth/Gate.test.tsx src/components/PersonShell.tsx src/components/PersonShell.test.tsx
git commit -m "feat: 익명 계정은 /pair 로, RequireAdult, 어른 가족 탭

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 시작 화면 "아이 계정으로 시작하기" · 가입 화면 "만 14세 미만이에요" 토글

**Files:**
- Modify: `src/pages/StartPage.tsx`, `src/pages/StartPage.test.tsx`
- Modify: `src/features/onboarding/OnboardingPage.tsx`, `src/features/onboarding/OnboardingPage.test.tsx`

- [x] **Step 1: 실패하는 테스트**

`src/pages/StartPage.test.tsx` — 목에 `signInAsChild` 추가 후:

```tsx
// hoisted 에 추가
  signInAsChild: vi.fn<() => Promise<void>>(),
// mock 교체
vi.mock('../features/auth/signIn', () => ({ signInWithKakao, devSignIn, signInAsChild }))

  it('아이 계정 버튼은 익명 로그인을 시작하고, 성공해도 잠근 채 둔다 (누를 때마다 새 계정이 생긴다)', async () => {
    signInAsChild.mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: /아이 계정으로 시작하기/ })
    expect(button).toHaveTextContent('카카오 없이 · 보호자 연결 필요')
    await userEvent.click(button)
    expect(signInAsChild).toHaveBeenCalledOnce()
    await waitFor(() => expect(button).toBeDisabled())
    // 카카오 이동 안내는 뜨지 않는다
    expect(screen.queryByText(/카카오 로그인 화면으로 이동/)).not.toBeInTheDocument()
  })

  it('아이 계정 시작이 실패하면 안내를 띄우고 버튼을 다시 연다', async () => {
    signInAsChild.mockRejectedValue(new Error('Anonymous sign-ins are disabled'))
    renderPage()
    const button = screen.getByRole('button', { name: /아이 계정으로 시작하기/ })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
    expect(button).not.toBeDisabled()
  })
```

`src/features/onboarding/OnboardingPage.test.tsx` 에 추가:

```tsx
  it('"만 14세 미만이에요" 를 고르면 입력 폼 대신 연결 코드 안내와 링크가 보인다', async () => {
    renderPage()
    expect(screen.getByRole('radio', { name: '어른이에요' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: '만 14세 미만이에요' }))
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
    expect(screen.getByText(/가족 › 자녀 추가/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '연결 코드 받기' })).toHaveAttribute('href', expect.stringContaining('pair'))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('다시 "어른이에요" 로 돌아오면 적던 내용이 남아 있다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름'), '김철수')
    await userEvent.click(screen.getByRole('radio', { name: '만 14세 미만이에요' }))
    await userEvent.click(screen.getByRole('radio', { name: '어른이에요' }))
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
  })
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/pages/StartPage src/features/onboarding`
Expected: 버튼·토글이 없어 실패.

- [x] **Step 3: 구현**

`src/pages/StartPage.tsx` — `Pending` 에 `'child'` 를 더하고 카카오 버튼 아래에 버튼 추가:

```tsx
import { devSignIn, signInAsChild, signInWithKakao } from '../features/auth/signIn'
/** 어느 버튼이 일하는 중인지. 카카오만 이동 안내를 띄운다. 카카오·아이 계정은 성공해도 잠긴 채 둔다. */
type Pending = 'kakao' | 'child' | 'dev'
// …
      {/* 익명 로그인은 누를 때마다 새 계정을 만든다. 성공하면 Gate 가 /pair 로 옮기므로 그때까지 잠근 채 둔다. */}
      <Button variant="ghost" disabled={busy} onClick={() => void run('child', signInAsChild, { unlockOnSuccess: false })}>
        아이 계정으로 시작하기
        <span className="mt-0.5 block text-xs font-normal text-gray-500">카카오 없이 · 보호자 연결 필요</span>
      </Button>
```

`src/features/onboarding/OnboardingPage.tsx` — 제목 아래에 토글을 두고, 14세 미만이면 폼 대신 안내:

```tsx
  const [minor, setMinor] = useState(false)
  // …
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">처음 오셨네요</h1>

      <div role="radiogroup" aria-label="가입 유형" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-sm font-bold">
        <button type="button" role="radio" aria-checked={!minor} onClick={() => setMinor(false)}
          className={`rounded-lg py-2 ${minor ? 'text-gray-500' : 'bg-white text-blue-600 shadow-sm'}`}>
          어른이에요
        </button>
        <button type="button" role="radio" aria-checked={minor} onClick={() => setMinor(true)}
          className={`rounded-lg py-2 ${minor ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
          만 14세 미만이에요
        </button>
      </div>

      {minor ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm leading-relaxed">
          <p>
            만 14세 미만은 이름·번호를 적지 않아요. 보호자 폰의 <strong>가족 › 자녀 추가</strong>에서 연결 코드를 입력하면
            이 폰에 가족 식권이 보여요.
          </p>
          <Link to="/pair" className="block w-full rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white">
            연결 코드 받기
          </Link>
        </section>
      ) : (
        <>
          <p className="text-sm text-gray-600">권사님이 식권을 발급할 때 쓰는 정보예요. 입금하신 이름과 같게 적어 주세요.</p>
          <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {/* (기존 폼 내용 그대로) */}
          </form>
        </>
      )}
    </main>
  )
```

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과. 기존 가입 테스트(폼은 기본 '어른이에요' 상태에서 그대로 보인다)도 통과.

- [x] **Step 5: 커밋**

```bash
git add src/pages/StartPage.tsx src/pages/StartPage.test.tsx src/features/onboarding/OnboardingPage.tsx src/features/onboarding/OnboardingPage.test.tsx
git commit -m "feat: 시작 화면 아이 계정 버튼, 가입 화면 만 14세 미만 토글

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 9: 연결 코드 — `usePairingCode` · `useCountdown` · `PairingCodeCard` · `#/pair`

**Files:**
- Create: `src/features/pairing/usePairingCode.ts`, `src/features/pairing/usePairingCode.test.tsx`
- Create: `src/features/pairing/useCountdown.ts`, `src/features/pairing/useCountdown.test.ts`
- Create: `src/features/pairing/PairingCodeCard.tsx`, `src/features/pairing/PairingCodeCard.test.tsx`
- Create: `src/pages/PairPage.tsx`, `src/pages/PairPage.test.tsx`
- Modify: `src/App.tsx` (`/pair` 라우트)

- [x] **Step 1: 실패하는 테스트**

`src/features/pairing/usePairingCode.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PAIR_POLL_MS, pairingCodeQueryKey, usePairingCode } from './usePairingCode'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const row = { code: '48291357', expires_at: '2026-10-12T03:40:00Z' }

describe('usePairingCode', () => {
  it('상수와 키', () => {
    expect(PAIR_POLL_MS).toBe(3_000)
    expect(pairingCodeQueryKey('child')).toEqual(['pairing-code', 'child'])
  })

  it('종류를 넘겨 코드를 받는다', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    const { result } = renderHook(() => usePairingCode('child'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(rpc).toHaveBeenCalledWith('create_pairing_code', { p_kind: 'child' })
    expect(result.current.data).toEqual(row)
  })

  it('"새 코드 받기"(refetch) 는 서버를 다시 부른다 — 자동 재조회는 없다', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    const { result } = renderHook(() => usePairingCode('adult'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => {
      await result.current.refetch()
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenLastCalledWith('create_pairing_code', { p_kind: 'adult' })
  })

  it('서버 오류는 Error 로 (문구는 toUserMessage 가 맡는다)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'already_registered' } })
    const { result } = renderHook(() => usePairingCode('child'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toBe('already_registered')
  })

  it('빈 결과는 오류로 드러낸다', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => usePairingCode('child'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toMatch(/코드를 받지 못했습니다/)
  })
})
```

`src/features/pairing/useCountdown.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { formatRemaining, useCountdown } from './useCountdown'

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T03:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('만료까지 남은 초를 1초마다 줄이고 0 에서 멈춘다', () => {
    const { result } = renderHook(() => useCountdown('2026-10-12T03:30:03Z'))
    expect(result.current).toBe(3)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(2)
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(0)
  })

  it('만료 시각이 없으면 0 이고 타이머를 만들지 않는다', () => {
    const { result } = renderHook(() => useCountdown(undefined))
    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('새 코드(만료 시각 변경)가 오면 다음 틱부터 새 값으로 센다', () => {
    const { result, rerender } = renderHook(({ at }) => useCountdown(at), { initialProps: { at: '2026-10-12T03:30:03Z' } })
    rerender({ at: '2026-10-12T03:40:00Z' })
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(599)
  })

  it('언마운트되면 인터벌을 치운다', () => {
    const { unmount } = renderHook(() => useCountdown('2026-10-12T03:40:00Z'))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('formatRemaining', () => {
  it('분·초', () => {
    expect(formatRemaining(581)).toBe('9분 41초')
    expect(formatRemaining(59)).toBe('0분 59초')
    expect(formatRemaining(0)).toBe('0분 0초')
  })
})
```

`src/features/pairing/PairingCodeCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PairingCodeCard } from './PairingCodeCard'

type Query = { status: 'pending' | 'error' | 'success'; data?: { code: string; expires_at: string }; error?: Error; isFetching: boolean; refetch: () => Promise<unknown> }
const { usePairingCode, useCountdown } = vi.hoisted(() => ({
  usePairingCode: vi.fn<() => Query>(),
  useCountdown: vi.fn<() => number>(),
}))
vi.mock('./usePairingCode', () => ({ usePairingCode }))
vi.mock('./useCountdown', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useCountdown')>()),
  useCountdown,
}))

const data = { code: '48291357', expires_at: '2026-10-12T03:40:00Z' }

describe('PairingCodeCard', () => {
  it('코드를 네 자리씩 띄워 크게 보여 주고 남은 시간을 알린다', () => {
    const refetch = vi.fn<() => Promise<unknown>>()
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: false, refetch })
    useCountdown.mockReturnValue(581)
    render(<PairingCodeCard kind="child" hint="보호자 앱에서 입력해 주세요" />)
    expect(screen.getByTestId('pairing-code')).toHaveTextContent('4829 1357')
    expect(screen.getByRole('status')).toHaveTextContent('9분 41초 남음 · 1회용')
    expect(screen.getByText('보호자 앱에서 입력해 주세요')).toBeInTheDocument()
    expect(usePairingCode).toHaveBeenCalledWith('child')
  })

  it('만료되면 코드를 흐리게 하고 안내한다', () => {
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: false, refetch: vi.fn<() => Promise<unknown>>() })
    useCountdown.mockReturnValue(0)
    render(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('status')).toHaveTextContent('코드가 만료되었어요')
    expect(screen.getByTestId('pairing-code')).toHaveClass('line-through')
  })

  it('"새 코드 받기" 는 refetch 를 부르고, 받는 중에는 잠근다', async () => {
    const refetch = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: false, refetch })
    useCountdown.mockReturnValue(10)
    const { rerender } = render(<PairingCodeCard kind="adult" hint="" />)
    await userEvent.click(screen.getByRole('button', { name: '새 코드 받기' }))
    expect(refetch).toHaveBeenCalledOnce()
    usePairingCode.mockReturnValue({ status: 'success', data, isFetching: true, refetch })
    rerender(<PairingCodeCard kind="adult" hint="" />)
    expect(screen.getByRole('button', { name: '새 코드 받기' })).toBeDisabled()
  })

  it('받는 중이면 스피너, 실패하면 문구', () => {
    usePairingCode.mockReturnValue({ status: 'pending', isFetching: true, refetch: vi.fn<() => Promise<unknown>>() })
    useCountdown.mockReturnValue(0)
    const { rerender } = render(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    usePairingCode.mockReturnValue({ status: 'error', error: new Error('already_registered'), isFetching: false, refetch: vi.fn<() => Promise<unknown>>() })
    rerender(<PairingCodeCard kind="child" hint="" />)
    expect(screen.getByRole('alert')).toHaveTextContent('이미 가입된 계정이에요.')
  })
})
```

`src/pages/PairPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'
import { PairPage } from './PairPage'

const { useAuth, usePerson } = vi.hoisted(() => ({
  useAuth: vi.fn<() => { status: 'ready'; session: { user: { id: string } } }>(),
  usePerson: vi.fn<(userId: string | undefined, options?: { refetchInterval?: number | false }) => unknown>(),
}))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth }))
vi.mock('../features/auth/usePerson', () => ({ usePerson }))
vi.mock('../features/pairing/PairingCodeCard', () => ({ PairingCodeCard: ({ kind }: { kind: string }) => <p>card:{kind}</p> }))
vi.mock('../components/SignOutButton', () => ({ SignOutButton: ({ label }: { label: string }) => <button type="button">{label}</button> }))

describe('PairPage', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'k1' } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
  })

  it('자녀 코드 카드와 안내, 처음으로 버튼을 보여 준다', () => {
    render(<MemoryRouter><PairPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '보호자에게 이 코드를 보여 주세요' })).toBeInTheDocument()
    expect(screen.getByText('card:child')).toBeInTheDocument()
    expect(screen.getByText(/홈 화면에 추가/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '처음으로 돌아가기' })).toBeInTheDocument()
  })

  it('보호자가 연결하면 바로 알 수 있게 내 사람 행을 3초마다 확인한다', () => {
    render(<MemoryRouter><PairPage /></MemoryRouter>)
    expect(usePerson).toHaveBeenCalledWith('k1', { refetchInterval: PAIR_POLL_MS })
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/features/pairing src/pages/PairPage`
Expected: 모듈 없음으로 실패.

- [x] **Step 3: 구현**

`src/features/pairing/usePairingCode.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'

/** 연결 대기 중 "내 사람 행이 생겼나(또는 가족이 바뀌었나)" 를 확인하는 주기 */
export const PAIR_POLL_MS = 3_000

export type PairingKind = 'child' | 'adult'
export type PairingCode = { code: string; expires_at: string }
export const pairingCodeQueryKey = (kind: PairingKind) => ['pairing-code', kind] as const

/**
 * 연결 코드를 받는다. 조회처럼 다루되(화면이 열릴 때 한 번) 자동 재조회는 모두 끈다 — 서버는 부를 때마다
 * 이전 코드를 지우고 새 코드를 만들기 때문에, 포커스 복귀만으로 코드가 바뀌면 보호자가 적던 코드가 무효가 된다.
 * 새 코드는 사용자가 "새 코드 받기"(refetch) 를 눌러 받는다. 화면을 떠나면 캐시도 버린다(gcTime 0).
 */
export function usePairingCode(kind: PairingKind) {
  return useQuery({
    queryKey: pairingCodeQueryKey(kind),
    queryFn: async (): Promise<PairingCode> => {
      const rows = unwrap(await supabase.rpc('create_pairing_code', { p_kind: kind }))
      const row = rows[0]
      if (!row) throw new Error('usePairingCode: 코드를 받지 못했습니다')
      return row
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  })
}
```

`src/features/pairing/useCountdown.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * 만료 시각까지 남은 초. 1초마다 줄고 0 에서 멈춘다. 서버가 준 만료 시각 기준이라 폰 시계가 조금 틀려도 10분 안팎으로 맞는다.
 * (effect 안에서 setState 를 바로 부르지 않는다 — 인터벌 콜백에서만. 만료 시각이 바뀌면 다음 틱에 새 값으로 센다.)
 */
export function useCountdown(expiresAt: string | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  if (!expiresAt) return 0
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
}

/** 581 → '9분 41초' */
export function formatRemaining(seconds: number): string {
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}
```

`src/features/pairing/PairingCodeCard.tsx`:

```tsx
import { Button, Spinner } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { formatRemaining, useCountdown } from './useCountdown'
import { usePairingCode, type PairingKind } from './usePairingCode'

type Props = {
  kind: PairingKind
  /** 이 코드를 어디에 넣는지 (아이 화면과 가족 탭 "내 코드" 가 다르다) */
  hint: string
}

/** 8자리 코드를 크게, 남은 시간과 함께. 만료되면 흐리게 하고 "새 코드 받기" 로 다시 받는다. */
export function PairingCodeCard({ kind, hint }: Props) {
  const code = usePairingCode(kind)
  const remaining = useCountdown(code.data?.expires_at)
  const expired = code.data !== undefined && remaining === 0

  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-blue-600 bg-white p-6 text-center">
      {code.data ? (
        <>
          <p
            data-testid="pairing-code"
            className={`font-mono text-5xl font-extrabold tabular-nums tracking-[0.2em] ${expired ? 'text-gray-300 line-through' : ''}`}
          >
            {code.data.code.slice(0, 4)} {code.data.code.slice(4)}
          </p>
          <p role="status" className={`text-sm ${expired ? 'font-bold text-red-600' : 'text-gray-600'}`}>
            {expired ? '코드가 만료되었어요' : `${formatRemaining(remaining)} 남음 · 1회용`}
          </p>
        </>
      ) : code.status === 'error' ? (
        <p role="alert" className="text-sm text-red-600">{toUserMessage(code.error)}</p>
      ) : (
        <Spinner inline />
      )}
      {hint && <p className="text-xs leading-relaxed text-gray-600">{hint}</p>}
      <Button variant="ghost" onClick={() => void code.refetch()} disabled={code.isFetching}>
        새 코드 받기
      </Button>
    </section>
  )
}
```

`src/pages/PairPage.tsx`:

```tsx
import { SignOutButton } from '../components/SignOutButton'
import { useAuth } from '../features/auth/AuthProvider'
import { usePerson } from '../features/auth/usePerson'
import { PairingCodeCard } from '../features/pairing/PairingCodeCard'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'

/** `#/pair` — 아이 폰(익명 계정, 또는 카카오 뒤 "만 14세 미만")에 뜨는 연결 코드. 보호자가 연결하면 가드가 홈으로 보낸다. */
export function PairPage() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  // 보호자가 "자녀 추가" 를 마치면 이 계정에 사람 행이 생긴다. 같은 키를 보는 RequireSession 가드가 데이터를 받자마자 홈으로 보낸다.
  // 폴링은 화면이 보일 때만 돈다(refetchIntervalInBackground 기본 false) — 화면이 꺼지거나 다른 앱으로 가면 멈추고, 돌아오면
  // refetchOnWindowFocus 로 바로 다시 읽는다. "잠금 화면에서 안 바뀌었다" 는 버그가 아니다.
  usePerson(userId, { refetchInterval: PAIR_POLL_MS })

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">보호자에게 이 코드를 보여 주세요</h1>
      <PairingCodeCard kind="child" hint="보호자 앱의 가족 › 자녀 추가에서 이 숫자를 입력하면 연결돼요" />
      <p className="text-sm leading-relaxed text-gray-600">
        연결이 끝나면 이 화면이 저절로 바뀌고 가족 식권이 보여요. <strong>홈 화면에 추가</strong>해 두면 다음부터 바로 열려요.
      </p>
      <div className="flex-1" />
      {/* 하루 넘게 연결되지 않은 익명 계정은 정리 작업이 지운다 → 코드 요청이 not_authenticated('로그인이 필요해요') 로 실패한다.
          그때는 처음으로 돌아가 "아이 계정으로 시작하기" 를 다시 누르면 새 계정으로 다시 시작된다. */}
      <p className="text-center text-xs text-gray-500">잘못 들어왔거나 코드를 받을 수 없다면 처음으로 돌아가 다시 시작할 수 있어요.</p>
      <SignOutButton label="처음으로 돌아가기" />
    </main>
  )
}
```

`src/App.tsx` — Task 7 가 자리만 잡아 둔 `/pair` 라우트(Spinner 자리표시자)의 element 를 실제 화면으로 바꾼다:

```tsx
import { PairPage } from './pages/PairPage'
// …
            <Route path="/pair" element={<RequireSession allowAnonymous><PairPage /></RequireSession>} />
```
(`Spinner` import 가 더 이상 쓰이지 않으면 지운다. `App.test.tsx` 의 익명 세션 테스트는 `#/pair` 로 가는 것과 제목 '보호자에게 이 코드를 보여 주세요' 가 보이는 것으로 바꾼다 — 해시 단언만으로는 리다이렉트 루프 안에서도 잠깐 통과하므로, 화면에 무언가 그려졌다는 두 번째 단언이 루프 방지의 실제 검증이다. 그 테스트는 `supabase.from` 체인 목으로 사람 행 null 을 돌려준다; PairPage 가 부르는 `rpc('create_pairing_code')` 도 목으로 `{ data: [{ code: '48291357', expires_at: … }], error: null }` 을 돌려주게 한다.)

- [x] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과. `rpc('create_pairing_code', …)` 의 반환 타입은 Task 4 에서 재생성한 `database.types.ts` 가 `{ code: string; expires_at: string }[]` 로 준다.

- [ ] **Step 5: 수동 확인 (로컬)**

Run: `npm run dev` → 시작 화면 → "아이 계정으로 시작하기" → `#/pair` 에 8자리 코드와 남은 시간이 보인다. "새 코드 받기" 로 코드가 바뀐다. (연결은 Task 11 이후.)

- [x] **Step 6: 커밋**

```bash
git add src/features/pairing src/pages/PairPage.tsx src/pages/PairPage.test.tsx src/App.tsx
git commit -m "feat: 연결 코드 화면(#/pair) — 코드 발급·남은 시간·새 코드·연결 감지 폴링

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 가족 데이터 — `familySchema` · `useFamilyMembers` · `useFamilyActions`

**Files:**
- Create: `src/features/family/familySchema.ts`, `src/features/family/familySchema.test.ts`
- Create: `src/features/family/useFamilyMembers.ts`, `src/features/family/useFamilyMembers.test.tsx`
- Create: `src/features/family/useFamilyActions.ts`, `src/features/family/useFamilyActions.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`src/features/family/familySchema.test.ts`:

```ts
import { validateAddChild, validateJoin, validateProfile, validateRelink } from './familySchema'

describe('validateAddChild', () => {
  it('이름 공백 제거·NFC, 코드는 숫자만 남겨 8자리', () => {
    const r = validateAddChild({ name: ' 서연 ', code: '4829 1357', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '서연', code: '48291357', consent: true } })
  })
  it('이름이 비면 오류', () => {
    expect(validateAddChild({ name: ' ', code: '48291357', consent: true })).toEqual({ ok: false, errors: { name: '이름을 입력해 주세요' } })
  })
  it('코드가 8자리 숫자가 아니면 오류', () => {
    expect(validateAddChild({ name: '서연', code: '1234567', consent: true })).toEqual({ ok: false, errors: { code: '8자리 숫자 코드를 입력해 주세요' } })
  })
  it('동의가 없으면 오류', () => {
    expect(validateAddChild({ name: '서연', code: '48291357', consent: false })).toEqual({ ok: false, errors: { consent: '법정대리인 동의가 필요해요' } })
  })
})

describe('validateRelink', () => {
  it('자녀 id 와 코드', () => {
    expect(validateRelink({ childId: 'p2', code: '4829-1357' })).toEqual({ ok: true, values: { childId: 'p2', code: '48291357' } })
    expect(validateRelink({ childId: '', code: '48291357' })).toEqual({ ok: false, errors: { childId: '자녀를 선택해 주세요' } })
  })
})

describe('validateJoin', () => {
  it('코드만', () => {
    expect(validateJoin({ code: '00001111' })).toEqual({ ok: true, values: { code: '00001111' } })
    expect(validateJoin({ code: 'abc' })).toEqual({ ok: false, errors: { code: '8자리 숫자 코드를 입력해 주세요' } })
  })
})

describe('validateProfile', () => {
  it('이름·번호 (번호는 정규화)', () => {
    expect(validateProfile({ name: '김철수', phone: '+82 10-1234-5678' })).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678' } })
    expect(validateProfile({ name: '김철수', phone: '02-123-4567' })).toEqual({ ok: false, errors: { phone: '휴대폰 번호를 확인해 주세요' } })
  })
})
```

`src/features/family/useFamilyMembers.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ok } from '../../test/fakeSupabase'
import { canLeaveFamily, familyMembersQueryKey, useFamilyMembers, type FamilyMember } from './useFamilyMembers'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const member = (over: Partial<FamilyMember>): FamilyMember => ({
  id: 'p1', name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1',
  consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z', ...over,
})

describe('useFamilyMembers', () => {
  it('내 가족의 살아 있는 구성원을 가입 순으로 읽는다', async () => {
    const rows = [member({}), member({ id: 'p2', name: '서연', is_minor: true, guardian_id: 'p1' })]
    const q = ok(rows)
    from.mockReturnValue(q)
    const { result } = renderHook(() => useFamilyMembers('f1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.data).toEqual(rows))
    expect(from).toHaveBeenCalledWith('people')
    expect(q.has('eq', 'family_id', 'f1')).toBe(true)
    expect(q.has('is', 'deleted_at', null)).toBe(true)
    expect(q.has('order', 'created_at')).toBe(true)
    expect(familyMembersQueryKey).toEqual(['family-members'])
  })
})

describe('canLeaveFamily', () => {
  const me = member({})
  const myChild = member({ id: 'p2', name: '서연', is_minor: true, guardian_id: 'p1' })
  it('나와 내 자녀뿐이면 나갈 뜻이 없다 (DB 도 그때는 아무것도 바꾸지 않는다)', () => {
    expect(canLeaveFamily([me], 'p1')).toBe(false)
    expect(canLeaveFamily([me, myChild], 'p1')).toBe(false)
  })
  it('다른 어른이나 남의 자녀가 있으면 나갈 수 있다', () => {
    expect(canLeaveFamily([me, member({ id: 'p3', name: '이영희' })], 'p1')).toBe(true)
    expect(canLeaveFamily([me, member({ id: 'p4', name: '민준', is_minor: true, guardian_id: 'p3' })], 'p1')).toBe(true)
  })
})
```

`src/features/family/useFamilyActions.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { church } from '../../config/church'
import { ok, fail } from '../../test/fakeSupabase'
import { profileErrorMessage, useAddChild, useDeleteAccount, useJoinFamily, useLeaveFamily, useRelinkChild, useRemoveChild, useUpdateProfile } from './useFamilyActions'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }
const { from, rpc, signOut } = vi.hoisted(() => ({
  from: vi.fn<(table: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => Promise<RpcResult>>(),
  signOut: vi.fn<() => Promise<void>>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }))
vi.mock('../auth/signIn', () => ({ signOut }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper, invalidate }
}

const child = { id: 'p2', name: '서연', family_id: 'f1' }
const FAMILY_KEYS = [['family-members'], ['tickets'], ['ledger'], ['person']]

function expectFamilyInvalidated(invalidate: ReturnType<typeof vi.spyOn>) {
  for (const queryKey of FAMILY_KEYS) expect(invalidate).toHaveBeenCalledWith({ queryKey })
}

describe('useAddChild', () => {
  it('add_family_member 를 코드·이름으로 부르고 가족 관련 캐시를 전부 무효화한다', async () => {
    rpc.mockResolvedValue({ data: child, error: null })
    const { wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useAddChild(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: '서연', code: '48291357' })
    })
    expect(rpc).toHaveBeenCalledWith('add_family_member', { p_code: '48291357', p_child_name: '서연', p_consent_version: church.consentVersion })
    expectFamilyInvalidated(invalidate)
  })

  it('서버 코드는 Error 로 (문구는 화면이 toUserMessage 로)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_code' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAddChild(), { wrapper })
    act(() => result.current.mutate({ name: '서연', code: '00000000' }))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toBe('invalid_code')
  })
})

describe('useRelinkChild · useJoinFamily · useLeaveFamily · useRemoveChild', () => {
  it('각각 알맞은 RPC 를 부른다', async () => {
    rpc.mockResolvedValue({ data: child, error: null })
    const { wrapper, invalidate } = makeWrapper()
    const relink = renderHook(() => useRelinkChild(), { wrapper })
    await act(async () => {
      await relink.result.current.mutateAsync({ childId: 'p2', code: '11111111' })
    })
    expect(rpc).toHaveBeenCalledWith('relink_child', { p_child_id: 'p2', p_code: '11111111' })

    const join = renderHook(() => useJoinFamily(), { wrapper })
    await act(async () => {
      await join.result.current.mutateAsync({ code: '22222222' })
    })
    expect(rpc).toHaveBeenCalledWith('add_family_member', { p_code: '22222222' })

    const leave = renderHook(() => useLeaveFamily(), { wrapper })
    await act(async () => {
      await leave.result.current.mutateAsync()
    })
    expect(rpc).toHaveBeenCalledWith('leave_family')

    rpc.mockResolvedValue({ data: null, error: null })
    const remove = renderHook(() => useRemoveChild(), { wrapper })
    await act(async () => {
      await remove.result.current.mutateAsync('p2')
    })
    expect(rpc).toHaveBeenCalledWith('remove_child', { p_child_id: 'p2' })
    expectFamilyInvalidated(invalidate)
  })
})

describe('useDeleteAccount', () => {
  it('익명화 RPC 뒤 로그아웃한다 (캐시·세션 정리는 AuthProvider)', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    signOut.mockResolvedValue(undefined)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDeleteAccount(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(rpc).toHaveBeenCalledWith('delete_my_account')
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('has_children 이면 로그아웃하지 않는다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'has_children' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDeleteAccount(), { wrapper })
    act(() => result.current.mutate())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('useUpdateProfile', () => {
  const me = { id: 'p1', auth_user_id: 'u1' }
  it('people 행을 고치고 내 사람 캐시를 바꿔 끼운 뒤 구성원 목록을 무효화한다', async () => {
    const updated = { id: 'p1', name: '김철수A', phone: '01099998888' }
    const q = ok(updated)
    from.mockReturnValue(q)
    const { client, wrapper, invalidate } = makeWrapper()
    const { result } = renderHook(() => useUpdateProfile(me), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: '김철수A', phone: '01099998888' })
    })
    expect(from).toHaveBeenCalledWith('people')
    expect(q.has('update', { name: '김철수A', phone: '01099998888' })).toBe(true)
    expect(q.has('eq', 'id', 'p1')).toBe(true)
    expect(q.has('single')).toBe(true)
    expect(client.getQueryData(['person', 'u1'])).toEqual(updated)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['family-members'] })
  })

  it('번호 중복(23505)은 구체적인 문구', () => {
    expect(profileErrorMessage({ code: '23505', message: 'duplicate key' })).toBe('이미 다른 분이 쓰는 번호예요. 번호를 확인하거나 권사님께 문의해 주세요.')
    expect(profileErrorMessage(new Error('x'))).toBe('잠시 후 다시 시도해 주세요.')
  })

  it('실패하면 Error', async () => {
    from.mockReturnValue(fail('permission denied', '42501'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateProfile(me), { wrapper })
    act(() => result.current.mutate({ name: '김', phone: '01011112222' }))
    await waitFor(() => expect(result.current.status).toBe('error'))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/features/family`
Expected: 모듈 없음.

- [ ] **Step 3: 구현**

`src/features/family/familySchema.ts`:

```ts
import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'
import { validateWith, type Validation } from '../../lib/validate'

// 가입 화면과 같은 이름 규칙 (NFC 로 맞춘 뒤 길이를 센다)
export const nameSchema = z
  .string()
  .transform((s) => s.normalize('NFC'))
  .pipe(z.string().trim().min(1, '이름을 입력해 주세요').max(20, '이름은 20자 이내로 입력해 주세요'))
// 코드는 "4829 1357" 처럼 띄워 보여 주므로 숫자만 남긴 뒤 8자리인지 본다 (DB 와 같은 길이 — 2단계 리뷰에서 6→8 로 늘렸다)
export const codeSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{8}$/, '8자리 숫자 코드를 입력해 주세요'))
const phoneSchema = z.string().transform(normalizePhone).refine(isValidMobile, '휴대폰 번호를 확인해 주세요')

export const addChildSchema = z.object({
  name: nameSchema,
  code: codeSchema,
  consent: z.boolean().refine((v) => v === true, '법정대리인 동의가 필요해요'),
})
export const relinkSchema = z.object({ childId: z.string().min(1, '자녀를 선택해 주세요'), code: codeSchema })
export const joinSchema = z.object({ code: codeSchema })
export const profileSchema = z.object({ name: nameSchema, phone: phoneSchema })

export type AddChildInput = z.input<typeof addChildSchema>
export type AddChildValues = z.output<typeof addChildSchema>
export type RelinkInput = z.input<typeof relinkSchema>
export type RelinkValues = z.output<typeof relinkSchema>
export type JoinInput = z.input<typeof joinSchema>
export type JoinValues = z.output<typeof joinSchema>
export type ProfileInput = z.input<typeof profileSchema>
export type ProfileValues = z.output<typeof profileSchema>

export const validateAddChild = (input: AddChildInput): Validation<AddChildValues, AddChildInput> => validateWith(addChildSchema, input, 'name')
export const validateRelink = (input: RelinkInput): Validation<RelinkValues, RelinkInput> => validateWith(relinkSchema, input, 'code')
export const validateJoin = (input: JoinInput): Validation<JoinValues, JoinInput> => validateWith(joinSchema, input, 'code')
export const validateProfile = (input: ProfileInput): Validation<ProfileValues, ProfileInput> => validateWith(profileSchema, input, 'name')
```

`src/features/family/useFamilyMembers.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import type { Person } from '../auth/usePerson'

export const familyMembersQueryKey = ['family-members'] as const
const COLUMNS = 'id, name, phone, is_minor, guardian_id, auth_user_id, consented_at, guardian_consented_at, created_at'

export type FamilyMember = Pick<Person, 'id' | 'name' | 'phone' | 'is_minor' | 'guardian_id' | 'auth_user_id' | 'consented_at' | 'guardian_consented_at' | 'created_at'>

/** 내 가족의 살아 있는 구성원 (RLS 가 같은 가족만 연다). 가입 순. */
export function useFamilyMembers(familyId: string) {
  return useQuery({
    queryKey: [...familyMembersQueryKey, familyId],
    queryFn: async (): Promise<FamilyMember[]> =>
      supabase.from('people').select(COLUMNS).eq('family_id', familyId).is('deleted_at', null).order('created_at').then(unwrap),
  })
}

/** 나도 아니고 내 자녀도 아닌 구성원이 있는가. DB 의 leave_family 도 같은 조건에서만 옮기므로, "가족 나가기" 는 이때만 보인다. */
export function canLeaveFamily(members: readonly FamilyMember[], meId: string): boolean {
  return members.some((m) => m.id !== meId && !(m.is_minor && m.guardian_id === meId))
}
```

`src/features/family/useFamilyActions.ts`:

```ts
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { church } from '../../config/church'
import { codeOf, toUserMessage } from '../../lib/errors'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { signOut } from '../auth/signIn'
import { personQueryKey, type Person } from '../auth/usePerson'
import { ledgerQueryKey } from '../history/useFamilyLedger'
import { ticketsQueryKey } from '../tickets/useFamilyTickets'
import { familyMembersQueryKey } from './useFamilyMembers'

/**
 * 가족 구성이 바뀌면 다시 읽어야 하는 것 전부: 구성원 목록, 홈(구성원 수·식권 — 어른 합류 때 잔량 풀이 옮겨 올 수 있다),
 * 내역, 내 사람 행(가족 나가기·합류로 family_id 가 바뀐다 — 키 접두사 ['person'] 으로 모든 사용자 캐시).
 */
export function invalidateFamily(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: familyMembersQueryKey }),
    queryClient.invalidateQueries({ queryKey: ticketsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
    queryClient.invalidateQueries({ queryKey: ['person'] }),
  ])
}

/** 자녀 추가: 아이 폰의 코드 + 이름. 돌려받는 행은 새 자녀. */
export function useAddChild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { name: string; code: string }) =>
      // 동의 버전: 보호자가 체크한 법정대리인 동의 문구의 날짜 (DB 가 YYYY-MM-DD 형식을 검사한다)
      unwrap(await supabase.rpc('add_family_member', { p_code: v.code, p_child_name: v.name, p_consent_version: church.consentVersion })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 폰을 바꾼 자녀를 새 폰의 코드로 다시 연결 */
export function useRelinkChild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { childId: string; code: string }) =>
      unwrap(await supabase.rpc('relink_child', { p_child_id: v.childId, p_code: v.code })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 어른 합류: 상대(배우자) 폰의 어른 코드 → 그 사람이 우리 가족으로 들어온다 */
export function useJoinFamily() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { code: string }) => unwrap(await supabase.rpc('add_family_member', { p_code: v.code })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 가족 나가기: 나와 내 자녀만 새 가족으로. 장부는 옛 가족에 남는다. */
export function useLeaveFamily() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('leave_family')),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/** 자녀 삭제(익명화) */
export function useRemoveChild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (childId: string) => unwrap(await supabase.rpc('remove_child', { p_child_id: childId })),
    onSuccess: () => invalidateFamily(queryClient),
  })
}

/**
 * 탈퇴: 익명화 뒤 로그아웃. 로그아웃이 세션·캐시를 비우고 Gate 가 시작 화면을 띄운다. has_children 이면 여기서 멈춘다.
 * onSuccess/onSettled 에서 캐시를 무효화하지 않는다 — 그 콜백은 signOut() 직후 마이크로태스크로 돌아서 AuthProvider 의
 * (한 틱 미룬) clear 보다 먼저 실행되고, 이미 폐기된 토큰으로 401 재조회를 쏘게 된다.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      unwrap(await supabase.rpc('delete_my_account'))
      await signOut()
    },
  })
}

/** 내 정보 수정(이름·번호). people_update_self 정책이 본인 행의 이 두 열만 연다. */
export function useUpdateProfile(me: Pick<Person, 'id' | 'auth_user_id'>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { name: string; phone: string }): Promise<Person> => {
      const row = unwrap(await supabase.from('people').update(v).eq('id', me.id).select('*').single())
      // .single() 의 타입은 null 을 허용하지만(런타임 응답 안전망) 한 행 update·select 는 항상 행을 돌려준다.
      if (!row) throw new Error('useUpdateProfile: 바뀐 사람 행을 받지 못했습니다')
      return row
    },
    onSuccess: (row) => {
      // 홈 머리말·가드가 보는 내 사람 행을 바로 바꿔 끼우고, 구성원 목록은 다시 읽는다
      if (me.auth_user_id) queryClient.setQueryData(personQueryKey(me.auth_user_id), row)
      return queryClient.invalidateQueries({ queryKey: familyMembersQueryKey })
    },
  })
}

/** 내 정보 수정 오류 문구. 번호 중복(부분 유니크 인덱스 23505)은 구체적으로. */
export function profileErrorMessage(err: unknown): string {
  return codeOf(err) === '23505' ? '이미 다른 분이 쓰는 번호예요. 번호를 확인하거나 권사님께 문의해 주세요.' : toUserMessage(err)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/features/family && npm run lint && npx tsc -b`
Expected: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/features/family/familySchema.ts src/features/family/familySchema.test.ts src/features/family/useFamilyMembers.ts src/features/family/useFamilyMembers.test.tsx src/features/family/useFamilyActions.ts src/features/family/useFamilyActions.test.tsx
git commit -m "feat: 가족 데이터 — 검증 스키마, 구성원 조회, 가족 뮤테이션 7개

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 가족 화면 ① — `MemberList` · `AddChildForm` · `FamilyPage` 조립 · `/family` 라우트

**Files:**
- Create: `src/features/family/MemberList.tsx`, `src/features/family/MemberList.test.tsx`
- Create: `src/features/family/AddChildForm.tsx`, `src/features/family/AddChildForm.test.tsx`
- Create: `src/pages/FamilyPage.tsx`, `src/pages/FamilyPage.test.tsx`
- Modify: `src/App.tsx` (`/family` 라우트)

- [ ] **Step 1: 실패하는 테스트**

`src/features/family/MemberList.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberList } from './MemberList'
import type { FamilyMember } from './useFamilyMembers'

const member = (over: Partial<FamilyMember>): FamilyMember => ({
  id: 'p1', name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1',
  consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z', ...over,
})
const me = member({})
const spouse = member({ id: 'p3', name: '이영희', phone: '01098765432', auth_user_id: 'u3' })
const myChild = member({ id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1', consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z' })
const spouseChild = member({ id: 'p4', name: '민준', phone: null, is_minor: true, guardian_id: 'p3', auth_user_id: 'k2', consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z' })
const visitor = member({ id: 'p5', name: '이순자', phone: '01011112222', auth_user_id: null, consented_at: null })

function renderList(members: FamilyMember[], over: Partial<Parameters<typeof MemberList>[0]> = {}) {
  const onLeave = vi.fn<() => void>()
  const onRemoveChild = vi.fn<(c: FamilyMember) => void>()
  render(<MemberList members={members} me={me} pending={false} onLeave={onLeave} onRemoveChild={onRemoveChild} {...over} />)
  return { onLeave, onRemoveChild }
}

describe('MemberList', () => {
  it('이름·태그·가려진 번호·동의 날짜를 보여 준다', () => {
    renderList([me, spouse, myChild, visitor])
    const rows = within(screen.getByRole('list', { name: '가족 구성원' })).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('김철수')
    expect(rows[0]).toHaveTextContent('나')
    expect(rows[0]).toHaveTextContent('010-****-5678')
    expect(rows[0]).toHaveTextContent('동의 10/7')
    expect(rows[2]).toHaveTextContent('서연')
    expect(rows[2]).toHaveTextContent('자녀')
    expect(rows[2]).toHaveTextContent('보호자 동의 10/5')
    expect(rows[3]).toHaveTextContent('미가입')
  })

  it('나와 내 자녀뿐이면 "가족 나가기" 가 없다', () => {
    renderList([me, myChild])
    expect(screen.queryByRole('button', { name: '가족 나가기' })).not.toBeInTheDocument()
  })

  it('다른 어른이 있으면 내 행에 "가족 나가기" — 확인을 거쳐 onLeave', async () => {
    const { onLeave } = renderList([me, spouse])
    await userEvent.click(screen.getByRole('button', { name: '가족 나가기' }))
    expect(onLeave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '나가기' }))
    expect(onLeave).toHaveBeenCalledOnce()
  })

  it('내 자녀 행에만 "자녀 삭제" — 확인을 거쳐 onRemoveChild(자녀)', async () => {
    const { onRemoveChild } = renderList([me, myChild, spouseChild])
    expect(screen.getAllByRole('button', { name: '자녀 삭제' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: '자녀 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onRemoveChild).toHaveBeenCalledWith(myChild)
  })

  it('처리 중에는 버튼을 잠근다', () => {
    renderList([me, spouse, myChild], { pending: true })
    expect(screen.getByRole('button', { name: '가족 나가기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '자녀 삭제' })).toBeDisabled()
  })
})
```

`src/features/family/AddChildForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddChildForm } from './AddChildForm'
import type { FamilyMember } from './useFamilyMembers'

type Mutation = {
  isPending: boolean
  isError: boolean
  error?: Error
  mutate: (vars: unknown, opts?: { onSuccess?: (row: { name: string }) => void }) => void
}
const { useAddChild, useRelinkChild } = vi.hoisted(() => ({
  useAddChild: vi.fn<() => Mutation>(),
  useRelinkChild: vi.fn<() => Mutation>(),
}))
vi.mock('./useFamilyActions', () => ({ useAddChild, useRelinkChild }))

const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>() })
const existing: FamilyMember[] = [{
  id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1',
  consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z', created_at: '2026-10-05T00:00:00Z',
}]

function renderForm(existingChildren: FamilyMember[] = []) {
  const onDone = vi.fn<(m: string) => void>()
  const onCancel = vi.fn<() => void>()
  render(<AddChildForm existingChildren={existingChildren} onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel }
}

describe('AddChildForm · 새 자녀', () => {
  it('동의 전에는 연결 버튼이 잠긴다', () => {
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(idle())
    renderForm()
    expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
    expect(screen.getByText(/보호자로서 동의합니다/)).toBeInTheDocument()
  })

  it('이름·코드·동의로 add 를 부르고, 성공하면 onDone', async () => {
    const add = idle()
    add.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.({ name: '서연' }))
    useAddChild.mockReturnValue(add)
    useRelinkChild.mockReturnValue(idle())
    const { onDone } = renderForm()
    await userEvent.type(screen.getByLabelText('자녀 이름'), '서연')
    await userEvent.type(screen.getByLabelText('자녀 폰에 뜬 코드'), '4829 1357')
    await userEvent.click(screen.getByLabelText(/법정대리인 동의/))
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(add.mutate).toHaveBeenCalledWith({ name: '서연', code: '48291357' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('서연 님을 연결했어요')
  })

  it('코드가 틀리면 서버를 부르지 않고 칸에 오류', async () => {
    const add = idle()
    useAddChild.mockReturnValue(add)
    useRelinkChild.mockReturnValue(idle())
    renderForm()
    await userEvent.type(screen.getByLabelText('자녀 이름'), '서연')
    await userEvent.type(screen.getByLabelText('자녀 폰에 뜬 코드'), '12')
    await userEvent.click(screen.getByLabelText(/법정대리인 동의/))
    await userEvent.click(screen.getByRole('button', { name: '연결하기' }))
    expect(add.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('8자리 숫자 코드를 입력해 주세요')
  })

  it('서버 오류 문구를 보여 준다', () => {
    useAddChild.mockReturnValue({ ...idle(), isError: true, error: new Error('invalid_code') })
    useRelinkChild.mockReturnValue(idle())
    renderForm()
    expect(screen.getByRole('alert')).toHaveTextContent('코드가 맞지 않거나 만료되었어요')
  })

  it('취소 버튼은 onCancel', async () => {
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(idle())
    const { onCancel } = renderForm()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('AddChildForm · 기존 자녀 재연결', () => {
  it('자녀가 있으면 고를 수 있고, 고르면 이름·동의 없이 코드만으로 relink', async () => {
    const relink = idle()
    relink.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.({ name: '서연' }))
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(relink)
    const { onDone } = renderForm(existing)
    await userEvent.selectOptions(screen.getByLabelText('자녀'), 'p2')
    expect(screen.queryByLabelText('자녀 이름')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/법정대리인 동의/)).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('자녀 폰에 뜬 코드'), '11111111')
    await userEvent.click(screen.getByRole('button', { name: '다시 연결하기' }))
    expect(relink.mutate).toHaveBeenCalledWith({ childId: 'p2', code: '11111111' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('서연 님을 다시 연결했어요')
  })

  it('자녀가 없으면 고르는 칸이 없다', () => {
    useAddChild.mockReturnValue(idle())
    useRelinkChild.mockReturnValue(idle())
    renderForm([])
    expect(screen.queryByLabelText('자녀')).not.toBeInTheDocument()
  })
})
```

`src/pages/FamilyPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Person } from '../features/auth/usePerson'
import type { FamilyMember } from '../features/family/useFamilyMembers'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'
import { FamilyPage } from './FamilyPage'

type Query = { status: 'pending' | 'error' | 'success'; data?: FamilyMember[]; refetch: () => void }
type Mutation = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => void }
const { useCurrentPerson, useAuth, usePerson, useFamilyMembers, useLeaveFamily, useRemoveChild } = vi.hoisted(() => ({
  useCurrentPerson: vi.fn<() => Person>(),
  useAuth: vi.fn<() => { status: 'ready'; session: { user: { id: string } } }>(),
  usePerson: vi.fn<(userId: string | undefined, options?: { refetchInterval?: number | false }) => unknown>(),
  useFamilyMembers: vi.fn<() => Query>(),
  useLeaveFamily: vi.fn<() => Mutation>(),
  useRemoveChild: vi.fn<() => Mutation>(),
}))
vi.mock('../features/auth/usePerson', () => ({ useCurrentPerson, usePerson }))
vi.mock('../features/auth/AuthProvider', () => ({ useAuth }))
vi.mock('../features/family/useFamilyMembers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/family/useFamilyMembers')>()),
  useFamilyMembers,
}))
vi.mock('../features/family/useFamilyActions', () => ({ useLeaveFamily, useRemoveChild }))
vi.mock('../features/family/AddChildForm', () => ({
  AddChildForm: ({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) => (
    <div>
      <p>자녀 추가 폼</p>
      <button type="button" onClick={() => onDone('서연 님을 연결했어요')}>폼성공</button>
      <button type="button" onClick={onCancel}>폼취소</button>
    </div>
  ),
}))

const me = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const rows: FamilyMember[] = [
  { id: 'p1', name: '김철수', phone: '01012345678', is_minor: false, guardian_id: null, auth_user_id: 'u1', consented_at: '2026-10-07T00:00:00Z', guardian_consented_at: null, created_at: '2026-10-07T00:00:00Z' },
  { id: 'p2', name: '서연', phone: null, is_minor: true, guardian_id: 'p1', auth_user_id: 'k1', consented_at: null, guardian_consented_at: '2026-10-05T00:00:00Z', created_at: '2026-10-08T00:00:00Z' },
]
const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>() })

function renderPage() {
  return render(<MemoryRouter><FamilyPage /></MemoryRouter>)
}

beforeEach(() => {
  useCurrentPerson.mockReturnValue(me)
  useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
  usePerson.mockReturnValue({ status: 'success', data: me })
  useFamilyMembers.mockReturnValue({ status: 'success', data: rows, refetch: () => {} })
  useLeaveFamily.mockReturnValue(idle())
  useRemoveChild.mockReturnValue(idle())
})

describe('FamilyPage', () => {
  it('머리말에 구성원 수, 목록, 두 개의 추가 버튼', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '가족' })).toBeInTheDocument()
    expect(screen.getByText('우리 가족 · 2명')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '가족 구성원' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 자녀 추가' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /가족 연결/ })).toBeInTheDocument()
    expect(useFamilyMembers).toHaveBeenCalledWith('f1')
    // 코드를 보여 주는 중이 아니면 내 사람 행을 폴링하지 않는다
    expect(usePerson).toHaveBeenCalledWith('u1', { refetchInterval: false })
  })

  it('"+ 자녀 추가" 를 누르면 폼이 열리고, 성공하면 닫히며 안내가 뜬다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '+ 자녀 추가' }))
    expect(screen.getByText('자녀 추가 폼')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ 자녀 추가' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '폼성공' }))
    expect(screen.queryByText('자녀 추가 폼')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('서연 님을 연결했어요')
  })

  it('자녀 삭제 확인 → remove_child 뮤테이션', async () => {
    const remove = idle()
    remove.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useRemoveChild.mockReturnValue(remove)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '자녀 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(remove.mutate).toHaveBeenCalledWith('p2', expect.anything())
    expect(screen.getByRole('status')).toHaveTextContent('서연 을(를) 삭제했어요')
  })

  it('뮤테이션 오류 문구', () => {
    useRemoveChild.mockReturnValue({ ...idle(), isError: true, error: new Error('child_not_found') })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('자녀를 찾을 수 없어요')
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useFamilyMembers.mockReturnValue({ status: 'pending', refetch: () => {} })
    const { rerender } = renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
    const refetch = vi.fn<() => void>()
    useFamilyMembers.mockReturnValue({ status: 'error', refetch })
    rerender(<MemoryRouter><FamilyPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('PAIR_POLL_MS 는 연결 코드 화면과 같은 값', () => {
    expect(PAIR_POLL_MS).toBe(3_000)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/features/family src/pages/FamilyPage`
Expected: 모듈 없음.

- [ ] **Step 3: 구현**

`src/features/family/MemberList.tsx`:

```tsx
import type { ReactNode } from 'react'
import { ConfirmButton } from '../../components/ConfirmButton'
import { formatDate } from '../../lib/dates'
import { maskPhone } from '../../lib/phone'
import type { Person } from '../auth/usePerson'
import { canLeaveFamily, type FamilyMember } from './useFamilyMembers'

type Props = {
  members: readonly FamilyMember[]
  me: Pick<Person, 'id'>
  pending: boolean
  onLeave: () => void
  onRemoveChild: (child: FamilyMember) => void
}

/** 구성원 한 줄: 이름·태그(나/자녀/미가입)·가려진 번호·동의 날짜. 내 행엔 "가족 나가기", 내 자녀 행엔 "자녀 삭제". */
export function MemberList({ members, me, pending, onLeave, onRemoveChild }: Props) {
  const canLeave = canLeaveFamily(members, me.id)
  return (
    <ul aria-label="가족 구성원" className="flex flex-col gap-2">
      {members.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm font-bold">
              <span className="truncate">{m.name}</span>
              {m.id === me.id && <Tag>나</Tag>}
              {m.is_minor && <Tag>자녀</Tag>}
              {!m.is_minor && !m.auth_user_id && <Tag>미가입</Tag>}
            </div>
            <div className="text-xs text-gray-500">{detailOf(m)}</div>
          </div>
          {m.id === me.id && canLeave && (
            <ConfirmButton
              label={pending ? '처리 중…' : '가족 나가기'}
              message="나와 내 자녀만 새 가족이 돼요. 남은 식권과 지금까지의 발급·사용 내역은 이 가족에 남아요."
              confirmLabel="나가기"
              onConfirm={onLeave}
              disabled={pending}
            />
          )}
          {m.is_minor && m.guardian_id === me.id && (
            <ConfirmButton
              label={pending ? '처리 중…' : '자녀 삭제'}
              message={`${m.name} 의 이름을 지우고 연결을 끊어요. 되돌릴 수 없어요.`}
              confirmLabel="삭제"
              onConfirm={() => onRemoveChild(m)}
              disabled={pending}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/** 자녀: 보호자 동의 날짜. 어른: 가려진 번호 · 동의 날짜(미가입이면 번호만). */
function detailOf(m: FamilyMember): string {
  if (m.is_minor) return m.guardian_consented_at ? `보호자 동의 ${formatDate(m.guardian_consented_at)}` : ''
  return [maskPhone(m.phone), m.consented_at ? `동의 ${formatDate(m.consented_at)}` : null].filter(Boolean).join(' · ')
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{children}</span>
}
```

`src/features/family/AddChildForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Button, Checkbox, TextField } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { validateAddChild, validateRelink } from './familySchema'
import { useAddChild, useRelinkChild } from './useFamilyActions'
import type { FamilyMember } from './useFamilyMembers'

type Props = {
  /** 내 자녀들. 고르면 "다시 연결" 모드. (React 의 children 과 섞이지 않게 이름을 따로 둔다) */
  existingChildren: readonly FamilyMember[]
  onDone: (message: string) => void
  onCancel: () => void
}
type FormErrors = Partial<Record<'name' | 'code' | 'consent' | 'childId', string>>

const GUARDIAN_CONSENT_TEXT = '만 14세 미만 자녀의 이름을 식권 사용 확인 목적으로 처리하는 데 보호자로서 동의합니다. 자녀 삭제 시 즉시 파기됩니다.'

/** 자녀 추가(이름·코드·법정대리인 동의) 또는 기존 자녀 재연결(코드만). 동의 체크가 법정대리인 동의 기록이 된다 (설계 §10). */
export function AddChildForm({ existingChildren: existing, onDone, onCancel }: Props) {
  const addChild = useAddChild()
  const relink = useRelinkChild()
  const [childId, setChildId] = useState('') // '' = 새 자녀
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const relinking = childId !== ''
  const pending = addChild.isPending || relink.isPending
  const serverError = addChild.isError ? toUserMessage(addChild.error) : relink.isError ? toUserMessage(relink.error) : null

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (relinking) {
      const result = validateRelink({ childId, code })
      if (!result.ok) return setErrors(result.errors)
      setErrors({})
      relink.mutate(result.values, { onSuccess: (row) => onDone(`${row.name} 님을 다시 연결했어요`) })
    } else {
      const result = validateAddChild({ name, code, consent })
      if (!result.ok) return setErrors(result.errors)
      setErrors({})
      addChild.mutate({ name: result.values.name, code: result.values.code }, { onSuccess: (row) => onDone(`${row.name} 님을 연결했어요`) })
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">자녀 추가</h2>
      {existing.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">자녀</span>
          <select
            value={childId}
            onChange={(e) => {
              setChildId(e.target.value)
              setErrors({})
            }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base"
          >
            <option value="">새 자녀 추가</option>
            {existing.map((c) => (
              <option key={c.id} value={c.id}>{c.name} (다른 폰으로 다시 연결)</option>
            ))}
          </select>
        </label>
      )}
      {!relinking && (
        <TextField label="자녀 이름" name="child-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} error={errors.name} />
      )}
      <TextField
        label="자녀 폰에 뜬 코드"
        name="child-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="8자리 숫자"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={9}
        error={errors.code}
      />
      {!relinking && (
        <section className="rounded-xl border border-gray-200 p-3 text-xs leading-relaxed">
          <Checkbox id="guardian-consent" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)}>
            <strong>[필수] 법정대리인 동의</strong>
          </Checkbox>
          <p className="mt-1 pl-6 text-gray-600">{GUARDIAN_CONSENT_TEXT}</p>
          {errors.consent && <p role="alert" className="mt-1 pl-6 text-red-600">{errors.consent}</p>}
        </section>
      )}
      {serverError && <p role="alert" className="text-sm text-red-600">{serverError}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>취소</Button>
        <Button type="submit" disabled={pending || (!relinking && !consent)}>
          {pending ? '연결 중…' : relinking ? '다시 연결하기' : '연결하기'}
        </Button>
      </div>
      <p className="text-center text-xs text-gray-500">폰을 바꾼 자녀는 위에서 이름을 고르면 다시 연결돼요</p>
    </form>
  )
}
```

`src/pages/FamilyPage.tsx` (이번 Task 에서는 자녀 추가 패널까지. 가족 연결·내 정보는 Task 12 에서 붙인다):

```tsx
import { useState } from 'react'
import { Button, Spinner } from '../components/ui'
import { useAuth } from '../features/auth/AuthProvider'
import { useCurrentPerson, usePerson } from '../features/auth/usePerson'
import { AddChildForm } from '../features/family/AddChildForm'
import { MemberList } from '../features/family/MemberList'
import { useLeaveFamily, useRemoveChild } from '../features/family/useFamilyActions'
import { useFamilyMembers } from '../features/family/useFamilyMembers'
import { PAIR_POLL_MS } from '../features/pairing/usePairingCode'
import { toUserMessage } from '../lib/errors'

type Panel = 'none' | 'child' | 'join'

/** `#/family` — 어른만 (RequireAdult). 구성원 목록 + 자녀 추가 + 가족 연결 + 내 정보. */
export function FamilyPage() {
  const me = useCurrentPerson()
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const members = useFamilyMembers(me.family_id)
  const [panel, setPanel] = useState<Panel>('none')
  const [notice, setNotice] = useState<string | null>(null)
  const leave = useLeaveFamily()
  const remove = useRemoveChild()
  // 내 코드를 보여 주는 동안(가족 연결 패널)은 배우자가 나를 자기 가족으로 합칠 수 있다 → 내 사람 행(family_id)을 폴링한다
  usePerson(userId, { refetchInterval: panel === 'join' ? PAIR_POLL_MS : false })
  const actionError = leave.isError ? toUserMessage(leave.error) : remove.isError ? toUserMessage(remove.error) : null
  const myChildren = (members.data ?? []).filter((m) => m.is_minor && m.guardian_id === me.id)

  function done(message: string) {
    setNotice(message)
    setPanel('none')
  }
  function open(next: Panel) {
    setNotice(null)
    setPanel(next)
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">가족</h1>
        {members.data && <p className="text-xs text-gray-500">우리 가족 · {members.data.length}명</p>}
      </header>
      {notice && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</p>}

      {/* status 가 아니라 data 로 분기한다 (공통 규약) */}
      {members.data ? (
        <>
          {members.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 정보를 받지 못했어요</p>}
          <MemberList
            members={members.data}
            me={me}
            pending={leave.isPending || remove.isPending}
            onLeave={() => leave.mutate(undefined, { onSuccess: () => done('새 가족이 되었어요') })}
            onRemoveChild={(c) => remove.mutate(c.id, { onSuccess: () => done(`${c.name} 을(를) 삭제했어요`) })}
          />
          {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
          {panel === 'none' && (
            <div className="flex flex-col gap-2">
              <Button variant="ghost" onClick={() => open('child')}>+ 자녀 추가</Button>
              <Button variant="ghost" onClick={() => open('join')}>+ 가족 연결 (배우자 등)</Button>
            </div>
          )}
          {panel === 'child' && <AddChildForm existingChildren={myChildren} onDone={done} onCancel={() => setPanel('none')} />}
          {panel === 'join' && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
              가족 연결은 다음 작업에서 붙는다
              <Button variant="ghost" className="mt-2" onClick={() => setPanel('none')}>닫기</Button>
            </section>
          )}
        </>
      ) : members.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          가족을 불러오지 못했어요
          <button type="button" onClick={() => void members.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}
```

`src/App.tsx` — `RequirePerson` 아래에:

```tsx
import { RequireAdult } from './features/auth/Gate'   // 기존 import 줄에 합친다
import { FamilyPage } from './pages/FamilyPage'
// …
              <Route path="/family" element={<RequireAdult><FamilyPage /></RequireAdult>} />
```

- [ ] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b`
Expected: 전부 통과.

- [ ] **Step 5: 수동 확인 (로컬, 두 브라우저 창)**

Run: `npm run dev`. 창 A: 개발 로그인 `e2e-admin@test.local` → 가족 탭. 창 B(시크릿): "아이 계정으로 시작하기" → 코드. 창 A: + 자녀 추가 → 이름·코드·동의 → 연결하기 → 목록에 자녀. 창 B: 3초 안에 홈으로 바뀌고 머리말 "우리 가족 식권 · 2명".

- [ ] **Step 6: 커밋**

```bash
git add src/features/family/MemberList.tsx src/features/family/MemberList.test.tsx src/features/family/AddChildForm.tsx src/features/family/AddChildForm.test.tsx src/pages/FamilyPage.tsx src/pages/FamilyPage.test.tsx src/App.tsx
git commit -m "feat: 가족 탭(#/family) — 구성원 목록, 자녀 추가·재연결, 가족 나가기·자녀 삭제

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 가족 화면 ② — `JoinFamilyPanel`(코드 입력 / 내 코드) · `ProfileSection`(내 정보 수정 · 탈퇴)

**Files:**
- Create: `src/features/family/JoinFamilyPanel.tsx`, `src/features/family/JoinFamilyPanel.test.tsx`
- Create: `src/features/family/ProfileSection.tsx`, `src/features/family/ProfileSection.test.tsx`
- Modify: `src/pages/FamilyPage.tsx`, `src/pages/FamilyPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트**

`src/features/family/JoinFamilyPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JoinFamilyPanel } from './JoinFamilyPanel'

type Mutation = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars: unknown, opts?: { onSuccess?: (row: { name: string }) => void }) => void }
const { useJoinFamily } = vi.hoisted(() => ({ useJoinFamily: vi.fn<() => Mutation>() }))
vi.mock('./useFamilyActions', () => ({ useJoinFamily }))
vi.mock('../pairing/PairingCodeCard', () => ({ PairingCodeCard: ({ kind, hint }: { kind: string; hint: string }) => <p>card:{kind}:{hint}</p> }))

const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>() })

function renderPanel() {
  const onDone = vi.fn<(m: string) => void>()
  const onCancel = vi.fn<() => void>()
  render(<JoinFamilyPanel onDone={onDone} onCancel={onCancel} />)
  return { onDone, onCancel }
}

describe('JoinFamilyPanel', () => {
  it('기본은 상대 코드 입력 — 8자리를 넣으면 add_family_member, 성공하면 onDone', async () => {
    const join = idle()
    join.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.({ name: '이영희' }))
    useJoinFamily.mockReturnValue(join)
    const { onDone } = renderPanel()
    expect(screen.getByRole('radio', { name: '상대 코드 입력' })).toBeChecked()
    await userEvent.type(screen.getByLabelText('상대 폰에 뜬 코드'), '0000 1111')
    await userEvent.click(screen.getByRole('button', { name: '우리 가족으로 연결' }))
    expect(join.mutate).toHaveBeenCalledWith({ code: '00001111' }, expect.anything())
    expect(onDone).toHaveBeenCalledWith('이영희 님이 우리 가족이 되었어요')
  })

  it('코드가 틀리면 칸에 오류, 서버 오류는 문구', async () => {
    useJoinFamily.mockReturnValue({ ...idle(), isError: true, error: new Error('invalid_code') })
    renderPanel()
    await userEvent.type(screen.getByLabelText('상대 폰에 뜬 코드'), '1')
    await userEvent.click(screen.getByRole('button', { name: '우리 가족으로 연결' }))
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toEqual(expect.arrayContaining([expect.stringContaining('8자리 숫자'), expect.stringContaining('코드가 맞지 않거나')]))
  })

  it('"내 코드 보여 주기" 로 바꾸면 어른 코드 카드', async () => {
    useJoinFamily.mockReturnValue(idle())
    const { onCancel } = renderPanel()
    await userEvent.click(screen.getByRole('radio', { name: '내 코드 보여 주기' }))
    expect(screen.getByText(/card:adult:/)).toBeInTheDocument()
    expect(screen.queryByLabelText('상대 폰에 뜬 코드')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
```

`src/features/family/ProfileSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Person } from '../auth/usePerson'
import { ProfileSection } from './ProfileSection'

type Mutation = { isPending: boolean; isError: boolean; error?: Error; mutate: (vars?: unknown, opts?: { onSuccess?: () => void }) => void; reset: () => void }
const { useUpdateProfile, useDeleteAccount } = vi.hoisted(() => ({
  useUpdateProfile: vi.fn<() => Mutation>(),
  useDeleteAccount: vi.fn<() => Mutation>(),
}))
vi.mock('./useFamilyActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useFamilyActions')>()),
  useUpdateProfile,
  useDeleteAccount,
}))

const me = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person
const idle = (): Mutation => ({ isPending: false, isError: false, mutate: vi.fn<Mutation['mutate']>(), reset: vi.fn<() => void>() })

describe('ProfileSection', () => {
  beforeEach(() => {
    useUpdateProfile.mockReturnValue(idle())
    useDeleteAccount.mockReturnValue(idle())
  })

  it('이름·가려진 번호와 수정·탈퇴 버튼', () => {
    render(<ProfileSection me={me} />)
    expect(screen.getByText('김철수 · 010-****-5678')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수정' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '탈퇴' })).toBeInTheDocument()
  })

  it('수정 → 폼(현재 값 채워짐) → 저장하면 update, 성공하면 닫힌다', async () => {
    const update = idle()
    update.mutate = vi.fn<Mutation['mutate']>((_vars, opts) => opts?.onSuccess?.())
    useUpdateProfile.mockReturnValue(update)
    render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
    expect(screen.getByLabelText('휴대폰 번호')).toHaveValue('010-1234-5678')
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-9999-8888')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).toHaveBeenCalledWith({ name: '김철수', phone: '01099998888' }, expect.anything())
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
  })

  it('틀린 번호는 서버를 부르지 않고 칸에 오류, 취소하면 원래 값으로', async () => {
    const update = idle()
    useUpdateProfile.mockReturnValue(update)
    render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    await userEvent.clear(screen.getByLabelText('휴대폰 번호'))
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(update.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByText('김철수 · 010-****-5678')).toBeInTheDocument()
    expect(update.reset).toHaveBeenCalled()
  })

  it('번호 중복(23505) 서버 오류 문구', async () => {
    useUpdateProfile.mockReturnValue({ ...idle(), isError: true, error: Object.assign(new Error('duplicate'), { code: '23505' }) })
    render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByRole('alert')).toHaveTextContent('이미 다른 분이 쓰는 번호예요')
  })

  it('탈퇴는 확인을 거쳐 delete_my_account, has_children 이면 문구', async () => {
    const del = idle()
    useDeleteAccount.mockReturnValue(del)
    const { rerender } = render(<ProfileSection me={me} />)
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    expect(screen.getByRole('status')).toHaveTextContent('익명 처리')
    await userEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))
    expect(del.mutate).toHaveBeenCalledOnce()
    useDeleteAccount.mockReturnValue({ ...idle(), isError: true, error: new Error('has_children') })
    rerender(<ProfileSection me={me} />)
    expect(screen.getByRole('alert')).toHaveTextContent('자녀를 먼저 삭제해 주세요')
  })
})
```

`src/pages/FamilyPage.test.tsx` 에 추가 (목 추가: `JoinFamilyPanel`, `ProfileSection`):

```tsx
vi.mock('../features/family/JoinFamilyPanel', () => ({
  JoinFamilyPanel: ({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) => (
    <div>
      <p>가족 연결 패널</p>
      <button type="button" onClick={() => onDone('이영희 님이 우리 가족이 되었어요')}>연결성공</button>
      <button type="button" onClick={onCancel}>연결취소</button>
    </div>
  ),
}))
vi.mock('../features/family/ProfileSection', () => ({ ProfileSection: () => <p>내 정보 구역</p> }))

  it('"+ 가족 연결" 패널이 열리면 내 사람 행을 3초마다 확인한다 (상대가 나를 합칠 수 있다)', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /가족 연결/ }))
    expect(screen.getByText('가족 연결 패널')).toBeInTheDocument()
    expect(usePerson).toHaveBeenLastCalledWith('u1', { refetchInterval: PAIR_POLL_MS })
    await userEvent.click(screen.getByRole('button', { name: '연결성공' }))
    expect(screen.getByRole('status')).toHaveTextContent('이영희 님이 우리 가족이 되었어요')
    expect(usePerson).toHaveBeenLastCalledWith('u1', { refetchInterval: false })
  })

  it('내 코드를 보여 주는 동안 가족이 바뀌면(상대가 나를 합침) 패널을 닫고 알린다', async () => {
    const utils = renderPage()
    await userEvent.click(screen.getByRole('button', { name: /가족 연결/ }))
    expect(screen.getByText('가족 연결 패널')).toBeInTheDocument()
    // 폴링으로 내 사람 행의 family_id 가 바뀌어 다시 그려진 상황
    useCurrentPerson.mockReturnValue({ ...me, family_id: 'f2' })
    utils.rerender(<MemoryRouter><FamilyPage /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('가족이 연결되었어요')
    expect(screen.queryByText('가족 연결 패널')).not.toBeInTheDocument()
    expect(useFamilyMembers).toHaveBeenLastCalledWith('f2')
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 자녀 추가' })).toBeInTheDocument()
  })

  it('내 정보 구역이 맨 아래에 있다', () => {
    renderPage()
    expect(screen.getByText('내 정보 구역')).toBeInTheDocument()
  })
```

(`renderPage` 가 `render(...)` 의 결과를 돌려주도록 두었으므로 `utils.rerender` 를 그대로 쓸 수 있다.)

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/features/family src/pages/FamilyPage`
Expected: `JoinFamilyPanel`·`ProfileSection` 없음, FamilyPage 가족 연결 동작 없음.

- [ ] **Step 3: 구현**

`src/features/family/JoinFamilyPanel.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Button, TextField } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { PairingCodeCard } from '../pairing/PairingCodeCard'
import { validateJoin } from './familySchema'
import { useJoinFamily } from './useFamilyActions'

type Props = { onDone: (message: string) => void; onCancel: () => void }
type Mode = 'enter' | 'show'

const ENTER_HINT = '상대 폰의 가족 › 가족 연결 › 내 코드 보여 주기에 뜬 숫자를 넣으면, 그분이 우리 가족으로 들어와요. 그분 가족에 남은 사람이 없으면 식권도 함께 옮겨 와요.'
const SHOW_HINT = '상대 폰의 가족 › 가족 연결 › 상대 코드 입력에 이 숫자를 넣으면 내가 그 가족으로 들어가요. 우리 가족에 나뿐이면 내 식권도 함께 옮겨 가요.'

/** 어른끼리 가족 합치기. 코드를 "넣는" 쪽 가족이 남고, "보여 주는" 쪽이 그리로 옮겨 간다 (설계 §5.1 준비 3). */
export function JoinFamilyPanel({ onDone, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>('enter')
  const join = useJoinFamily()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>()

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateJoin({ code })
    if (!result.ok) return setError(result.errors.code)
    setError(undefined)
    join.mutate(result.values, { onSuccess: (row) => onDone(`${row.name} 님이 우리 가족이 되었어요`) })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-blue-600 bg-white p-4">
      <h2 className="font-bold">가족 연결</h2>
      <SegmentedControl
        label="연결 방법"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'enter', label: '상대 코드 입력' },
          { value: 'show', label: '내 코드 보여 주기' },
        ]}
      />
      {mode === 'enter' ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-gray-600">{ENTER_HINT}</p>
          <TextField
            label="상대 폰에 뜬 코드"
            name="join-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="8자리 숫자"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={9}
            error={error}
          />
          {join.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(join.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={join.isPending}>취소</Button>
            <Button type="submit" disabled={join.isPending}>{join.isPending ? '연결 중…' : '우리 가족으로 연결'}</Button>
          </div>
        </form>
      ) : (
        <>
          <PairingCodeCard kind="adult" hint={SHOW_HINT} />
          <Button variant="ghost" onClick={onCancel}>닫기</Button>
        </>
      )}
    </section>
  )
}
```

`src/features/family/ProfileSection.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { ConfirmButton } from '../../components/ConfirmButton'
import { Button, TextField } from '../../components/ui'
import { toUserMessage } from '../../lib/errors'
import { formatPhone, maskPhone } from '../../lib/phone'
import type { FieldErrors } from '../../lib/validate'
import type { Person } from '../auth/usePerson'
import { validateProfile, type ProfileInput } from './familySchema'
import { profileErrorMessage, useDeleteAccount, useUpdateProfile } from './useFamilyActions'

const DELETE_NOTICE = '이름·번호는 익명 처리되고 식권 기록은 익명으로 남아요. 자녀가 있으면 먼저 삭제해 주세요. 정말 탈퇴할까요?'

/** 가족 탭 맨 아래: 내 정보 수정(이름·번호) · 탈퇴 (설계 §8.2). 번호는 인증된 값이 아니라 본인이 고칠 수 있다. */
export function ProfileSection({ me }: { me: Person }) {
  const update = useUpdateProfile(me)
  const del = useDeleteAccount()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(me.name)
  const [phone, setPhone] = useState(formatPhone(me.phone ?? ''))
  const [errors, setErrors] = useState<FieldErrors<ProfileInput>>({})

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateProfile({ name, phone })
    if (!result.ok) return setErrors(result.errors)
    setErrors({})
    update.mutate(result.values, { onSuccess: () => setEditing(false) })
  }
  function cancel() {
    setEditing(false)
    setName(me.name)
    setPhone(formatPhone(me.phone ?? ''))
    setErrors({})
    update.reset()
  }

  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4">
      <h2 className="text-xs font-bold text-gray-500">내 정보</h2>
      {editing ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <TextField label="이름" name="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} error={errors.name} />
          <TextField label="휴대폰 번호" name="profile-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
          {update.isError && <p role="alert" className="text-sm text-red-600">{profileErrorMessage(update.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={cancel} disabled={update.isPending}>취소</Button>
            <Button type="submit" disabled={update.isPending}>{update.isPending ? '저장 중…' : '저장'}</Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between text-sm">
          <span>{me.name} · {maskPhone(me.phone)}</span>
          <button type="button" onClick={() => setEditing(true)} className="px-3 py-2 text-xs text-blue-600 underline">수정</button>
        </div>
      )}
      <div className="flex flex-col items-end gap-1">
        <ConfirmButton label={del.isPending ? '처리 중…' : '탈퇴'} message={DELETE_NOTICE} confirmLabel="탈퇴하기" onConfirm={() => del.mutate()} disabled={del.isPending} />
        {del.isError && <p role="alert" className="text-sm text-red-600">{toUserMessage(del.error)}</p>}
      </div>
    </section>
  )
}
```

`src/pages/FamilyPage.tsx` — Task 11 의 임시 `join` 구역을 실제 패널로 바꾸고, 합류 감지와 내 정보 구역을 붙인다. 바뀌는 부분만:

```tsx
import { JoinFamilyPanel } from '../features/family/JoinFamilyPanel'
import { ProfileSection } from '../features/family/ProfileSection'
// …
  const [panel, setPanel] = useState<Panel>('none')
  // 패널을 연 순간의 가족. 내 코드를 보여 주는 동안 상대가 나를 합치면 me.family_id 가 바뀐다 (폴링) → 렌더에서 알아챈다.
  const [familyAtOpen, setFamilyAtOpen] = useState<string | null>(null)
  const joined = panel === 'join' && familyAtOpen !== null && familyAtOpen !== me.family_id
  // …
  function open(next: Panel) {
    setNotice(null)
    setFamilyAtOpen(next === 'join' ? me.family_id : null)
    setPanel(next)
  }
  // JSX: 머리말 아래 notice 다음에
      {joined && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
          가족이 연결되었어요
          <button type="button" onClick={() => setPanel('none')} className="ml-2 underline">닫기</button>
        </p>
      )}
  // 임시 join 구역을 교체
          {panel === 'join' && !joined && <JoinFamilyPanel onDone={done} onCancel={() => setPanel('none')} />}
  // </main> 바로 앞 (조회 분기 바깥)
      <ProfileSection me={me} />
```

(`joined` 가 true 인 동안은 패널을 그리지 않는다. 닫기를 누르면 `panel` 이 `none` 이 되어 `joined` 도 false 로 돌아간다 — `useEffect` 로 상태를 맞추지 않고 렌더에서 계산한다.)

- [ ] **Step 4: 통과 확인**

Run: `npm test && npm run lint && npx tsc -b && npm run build`
Expected: 전부 통과.

- [ ] **Step 5: 수동 확인 (로컬, 두 창)**

창 A 관리자, 창 B 다른 개발 로그인(새 이메일 → 가입). 창 B 가족 › 가족 연결 › 내 코드 보여 주기. 창 A 가족 › 가족 연결 › 상대 코드 입력 → "○○ 님이 우리 가족이 되었어요". 창 B 는 3초 안에 "가족이 연결되었어요", 구성원 목록에 둘. 창 B 내 정보 수정으로 번호를 바꾸면 홈 머리말의 번호도 바뀐다.

- [ ] **Step 6: 커밋**

```bash
git add src/features/family/JoinFamilyPanel.tsx src/features/family/JoinFamilyPanel.test.tsx src/features/family/ProfileSection.tsx src/features/family/ProfileSection.test.tsx src/pages/FamilyPage.tsx src/pages/FamilyPage.test.tsx
git commit -m "feat: 가족 연결(코드 입력·내 코드), 합류 감지, 내 정보 수정·탈퇴

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 13: E2E — 아이 익명 시작 → 코드 → 보호자 자녀 추가 → 아이 폰 가족 잔량 → 아이 폰에서 사용

**Files:**
- Create: `e2e/helpers.ts`
- Create: `e2e/family.spec.ts`
- Modify: `e2e/tickets.spec.ts` (헬퍼 사용으로 정리 — 동작 동일)

- [ ] **Step 1: 공통 헬퍼 — `e2e/helpers.ts`**

```ts
import { expect, type Page } from '@playwright/test'

// supabase/seeds/010_e2e_admin.sql — 'admin@test.local' 은 pgTAP 030 이 임시 사용자로 쓰므로 e2e- 접두어
export const ADMIN = { email: 'e2e-admin@test.local', password: 'password123' }

/** people_phone_unique 와 충돌하지 않는 9자리: 시간(5) + 난수(4). '01' + 9자리 = is_valid_mobile 통과 */
export function uniqueDigits(): string {
  return Date.now().toString().slice(-5) + String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
}

export async function devLogin(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '개발용 로그인' }).click()
}

export async function logout(page: Page) {
  await page.getByRole('link', { name: '내 식권' }).click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
}

/** 식권 한 장을 꾹 누른다. hover 가 스크롤·안정화·덮인 요소 없음까지 확인해 준다. mouse 는 pointer 이벤트도 함께 낸다. */
export async function hold(page: Page, name: string, ms: number) {
  const button = page.getByRole('button', { name })
  await button.hover()
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

type IssueArgs = { mealTitle: string; mealLabel: string; name: string; phone: string }

/** 관리자로 로그인해 오늘 식사를 만들고, "새로 등록" 한 사람에게 5,000원 × 2장을 발급한 뒤 로그아웃한다. */
export async function adminCreateTodayMealAndIssueTwo(page: Page, { mealTitle, mealLabel, name, phone }: IssueArgs) {
  await devLogin(page, ADMIN.email, ADMIN.password)
  await expect(page.getByRole('heading', { name: '권사 님' })).toBeVisible()
  await page.getByRole('link', { name: '관리' }).click()
  await page.getByRole('button', { name: '+ 식사 직접 추가' }).click()
  await page.getByLabel('식사 이름').fill(mealTitle)
  await page.getByRole('button', { name: '식사 추가' }).click() // 날짜 기본값은 오늘
  await expect(page.getByRole('article', { name: new RegExp(mealTitle) })).toBeVisible()

  await page.getByRole('link', { name: '발급' }).click()
  await page.getByRole('button', { name: '변경' }).click()
  await page.getByRole('button', { name: mealLabel, exact: true }).click()
  await page.getByRole('button', { name: '+ 새로 등록' }).click()
  // "이름" 은 검색창 레이블("이름 또는 번호 뒷자리")의 부분 문자열 — exact 로 좁힌다
  await page.getByLabel('이름', { exact: true }).fill(name)
  await page.getByLabel('휴대폰 번호').fill(phone)
  await page.getByRole('button', { name: '등록하고 선택' }).click()
  await expect(page.getByRole('heading', { name: `${name} 님께 발급` })).toBeVisible()
  await page.getByLabel('단가 (원)').fill('5000')
  await page.getByRole('button', { name: '장수 늘리기' }).click()
  await expect(page.getByText('합계 10,000원')).toBeVisible()
  await page.getByRole('button', { name: '2장 발급하기' }).click()
  await expect(page.getByText(`${name} 님께 2장 발급했어요`)).toBeVisible()
  await logout(page)
}

/** 선발급된 이름·번호로 가입하면 자동 연결된다 (claim_person). 홈까지. */
export async function signUpAsPrepaid(page: Page, { email, name, phone }: { email: string; name: string; phone: string }) {
  await devLogin(page, email, 'password123')
  await expect(page.getByRole('heading', { name: '처음 오셨네요' })).toBeVisible()
  await page.getByLabel('이름').fill(name)
  await page.getByLabel('휴대폰 번호').fill(phone)
  await page.getByLabel(/개인정보 수집·이용 동의/).check()
  await page.getByRole('button', { name: '동의하고 시작하기' }).click()
  await expect(page.getByRole('heading', { name: `${name} 님` })).toBeVisible()
}
```

- [ ] **Step 2: `e2e/tickets.spec.ts` 를 헬퍼로 정리**

파일 상단의 `ADMIN`·`devLogin`·`logout`·`hold` 정의를 지우고 `import { adminCreateTodayMealAndIssueTwo, hold, signUpAsPrepaid, uniqueDigits } from './helpers.ts'` 로 바꾼다. 첫 두 step("관리자: 오늘 식사 만들기", "관리자: 새로 등록한 사람에게 2장 발급")은 한 step 으로:

```ts
  await test.step('관리자: 오늘 식사 + 김철수 2장 발급', async () => {
    await adminCreateTodayMealAndIssueTwo(page, { mealTitle, mealLabel, name: '김철수', phone })
  })

  await test.step('교인: 같은 이름·번호로 가입하면 선발급 식권이 보인다', async () => {
    await signUpAsPrepaid(page, { email: `e2e-${digits}@test.local`, name: '김철수', phone })
    await expect(page.getByRole('heading', { name: mealTitle })).toBeVisible()
    await expect(page.getByText('2장 남음')).toBeVisible()
    await expect(page.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(2)
  })
```

`const digits = uniqueDigits()` 로 바꾼다. 나머지 step 은 그대로.

Run: `npm run e2e -- e2e/tickets.spec.ts`
Expected: 통과 (동작 동일).

- [ ] **Step 3: 가족 E2E — `e2e/family.spec.ts`**

```ts
import { expect, test } from '@playwright/test'
import { formatMealDate, todaySeoul } from '../src/lib/dates.ts'
import { adminCreateTodayMealAndIssueTwo, hold, signUpAsPrepaid, uniqueDigits } from './helpers.ts'

// 두 폰(보호자·아이)을 번갈아 쓰고 폴링(3초·5초)을 기다린다
test.describe.configure({ timeout: 180_000 })

test('아이 익명 시작 → 코드 → 보호자 자녀 추가 → 아이 폰에 가족 잔량 → 아이 폰에서 사용', async ({ browser }, testInfo) => {
  const digits = uniqueDigits()
  const phone = `01${digits}`
  const mealTitle = `E2E 가족 ${digits}`
  const mealLabel = `${formatMealDate(todaySeoul())} · ${mealTitle}`
  // 프로젝트의 use(Pixel 7·baseURL)를 그대로 물려받는 두 개의 독립 컨텍스트 = 두 대의 폰 (localStorage 분리)
  const parentContext = await browser.newContext(testInfo.project.use)
  const childContext = await browser.newContext(testInfo.project.use)
  const parent = await parentContext.newPage()
  const child = await childContext.newPage()
  for (const page of [parent, child]) {
    page.on('pageerror', (e) => {
      throw e
    })
  }
  let code = ''

  try {
    await test.step('관리자: 오늘 식사 + 김철수 2장 발급', async () => {
      await adminCreateTodayMealAndIssueTwo(parent, { mealTitle, mealLabel, name: '김철수', phone })
    })

    await test.step('보호자: 선발급 이름·번호로 가입 → 2장', async () => {
      await signUpAsPrepaid(parent, { email: `e2e-parent-${digits}@test.local`, name: '김철수', phone })
      await expect(parent.getByText('2장 남음')).toBeVisible()
      await expect(parent.getByText('내 식권')).toBeVisible()
    })

    await test.step('아이: 아이 계정으로 시작 → 연결 코드', async () => {
      await child.goto('/')
      await child.getByRole('button', { name: /아이 계정으로 시작하기/ }).click()
      await expect(child.getByRole('heading', { name: '보호자에게 이 코드를 보여 주세요' })).toBeVisible()
      await expect(child.getByText(/남음 · 1회용/)).toBeVisible()
      code = ((await child.getByTestId('pairing-code').textContent()) ?? '').replace(/\D/g, '')
      expect(code).toMatch(/^\d{8}$/)
    })

    await test.step('보호자: 가족 탭 › 자녀 추가', async () => {
      await parent.getByRole('link', { name: '가족' }).click()
      await expect(parent.getByText('우리 가족 · 1명')).toBeVisible()
      await parent.getByRole('button', { name: '+ 자녀 추가' }).click()
      await parent.getByLabel('자녀 이름').fill('서연')
      await parent.getByLabel('자녀 폰에 뜬 코드').fill(code)
      await parent.getByLabel(/법정대리인 동의/).check()
      await parent.getByRole('button', { name: '연결하기' }).click()
      await expect(parent.getByText('서연 님을 연결했어요')).toBeVisible()
      await expect(parent.getByText('우리 가족 · 2명')).toBeVisible()
      const rows = parent.getByRole('list', { name: '가족 구성원' }).getByRole('listitem')
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(1)).toContainText('서연')
      await expect(rows.nth(1)).toContainText('자녀')
    })

    await test.step('아이 폰: 저절로 홈 → 우리 가족 식권 2장, 가족 탭 없음', async () => {
      await expect(child.getByRole('heading', { name: '서연 님' })).toBeVisible({ timeout: 15_000 }) // 3초 폴링
      await expect(child.getByText('우리 가족 식권 · 2명')).toBeVisible()
      await expect(child.getByRole('heading', { name: mealTitle })).toBeVisible()
      await expect(child.getByText('2장 남음')).toBeVisible()
      await expect(child.getByRole('button', { name: /꾹 눌러 사용/ })).toHaveCount(2)
      await expect(child.getByRole('link', { name: '가족' })).toHaveCount(0)
    })

    await test.step('아이 폰에서 1장 사용 → 보호자 폰에도 "서연 폰"', async () => {
      await hold(child, '식권 1번 꾹 눌러 사용하기', 900)
      await expect(child.getByText(/사용 처리되었어요/)).toBeVisible()
      await expect(child.getByText('1장 남음')).toBeVisible()
      await parent.getByRole('link', { name: '식권' }).click()
      await expect(parent.getByText('1장 남음')).toBeVisible({ timeout: 15_000 }) // 5초 폴링
      const items = parent.getByRole('list', { name: '식권 목록' }).getByRole('listitem')
      await expect(items.first()).toContainText('사용 완료')
      await expect(items.first()).toContainText('서연 폰')
    })

    await test.step('아이 폰 로그아웃은 한 번 더 묻는다', async () => {
      await child.getByRole('button', { name: '로그아웃' }).click()
      await expect(child.getByText(/보호자가 새 코드로 다시 연결해야 해요/)).toBeVisible()
      await child.getByRole('button', { name: '취소' }).click()
      await expect(child.getByRole('heading', { name: '서연 님' })).toBeVisible()
    })
  } finally {
    await parentContext.close()
    await childContext.close()
  }
})
```

- [ ] **Step 4: 실행**

Run: `npm run e2e`
Expected: 4개 전부 통과 (`onboarding` 2 + `tickets` 1 + `family` 1), 단일 워커. 실패하면 `npx playwright show-report` 로 트레이스를 본다. 흔한 원인: (1) 로컬 Supabase 의 익명 로그인이 꺼짐 — `supabase/config.toml` 의 `enable_anonymous_sign_ins = true` 확인 후 `npm run db:stop && npm run db:start`; (2) `getByText('2장 남음')` 이 여러 개 — `.first()`; (3) 코드 텍스트에 공백이 들어 있어 `replace(/\D/g, '')` 로 지운다.

- [ ] **Step 5: 커밋**

```bash
git add e2e/helpers.ts e2e/family.spec.ts e2e/tickets.spec.ts
git commit -m "test(e2e): 가족 흐름 — 아이 익명 시작·코드·자녀 추가·가족 잔량·아이 폰 사용, 헬퍼 추출

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: 문서 동기화 · 전체 검증 · 마무리

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md`
- Modify: `docs/superpowers/plans/2026-10-09-phase3-family.md` (이 파일 — 차이·수치)

- [ ] **Step 1: README**

"로컬 개발" 표 아래 목록에 추가:

```markdown
- 아이 계정(익명 로그인)은 로컬 `config.toml` 에서 이미 켜져 있다(`enable_anonymous_sign_ins = true`). E2E `family.spec.ts` 가 쓴다.
- pg_cron 정리 작업 3건(`cleanup_pairing_codes` 매시간, `cleanup_orphan_anonymous_users`·`cleanup_empty_families` 매일 03:15/03:30 KST)은 마이그레이션이 확장을 켜고 `cron.schedule` 로 등록한다. 로컬에서도 돈다. 상태는 `select jobname, schedule, active from cron.job;` 과 `select * from cron.job_run_details order by start_time desc limit 20;`. **Supabase 공식 문서의 `grant usage on schema cron to postgres; grant all privileges on all tables in schema cron to postgres;` 스니펫은 실행하지 말 것** — supautils 가 이미 권한을 주며, 그 grant 가 남아 있으면 이후 `create extension pg_cron` 이 2BP01 로 실패한다(마이그레이션이 그런 grant 를 먼저 거둔다).
```

"운영 설정 › 1. Supabase 프로젝트" 3번 항목의 Anonymous sign-ins 줄을 바꾼다:

```markdown
   - Anonymous sign-ins: **켜기** (3단계 아이 계정 — 켜지 않으면 "아이 계정으로 시작하기" 가 "잠시 후 다시 시도해 주세요" 로 실패한다). 익명 가입 속도 제한은 기본값(IP 당 시간 30회)으로 둔다. 캡차는 붙이지 않는다(무료지만 UI 가 복잡해진다).
```

"5. 운영 체크리스트" 에 추가:

```markdown
- 3단계 배포 뒤 Supabase **Authentication › Sign In / Providers › Anonymous** 가 켜져 있는지 확인한다. pg_cron 은 마이그레이션이 켠다 — 콘솔에서 미리 켜지 말고, 특히 공식 문서의 `grant … on schema cron to postgres` 스니펫은 실행하지 않는다. 확인은 SQL Editor 에서 `select jobname, schedule, active from cron.job;`(3건) 과 `select * from cron.job_run_details order by start_time desc limit 10;` 로 한다(Integrations › Cron 화면은 대시보드 통합을 켰을 때만 보이고, 작업은 그와 무관하게 돈다).
- 자녀 삭제·탈퇴는 화면에서 본인(보호자)이 한다. 관리자가 대신 처리해야 하면(권사님 요청) 4단계 `admin_reset_person` 전까지는 SQL 로: `update public.people set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now() where id = '<사람 id>';`
```

- [ ] **Step 2: 설계 문서**

- 상단 "상태" 를 `1·2·3단계 구현 완료 (2026-10-09). 4단계 계획 전 이 계획의 인계 항목 참고` 로.
- 연결 코드는 **8자리**다(2단계 리뷰 반영). 설계 문서의 "6자리" 를 모두 바꾼다: §4 핵심 개념, §7.1 `pairing_codes`(`code text PK` 설명에 "8자리 숫자(`^[0-9]{8}$`), 만료·사용된 코드 자리는 새 코드가 재활용", `auth_user_id` 에 "on delete cascade"), §7.3 `create_pairing_code`("새 8자리 숫자 코드"), §8.2 연결 코드 화면("8자리 큰 글씨"). 8자리로 늘린 이유(어른 코드를 맞히면 가족·장부·전체 번호가 넘어오는데 속도 제한이 없다)도 §10 또는 §15 에 한 줄.
- §7.3 표: `create_pairing_code` 반환이 `{code, expires_at}` 한 행, 코드 `not_authenticated | invalid_kind | already_registered | not_registered | not_adult | code_generation_failed`. `add_family_member` 에 "adult: 옛 가족에 산 사람이 없을 때만 장부(issuances·usages)를 새 가족으로 옮기고 빈 가족을 지운다. 남는 사람이 있으면 장부는 남는다. 같은 가족이면 그대로 돌려준다", 코드 `not_registered | not_adult | invalid_code | invalid_name | already_registered`. `relink_child` 코드 `child_not_found | invalid_code | already_registered`. `leave_family` "다른 어른(또는 남의 자녀)이 없으면 아무것도 바꾸지 않는다". `remove_child`·`delete_my_account` 코드(`child_not_found`, `has_children`, 둘 다 `not_adult`). 헬퍼 `lock_family_meal(uuid, uuid)` 한 줄.
- §7.5: 세 작업의 함수 이름·시각(UTC 18:15/18:30 = KST 03:15/03:30), "빈 가족 정리는 사람 행도 장부도 없고 1시간 지난 가족만".
- §8.2 가족: "길게 눌러" → "행마다 작은 버튼 + 두 단계 확인". 가족 연결에 "상대 코드 입력 / 내 코드 보여 주기" 두 모드. 아이 폰 로그아웃 확인 문구.
- §12 E2E (b) 가 `e2e/family.spec.ts` 로 구현됨 (두 브라우저 컨텍스트).
- §15: "로그아웃은 `scope: 'local'`(이 기기만) — 공용 폰에서 로그아웃해도 본인 폰 세션은 남는다", "연결 코드 무차별 대입 완화 보류(이유: RPC 예외는 같은 트랜잭션의 기록을 롤백한다; 코드는 8자리)", "탈퇴한 카카오 계정의 auth.users 정리 보류", "같은 가족에서 두 어른이 각자 다른 가족으로 합류하면 나중 커밋이 장부 풀을 가져간다".
- §10: 익명화된 구성원 행은 가족 행과 함께 영구히 남는다(구성원 행이 하나라도 있으면 가족 행은 지우지 않는다 — `families` 는 세대 변동만큼만 늘어난다). 자녀 행의 `consent_version` 은 보호자가 체크한 법정대리인 동의 문구의 버전이다. `delete_my_account` 는 마지막 관리자를 거부한다(`last_admin`).

- [ ] **Step 3: 이 계획 파일**

"구현 결과와 계획의 차이" 에 Task 별로 실제로 바뀐 것을 적고, 완료 기준의 수치를 실제 값으로 맞춘다. 모든 Step 체크박스를 `[x]` 로.

- [ ] **Step 4: 전체 검증**

```bash
npm run db:reset && npm run db:test        # pgTAP 346
npm run lint && npx tsc -b
npm run test:coverage                      # 임계값(80/80/70/80) 통과
npm run build && VITE_BASE_PATH=/meal-ticket/ npm run build && grep -q '/meal-ticket/assets/' dist/index.html
npm run e2e                                # 4 passed
```

Expected: 전부 통과. 커버리지 요약과 pgTAP/vitest/E2E 개수를 완료 기준에 적는다.

- [ ] **Step 5: 커밋 · push · PR**

```bash
git add README.md docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md docs/superpowers/plans/2026-10-09-phase3-family.md
git commit -m "docs: 3단계 문서 동기화 — README 운영 설정(익명 로그인·pg_cron), 설계 §7·§8·§12·§15, 계획 차이

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/phase3-family
gh pr create --title "3단계: 가족·아이 — 연결 코드, 익명 아이 계정, 가족 탭, pg_cron 정리" --body-file /tmp/pr-body.md
```

`/tmp/pr-body.md` 내용:

```markdown
## Summary
- DB: `pairing_codes`, `lock_family_meal`, `create_pairing_code`, `add_family_member`(자녀 추가·어른 합류, 빈 가족 장부 이동), `relink_child`, `leave_family`, `remove_child`, `delete_my_account`, pg_cron 정리 3건. pgTAP +157 (총 346).
- 교인: 시작 화면 "아이 계정으로 시작하기", 가입 "만 14세 미만" 토글, `#/pair` 연결 코드, `#/family` 가족 탭(구성원·자녀 추가·재연결·가족 연결·가족 나가기·자녀 삭제·내 정보·탈퇴), 아이 폰 로그아웃 확인.
- 공통: 로그아웃 캐시 정리를 AuthProvider SIGNED_OUT 으로 이동. E2E 가족 흐름(두 브라우저 컨텍스트).

## 운영 (merge 전 확인)
- Supabase **Authentication › Sign In / Providers › Anonymous sign-ins 켜기** — 켜기 전에는 "아이 계정으로 시작하기" 가 실패한다. 코드로 올릴 수 없는 콘솔 설정이다.
- 마이그레이션이 `pg_cron` 을 켜고 작업 3건을 등록한다 (비용 없음).

## Test Plan
- [ ] CI 녹색 (pgTAP 346 · vitest · E2E 4)
- [ ] merge 후 Deploy 성공, 운영에서 익명 로그인 → `#/pair` 코드 표시 확인
- [ ] 실제 폰 2대: 아이 계정 → 코드 → 보호자 자녀 추가 → 아이 폰에 가족 식권

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

PR 은 사용자가 merge 한다. merge 전에 사용자에게 **Supabase 콘솔에서 Anonymous sign-ins 를 켜 달라고** 알린다.

---

## 완료 기준

- pgTAP: 010~130 전부 통과, 총 346 (100=29 · 110=62 · 120=46 · 130=20).
- Vitest: 전부 통과, 커버리지 임계값(lines 80 · functions 80 · branches 70 · statements 80) 통과.
- `npm run lint` · `npx tsc -b` · `npm run build` · 하위 경로 빌드 통과.
- Playwright: 4 passed (onboarding 2 · tickets 1 · family 1).
- 수동: 로컬 두 창에서 자녀 추가·가족 연결·가족 나가기·자녀 삭제·탈퇴가 모두 화면 문구대로 동작.
- 운영: merge 뒤 Deploy 성공, Supabase 에 `pg_cron` 작업 3건, Anonymous sign-ins 켜짐(사용자 확인).

## 4단계로 넘기는 것

- `merge_people` · `link_person` · `admin_reset_person` · `cancel_issuance` · `use_ticket_as_admin` · `void_usage`, 식사 상세 현황판, 사람 탭, 통계·CSV·공유 (2단계 인계 그대로).
- **`use_ticket` 을 `public.lock_family_meal(uuid, uuid)` 로 바꾼다** — 헬퍼는 이번 단계가 만들었고 `100_pairing_codes.sql` 이 키가 같음을 `pg_locks` 로 고정한다. 4단계 함수(`cancel_issuance` 등)도 같은 헬퍼로 잠근다.
- 사람 탭의 "가족 수" 태그와 발급 검색 결과의 가족 수 — 이제 의미가 생겼다(`people` 을 `family_id` 로 묶어 세면 된다).
- `admin_reset_person` 이 생기면 README 의 "관리자 대신 처리 SQL" 임시 절차를 지운다.
- **`merge_people(from, into)` 는 자녀의 `guardian_id` 를 바꾸므로 대상 보호자(`into`)의 사람 행을 `for update` 로 잠가야 한다** (Task 3 리뷰). `delete_my_account` 의 `has_children` 검사는 "내 행을 잠그지 않고는 내 밑에 자녀를 만들 수 없다" 는 불변식에 기대고 있어, 이를 어기면 익명화된 보호자 밑에 살아 있는 자녀가 남을 수 있다. 같은 이유로 4단계 함수도 "어른(보호자) 행 → 자녀 행" 잠금 순서를 지킨다.
- 같은 가족에서 두 어른이 각자 다른 가족으로 합류하면, 나중에 커밋된 쪽이 옛 가족의 장부 풀을 통째로 가져간다(순서 의존 — 손상은 없고 설계상 그렇다). 설계 §15 에 한 줄로 적는다(Task 14).
- 연결 코드 무차별 대입 완화: 코드는 이미 8자리다(2단계 리뷰 반영). 더 필요해지면 `add_family_member` 가 실패를 예외 대신 "실패 행 반환" 으로 바꿔 실패 횟수를 기록한다.
- 탈퇴한 카카오 계정의 `auth.users` 정리(사람 행이 없는 비익명 계정 N일 뒤 삭제) — 5단계 운영 문서에서 결정. `cleanup_orphan_anonymous_users` 를 넓히면 된다.
- `onboardingSchema` 와 `familySchema.nameSchema` 가 같은 규칙을 두 번 적는다. 4단계에서 사람 입력 규칙을 `lib/personSchema.ts` 로 모을지 검토(2곳이라 아직 두었다).
- PWA(5단계) 때 `#/pair` 와 시작 화면에 `pt-[env(safe-area-inset-top)]`.
