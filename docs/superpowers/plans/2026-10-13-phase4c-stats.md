# 4c단계: 통계 · CSV · 공유 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권사님이 월 단위로 발급·사용·금액을 한 화면에서 보고, 그 달의 장부를 CSV 로 내려받거나 카카오톡으로 공유할 수 있게 한다.

**Architecture:** 새 DB 객체를 만들지 않는다. 그 달의 `issuances`·`usages` 를 PostgREST 임베딩 필터(`meals!inner` + `served_on` 범위)로 두 번 읽고, 합계·식사별 행·이름 검색·CSV 는 모두 **순수 함수**가 만든다. 화면은 읽은 결과를 그릴 뿐이다. 마이그레이션은 하나뿐이고 4b 가 넘긴 `admin_reset_person` 의 연결 코드 정리만 담는다.

**Tech Stack:** React 19 · Vite · TS 6 strict · Tailwind v4 · react-router 7(HashRouter) · TanStack Query 5 · Vitest 4 + Testing Library · Playwright · oxlint `--deny-warnings` · Supabase(PostgREST · pgTAP)

---

## 범위

설계 §8.3 **통계** 가 이 단계의 명세다.

- 월 선택(**식사일** 기준), 이전/다음 달 이동
- 그 달의 합계: 발급 장수 · 금액 · 사용 장수
- 식사별 행(식사일·식사명·발급·사용·금액)
- 교인별 검색(이름)
- **CSV 저장**(다운로드) · **카톡으로 공유**(Web Share API, 미지원이면 버튼을 감춘다)
- CSV 열 11개: 종류(발급/취소/사용/무효) · 일시 · 식사일 · 식사명 · 이름 · 가족 대표 · 장수 · 단가 · 금액 · 처리자 · 메모

4b 가 **고의로 넘긴 것** 둘을 함께 처리한다(4b 계획의 "4c·5단계로 넘기는 것").

- `admin_reset_person` 이 떼어낸 계정의 `pairing_codes` 를 지우지 않는다 → Task 1.
- 배포된 4b 마이그레이션의 `link_person` 안내 주석이 코드가 금지하는 용도를 적고 있다 → Task 1 에서 `comment on function` 으로 덮는다(배포된 파일 자체는 역사 기록이므로 손대지 않는다).

## 설계와 다른 점 (의도한 선택)

- **월 선택은 `<input type="month">` 가 아니라 "◀ 2026년 10월 ▶" 단계 버튼이다.** `type="month"` 는 데스크톱 Safari 가 지원하지 않고 iOS 는 휠 피커를 띄워 플랫폼마다 다르게 보인다. 권사님은 이번 달과 지난달만 주로 보므로 좌우 버튼이 탭 수도 적고 테스트도 결정적이다.
- **`ticket_balances` 뷰를 쓰지 않는다.** CSV 는 취소·무효 행까지 담아야 하므로 장부 원본을 읽는다. 합계를 뷰에서 따로 읽으면 CSV 와 화면 숫자가 어긋날 수 있다 — 한 번 읽은 장부에서 둘 다 만든다.
- **취소·무효는 별도 행이다.** 취소된 발급은 `발급` 행 하나와 `취소` 행 하나가 된다(일시가 다르다). 합계는 `발급 − 취소`, `사용 − 무효` 로 계산하므로 `ticket_balances` 와 산술적으로 같다.
- **`가족 대표`** 는 스키마에 열이 없다. 그 가족의 **살아 있는 어른 중 이름 순 첫 사람**(동명이인은 id 로 고정)으로 정한다 — 4b 의 `familyHint` 와 같은 규칙이고, `useAllPeople` 이 이미 그 명단을 캐시에 들고 있다. 살아 있는 어른이 없는 가족(초기화된 1인 가족 등)은 빈 칸으로 둔다.
- **`meals.created_by`(식사 등록자)는 CSV 에 넣지 않는다.** 4b 리뷰가 "4c 가 식사 등록자를 내보내면 합치기가 그 열을 옮기지 않는 문제를 다시 보라" 고 남겼다. 설계의 11열에 없으므로 넣지 않고, `merge_people` 도 그대로 둔다.
- **교인별 검색은 이름만** 본다(번호 뒷자리 검색은 두지 않는다). 장부 행에는 번호가 없고, 번호로 사람을 찾는 일은 사람 탭의 몫이다.

## 구현 결과와 계획의 차이 (실행 중 바뀐 것)

- **Task 1** (DB 리뷰 결과): 마이그레이션은 **배포 안전**으로 승인됐다 — 다섯 문장이 모두 카탈로그만 건드리고(사용자 표에 잠금이 하나도 없다), 한 트랜잭션에서 두 번 재실행해도 30개 함수의 소스·ACL·주석이 0행 차이이며, 진행 중인 호출과 나란히 적용해도 막히지 않는다. 잠금 순서가 지켜진 것도, delete 를 ② 뒤로 옮기면 `add_family_member` 와 **실제로 40P01 교착**이 나는 것도 실험으로 확인됐다.
  그런데 **남은 경쟁 하나가 실재**했다: 잠그지 않고 읽은 계정과 ② 에서 잠그고 다시 읽은 계정이 다를 수 있다(`merge_people` 이 그 창에서 계정을 붙인다). 그러면 사전 읽기가 `null` 을 보고 아무 코드도 지우지 않은 채 ② 가 계정을 떼어 버려, **살아 있고 쓰이지 않은 코드**가 남는다 — 이 커밋이 닫으려던 흡수 경로가 그대로 다시 열린다. 한 줄 가드(`auth_user_id is distinct from v_account` → `person_not_found`)로 닫았고, 두 세션 실험으로 양쪽을 직접 재현했다(가드 있으면 아무것도 안 바뀐다, 빼면 코드가 살아남는다).
  주석의 설명도 틀려 있었다. `link_person`·`claim_person` 이 그 상황을 만든다고 적었지만 각각 `account_taken`·`already_registered` 로 막혀 만들 수 없고, 남는 것은 "이미 쓰인 죽은 코드" 가 아니라 살아 있는 코드다. **닫지 못한 경쟁**은 교인 폰이 `create_pairing_code` 를 우리 delete 뒤에 끝내는 경우로, 이 함수 안에서는 닫을 수 없다(교착 때문에 delete 를 뒤로 못 옮긴다) — 5단계로 넘긴다.
  pgTAP 쪽 지적도 받아들였다. 라벨과 실제가 어긋난 두 곳(코드 없는 사람을 시험하지 않던 "코드가 없어도" 테스트, 이미 초기화된 계정으로 불러 `forbidden` 의 다른 쪽을 시험하던 권한 테스트)을 고쳐 **458** 이 되었고, `delete` 의 **위치**와 새 가드는 한 세션 pgTAP 로 못 박을 수 없다는 것을 파일 끝에 적어 뒀다(순서를 바꿔도 전부 통과한다 — 녹색이 면허로 읽히지 않게).
- **Task 4** (그 달 장부): `FakeQuery` 에 `lte` 체인 메서드가 없었다 — 저장소에서 `.lte()` 를 쓰는 첫 자리다(`gte` 만 있었다). 계획이 그걸 놓쳐, 테스트가 의도한 동작이 아니라 `...lte is not a function` 으로 터졌다. `gte` 바로 아래에 한 줄(`lte = this.chain('lte')`)을 더해 고쳤다 — 계획의 8개 파일 밖이지만 테스트를 그대로 통과시키려면 필요했고, 단언을 낮추지 않았다.
- **Task 1** (DB): 계획의 pgTAP 가 `tests.authenticate_as` 에 이메일 문자열을 넘기고 있었다. 그 헬퍼는 `tests.authenticate_as(p_user uuid)` 하나뿐이라(`supabase/seeds/000_test_helpers.sql:29`) 그대로 돌리면 `invalid input syntax for type uuid` 가 난다. 구현은 이미 `\gset` 해 둔 uuid 변수(`:'admin_uid'`·`:'b_uid'`)를 넘긴다 — `150`·`120` 이 쓰는 방식 그대로다. 위 Task 1 본문도 고쳐 두었다. 마이그레이션은 계획과 한 글자도 다르지 않다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20261013000001_reset_clears_pairing_codes.sql` | `admin_reset_person` 재정의(① 코드 삭제 → ② 사람 잠금) + `link_person` 주석 정정 |
| `supabase/tests/database/160_reset_pairing_codes.sql` | 위 동작의 pgTAP |
| `src/lib/search.ts` | 이름·숫자 검색 키 (NFC·공백 제거·숫자 추출). `peopleFilter` 와 통계가 함께 쓴다 |
| `src/features/admin/statsMonth.ts` | 월 문자열 계산 (이번 달·범위·앞뒤 이동·표기). 순수 |
| `src/features/admin/useMonthLedger.ts` | 그 달 식사의 발급·사용 원본 행 조회 (임베딩 필터 + 1000행 천장) |
| `src/features/admin/statsRows.ts` | 원본 행 → 통계 행(종류별로 펼친 장부) + 합계 + 식사별 행 + 이름 검색. 순수 |
| `src/features/admin/statsCsv.ts` | 통계 행 → CSV 문자열(11열·BOM·CRLF·인용) + 파일 이름. 순수 |
| `src/features/admin/shareCsv.ts` | 다운로드와 Web Share. 브라우저 API 를 주입 가능하게 감싼다 |
| `src/pages/admin/StatsPage.tsx` | `#/admin/stats` 화면 |
| `src/components/PersonShell.tsx` | 관리자 탭에 **통계** 추가 (5개) |
| `src/App.tsx` | `/admin/stats` 라우트 |
| `e2e/stats.spec.ts` | 발급·사용 → 통계에서 합계·식사별 행·CSV 내용 확인 |

## 공통 규약 (1~4b 단계에서 이어받음 — 모든 Task 에 적용)

**DB**

- 함수마다 `revoke execute … from public, anon` + `grant … to authenticated`. pgTAP 020 이 anon 실행 가능한 public 함수 목록을 `{ping}` 으로 못 박고 있다.
- `security definer` + `set search_path = public, pg_temp`.
- `raise exception '<snake_case>'` — 값을 문구에 끼워 넣지 않는다. **새 오류 코드가 생기면 같은 커밋에서 `src/lib/errors.ts` 에 문구를 넣는다**(`rpcCodeOf` 멤버십이 재조회·재시도 판단을 가른다). 이 단계는 새 코드가 없다.
- 잠금 순서: ① `pairing_codes` 행 → ② `people` 행(한 문장에서 id 순 `for update`) → ③ `lock_family(uuid)` → ④ `lock_family_meal(가족, 식사)`.
- pgTAP: `tests.create_user(email?)`, `tests.authenticate_as`, **직접 표를 읽거나 쓰기 전에 `tests.clear_auth()`**, `not_authenticated` 단언은 `set local role authenticated` + `reset role`. 전화번호·식사 제목은 파일 번호를 박아 다른 파일과 섞이지 않게 한다(이 파일은 `0101616000x`).
- `pg_locks` 단언은 **성공한** 호출 뒤에, 그 트랜잭션에서 아무도 잠그지 않은 키에 대해서만 둔다(서브트랜잭션 중단은 advisory 잠금을 푼다).

**프런트엔드**

- 조회 화면은 `status` 가 아니라 **`data` 로 분기**한다(`data !== undefined`; `null` 은 "없음" 이라는 정상 값). 재조회가 실패해도 보던 내용은 남기고, 조용한 `role="status"` 한 줄로 알린다. 데이터가 아예 없을 때만 `role="alert"` + "다시 시도".
- 다음 동작이 시작되면 이전 동작의 오류를 `reset()` 한다. 오류는 `role="alert"`, 지나가는 안내는 `role="status"`.
- **접근성 이름은 유일해야 한다.** 동명이인·같은 분의 같은 분 발급이 두 줄일 수 있다(4b 에서 반복해 당했다).
- 테스트는 사용자가 보는 질의(`getByRole`/`getByLabelText`/`getByText`)로 쓴다. 조회 훅은 모듈 경계에서 `vi.fn<…>()` 로 가로채고, 무효화는 **키 목록을 순서까지** 단언한다. 조건부 `expect` 는 `oxlint-disable` 로 덮지 않고 결과 전체를 `toEqual` 로 비교한다(`onboardingSchema.test.ts` 가 세운 규약).
- 모바일 우선: `max-w-sm` 한 칼럼, 나이 드신 손가락에 편한 탭 영역, hover 전용 장치 없음.

---

### Task 1: 마이그레이션 ⑯ — `admin_reset_person` 이 연결 코드를 지운다 + `link_person` 주석 정정

**Files:**
- Create: `supabase/migrations/20261013000001_reset_clears_pairing_codes.sql`
- Create: `supabase/tests/database/160_reset_pairing_codes.sql`

**왜:** 같은 익명화를 하는 두 형제 함수(`delete_my_account`·`remove_child`)는 모두 떼어낸 계정의 연결 코드를 먼저 지운다. `admin_reset_person` 만 지우지 않아, 교인이 가족 탭에서 어른 코드를 띄워 둔 채 초기화되고 10분 안에 다시 가입하면 그 코드가 **새로 생긴 사람 행**에 대해 유효해진다(`add_family_member` 는 `auth_user_id` 로 대상을 찾는다). 코드를 쥔 사람이 그 교인을 자기 가족으로 흡수할 수 있다.

- [ ] **Step 1: 실패하는 pgTAP 를 쓴다**

`supabase/tests/database/160_reset_pairing_codes.sql` 를 새로 만든다. 전화번호 블록은 `0101616000x` 다(다른 파일과 겹치면 `people_phone_unique` 가 23505 를 낸다).

```sql
begin;
select plan(10);

-- ---------- 준비 ----------
-- 권사(관리자) · 김철수(계정 있음, 어른 코드를 띄워 둔 상태) · 박영수(계정 있음, 코드 없음) · 서진(자녀)
select tests.create_user('reset-admin@test.local') as admin_uid \gset
select tests.create_user('reset-a@test.local') as a_uid \gset
select tests.create_user('reset-b@test.local') as b_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('권사',   '01016160001', :'admin_uid', now(), '2026-10-07'),
       ('김철수', '01016160002', :'a_uid',     now(), '2026-10-07'),
       ('박영수', '01016160003', :'b_uid',     now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid from public.people where auth_user_id = :'b_uid' \gset

-- 두 사람이 각각 코드를 띄워 둔 상태. 초기화는 대상의 코드만 지워야 한다.
insert into public.pairing_codes (code, auth_user_id, kind, expires_at)
values ('16160001', :'a_uid', 'adult', now() + interval '10 minutes'),
       ('16160002', :'b_uid', 'adult', now() + interval '10 minutes');

-- ---------- 초기화가 그 계정의 코드를 지운다 ----------
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.admin_reset_person(%L) $$, :'a_pid'), '관리자가 김철수를 초기화한다');

select tests.clear_auth();
select is((select count(*) from public.pairing_codes where auth_user_id = :'a_uid'), 0::bigint,
          '초기화한 계정의 연결 코드가 지워진다');
select is((select count(*) from public.pairing_codes where auth_user_id = :'b_uid'), 1::bigint,
          '다른 사람의 코드는 건드리지 않는다');
select is((select deleted_at is not null and name = '탈퇴한 사용자' and auth_user_id is null
             from public.people where id = :'a_pid'), true,
          '초기화 자체는 그대로 — 익명화 + 계정 해제');

-- ---------- 코드가 없어도 초기화는 된다 ----------
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.admin_reset_person(%L) $$, :'b_pid'), '코드가 있든 없든 초기화는 성공한다');
select tests.clear_auth();
select is((select count(*) from public.pairing_codes where auth_user_id = :'b_uid'), 0::bigint,
          '박영수의 코드도 그 차례에 지워진다');

-- ---------- 거부되면 코드도 함께 롤백된다 ----------
-- 자녀는 거부 대상이다(minor_not_allowed). 예외가 나면 그 사이의 delete 도 같은 트랜잭션에서 되돌아간다.
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('서진', :'a_fid', true, :'a_pid', now()) returning id as kid_pid \gset
select tests.create_user('reset-kid@test.local') as kid_uid \gset
update public.people set auth_user_id = :'kid_uid' where id = :'kid_pid';
insert into public.pairing_codes (code, auth_user_id, kind, expires_at)
values ('16160003', :'kid_uid', 'child', now() + interval '10 minutes');

select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'kid_pid'), 'P0001', 'minor_not_allowed',
                 '자녀는 초기화할 수 없다 (4b 와 같다)');
select tests.clear_auth();
select is((select count(*) from public.pairing_codes where auth_user_id = :'kid_uid'), 1::bigint,
          '거부된 초기화는 코드 삭제까지 되돌린다');

-- ---------- 권한 ----------
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'kid_pid'), 'P0001', 'forbidden',
                 '교인은 초기화할 수 없다 — 코드를 지우기 전에 막힌다');
select tests.clear_auth();
select is((select count(*) from public.pairing_codes where auth_user_id = :'kid_uid'), 1::bigint,
          '막힌 호출은 코드를 건드리지 않는다');

select * from finish();
rollback;
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run db:reset && npm run db:test
```

Expected: `160_reset_pairing_codes.sql` 에서 `초기화한 계정의 연결 코드가 지워진다` 와 `박영수의 코드도 그 차례에 지워진다` 가 FAIL (현재 함수는 코드를 지우지 않는다). 나머지 8개는 PASS.

- [ ] **Step 3: 마이그레이션을 쓴다**

`supabase/migrations/20261013000001_reset_clears_pairing_codes.sql`:

```sql
-- 4c단계 ⑯: admin_reset_person 이 떼어낸 계정의 연결 코드를 지운다.
--
-- 왜: 같은 익명화를 하는 두 형제 함수(delete_my_account · remove_child)는 모두 코드를 먼저 지운다.
--   초기화만 지우지 않아, 교인이 가족 탭에서 어른 코드를 띄워 둔 채 초기화되고 10분 안에 다시 가입하면
--   그 코드가 새로 생긴 사람 행에 대해 유효해진다(add_family_member 는 auth_user_id 로 대상을 찾는다) —
--   코드를 쥔 사람이 그 교인을 자기 가족으로 흡수할 수 있다.
--
-- 잠금 순서는 이 저장소의 규칙(① 코드 → ② 사람 → ③ 가족)을 그대로 지킨다. 사람 행을 잠그기 전에 계정 id 를
--   알아야 하므로 잠그지 않고 한 번 읽는다 — remove_child 가 같은 모양이고 같은 이유를 적어 뒀다.
--
-- 함수 본문 외 변경 없음: 표·인덱스·권한을 건드리지 않고 create or replace 와 comment 뿐이라 재실행도 안전하다.
-- 오류 코드는 4b 와 같다: not_authenticated | forbidden | person_not_found | minor_not_allowed | has_children | last_admin

create or replace function public.admin_reset_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
  v_account uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- ① 연결 코드. 잠그지 않고 읽은 계정 id 기준으로 지운다.
  --   경쟁: 이 사이에 그 계정이 다른 사람 행으로 옮겨 가면(link_person·claim_person) 이미 쓰인 죽은 코드 행이
  --   하나 남을 수 있다. 무해하고(used_at 이 찍힌 행은 다시 못 쓴다) 매시간 cleanup_pairing_codes 가 지운다.
  --   사람 행을 잠근 뒤에 지우면 ②가 ①보다 먼저 와 이 저장소의 잠금 순서를 어긴다 — remove_child 와 같은 판단.
  --   아래에서 예외가 나면(미성년자·자녀 있음·마지막 관리자) 이 delete 도 같은 트랜잭션에서 되돌아간다.
  select auth_user_id into v_account from public.people where id = p_person_id and deleted_at is null;
  if v_account is not null then
    delete from public.pairing_codes where auth_user_id = v_account;
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

comment on function public.admin_reset_person(uuid) is
  '관리자 사람 초기화(익명화 + 계정 해제 + 그 계정의 연결 코드 삭제, 장부 보존). 오류 코드: not_authenticated | forbidden | person_not_found | minor_not_allowed | has_children | last_admin';
revoke execute on function public.admin_reset_person(uuid) from public, anon;
grant execute on function public.admin_reset_person(uuid) to authenticated;

-- 4b 의 안내 주석 정정. 배포된 마이그레이션 파일은 역사 기록이라 손대지 않고 주석만 덮어쓴다.
-- 잘못된 설명: "초기화 뒤 같은 계정으로 되돌릴 때만 쓴다" — link_person 은 deleted_at is null 을 요구하므로
-- 초기화된 사람에게는 쓸 수 없다(pgTAP 150 이 양방향으로 못 박는다). 실제로 닿는 경우는 auth.users 행이
-- 사라져(on delete set null) 연결이 끊긴 살아 있는 어른이다.
comment on function public.link_person(uuid, uuid) is
  '카카오 계정 수동 연결(복구 경로): auth.users 행이 사라져 연결이 끊긴, 동의 기록이 있는 살아 있는 어른에게만. 초기화된 사람은 되돌릴 수 없다. 오류 코드는 20261011000001 헤더 참고.';
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run db:reset && npm run db:test
```

Expected: `Files=16, Tests=456, PASS` (기존 446 + 10).

- [ ] **Step 5: 단언이 비어 있지 않은지 확인한다**

함수에서 `delete from public.pairing_codes …` 두 줄을 지우고 다시 돌려, `초기화한 계정의 연결 코드가 지워진다` 가 FAIL 하는 것을 확인한 뒤 되돌린다. (되돌릴 때 `git checkout --` 로 파일 전체를 되돌리지 말 것 — 같은 파일의 다른 변경까지 날아간다. 손으로 두 줄을 다시 넣는다.)

- [ ] **Step 6: 타입 재생성 확인**

```bash
npm run db:types && git diff --stat src/lib/database.types.ts
```

Expected: 차이 없음 (함수 시그니처가 그대로다).

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/20261013000001_reset_clears_pairing_codes.sql supabase/tests/database/160_reset_pairing_codes.sql
git commit -m "$(cat <<'MSG'
fix(db): 사람 초기화가 떼어낸 계정의 연결 코드도 지운다

같은 익명화를 하는 delete_my_account·remove_child 는 모두 코드를 먼저 지우는데
admin_reset_person 만 지우지 않았다. 교인이 가족 탭에서 어른 코드를 띄워 둔 채
초기화되고 10분 안에 다시 가입하면 그 코드가 새 사람 행에 유효해져(add_family_member
는 auth_user_id 로 대상을 찾는다) 코드를 쥔 사람이 그 교인을 흡수할 수 있었다.

잠금 순서(① 코드 → ② 사람 → ③ 가족)를 지키려고 사람 행을 잠그기 전에 계정 id 를
잠그지 않고 한 번 읽는다 — remove_child 와 같은 모양이고 같은 경쟁 판단을 적어 뒀다.

link_person 의 안내 주석도 덮어쓴다. "초기화 뒤 되돌릴 때만" 이라고 적혀 있었지만
그 함수는 deleted_at is null 을 요구해 그 용도가 불가능하다(pgTAP 150 이 양방향으로
못 박는다). 배포된 4b 마이그레이션 파일은 역사 기록이라 손대지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: 검색 키를 공용 모듈로 (`src/lib/search.ts`)

**Files:**
- Create: `src/lib/search.ts`, `src/lib/search.test.ts`
- Modify: `src/features/admin/peopleFilter.ts` (지금 가진 사설 복사본을 지우고 가져다 쓴다)

**왜:** 통계의 교인별 검색도 사람 목록과 똑같이 NFC 로 맞추고 공백을 없애야 한다(iOS 가 자모 분리(NFD)로 보낸다). 세 번째 복사본을 만들지 않는다. `usePeopleSearch.sanitizeQuery` 는 **합치지 않는다** — 그쪽은 문장부호까지 지우고, `nameKey` 는 DB 의 `normalize_name` 과 같은 규칙을 지키기로 4b 에서 정했다.

- [ ] **Step 1: 실패하는 테스트**

`src/lib/search.test.ts`:

```ts
import { digitsOf, nameKey, SEARCH_MIN_DIGITS } from './search'

describe('nameKey', () => {
  it('NFC 로 맞추고 공백을 없앤다 (iOS 가 자모 분리로 보낼 수 있다)', () => {
    expect(nameKey('김 철수')).toBe('김철수')
    expect(nameKey('김철수'.normalize('NFD'))).toBe('김철수')
    expect(nameKey('  이 영 희 ')).toBe('이영희')
  })

  it('문장부호는 남긴다 (DB 의 normalize_name 과 같은 규칙을 지킨다)', () => {
    expect(nameKey('김-철수')).toBe('김-철수')
  })
})

describe('digitsOf', () => {
  it('숫자만 남긴다', () => {
    expect(digitsOf('010-1234-5678')).toBe('01012345678')
    expect(digitsOf('이영희')).toBe('')
  })

  it('전각 숫자는 숫자로 보지 않는다 (\\D 가 지운다 — 알고 쓰는 한계다)', () => {
    expect(digitsOf('１２３')).toBe('')
  })
})

describe('SEARCH_MIN_DIGITS', () => {
  it('두 자리다 — 한 자리면 010… 번호 전부에 걸린다', () => {
    expect(SEARCH_MIN_DIGITS).toBe(2)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/lib/search.test.ts
```

Expected: FAIL — `Failed to resolve import "./search"`.

- [ ] **Step 3: 구현**

`src/lib/search.ts`:

```ts
/** 번호로 찾을 때 필요한 최소 자릿수. 한 자리면 `010…` 번호 전부에 걸려 명단이 쏟아진다. */
export const SEARCH_MIN_DIGITS = 2

/**
 * 검색 비교용 이름 키: NFC 로 맞추고 공백을 없앤다 (iOS 가 자모 분리(NFD)로 보낼 수 있다 — lib/fieldSchemas 와 같은 이유).
 * DB 의 `public.normalize_name` 과 같은 규칙이다 — 문장부호는 남긴다. `usePeopleSearch.sanitizeQuery` 는
 * 문장부호까지 지우는 별개 규칙이고, 일부러 합치지 않는다 (4b 리뷰에서 정했다).
 */
export const nameKey = (text: string) => text.normalize('NFC').replace(/\s+/g, '')

/** 숫자만 남긴다. 전각 숫자는 지워진다 — 한국 폰 입력에서는 나오지 않는다고 보고 둔다. */
export const digitsOf = (text: string) => text.replace(/\D/g, '')
```

`src/features/admin/peopleFilter.ts` 에서 사설 복사본 세 줄을 지운다:

```ts
/** 번호로 찾을 때 필요한 최소 자릿수. 한 자리면 `010…` 번호 전부에 걸려 명단이 쏟아진다. */
const SEARCH_MIN_DIGITS = 2

/** 검색 비교용 키: NFC 로 맞추고 공백을 없앤다 (iOS 가 자모 분리(NFD)로 보낼 수 있다 — lib/fieldSchemas 와 같은 이유). */
const nameKey = (text: string) => text.normalize('NFC').replace(/\s+/g, '')
const digits = (text: string) => text.replace(/\D/g, '')
```

그 자리에 import 를 둔다 (파일 맨 위, `import type { Person }` 아래):

```ts
import { digitsOf, nameKey, SEARCH_MIN_DIGITS } from '../../lib/search'
```

그리고 `filterPeople` 안의 `digits(query)` 호출을 `digitsOf(query)` 로 바꾼다:

```ts
  const num = digitsOf(query)
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/lib/search.test.ts src/features/admin/peopleFilter.test.ts && npm run lint && npx tsc -b
```

Expected: 두 파일 모두 PASS (`peopleFilter.test.ts` 는 한 줄도 바꾸지 않는다 — 동작이 같아야 한다), lint·tsc 깨끗.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/search.ts src/lib/search.test.ts src/features/admin/peopleFilter.ts
git commit -m "$(cat <<'MSG'
refactor: 이름·숫자 검색 키를 lib/search 로 옮긴다

통계의 교인별 검색도 사람 목록과 같은 규칙(NFC·공백 제거)이어야 한다. 세 번째
복사본을 만들지 않는다. usePeopleSearch.sanitizeQuery 는 문장부호까지 지우는 별개
규칙이라 일부러 합치지 않는다 (4b 리뷰에서 정한 것).

peopleFilter 의 동작은 그대로다 — 그 테스트 파일은 한 줄도 바꾸지 않았다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: 월 계산 (`statsMonth.ts`)

**Files:**
- Create: `src/features/admin/statsMonth.ts`, `src/features/admin/statsMonth.test.ts`

**왜:** 월 선택이 **식사일**(`meals.served_on`, `date` 열) 기준이라, 조회 범위를 `YYYY-MM-DD` 두 개로 만들어야 한다. `lib/dates.ts` 와 같은 방식으로 **UTC 산술**을 쓴다 — 날짜만 있는 값을 로컬 `Date` 로 바꾸면 시간대에 하루씩 밀린다.

- [ ] **Step 1: 실패하는 테스트**

`src/features/admin/statsMonth.test.ts`:

```ts
import { currentMonth, formatMonth, monthRange, shiftMonth } from './statsMonth'

describe('currentMonth', () => {
  it('오늘(YYYY-MM-DD)에서 YYYY-MM 을 뽑는다', () => {
    expect(currentMonth('2026-10-13')).toBe('2026-10')
    expect(currentMonth('2026-01-01')).toBe('2026-01')
  })
})

describe('monthRange', () => {
  it('그 달의 첫날과 마지막 날', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('2월은 평년 28일, 윤년 29일', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28')
    expect(monthRange('2028-02').to).toBe('2028-02-29')
  })
})

describe('shiftMonth', () => {
  it('앞뒤로 한 달', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09')
    expect(shiftMonth('2026-10', 1)).toBe('2026-11')
  })

  it('해를 넘는다', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
})

describe('formatMonth', () => {
  it('사람이 읽는 표기 (0 을 떼고 "년 월")', () => {
    expect(formatMonth('2026-10')).toBe('2026년 10월')
    expect(formatMonth('2026-01')).toBe('2026년 1월')
  })
})

describe('형식이 아니면 던진다', () => {
  it('잘못된 월 문자열은 조용히 넘기지 않는다 (주소창으로 들어올 수 있다)', () => {
    expect(() => monthRange('2026-13')).toThrow('YYYY-MM')
    expect(() => monthRange('202610')).toThrow('YYYY-MM')
    expect(() => shiftMonth('', 1)).toThrow('YYYY-MM')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/features/admin/statsMonth.test.ts
```

Expected: FAIL — `Failed to resolve import "./statsMonth"`.

- [ ] **Step 3: 구현**

`src/features/admin/statsMonth.ts`:

```ts
/**
 * 통계의 월 계산. 월은 `YYYY-MM`, 범위는 식사일(`meals.served_on`, date 열)과 같은 모양인 `YYYY-MM-DD` 다.
 * `lib/dates.ts` 와 같이 UTC 산술만 쓴다 — 날짜만 있는 값을 로컬 Date 로 바꾸면 시간대에 하루씩 밀린다.
 */
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

function parts(month: string): [number, number] {
  const match = MONTH_RE.exec(month)
  if (!match) throw new Error(`statsMonth: 'YYYY-MM' 형식이 아닙니다 (${month})`)
  const [, y, m] = match
  return [Number(y), Number(m)]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** '2026-10-13' → '2026-10'. 입력은 `todaySeoul()` 의 결과다. */
export function currentMonth(today: string): string {
  return today.slice(0, 7)
}

/** '2026-10' → { from: '2026-10-01', to: '2026-10-31' }. `Date.UTC(y, m, 0)` 이 그 달의 마지막 날이다. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = parts(month)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }
}

/** '2026-12' + 1 → '2027-01'. 해를 넘는 계산을 월 수로 바꿔서 한다. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parts(month)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`
}

/** '2026-01' → '2026년 1월' (앞의 0 을 떼고 읽는다) */
export function formatMonth(month: string): string {
  const [y, m] = parts(month)
  return `${y}년 ${m}월`
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/features/admin/statsMonth.test.ts && npm run lint && npx tsc -b
```

Expected: PASS, lint·tsc 깨끗.

- [ ] **Step 5: 커밋**

```bash
git add src/features/admin/statsMonth.ts src/features/admin/statsMonth.test.ts
git commit -m "$(cat <<'MSG'
feat(admin): 통계 월 계산 — 범위·앞뒤 이동·표기 (UTC 산술)

식사일 기준이라 조회 범위를 YYYY-MM-DD 두 개로 만든다. lib/dates 와 같이 UTC
산술만 쓴다 — 날짜만 있는 값을 로컬 Date 로 바꾸면 시간대에 하루씩 밀린다.
잘못된 월 문자열은 던진다(주소창으로 들어올 수 있다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: 그 달의 장부 조회 (`useMonthLedger.ts`)

**Files:**
- Create: `src/features/admin/useMonthLedger.ts`, `src/features/admin/useMonthLedger.test.tsx`

**왜·어떻게:** 월 범위는 **식사일** 기준이므로 `issuances`/`usages` 자체 열로는 걸 수 없다. PostgREST 의 임베딩 필터를 쓴다 — `meal:meals!inner(title, served_on)` 로 조인을 강제하고 `meal.served_on` 에 `gte`/`lte` 를 건다. **로컬 Supabase 에서 직접 확인했다**: 9월 범위는 0건, 10월 범위는 4건을 돌려주고, FK 이름 힌트가 필요한 임베딩 7개(`issuances_person_id_fkey`·`issuances_issued_by_fkey`·`issuances_cancelled_by_fkey`·`usages_person_id_fkey`·`usages_recorded_by_fkey`·`usages_voided_by_fkey`·`meals`)가 모두 풀린다.

취소·무효 행도 CSV 에 들어가므로 `cancelled_at`/`voided_at` 으로 **걸러내지 않는다**.

- [ ] **Step 1: 실패하는 테스트**

`src/features/admin/useMonthLedger.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fail, FakeQuery, ok } from '../../test/fakeSupabase'
import { MAX_LEDGER_ROWS, monthLedgerQueryKey, useMonthLedger } from './useMonthLedger'

const { from } = vi.hoisted(() => ({ from: vi.fn<(table: string) => unknown>() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from } }))

const issuanceRow = {
  id: 'i1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: '입금 확인',
  issued_at: '2026-10-09T05:00:00Z', cancelled_at: null, cancel_reason: null,
  meal: { id: 'm1', title: '주일 점심', served_on: '2026-10-11' },
  buyer: { name: '김철수' }, issuer: { name: '권사' }, canceller: null,
}
const usageRow = {
  id: 'u1', family_id: 'f1', quantity: 1, used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  meal: { id: 'm1', title: '주일 점심', served_on: '2026-10-11' },
  person: { name: '김철수' }, recorder: { name: '김철수' }, voider: null,
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('useMonthLedger', () => {
  it('식사일 범위로 발급·사용을 읽는다 (임베딩 필터)', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = ok(table === 'issuances' ? [issuanceRow] : [usageRow])))
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.issuances).toEqual([issuanceRow])
    expect(result.current.data?.usages).toEqual([usageRow])
    expect(result.current.data?.truncated).toBe(false)
    for (const table of ['issuances', 'usages']) {
      // 식사일로 거는 것이 핵심이다 — 발급 시각(issued_at)이 아니라 meals.served_on 이다
      expect(queries[table]?.has('gte', 'meal.served_on', '2026-10-01')).toBe(true)
      expect(queries[table]?.has('lte', 'meal.served_on', '2026-10-31')).toBe(true)
      expect(queries[table]?.has('limit', MAX_LEDGER_ROWS)).toBe(true)
    }
    expect(queries.issuances?.has('order', 'issued_at', { ascending: false })).toBe(true)
    expect(queries.issuances?.has('order', 'id')).toBe(true)
    expect(queries.usages?.has('order', 'used_at', { ascending: false })).toBe(true)
    expect(queries.usages?.has('order', 'id')).toBe(true)
    expect(client.getQueryData(monthLedgerQueryKey('2026-10'))).toBeDefined()
  })

  it('!inner 로 조인을 강제한다 — 안 그러면 식사일 필터가 행을 지우지 못한다', async () => {
    const queries: Record<string, FakeQuery<unknown>> = {}
    from.mockImplementation((table: string) => (queries[table] = ok([])))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const selects = Object.values(queries).flatMap((q) => q.filters.filter(([m]) => m === 'select').map(([, a]) => String(a)))
    expect(selects).toHaveLength(2)
    for (const select of selects) expect(select).toContain('meals!inner')
    // 취소·무효 행도 CSV 에 들어간다 — 걸러내지 않는다
    for (const q of Object.values(queries)) {
      expect(q.has('is', 'cancelled_at', null)).toBe(false)
      expect(q.has('is', 'voided_at', null)).toBe(false)
    }
  })

  it('천장에 닿으면 잘렸다고 알린다 (PostgREST 가 max_rows 에서 조용히 자른다)', async () => {
    const many = Array.from({ length: MAX_LEDGER_ROWS }, (_, i) => ({ ...issuanceRow, id: `i${i}` }))
    from.mockImplementation((table: string) => ok(table === 'issuances' ? many : []))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.truncated).toBe(true)
  })

  it('월 문자열이 형식에 안 맞으면 조회하지 않고 빈 결과 (주소창으로 들어올 수 있다)', async () => {
    from.mockImplementation(() => ok([]))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-13'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toEqual({ issuances: [], usages: [], truncated: false })
    expect(from).not.toHaveBeenCalled()
  })

  it('조회가 실패하면 코드를 보존한 Error 로 알린다', async () => {
    from.mockImplementation(() => fail('jwt expired', 'PGRST301'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMonthLedger('2026-10'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({ code: 'PGRST301' })
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/features/admin/useMonthLedger.test.tsx
```

Expected: FAIL — `Failed to resolve import "./useMonthLedger"`.

- [ ] **Step 3: 구현**

`src/features/admin/useMonthLedger.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { unwrap } from '../../lib/postgrest'
import { supabase } from '../../lib/supabase'
import { monthRange } from './statsMonth'

export const MONTH_LEDGER_QUERY_KEY = ['month-ledger'] as const
export const monthLedgerQueryKey = (month: string) => [...MONTH_LEDGER_QUERY_KEY, month] as const

/**
 * 한 달에 읽는 최대 행 수(표마다). PostgREST 의 `max_rows`(supabase/config.toml, 호스팅 기본값도 1000) 와 같은
 * 값을 명시해 둔다 — 넘으면 오류 없이 잘려서 합계가 조용히 작아지고 CSV 에 빠진 행이 생긴다.
 * 교회 규모(한 달에 식사 4~5회)에서는 닿지 않지만, 닿는 순간을 화면이 알려야 한다.
 */
export const MAX_LEDGER_ROWS = 1000

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// FK 가 여럿이라 임베딩에 제약 이름 힌트가 필요하다(Postgres 기본 규칙 <표>_<열>_fkey). `meals!inner` 는
// 조인을 강제한다 — 바깥 조인이면 meal.served_on 필터가 행을 지우지 못하고 meal 이 null 인 행이 남는다.
const ISSUANCE_SELECT =
  'id, family_id, quantity, unit_price, memo, issued_at, cancelled_at, cancel_reason, meal:meals!inner(id, title, served_on), buyer:people!issuances_person_id_fkey(name), issuer:people!issuances_issued_by_fkey(name), canceller:people!issuances_cancelled_by_fkey(name)'
const USAGE_SELECT =
  'id, family_id, quantity, used_at, used_via, voided_at, meal:meals!inner(id, title, served_on), person:people!usages_person_id_fkey(name), recorder:people!usages_recorded_by_fkey(name), voider:people!usages_voided_by_fkey(name)'

type NameRef = { name: string } | null
// 식사별 행은 식사 id 로 묶는다 — (served_on, title) 조합에 유일 제약이 있어도 파생 키보다 id 가 정직하다.
type MealRef = { id: string; title: string; served_on: string }

export type MonthIssuanceRow = {
  id: string
  family_id: string
  quantity: number
  unit_price: number
  memo: string | null
  issued_at: string
  cancelled_at: string | null
  cancel_reason: string | null
  meal: MealRef
  buyer: NameRef
  issuer: NameRef
  canceller: NameRef
}
export type MonthUsageRow = {
  id: string
  family_id: string
  quantity: number
  used_at: string
  used_via: string // DB 는 check 제약뿐인 text — 'self' | 'admin' 리터럴이 아니다
  voided_at: string | null
  meal: MealRef
  person: NameRef
  recorder: NameRef
  voider: NameRef
}
export type MonthLedger = {
  issuances: MonthIssuanceRow[]
  usages: MonthUsageRow[]
  /** 어느 한쪽이라도 천장에 닿았다 — 화면이 "일부만 보여요" 를 띄운다. */
  truncated: boolean
}

const EMPTY: MonthLedger = { issuances: [], usages: [], truncated: false }

/**
 * 그 달 **식사일**의 발급·사용 원본 행. 취소·무효 행도 CSV 에 들어가므로 걸러내지 않는다.
 * 관리자만 쓰는 화면이지만 RLS 가 어차피 관리자에게만 전부 연다(교인이 주소를 쳐도 자기 가족만 온다).
 */
export function useMonthLedger(month: string) {
  return useQuery({
    queryKey: monthLedgerQueryKey(month),
    queryFn: async (): Promise<MonthLedger> => {
      if (!MONTH_RE.test(month)) return EMPTY
      const { from, to } = monthRange(month)
      const [issuances, usages] = await Promise.all([
        supabase
          .from('issuances')
          .select(ISSUANCE_SELECT)
          .gte('meal.served_on', from)
          .lte('meal.served_on', to)
          .order('issued_at', { ascending: false })
          .order('id')
          .limit(MAX_LEDGER_ROWS)
          .then(unwrap),
        supabase
          .from('usages')
          .select(USAGE_SELECT)
          .gte('meal.served_on', from)
          .lte('meal.served_on', to)
          .order('used_at', { ascending: false })
          .order('id')
          .limit(MAX_LEDGER_ROWS)
          .then(unwrap),
      ])
      return {
        issuances,
        usages,
        truncated: issuances.length >= MAX_LEDGER_ROWS || usages.length >= MAX_LEDGER_ROWS,
      }
    },
  })
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/features/admin/useMonthLedger.test.tsx && npm run lint && npx tsc -b
```

Expected: 5 passed, lint·tsc 깨끗.

- [ ] **Step 5: 새 캐시를 무효화하는 곳을 잇는다 — 실패하는 테스트부터**

**왜 이 단계가 있는가:** 4b 에서 **같은 종류의 버그를 양방향으로 두 번** 겪었다(발급 취소가 사람 이력을 무효화하지 않았고, 합치기가 상대편 상세·식사 현황판을 무효화하지 않았다). 새 캐시를 만들었으니 그 캐시를 낡게 만드는 쓰기를 **지금** 모두 잇는다. 발급·취소·무효·대신 사용·합치기·초기화는 모두 그 달 합계와 CSV 내용을 바꾼다. 어느 달인지 모르므로 **접두사**(`MONTH_LEDGER_QUERY_KEY`)로 덮는다 — `useMealOps` 의 `PERSON_LEDGER_QUERY_KEY` 와 같은 이유다.

식사 추가·삭제(`useMeals`)는 잇지 않는다 — 발급이 있는 식사는 FK 가 삭제를 막으므로 장부가 바뀌지 않는다.

`src/features/admin/useIssue.test.tsx` 의 무효화 단언에 한 줄 더한다:

```ts
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ledger'] })
    // 통계의 그 달 장부도 낡는다 (어느 달인지 모르므로 접두사로)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['month-ledger'] })
```

`src/features/admin/useMealOps.test.tsx` 의 `OPS_KEYS` 끝에 `['month-ledger']` 를 더한다(목록 순서까지 단언하므로 **구현의 추가 순서와 같아야 한다** — 맨 뒤에 붙인다).

`src/features/admin/usePersonOps.test.tsx` 의 `PEOPLE_KEYS` 끝에도 `['month-ledger']` 를 더한다(합치기·초기화는 CSV 의 이름과 가족 대표를 바꾼다).

- [ ] **Step 6: 실패 확인**

```bash
npx vitest run src/features/admin/useIssue.test.tsx src/features/admin/useMealOps.test.tsx src/features/admin/usePersonOps.test.tsx
```

Expected: 세 파일 모두 FAIL — 키 목록에 `['month-ledger']` 가 없다.

- [ ] **Step 7: 세 곳을 잇는다**

`src/features/admin/useIssue.ts` — import 를 더하고 `onSuccess` 의 `Promise.all` 맨 뒤에 한 줄:

```ts
import { MONTH_LEDGER_QUERY_KEY } from './useMonthLedger'
```
```ts
        queryClient.invalidateQueries({ queryKey: PERSON_LEDGER_QUERY_KEY }),
        // 통계의 그 달 장부 (어느 달인지 모르므로 접두사로 — PERSON_LEDGER_QUERY_KEY 와 같은 이유)
        queryClient.invalidateQueries({ queryKey: MONTH_LEDGER_QUERY_KEY }),
```

`src/features/admin/useMealOps.ts` — `invalidateMealOps` 의 배열 맨 뒤에 같은 줄을 더하고 그 함수의 주석에 "그리고 통계의 그 달 장부" 를 적는다.

`src/features/admin/usePersonOps.ts` — `invalidatePeople` 의 배열 맨 뒤에 같은 줄을 더하고 주석에 "합치기·초기화는 CSV 의 이름·가족 대표도 바꾼다" 를 적는다.

- [ ] **Step 8: 통과 확인**

```bash
npm test && npm run lint && npx tsc -b
```

Expected: 전부 PASS.

- [ ] **Step 9: 커밋**

```bash
git add src/features/admin/useMonthLedger.ts src/features/admin/useMonthLedger.test.tsx src/features/admin/useIssue.ts src/features/admin/useIssue.test.tsx src/features/admin/useMealOps.ts src/features/admin/useMealOps.test.tsx src/features/admin/usePersonOps.ts src/features/admin/usePersonOps.test.tsx
git commit -m "$(cat <<'MSG'
feat(admin): 그 달 식사의 발급·사용 조회 (임베딩 식사일 필터)

월 범위는 식사일 기준이라 장부 자체 열로는 걸 수 없다. meals!inner 로 조인을
강제하고 meal.served_on 에 gte/lte 를 건다 — 바깥 조인이면 필터가 행을 지우지
못한다. 로컬에서 확인했다(9월 범위 0건, 10월 범위 4건).

취소·무효 행은 CSV 에 들어가므로 걸러내지 않는다. max_rows 1000 천장을
MAX_LEDGER_ROWS 로 명시하고, 닿으면 truncated 로 알린다.

새 캐시를 낡게 만드는 쓰기를 같은 커밋에서 모두 잇는다 — 발급·취소·무효·대신
사용·합치기·초기화. 4b 에서 이 종류의 버그를 양방향으로 두 번 겪었다. 어느 달인지
모르므로 접두사로 덮는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: 통계 행·합계·식사별·이름 검색 (`statsRows.ts`)

**Files:**
- Create: `src/features/admin/statsRows.ts`, `src/features/admin/statsRows.test.ts`

**설계 결정 (여기서 못 박는다):**

- **취소·무효는 별도 행이다.** 취소된 발급은 `발급` 행(발급 시각)과 `취소` 행(취소 시각) 둘이 된다. 설계가 "취소·무효 행 포함" 이라고 했고, 일시가 다르므로 한 행에 담을 수 없다.
- **합계는 그 행들에서 계산한다** — `발급 − 취소`, `사용 − 무효`. `ticket_balances` 뷰와 산술적으로 같지만 **한 번 읽은 장부에서 화면 숫자와 CSV 를 함께 만들어** 둘이 어긋날 수 없게 한다.
- **사용·무효 행에는 단가·금액이 없다**(빈 칸). 장부에 그 값이 없다 — 지어내지 않는다.
- **`처리자` 는 그 동작을 기록한 사람**이다. 발급은 `issued_by`, 취소는 `cancelled_by`, 사용은 `recorded_by`, 무효는 `voided_by`. 본인 폰 사용은 `recorded_by = person_id` 라 이름이 같게 나오는데, 그게 사실이다. 설계가 11열을 고정했으므로 `경로(본인 폰/담당자 처리)` 열은 **넣지 않는다** — 같은 이름이면 본인 폰이라는 뜻이다.
- **정렬은 최신순**(앱의 다른 장부와 같다). `mergeLedger` 가 배운 함정을 그대로 피한다 — 문자열 비교가 아니라 **실제 시각(ms)** 으로 비교하고, 같으면 id 로 고정한다.
- **이름이 가려진 행**(합쳐짐·초기화됨)은 DB 가 `'탈퇴한 사용자'` 로 돌려준다. 그대로 쓴다 — 통계는 그 사람이 그때 거기 있었다는 기록이다.

- [ ] **Step 1: 실패하는 테스트**

`src/features/admin/statsRows.test.ts`:

```ts
import type { MonthIssuanceRow, MonthUsageRow } from './useMonthLedger'
import { byMeal, filterByName, summarizeMonth, toStatsRows } from './statsRows'

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11' }
const other = { id: 'm2', title: '수요 저녁', served_on: '2026-10-07' }

const issuance = (over: Partial<MonthIssuanceRow> = {}): MonthIssuanceRow => ({
  id: 'i1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: '입금 확인',
  issued_at: '2026-10-09T05:00:00Z', cancelled_at: null, cancel_reason: null,
  meal, buyer: { name: '김철수' }, issuer: { name: '권사' }, canceller: null, ...over,
})
const usage = (over: Partial<MonthUsageRow> = {}): MonthUsageRow => ({
  id: 'u1', family_id: 'f1', quantity: 1, used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
  meal, person: { name: '김철수' }, recorder: { name: '김철수' }, voider: null, ...over,
})
const reps = new Map([['f1', '김철수'], ['f2', '이영희']])

describe('toStatsRows', () => {
  it('발급 한 건 → 발급 행 하나 (단가·금액·처리자·메모)', () => {
    expect(toStatsRows({ issuances: [issuance()], usages: [] }, reps)).toEqual([
      {
        kind: '발급', at: '2026-10-09T05:00:00Z', servedOn: '2026-10-11', mealId: 'm1', mealTitle: '주일 점심',
        name: '김철수', familyRep: '김철수', quantity: 2, unitPrice: 5000, amount: 10000, handler: '권사', memo: '입금 확인',
      },
    ])
  })

  it('취소된 발급 → 발급 행과 취소 행 둘 (일시·처리자가 다르고 취소 메모는 사유다)', () => {
    const rows = toStatsRows(
      { issuances: [issuance({ cancelled_at: '2026-10-10T01:00:00Z', cancel_reason: '입금 취소', canceller: { name: '권사' } })], usages: [] },
      reps,
    )
    expect(rows.map((r) => r.kind)).toEqual(['취소', '발급'])
    expect(rows[0]).toMatchObject({ kind: '취소', at: '2026-10-10T01:00:00Z', quantity: 2, amount: 10000, handler: '권사', memo: '입금 취소' })
    expect(rows[1]).toMatchObject({ kind: '발급', at: '2026-10-09T05:00:00Z', memo: '입금 확인' })
  })

  it('사용·무효 행에는 단가·금액이 없다 (장부에 없는 값을 지어내지 않는다)', () => {
    const rows = toStatsRows(
      { issuances: [], usages: [usage({ voided_at: '2026-10-11T04:00:00Z', voider: { name: '권사' } })] },
      reps,
    )
    expect(rows.map((r) => r.kind)).toEqual(['무효', '사용'])
    expect(rows[0]).toMatchObject({ kind: '무효', unitPrice: null, amount: null, handler: '권사' })
    expect(rows[1]).toMatchObject({ kind: '사용', unitPrice: null, amount: null, handler: '김철수', memo: null })
  })

  it('이름이 없는 행(가려짐·탈퇴)은 빈 문자열로 둔다', () => {
    const rows = toStatsRows({ issuances: [issuance({ buyer: null, issuer: null })], usages: [] }, reps)
    expect(rows[0]).toMatchObject({ name: '', handler: '' })
  })

  it('가족 대표를 모르는 가족은 빈 칸 (살아 있는 어른이 없는 가족)', () => {
    const rows = toStatsRows({ issuances: [issuance({ family_id: 'f9' })], usages: [] }, reps)
    expect(rows[0]?.familyRep).toBe('')
  })

  it('최신순으로 섞어 정렬한다 (문자열이 아니라 실제 시각으로 — 분수 초가 섞여도 순서가 맞다)', () => {
    const rows = toStatsRows(
      {
        issuances: [issuance({ id: 'i1', issued_at: '2026-10-09T05:00:00+00:00' })],
        usages: [
          usage({ id: 'u1', used_at: '2026-10-09T05:00:00.500+00:00' }),
          usage({ id: 'u2', used_at: '2026-10-11T03:31:00Z' }),
        ],
      },
      reps,
    )
    expect(rows.map((r) => `${r.kind}:${r.at}`)).toEqual([
      '사용:2026-10-11T03:31:00Z',
      '사용:2026-10-09T05:00:00.500+00:00',
      '발급:2026-10-09T05:00:00+00:00',
    ])
  })

  it('같은 시각이면 종류·id 로 순서를 고정한다 (조회마다 자리가 바뀌지 않게)', () => {
    const a = toStatsRows({ issuances: [issuance({ id: 'iB' }), issuance({ id: 'iA' })], usages: [] }, reps)
    const b = toStatsRows({ issuances: [issuance({ id: 'iA' }), issuance({ id: 'iB' })], usages: [] }, reps)
    expect(a.map((r) => r.name)).toEqual(b.map((r) => r.name))
    expect(a).toEqual(b)
  })
})

describe('summarizeMonth', () => {
  it('발급 − 취소, 사용 − 무효, 금액도 같은 규칙 (ticket_balances 와 산술이 같다)', () => {
    const rows = toStatsRows(
      {
        issuances: [
          issuance({ id: 'i1', quantity: 2, unit_price: 5000 }),
          issuance({ id: 'i2', quantity: 3, unit_price: 5000, cancelled_at: '2026-10-10T01:00:00Z', cancel_reason: '취소', canceller: { name: '권사' } }),
        ],
        usages: [
          usage({ id: 'u1', quantity: 1 }),
          usage({ id: 'u2', quantity: 1, voided_at: '2026-10-11T04:00:00Z', voider: { name: '권사' } }),
        ],
      },
      reps,
    )
    expect(summarizeMonth(rows)).toEqual({ issued: 2, used: 1, amount: 10000 })
  })

  it('빈 달은 0', () => {
    expect(summarizeMonth([])).toEqual({ issued: 0, used: 0, amount: 0 })
  })
})

describe('byMeal', () => {
  it('식사별로 묶어 식사일 늦은 것부터 (같은 날은 이름 순)', () => {
    const rows = toStatsRows(
      {
        issuances: [issuance({ id: 'i1' }), issuance({ id: 'i2', meal: other, quantity: 1 })],
        usages: [usage({ id: 'u1' })],
      },
      reps,
    )
    expect(byMeal(rows)).toEqual([
      { mealId: 'm1', servedOn: '2026-10-11', mealTitle: '주일 점심', issued: 2, used: 1, amount: 10000 },
      { mealId: 'm2', servedOn: '2026-10-07', mealTitle: '수요 저녁', issued: 1, used: 0, amount: 5000 },
    ])
  })

  it('식사별 합계도 취소·무효를 뺀다', () => {
    const rows = toStatsRows(
      { issuances: [issuance({ cancelled_at: '2026-10-10T01:00:00Z', cancel_reason: '취소', canceller: { name: '권사' } })], usages: [] },
      reps,
    )
    expect(byMeal(rows)).toEqual([{ mealId: 'm1', servedOn: '2026-10-11', mealTitle: '주일 점심', issued: 0, used: 0, amount: 0 }])
  })
})

describe('filterByName', () => {
  const rows = toStatsRows(
    { issuances: [issuance({ id: 'i1' }), issuance({ id: 'i2', family_id: 'f2', buyer: { name: '이영희' } })], usages: [] },
    reps,
  )

  it('빈 검색어는 전부', () => {
    expect(filterByName(rows, '')).toHaveLength(2)
    expect(filterByName(rows, '   ')).toHaveLength(2)
  })

  it('이름 일부로 좁힌다 (NFD 로 들어온 자모도 맞춘다)', () => {
    expect(filterByName(rows, '영희').map((r) => r.name)).toEqual(['이영희'])
    expect(filterByName(rows, '영희'.normalize('NFD')).map((r) => r.name)).toEqual(['이영희'])
  })

  it('가족 대표로도 걸린다 (한 가족의 다른 식구 이름으로 찾을 수 있게)', () => {
    expect(filterByName(rows, '김철수').map((r) => r.name)).toEqual(['김철수'])
  })

  it('받은 배열을 건드리지 않는다', () => {
    const before = rows.map((r) => r.kind)
    filterByName(rows, '영희')
    expect(rows.map((r) => r.kind)).toEqual(before)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/features/admin/statsRows.test.ts
```

Expected: FAIL — `Failed to resolve import "./statsRows"`.

- [ ] **Step 3: 구현**

`src/features/admin/statsRows.ts`:

```ts
import { nameKey } from '../../lib/search'
import type { MonthIssuanceRow, MonthUsageRow } from './useMonthLedger'

export type StatsKind = '발급' | '취소' | '사용' | '무효'

/** CSV 한 줄과 화면 한 줄이 같은 모양이다 — 둘이 어긋날 수 없게 한 곳에서 만든다. */
export type StatsRow = {
  kind: StatsKind
  /** 그 동작이 일어난 시각 (발급/취소/사용/무효 각각 다르다) */
  at: string
  servedOn: string
  mealId: string
  mealTitle: string
  /** 구매자 또는 사용자. 가려진 행은 DB 가 '탈퇴한 사용자' 로 돌려준다. 참조가 없으면 빈 문자열. */
  name: string
  familyRep: string
  quantity: number
  /** 사용·무효에는 없다 — 장부에 없는 값을 지어내지 않는다. */
  unitPrice: number | null
  amount: number | null
  /** 그 동작을 기록한 사람 (발급 issued_by · 취소 cancelled_by · 사용 recorded_by · 무효 voided_by) */
  handler: string
  memo: string | null
}

export type MealStats = { mealId: string; servedOn: string; mealTitle: string; issued: number; used: number; amount: number }
export type MonthTotals = { issued: number; used: number; amount: number }

type Source = { issuances: readonly MonthIssuanceRow[]; usages: readonly MonthUsageRow[] }

const nameOf = (ref: { name: string } | null) => ref?.name ?? ''

// 같은 시각이 섞일 수 있어 종류·id 로 순서를 고정한다 (조회마다 줄이 뒤바뀌면 CSV 가 매번 달라진다).
const KIND_ORDER: Record<StatsKind, number> = { 발급: 0, 취소: 1, 사용: 2, 무효: 3 }

/**
 * 원본 장부를 통계 행으로 펼친다. 취소된 발급은 `발급`·`취소` 두 행이 되고(일시가 다르다), 무효 처리된 사용도
 * `사용`·`무효` 두 행이 된다 — 설계의 "취소·무효 행 포함" 이 이것이다.
 * 정렬은 최신순. `localeCompare` 는 ICU 규칙상 분수 초('.')를 시간대 부호('+')보다 앞세워 실제 순서를 뒤집을 수
 * 있으므로(교인 내역에서 당했다) **실제 시각(ms)** 으로 비교한다.
 */
export function toStatsRows(source: Source, repByFamily: ReadonlyMap<string, string>): StatsRow[] {
  const rows: StatsRow[] = []
  for (const i of source.issuances) {
    const common = {
      servedOn: i.meal.served_on,
      mealId: i.meal.id,
      mealTitle: i.meal.title,
      name: nameOf(i.buyer),
      familyRep: repByFamily.get(i.family_id) ?? '',
      quantity: i.quantity,
      unitPrice: i.unit_price,
      amount: i.quantity * i.unit_price,
    }
    rows.push({ ...common, kind: '발급', at: i.issued_at, handler: nameOf(i.issuer), memo: i.memo })
    if (i.cancelled_at !== null) {
      rows.push({ ...common, kind: '취소', at: i.cancelled_at, handler: nameOf(i.canceller), memo: i.cancel_reason })
    }
  }
  for (const u of source.usages) {
    const common = {
      servedOn: u.meal.served_on,
      mealId: u.meal.id,
      mealTitle: u.meal.title,
      name: nameOf(u.person),
      familyRep: repByFamily.get(u.family_id) ?? '',
      quantity: u.quantity,
      unitPrice: null,
      amount: null,
      memo: null,
    }
    rows.push({ ...common, kind: '사용', at: u.used_at, handler: nameOf(u.recorder) })
    if (u.voided_at !== null) {
      rows.push({ ...common, kind: '무효', at: u.voided_at, handler: nameOf(u.voider) })
    }
  }
  return rows.toSorted(
    (a, b) =>
      Date.parse(b.at) - Date.parse(a.at) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.mealId.localeCompare(b.mealId) ||
      a.name.localeCompare(b.name, 'ko'),
  )
}

/** 취소·무효를 뺀 그 달 합계. ticket_balances 뷰와 산술이 같다. */
export function summarizeMonth(rows: readonly StatsRow[]): MonthTotals {
  let issued = 0
  let used = 0
  let amount = 0
  for (const r of rows) {
    if (r.kind === '발급') {
      issued += r.quantity
      amount += r.amount ?? 0
    } else if (r.kind === '취소') {
      issued -= r.quantity
      amount -= r.amount ?? 0
    } else if (r.kind === '사용') {
      used += r.quantity
    } else {
      used -= r.quantity
    }
  }
  return { issued, used, amount }
}

/** 식사별 행, 식사일 늦은 것부터 (같은 날은 이름 순 — 조회마다 순서가 바뀌지 않게). */
export function byMeal(rows: readonly StatsRow[]): MealStats[] {
  const out = new Map<string, MealStats>()
  for (const r of rows) {
    const s = out.get(r.mealId) ?? { mealId: r.mealId, servedOn: r.servedOn, mealTitle: r.mealTitle, issued: 0, used: 0, amount: 0 }
    const sign = r.kind === '취소' || r.kind === '무효' ? -1 : 1
    if (r.kind === '발급' || r.kind === '취소') {
      s.issued += sign * r.quantity
      s.amount += sign * (r.amount ?? 0)
    } else {
      s.used += sign * r.quantity
    }
    out.set(r.mealId, s)
  }
  return [...out.values()].toSorted((a, b) => b.servedOn.localeCompare(a.servedOn) || a.mealTitle.localeCompare(b.mealTitle, 'ko'))
}

/** 이름(구매자·사용자) 또는 가족 대표로 좁힌다. 번호 검색은 두지 않는다 — 장부 행에 번호가 없다. */
export function filterByName(rows: readonly StatsRow[], query: string): StatsRow[] {
  const key = nameKey(query)
  if (!key) return [...rows]
  return rows.filter((r) => nameKey(r.name).includes(key) || nameKey(r.familyRep).includes(key))
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/features/admin/statsRows.test.ts && npm run lint && npx tsc -b
```

Expected: 14 passed, lint·tsc 깨끗.

- [ ] **Step 5: 커밋**

```bash
git add src/features/admin/statsRows.ts src/features/admin/statsRows.test.ts
git commit -m "$(cat <<'MSG'
feat(admin): 통계 행·합계·식사별·이름 검색 (순수)

취소된 발급은 발급·취소 두 행이 된다(일시가 다르다). 설계의 "취소·무효 행 포함"
이 이것이고, 합계는 그 행들에서 발급−취소·사용−무효 로 계산한다 — 한 번 읽은
장부에서 화면 숫자와 CSV 를 함께 만들어 둘이 어긋날 수 없게 한다.

사용·무효 행에는 단가·금액이 없다(빈 칸). 장부에 없는 값을 지어내지 않는다.
정렬은 최신순이고, 문자열이 아니라 실제 시각(ms)으로 비교한다 — localeCompare 는
분수 초를 시간대 부호보다 앞세워 순서를 뒤집는다(교인 내역에서 당한 함정).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: CSV 만들기 (`statsCsv.ts`)

**Files:**
- Modify: `src/lib/dates.ts`, `src/lib/dates.test.ts` (연도까지 있는 시각 표기 하나 추가)
- Create: `src/features/admin/statsCsv.ts`, `src/features/admin/statsCsv.test.ts`

**설계 결정:**

- **엑셀을 위해 UTF-8 BOM 을 붙인다.** 한국어 윈도우 엑셀은 BOM 이 없으면 CSV 를 cp949 로 읽어 한글이 깨진다.
- **줄 끝은 CRLF** (엑셀·구글 시트가 모두 안전하게 읽는다).
- **장수·단가·금액은 숫자만** 쓴다(천 단위 쉼표도, '원' 도 넣지 않는다). 엑셀에서 더할 수 있어야 한다. 화면에는 `formatWon` 으로 보여 주고 CSV 에는 숫자를 넣는다.
- **일시는 `YYYY-MM-DD HH:MM`(서울)** 이다. 화면용 `formatDateTime` 은 'M/D HH:MM' 이라 연도가 없어 CSV 로는 쓸 수 없다.
- **수식 주입을 막는다.** `=` `+` `-` `@` 로 시작하는 칸은 앞에 `'` 를 붙인다. **이름은 교인이 직접 적는 값**이라(20자 제한뿐이고 `=` 를 막지 않는다) 수식으로 시작하는 이름이 들어올 수 있다. 엑셀에서 `'` 가 글자로 보이는 대가를 치르지만, 권사님 노트북에서 수식이 실행되는 쪽보다 낫다.

- [ ] **Step 1: 실패하는 테스트 — 시각 표기부터**

`src/lib/dates.test.ts` 맨 아래에 `describe` 하나를 더한다:

```ts
describe('formatSeoulStamp', () => {
  it('ISO 시각 → 서울 YYYY-MM-DD HH:MM (CSV 는 연도가 있어야 한다)', () => {
    expect(formatSeoulStamp('2026-10-11T03:31:00Z')).toBe('2026-10-11 12:31')
  })

  it('자정을 넘기는 UTC 시각도 서울 날짜로 찍는다', () => {
    expect(formatSeoulStamp('2026-10-10T16:00:00Z')).toBe('2026-10-11 01:00')
  })
})
```

같은 파일 맨 위 import 에 `formatSeoulStamp` 를 더한다.

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/lib/dates.test.ts
```

Expected: FAIL — `formatSeoulStamp is not a function`.

- [ ] **Step 3: 구현 — 시각 표기**

`src/lib/dates.ts` 의 `formatDateTime` 아래에 더한다:

```ts
/** ISO 시각 → 서울 'YYYY-MM-DD HH:MM'. CSV 용 — 화면용 formatDateTime 은 연도가 없다. */
export function formatSeoulStamp(iso: string): string {
  const at = new Date(iso)
  return `${ymd.format(at)} ${hm.format(at)}`
}
```

- [ ] **Step 4: 실패하는 테스트 — CSV**

`src/features/admin/statsCsv.test.ts`:

```ts
import type { StatsRow } from './statsRows'
import { csvFilename, toCsv } from './statsCsv'

const row = (over: Partial<StatsRow> = {}): StatsRow => ({
  kind: '발급', at: '2026-10-09T05:00:00Z', servedOn: '2026-10-11', mealId: 'm1', mealTitle: '주일 점심',
  name: '김철수', familyRep: '김철수', quantity: 2, unitPrice: 5000, amount: 10000, handler: '권사', memo: '입금 확인', ...over,
})

const lines = (text: string) => text.replace(/^﻿/, '').split('\r\n')

describe('toCsv', () => {
  it('BOM 으로 시작한다 (한국어 엑셀이 cp949 로 읽어 한글이 깨지는 것을 막는다)', () => {
    expect(toCsv([])).toMatch(/^﻿/)
  })

  it('머리글 11열, 설계 순서대로', () => {
    expect(lines(toCsv([]))[0]).toBe('종류,일시,식사일,식사명,이름,가족 대표,장수,단가,금액,처리자,메모')
  })

  it('빈 달은 머리글만 (끝에 빈 줄을 남기지 않는다)', () => {
    expect(lines(toCsv([]))).toHaveLength(1)
  })

  it('발급 한 줄 — 금액은 숫자만 (엑셀에서 더할 수 있어야 한다)', () => {
    expect(lines(toCsv([row()]))[1]).toBe('발급,2026-10-09 14:00,2026-10-11,주일 점심,김철수,김철수,2,5000,10000,권사,입금 확인')
  })

  it('사용 행의 단가·금액·메모는 빈 칸', () => {
    const used = row({ kind: '사용', at: '2026-10-11T03:31:00Z', quantity: 1, unitPrice: null, amount: null, memo: null, handler: '김철수' })
    expect(lines(toCsv([used]))[1]).toBe('사용,2026-10-11 12:31,2026-10-11,주일 점심,김철수,김철수,1,,,김철수,')
  })

  it('쉼표·따옴표·줄바꿈이 든 칸은 인용하고 따옴표는 두 개로 늘린다', () => {
    const odd = row({ mealTitle: '점심, 특식', memo: '김"권사"님\n확인' })
    expect(lines(toCsv([odd]))[1]).toContain('"점심, 특식"')
    expect(toCsv([odd])).toContain('"김""권사""님\n확인"')
  })

  it('수식으로 시작하는 칸은 앞에 \' 를 붙인다 (이름은 교인이 직접 적는 값이다)', () => {
    expect(lines(toCsv([row({ name: '=HYPERLINK("http://x")' })]))[1]).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(lines(toCsv([row({ memo: '-1 확인' })]))[1]).toContain(`'-1 확인`)
  })

  it('줄 순서는 받은 순서 그대로 (정렬은 statsRows 가 이미 했다)', () => {
    const text = lines(toCsv([row({ name: '가' }), row({ name: '나' })]))
    expect(text[1]).toContain('가')
    expect(text[2]).toContain('나')
  })
})

describe('csvFilename', () => {
  it('월이 들어간 이름', () => {
    expect(csvFilename('2026-10')).toBe('식권-2026-10.csv')
  })
})
```

- [ ] **Step 5: 실패 확인**

```bash
npx vitest run src/features/admin/statsCsv.test.ts
```

Expected: FAIL — `Failed to resolve import "./statsCsv"`.

- [ ] **Step 6: 구현 — CSV**

`src/features/admin/statsCsv.ts`:

```ts
import { formatSeoulStamp } from '../../lib/dates'
import type { StatsRow } from './statsRows'

/** 설계 §8.3 이 정한 11열, 그 순서. */
const HEADER = ['종류', '일시', '식사일', '식사명', '이름', '가족 대표', '장수', '단가', '금액', '처리자', '메모'] as const

// 엑셀이 칸을 수식으로 해석하는 글자들. 이름은 교인이 직접 적는 값이라(20자 제한뿐) 여기로 들어올 수 있다.
const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTE = /[",\n\r]/

function cell(value: string | number | null): string {
  if (value === null) return ''
  const text = typeof value === 'number' ? String(value) : value
  if (text === '') return ''
  const safe = FORMULA_START.test(text) ? `'${text}` : text
  return NEEDS_QUOTE.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/**
 * 통계 행 → CSV 문자열. 줄 순서는 받은 그대로다(정렬은 `statsRows` 가 한다).
 * BOM 은 한국어 엑셀이 cp949 로 읽어 한글이 깨지는 것을 막고, CRLF 는 엑셀·구글 시트가 모두 안전하게 읽는다.
 * 장수·단가·금액은 숫자만 쓴다 — 엑셀에서 더할 수 있어야 한다.
 */
export function toCsv(rows: readonly StatsRow[]): string {
  const body = rows.map((r) =>
    [
      r.kind,
      formatSeoulStamp(r.at),
      r.servedOn,
      r.mealTitle,
      r.name,
      r.familyRep,
      r.quantity,
      r.unitPrice,
      r.amount,
      r.handler,
      r.memo,
    ]
      .map(cell)
      .join(','),
  )
  return `﻿${[HEADER.join(','), ...body].join('\r\n')}`
}

/** '2026-10' → '식권-2026-10.csv' */
export function csvFilename(month: string): string {
  return `식권-${month}.csv`
}
```

- [ ] **Step 7: 통과 확인**

```bash
npx vitest run src/lib/dates.test.ts src/features/admin/statsCsv.test.ts && npm run lint && npx tsc -b
```

Expected: 모두 PASS, lint·tsc 깨끗.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts src/features/admin/statsCsv.ts src/features/admin/statsCsv.test.ts
git commit -m "$(cat <<'MSG'
feat(admin): 통계 CSV 만들기 (11열·BOM·CRLF·수식 주입 차단)

한국어 엑셀은 BOM 이 없으면 cp949 로 읽어 한글이 깨진다. 장수·단가·금액은 숫자만
써서 엑셀에서 더할 수 있게 한다(화면에는 formatWon 으로 보여 준다).

수식으로 시작하는 칸은 앞에 ' 를 붙인다 — 이름은 교인이 직접 적는 값이고 20자
제한뿐이라 '=' 로 시작하는 이름이 들어올 수 있다. 엑셀에서 ' 가 글자로 보이는
대가를 치르지만, 권사님 노트북에서 수식이 실행되는 쪽보다 낫다.

CSV 용 시각 표기(formatSeoulStamp)를 lib/dates 에 둔다 — 화면용 formatDateTime 은
연도가 없어 CSV 로는 쓸 수 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: 내려받기와 공유 (`shareCsv.ts`)

**Files:**
- Create: `src/features/admin/shareCsv.ts`, `src/features/admin/shareCsv.test.ts`

**왜 따로 두는가:** 브라우저 API(`URL.createObjectURL`·`<a download>`·`navigator.share`·`navigator.canShare`)를 한 곳에 모아 두면 화면은 평범한 함수 두 개만 부르고, 테스트는 jsdom 에서 그 API 를 바꿔 끼울 수 있다. jsdom 에는 `createObjectURL` 과 `navigator.share` 가 **아예 없다** — 화면 안에서 직접 부르면 테스트가 터진다.

**공유 지원 판정:** `navigator.canShare({ files })` 가 유일하게 믿을 수 있는 신호다. `navigator.share` 만 보고 파일 공유가 되는지 알 수 없다(데스크톱 크롬은 `share` 는 있고 파일은 못 받는다). 설계가 "미지원 시 숨김" 이라 했으므로 **판정이 거짓이면 버튼을 아예 그리지 않는다**.

- [ ] **Step 1: 실패하는 테스트**

`src/features/admin/shareCsv.test.ts`:

```ts
import { canShareCsv, downloadCsv, shareCsv } from './shareCsv'

const TEXT = '﻿종류,일시\r\n발급,2026-10-09 14:00'

describe('downloadCsv', () => {
  it('objectURL 을 만들어 a[download] 를 누르고, 끝나면 되돌린다 (메모리 누수 방지)', () => {
    const createObjectURL = vi.fn<(b: Blob) => string>(() => 'blob:x')
    const revokeObjectURL = vi.fn<(u: string) => void>()
    const click = vi.fn<() => void>()
    const anchor = { click, href: '', download: '' } as unknown as HTMLAnchorElement
    downloadCsv('식권-2026-10.csv', TEXT, { createObjectURL, revokeObjectURL, anchor })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]![0]
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(anchor.href).toBe('blob:x')
    expect(anchor.download).toBe('식권-2026-10.csv')
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })
})

describe('canShareCsv', () => {
  it('canShare 가 파일을 받겠다고 할 때만 참', () => {
    expect(canShareCsv({ canShare: () => true, share: async () => {} })).toBe(true)
  })

  it('canShare 가 거짓이면 거짓 (데스크톱 크롬은 share 는 있고 파일은 못 받는다)', () => {
    expect(canShareCsv({ canShare: () => false, share: async () => {} })).toBe(false)
  })

  it('API 가 아예 없으면 거짓 (iOS 가 아닌 브라우저·jsdom)', () => {
    expect(canShareCsv({})).toBe(false)
    expect(canShareCsv({ share: async () => {} })).toBe(false)
  })

  it('canShare 가 던져도 거짓으로 본다 (파일 생성이 막힌 환경)', () => {
    expect(canShareCsv({ canShare: () => { throw new Error('nope') }, share: async () => {} })).toBe(false)
  })
})

describe('shareCsv', () => {
  it('파일 하나를 share 에 넘긴다', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {})
    await shareCsv('식권-2026-10.csv', TEXT, { canShare: () => true, share })
    const data = share.mock.calls[0]![0]
    expect(data.files?.[0]?.name).toBe('식권-2026-10.csv')
    expect(data.files?.[0]?.type).toBe('text/csv;charset=utf-8')
    expect(data.title).toBe('식권-2026-10.csv')
  })

  it('사용자가 공유 창을 닫으면(AbortError) 조용히 끝난다 — 오류로 띄우지 않는다', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' })
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => { throw abort })
    await expect(shareCsv('x.csv', TEXT, { canShare: () => true, share })).resolves.toBeUndefined()
  })

  it('그 밖의 실패는 던진다 (화면이 문구를 띄운다)', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => { throw new Error('boom') })
    await expect(shareCsv('x.csv', TEXT, { canShare: () => true, share })).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/features/admin/shareCsv.test.ts
```

Expected: FAIL — `Failed to resolve import "./shareCsv"`.

- [ ] **Step 3: 구현**

`src/features/admin/shareCsv.ts`:

```ts
/**
 * CSV 를 내려받거나 공유한다. 브라우저 API 를 여기 한 곳에 모아 두어 화면은 평범한 함수만 부르고,
 * 테스트는 그 API 를 바꿔 끼운다 — jsdom 에는 `createObjectURL` 과 `navigator.share` 가 아예 없다.
 */
export const CSV_TYPE = 'text/csv;charset=utf-8'

type DownloadDeps = {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  anchor: HTMLAnchorElement
}

function browserDownloadDeps(): DownloadDeps {
  return { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL, anchor: document.createElement('a') }
}

/** objectURL 을 만들어 `a[download]` 를 누른다. 끝나면 되돌린다 — 안 되돌리면 탭이 살아 있는 동안 메모리에 남는다. */
export function downloadCsv(filename: string, text: string, deps: DownloadDeps = browserDownloadDeps()): void {
  const url = deps.createObjectURL(new Blob([text], { type: CSV_TYPE }))
  try {
    deps.anchor.href = url
    deps.anchor.download = filename
    deps.anchor.click()
  } finally {
    deps.revokeObjectURL(url)
  }
}

type ShareDeps = {
  canShare?: (data: ShareData) => boolean
  share?: (data: ShareData) => Promise<void>
}

const probeFile = () => new File(['﻿'], 'probe.csv', { type: CSV_TYPE })

/**
 * 파일 공유가 되는 브라우저인가. `canShare({ files })` 가 유일하게 믿을 수 있는 신호다 —
 * 데스크톱 크롬은 `share` 는 있고 파일은 못 받는다. 설계대로 거짓이면 버튼을 아예 그리지 않는다.
 */
export function canShareCsv(nav: ShareDeps = navigator): boolean {
  if (typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return false
  try {
    return nav.canShare({ files: [probeFile()] })
  } catch {
    // File 을 만들 수 없거나 canShare 가 던지는 환경 — 없는 것으로 본다
    return false
  }
}

/** 카카오톡 등으로 공유. 사용자가 창을 닫으면(AbortError) 조용히 끝낸다 — 실패가 아니다. */
export async function shareCsv(filename: string, text: string, nav: ShareDeps = navigator): Promise<void> {
  const share = nav.share
  if (!share) return
  try {
    await share({ title: filename, files: [new File([text], filename, { type: CSV_TYPE })] })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    throw err
  }
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/features/admin/shareCsv.test.ts && npm run lint && npx tsc -b
```

Expected: 8 passed, lint·tsc 깨끗.

- [ ] **Step 5: 커밋**

```bash
git add src/features/admin/shareCsv.ts src/features/admin/shareCsv.test.ts
git commit -m "$(cat <<'MSG'
feat(admin): CSV 내려받기·공유 (브라우저 API 를 한 곳에 모은다)

jsdom 에는 createObjectURL 과 navigator.share 가 아예 없어, 화면이 직접 부르면
테스트가 터진다. 주입 가능한 모듈로 감싼다.

공유 지원 판정은 canShare({files}) 만 믿는다 — 데스크톱 크롬은 share 는 있고
파일은 못 받는다. 설계대로 거짓이면 버튼을 그리지 않는다. 사용자가 공유 창을
닫으면(AbortError) 조용히 끝낸다 — 실패가 아니다.

objectURL 은 반드시 되돌린다(finally) — 안 되돌리면 탭이 살아 있는 동안 남는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: 통계 화면 (`#/admin/stats`) · 통계 탭 · 라우트

**Files:**
- Modify: `src/features/admin/statsRows.ts`, `src/features/admin/statsRows.test.ts` (가족 대표 맵 한 함수 추가)
- Create: `src/pages/admin/StatsPage.tsx`, `src/pages/admin/StatsPage.test.tsx`
- Modify: `src/components/PersonShell.tsx`, `src/components/PersonShell.test.tsx` (관리자 탭 5개)
- Modify: `src/App.tsx`

**설계 결정:**

- **검색 전에는 식사별 합계**, 이름을 적으면 **그 사람의 장부 줄**을 보여 준다. "이 분이 이번 달에 얼마 냈나" 가 권사님이 실제로 묻는 질문이다.
- **CSV 는 늘 그 달 전체**를 담는다(이름 검색과 무관). 설계가 "월 단위 필터 적용" 이라고 했고, 버튼이 화면에 보이는 것과 다른 양을 내보내면 설명하기 어렵다. 버튼 문구에 "이 달" 을 적어 둔다.
- **다음 달로도 갈 수 있다.** 다음 주일 점심이 다음 달일 수 있어 미래를 막지 않는다.
- 관리자 탭이 5개가 된다(식사·발급·사람·통계·내 식권). `max-w-sm` 바에서 `flex-1` 이라 320px 화면에서 한 칸 64px — `text-xs` 로 '내 식권' 까지 들어간다.

- [ ] **Step 1: 실패하는 테스트 — 가족 대표 맵**

`src/features/admin/statsRows.test.ts` 맨 아래에 더한다:

```ts
describe('repByFamily', () => {
  const p = (over: Partial<{ id: string; family_id: string; name: string; is_minor: boolean }> = {}) => ({
    id: 'p1', family_id: 'f1', name: '김철수', is_minor: false, ...over,
  })

  it('가족마다 어른 중 이름 순 첫 사람', () => {
    const map = repByFamily([p({ id: 'p1', name: '김철수' }), p({ id: 'p2', name: '박영수' }), p({ id: 'p3', family_id: 'f2', name: '이영희' })])
    expect(map.get('f1')).toBe('김철수')
    expect(map.get('f2')).toBe('이영희')
  })

  it('자녀는 대표가 되지 않는다', () => {
    const map = repByFamily([p({ id: 'p1', name: '서연', is_minor: true }), p({ id: 'p2', name: '최영수' })])
    expect(map.get('f1')).toBe('최영수')
  })

  it('어른이 없는 가족은 비워 둔다 (초기화된 1인 가족)', () => {
    expect(repByFamily([p({ name: '서연', is_minor: true })].map((x) => x)).get('f1')).toBeUndefined()
  })

  it('입력 순서에 기대지 않는다 (동명이인은 id 로 고정)', () => {
    const rows = [p({ id: 'pB', name: '김철수' }), p({ id: 'pA', name: '김철수' })]
    expect(repByFamily(rows).get('f1')).toBe('김철수')
    expect(repByFamily(rows.toReversed()).get('f1')).toBe('김철수')
  })
})
```

파일 맨 위 import 에 `repByFamily` 를 더한다.

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/features/admin/statsRows.test.ts
```

Expected: FAIL — `repByFamily is not a function`.

- [ ] **Step 3: 구현 — 가족 대표 맵**

`src/features/admin/statsRows.ts` 맨 아래에 더한다:

```ts
/** 가족 대표를 뽑을 때 필요한 최소 모양 — `useAllPeople` 의 행이 그대로 들어맞는다. */
type RepCandidate = { id: string; family_id: string; name: string; is_minor: boolean }

/**
 * 가족마다 "대표" 한 사람의 이름. 스키마에 대표 열이 없어 **살아 있는 어른 중 이름 순 첫 사람**으로 정한다
 * (4b 의 가족 힌트와 같은 규칙). 동명이인은 id 로 고정해 입력 순서에 기대지 않는다.
 * 어른이 없는 가족(초기화된 1인 가족 등)은 아예 담지 않는다 — 통계 행에서는 빈 칸이 된다.
 * `useAllPeople` 이 익명화된 행을 이미 빼고 읽으므로 여기서 다시 거르지 않는다.
 */
export function repByFamily(people: readonly RepCandidate[]): Map<string, string> {
  const best = new Map<string, RepCandidate>()
  for (const p of people) {
    if (p.is_minor) continue
    const current = best.get(p.family_id)
    if (!current || p.name.localeCompare(current.name, 'ko') < 0 || (p.name === current.name && p.id < current.id)) {
      best.set(p.family_id, p)
    }
  }
  return new Map([...best].map(([familyId, p]) => [familyId, p.name]))
}
```

- [ ] **Step 4: 실패하는 테스트 — 화면**

`src/pages/admin/StatsPage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { DecoratedPerson } from '../../features/admin/peopleFilter'
import type { MonthLedger } from '../../features/admin/useMonthLedger'
import { StatsPage } from './StatsPage'

type Q<T> = { status: 'pending' | 'error' | 'success'; data?: T; refetch: () => void }
const { useMonthLedger, useAllPeople, canShareCsv, downloadCsv, shareCsv } = vi.hoisted(() => ({
  useMonthLedger: vi.fn<(month: string) => Q<MonthLedger>>(),
  useAllPeople: vi.fn<() => Q<DecoratedPerson[]>>(),
  canShareCsv: vi.fn<() => boolean>(),
  downloadCsv: vi.fn<(name: string, text: string) => void>(),
  shareCsv: vi.fn<(name: string, text: string) => Promise<void>>(),
}))
vi.mock('../../features/admin/useMonthLedger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useMonthLedger')>()),
  useMonthLedger,
}))
vi.mock('../../features/admin/useAllPeople', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/admin/useAllPeople')>()),
  useAllPeople,
}))
vi.mock('../../features/admin/shareCsv', () => ({ canShareCsv, downloadCsv, shareCsv, CSV_TYPE: 'text/csv;charset=utf-8' }))
vi.mock('../../lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dates')>()),
  // 화면이 "이번 달" 을 고르는 기준을 고정한다
  todaySeoul: () => '2026-10-13',
}))

const meal = { id: 'm1', title: '주일 점심', served_on: '2026-10-11' }
const other = { id: 'm2', title: '수요 저녁', served_on: '2026-10-07' }
const ledger: MonthLedger = {
  issuances: [
    {
      id: 'i1', family_id: 'f1', quantity: 2, unit_price: 5000, memo: '입금 확인', issued_at: '2026-10-09T05:00:00Z',
      cancelled_at: null, cancel_reason: null, meal, buyer: { name: '김철수' }, issuer: { name: '권사' }, canceller: null,
    },
    {
      id: 'i2', family_id: 'f2', quantity: 1, unit_price: 5000, memo: null, issued_at: '2026-10-06T05:00:00Z',
      cancelled_at: null, cancel_reason: null, meal: other, buyer: { name: '이영희' }, issuer: { name: '권사' }, canceller: null,
    },
  ],
  usages: [
    {
      id: 'u1', family_id: 'f1', quantity: 1, used_at: '2026-10-11T03:31:00Z', used_via: 'self', voided_at: null,
      meal, person: { name: '김철수' }, recorder: { name: '김철수' }, voider: null,
    },
  ],
  truncated: false,
}
const people = [
  { id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1', role: 'member', is_minor: false, guardian_id: null, created_at: '', familySize: 1, tags: [], familyHint: null },
  { id: 'p2', family_id: 'f2', name: '이영희', phone: '01098765432', auth_user_id: 'u2', role: 'member', is_minor: false, guardian_id: null, created_at: '', familySize: 1, tags: [], familyHint: null },
] as unknown as DecoratedPerson[]

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/stats']}>
      <Routes>
        <Route path="/admin/stats" element={<StatsPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  useMonthLedger.mockReturnValue({ status: 'success', data: ledger, refetch: vi.fn<() => void>() })
  useAllPeople.mockReturnValue({ status: 'success', data: people, refetch: vi.fn<() => void>() })
  canShareCsv.mockReturnValue(false)
})

describe('StatsPage', () => {
  it('이번 달을 기본으로 열고 합계와 식사별 행을 보여 준다', () => {
    renderPage()
    expect(useMonthLedger).toHaveBeenCalledWith('2026-10')
    expect(screen.getByText('2026년 10월')).toBeInTheDocument()
    const totals = screen.getByRole('status', { name: '이 달 합계' })
    expect(totals).toHaveTextContent('발급 3장')
    expect(totals).toHaveTextContent('사용 1장')
    expect(totals).toHaveTextContent('15,000원')
    const meals = within(screen.getByRole('list', { name: '식사별 합계' })).getAllByRole('listitem')
    expect(meals).toHaveLength(2)
    expect(meals[0]).toHaveTextContent('주일 점심')
    expect(meals[0]).toHaveTextContent('발급 2장')
    expect(meals[1]).toHaveTextContent('수요 저녁')
  })

  it('◀ ▶ 로 달을 옮긴다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '이전 달' }))
    expect(screen.getByText('2026년 9월')).toBeInTheDocument()
    expect(useMonthLedger).toHaveBeenLastCalledWith('2026-09')
    await userEvent.click(screen.getByRole('button', { name: '다음 달' }))
    await userEvent.click(screen.getByRole('button', { name: '다음 달' }))
    expect(screen.getByText('2026년 11월')).toBeInTheDocument()
  })

  it('이름으로 찾으면 그 사람의 장부 줄과 소계가 나온다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름으로 찾기'), '영희')
    expect(screen.queryByRole('list', { name: '식사별 합계' })).not.toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: '찾은 장부' })).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('발급 1장')
    expect(rows[0]).toHaveTextContent('수요 저녁')
    expect(screen.getByRole('status', { name: '찾은 합계' })).toHaveTextContent('5,000원')
  })

  it('찾는 이름이 없으면 그렇게 말한다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름으로 찾기'), '없는사람')
    expect(screen.getByText('그 이름으로 찾은 기록이 없어요')).toBeInTheDocument()
  })

  it('기록이 없는 달은 빈 상태를 보여 주고 CSV 버튼을 잠근다', () => {
    useMonthLedger.mockReturnValue({ status: 'success', data: { issuances: [], usages: [], truncated: false }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('이 달에는 발급·사용 기록이 없어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이 달 CSV 저장' })).toBeDisabled()
  })

  it('CSV 저장은 그 달 전체를 내보낸다 (이름 검색과 무관하다)', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름으로 찾기'), '영희')
    await userEvent.click(screen.getByRole('button', { name: '이 달 CSV 저장' }))
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [name, text] = downloadCsv.mock.calls[0]!
    expect(name).toBe('식권-2026-10.csv')
    expect(text).toContain('김철수')
    expect(text).toContain('이영희')
  })

  it('공유가 안 되는 브라우저에서는 공유 버튼을 아예 그리지 않는다 (설계 §8.3)', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: '카톡으로 공유' })).not.toBeInTheDocument()
  })

  it('공유가 되면 버튼이 보이고 같은 CSV 를 넘긴다', async () => {
    canShareCsv.mockReturnValue(true)
    shareCsv.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카톡으로 공유' }))
    expect(shareCsv).toHaveBeenCalledWith('식권-2026-10.csv', expect.stringContaining('김철수'))
  })

  it('공유가 실패하면 문구를 띄운다', async () => {
    canShareCsv.mockReturnValue(true)
    shareCsv.mockRejectedValue(new Error('boom'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카톡으로 공유' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('공유하지 못했어요')
  })

  it('천장에 닿으면 일부만 보여 준다고 알린다', () => {
    useMonthLedger.mockReturnValue({ status: 'success', data: { ...ledger, truncated: true }, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('기록이 너무 많아 일부만 보여요. 월을 나눠 확인해 주세요.')).toBeInTheDocument()
  })

  it('처음 불러오는 중이면 스피너, data 없이 실패하면 다시 시도', async () => {
    useMonthLedger.mockReturnValue({ status: 'pending', refetch: vi.fn<() => void>() })
    const { unmount } = renderPage()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    unmount()
    const refetch = vi.fn<() => void>()
    useMonthLedger.mockReturnValue({ status: 'error', refetch })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('데이터가 있는 채 재조회가 실패하면 작은 안내만 덧붙인다 (data 로 분기)', () => {
    useMonthLedger.mockReturnValue({ status: 'error', data: ledger, refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByText('최신 기록을 받지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '식사별 합계' })).toBeInTheDocument()
  })

  it('명단을 못 읽어도 합계는 보여 준다 — 가족 대표만 빈 칸이 된다', () => {
    useAllPeople.mockReturnValue({ status: 'error', refetch: vi.fn<() => void>() })
    renderPage()
    expect(screen.getByRole('status', { name: '이 달 합계' })).toHaveTextContent('발급 3장')
  })
})
```

- [ ] **Step 5: 실패 확인**

```bash
npx vitest run src/pages/admin/StatsPage.test.tsx
```

Expected: FAIL — `Failed to resolve import "./StatsPage"`.

- [ ] **Step 6: 구현 — 화면**

`src/pages/admin/StatsPage.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { Button, Spinner, TextField } from '../../components/ui'
import { useAllPeople } from '../../features/admin/useAllPeople'
import { useMonthLedger } from '../../features/admin/useMonthLedger'
import { canShareCsv, downloadCsv, shareCsv } from '../../features/admin/shareCsv'
import { csvFilename, toCsv } from '../../features/admin/statsCsv'
import { currentMonth, formatMonth, shiftMonth } from '../../features/admin/statsMonth'
import { byMeal, filterByName, repByFamily, summarizeMonth, toStatsRows, type StatsRow } from '../../features/admin/statsRows'
import { formatMealDate, formatSeoulStamp, todaySeoul } from '../../lib/dates'
import { formatWon } from '../../lib/money'

/** `#/admin/stats` — 월 통계 (설계 §8.3). 그 달 식사의 장부를 한 번 읽어 합계·식사별·검색·CSV 를 모두 만든다. */
export function StatsPage() {
  const [month, setMonth] = useState(() => currentMonth(todaySeoul()))
  const [query, setQuery] = useState('')
  const [shareError, setShareError] = useState<string | null>(null)
  const ledger = useMonthLedger(month)
  const people = useAllPeople()
  // 공유 지원은 브라우저마다 고정이라 한 번만 묻는다 (설계대로 미지원이면 버튼을 아예 그리지 않는다)
  const shareable = useMemo(() => canShareCsv(), [])

  const reps = useMemo(() => repByFamily(people.data ?? []), [people.data])
  const rows = useMemo(() => (ledger.data ? toStatsRows(ledger.data, reps) : []), [ledger.data, reps])
  const searching = query.trim() !== ''
  const shown = useMemo(() => (searching ? filterByName(rows, query) : rows), [rows, query, searching])
  const totals = useMemo(() => summarizeMonth(rows), [rows])
  const found = useMemo(() => summarizeMonth(shown), [shown])
  const meals = useMemo(() => byMeal(rows), [rows])

  function onDownload() {
    setShareError(null)
    downloadCsv(csvFilename(month), toCsv(rows))
  }
  async function onShare() {
    setShareError(null)
    try {
      await shareCsv(csvFilename(month), toCsv(rows))
    } catch {
      setShareError('공유하지 못했어요. CSV 저장으로 받아 주세요.')
    }
  }
  function go(delta: number) {
    setShareError(null)
    setMonth((m) => shiftMonth(m, delta))
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">통계</h1>
        <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">관리자</span>
      </header>

      {/* 식사일 기준 월 선택. input[type=month] 는 브라우저마다 달라 좌우 버튼으로 둔다. */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-2 py-1">
        <button type="button" onClick={() => go(-1)} aria-label="이전 달" className="px-4 py-2 text-lg text-blue-600">◀</button>
        <span className="text-sm font-bold">{formatMonth(month)}</span>
        <button type="button" onClick={() => go(1)} aria-label="다음 달" className="px-4 py-2 text-lg text-blue-600">▶</button>
      </div>

      {/* status 가 아니라 data 로 분기한다 (공통 규약): 재조회 실패에도 보던 숫자는 남긴다. */}
      {ledger.data ? (
        <>
          {ledger.status === 'error' && <p role="status" className="text-center text-xs text-gray-500">최신 기록을 받지 못했어요</p>}
          {ledger.data.truncated && (
            <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
              기록이 너무 많아 일부만 보여요. 월을 나눠 확인해 주세요.
            </p>
          )}

          <p role="status" aria-label="이 달 합계" className="rounded-xl bg-gray-50 px-4 py-3 text-sm font-bold">
            발급 {totals.issued}장 · 사용 {totals.used}장 · {formatWon(totals.amount)}
          </p>

          <div className="flex gap-2">
            <Button onClick={onDownload} disabled={rows.length === 0}>이 달 CSV 저장</Button>
            {shareable && <Button variant="ghost" onClick={() => void onShare()} disabled={rows.length === 0}>카톡으로 공유</Button>}
          </div>
          {shareError && <p role="alert" className="text-sm text-red-600">{shareError}</p>}

          <TextField label="이름으로 찾기" name="stats-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="구매자·사용자·가족 대표" autoComplete="off" />

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">이 달에는 발급·사용 기록이 없어요</p>
          ) : searching ? (
            shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">그 이름으로 찾은 기록이 없어요</p>
            ) : (
              <>
                <p role="status" aria-label="찾은 합계" className="text-xs text-gray-500">
                  {shown.length}건 · 발급 {found.issued}장 · 사용 {found.used}장 · {formatWon(found.amount)}
                </p>
                <ul aria-label="찾은 장부" className="flex flex-col gap-2">
                  {shown.map((r) => <LedgerLine key={`${r.kind}-${r.mealId}-${r.at}-${r.name}`} row={r} />)}
                </ul>
              </>
            )
          ) : (
            <ul aria-label="식사별 합계" className="flex flex-col gap-2">
              {meals.map((m) => (
                <li key={m.mealId} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-bold">{m.mealTitle}</span>
                    <span className="shrink-0 text-xs text-gray-500">{formatMealDate(m.servedOn)}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">발급 {m.issued}장 · 사용 {m.used}장 · {formatWon(m.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : ledger.status === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-center text-sm text-red-600">
          기록을 불러오지 못했어요
          <button type="button" onClick={() => void ledger.refetch()} className="ml-2 underline">다시 시도</button>
        </div>
      ) : (
        <Spinner inline />
      )}
    </main>
  )
}

function LedgerLine({ row: r }: { row: StatsRow }) {
  const struck = r.kind === '취소' || r.kind === '무효'
  return (
    <li className={`rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm ${struck ? 'text-gray-500' : ''}`}>
      <div className={`font-bold ${struck ? 'line-through' : ''}`}>
        {r.kind} {r.quantity}장{r.amount === null ? '' : ` · ${formatWon(r.amount)}`}
      </div>
      <div className="text-xs text-gray-500">
        {formatSeoulStamp(r.at)} · {r.mealTitle} · {r.name || '(이름 없음)'} · {r.handler || '관리자'}
        {r.memo ? ` · ${r.memo}` : ''}
      </div>
    </li>
  )
}
```

**`SegmentedControl` 은 쓰지 않는다** — 월 선택은 좌우 버튼이고 필터 칩이 없다. import 를 넣으면 `noUnusedLocals` 가 빌드를 막는다.

- [ ] **Step 7: 탭과 라우트**

`src/components/PersonShell.tsx` 의 `ADMIN_TABS` 에 통계를 넣는다 (사람 다음, 내 식권 앞):

```tsx
const ADMIN_TABS: readonly TabItem[] = [
  { to: '/admin/meals', label: '식사', icon: '🍚' },
  { to: '/admin/issue', label: '발급', icon: '🎟️' },
  { to: '/admin/people', label: '사람', icon: '👥' },
  { to: '/admin/stats', label: '통계', icon: '📊' },
  { to: '/', label: '내 식권', icon: '🎫' },
]
```

`src/components/PersonShell.test.tsx` 의 단언을 고친다:

```tsx
  it('관리자 영역에서는 식사·발급·사람·통계·내 식권 탭', () => {
```
```tsx
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['🍚식사', '🎟️발급', '👥사람', '📊통계', '🎫내 식권'])
```

`src/App.tsx` 에 import 와 라우트를 더한다:

```tsx
import { StatsPage } from './pages/admin/StatsPage'
```
```tsx
              <Route path="/admin/stats" element={<RequireAdmin><StatsPage /></RequireAdmin>} />
```

- [ ] **Step 8: 통과 확인**

```bash
npm test && npm run lint && npx tsc -b
```

Expected: 전부 PASS, lint·tsc 깨끗.

- [ ] **Step 9: 손으로 확인 (컨트롤러가 한다 — 구현자는 `npm run dev` 를 띄우지 않는다)**

관리자로 `#/admin/stats` 에서: 이번 달이 기본이고, ◀▶ 가 달을 옮기고, 합계·식사별 행이 맞고, 이름 검색이 장부 줄을 보여 주고, CSV 저장이 엑셀에서 한글·숫자 모두 제대로 열린다.

- [ ] **Step 10: 커밋**

```bash
git add src/features/admin/statsRows.ts src/features/admin/statsRows.test.ts src/pages/admin/StatsPage.tsx src/pages/admin/StatsPage.test.tsx src/components/PersonShell.tsx src/components/PersonShell.test.tsx src/App.tsx
git commit -m "$(cat <<'MSG'
feat(admin): 통계 화면(#/admin/stats) — 월 합계·식사별·이름 검색·CSV·공유

그 달 식사의 장부를 한 번 읽어 합계·식사별 행·검색·CSV 를 모두 만든다. 월 선택은
input[type=month] 대신 좌우 버튼이다 — 데스크톱 Safari 는 그 입력을 지원하지 않고
iOS 는 휠 피커라 플랫폼마다 다르게 보인다.

검색 전에는 식사별 합계, 이름을 적으면 그 사람의 장부 줄과 소계를 보여 준다.
CSV 는 늘 그 달 전체를 담는다(이름 검색과 무관) — 보이는 것과 다른 양을 내보내면
설명하기 어렵다. 공유는 canShare 가 파일을 받겠다고 할 때만 버튼이 보인다.

가족 대표는 스키마에 열이 없어 그 가족의 살아 있는 어른 중 이름 순 첫 사람으로
정한다(4b 의 가족 힌트와 같은 규칙, 동명이인은 id 로 고정).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: E2E — 발급·사용 뒤 통계와 CSV

**Files:**
- Create: `e2e/stats.spec.ts`

**주의:** E2E 는 **공유 DB 에서 단일 워커로 직렬** 실행된다. 다른 spec 도 오늘 날짜로 식사를 만들고 발급하므로, **그 달 전체 합계를 단언하면 안 된다.** 유일한 이름으로 검색해 그 사람의 소계·장부 줄·CSV 내용만 단언한다.

- [ ] **Step 1: 테스트를 쓴다**

`e2e/stats.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { adminCreateTodayMeal, adminIssue, adminLogin, uniqueDigits } from './helpers'

test('관리자 통계: 월 합계 → 이름 검색 → CSV 내용', async ({ page }) => {
  const tag = uniqueDigits()
  const mealTitle = `E2E 통계 ${tag}`
  const name = `통계김${tag}`
  const phone = `010${tag.slice(0, 4)}${tag.slice(0, 4)}`

  await adminLogin(page)
  const mealLabel = await adminCreateTodayMeal(page, mealTitle)
  await adminIssue(page, { mealLabel, name, phone, quantity: '3', unitPrice: '5000' })

  await page.getByRole('link', { name: '통계' }).click()
  // 이번 달이 기본이라 방금 만든 오늘 식사가 들어 있다
  await expect(page.getByRole('status', { name: '이 달 합계' })).toContainText('발급')
  await expect(page.getByRole('list', { name: '식사별 합계' }).getByText(mealTitle)).toBeVisible()

  // 합계는 다른 spec 의 기록과 섞이므로, 유일한 이름으로 좁혀서 단언한다
  await page.getByLabel('이름으로 찾기').fill(name)
  await expect(page.getByRole('status', { name: '찾은 합계' })).toContainText('발급 3장')
  await expect(page.getByRole('status', { name: '찾은 합계' })).toContainText('15,000원')
  const rows = page.getByRole('list', { name: '찾은 장부' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('발급 3장')
  await expect(rows.first()).toContainText(mealTitle)

  // CSV 는 이름 검색과 무관하게 그 달 전체 — 방금 만든 줄이 들어 있어야 한다
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '이 달 CSV 저장' }).click(),
  ])
  const path = await download.path()
  expect(download.suggestedFilename()).toMatch(/^식권-\d{4}-\d{2}\.csv$/)
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(path, 'utf8')
  // 한국어 엑셀이 cp949 로 읽지 않도록 BOM 으로 시작한다
  expect(text.startsWith('﻿')).toBe(true)
  expect(text).toContain('종류,일시,식사일,식사명,이름,가족 대표,장수,단가,금액,처리자,메모')
  expect(text).toContain(`발급,`)
  expect(text).toContain(name)
  expect(text).toContain(mealTitle)
  // 금액은 숫자만 — 엑셀에서 더할 수 있어야 한다
  expect(text).toContain(',3,5000,15000,')
})
```

- [ ] **Step 2: 돌린다**

```bash
npm run e2e
```

Expected: **7 passed** (admin 1 · family 1 · onboarding 2 · people 1 · stats 1 · tickets 1).

실패하면 테스트를 느슨하게 바꾸기 전에 원인을 본다. `npx playwright test e2e/stats.spec.ts --headed` 와 trace 가 도움이 된다. 제품 결함이 드러났다면 그것은 **고쳐서 보고할 발견**이지, 단언을 낮춰 덮을 일이 아니다.

- [ ] **Step 3: 커밋**

```bash
git add e2e/stats.spec.ts
git commit -m "$(cat <<'MSG'
test(e2e): 통계 — 월 합계·이름 검색·CSV 내용(BOM·머리글·숫자)

E2E 는 공유 DB 에서 직렬로 돌고 다른 spec 도 오늘 식사를 만들므로, 그 달 전체
합계는 단언하지 않는다. 유일한 이름으로 좁혀 소계·장부 줄·CSV 내용을 단언한다.

CSV 는 Playwright 의 download 이벤트로 받아 BOM·머리글 11열·숫자 칸을 확인한다 —
엑셀에서 한글이 깨지거나 금액을 못 더하는 회귀를 막는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: 문서 동기화 · 전체 검증 · 마무리

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md`
- Modify: `docs/superpowers/plans/2026-10-13-phase4c-stats.md` (이 파일)

- [ ] **Step 1: README — 운영 체크리스트에 월 정산 절차**

"### 5. 운영 체크리스트" 의 발급 정정 줄 **다음에** 한 줄을 넣는다:

```markdown
- 월 정산은 **관리 › 통계** 에서 한다: 달을 고르고 발급·사용·금액을 확인한 뒤 "이 달 CSV 저장" 으로 받는다(엑셀에서 바로 열린다 — 장수·단가·금액은 숫자라 그대로 더할 수 있다). 폰에서 "카톡으로 공유" 가 보이면 그 파일을 그대로 보낼 수 있다. **취소·무효 행도 들어 있다** — 종류 열로 구분한다.
```

- [ ] **Step 2: 설계 문서**

- **§8.3 통계**: 구현대로 적고, 넣지 않은 것을 밝힌다. 그 단락을 아래로 바꾼다.

```markdown
**통계**(4c 에서 구현): 월 선택(**식사일** 기준, ◀▶ 좌우 버튼 — `input[type=month]` 는 데스크톱 Safari 가 지원하지 않고 iOS 는 휠 피커라 플랫폼마다 다르다) → 발급 장수·사용 장수·금액 → 식사별 행 → 이름 검색(구매자·사용자·가족 대표). 이름을 적으면 식사별 행 대신 그 사람의 장부 줄과 소계를 보여 준다. "이 달 CSV 저장"(다운로드), "카톡으로 공유"(Web Share API — `canShare({files})` 가 참일 때만 버튼을 그린다).
CSV 열: 종류(발급/취소/사용/무효), 일시, 식사일, 식사명, 이름, 가족 대표, 장수, 단가, 금액, 처리자, 메모. 월 단위 필터 적용(이름 검색과 무관하게 그 달 전체).
CSV 의 약속: UTF-8 **BOM**(한국어 엑셀이 cp949 로 읽어 한글이 깨지는 것을 막는다) · CRLF · 장수·단가·금액은 **숫자만**(엑셀에서 더할 수 있게) · `=` `+` `-` `@` 로 시작하는 칸은 앞에 `'` 를 붙인다(이름은 교인이 직접 적는 값이라 수식이 들어올 수 있다).
취소·무효는 **별도 행**이다(일시가 다르다). 합계는 `발급 − 취소`·`사용 − 무효` 로 계산해 `ticket_balances` 와 산술이 같다.
넣지 않은 것: **경로(본인 폰/담당자 처리) 열** — 11열을 고정했고, `처리자` 가 이름과 같으면 본인 폰이라는 뜻이다. **식사 등록자(`meals.created_by`)** — 11열에 없으므로 내보내지 않고, 그래서 `merge_people` 이 그 열을 옮기지 않는 것도 그대로 둔다.
```

- **§12 테스트 전략**: item 1 의 pgTAP 목록에 한 줄을 더한다.

```markdown
   - `admin_reset_person`: 떼어낸 계정의 `pairing_codes` 삭제, 거부(미성년자·비관리자) 시 그 삭제까지 롤백.
```

item 4 의 E2E 목록 끝에 더한다(`(e)` 다음).

```markdown
(f) 발급 → 통계에서 월 합계·이름 검색·CSV 내용(BOM·머리글·숫자) = 4c 의 `e2e/stats.spec.ts`.
```

- **§14**: 4단계 줄의 4c 를 완료로 바꾼다.

```markdown
4. **관리 확장**: **4a** 식사 상세 현황판(1장 대신 사용·발급 취소·사용 무효)과 `use_ticket` 재정의. (완료, 2026-10-10) · **4b** 사람 탭(합치기·연결·초기화·번호 수정·이력, 발급 취소 사유). (완료, 2026-10-11) · **4c** 통계·CSV·공유. (완료, 2026-10-13)
```

- **§14 위의 상태 머리말(파일 4행)** 도 맞춘다.

```markdown
- 상태: 1·2·3단계와 4단계(4a 현황판 · 4b 사람 탭 · 4c 통계) 구현 완료 (2026-10-13). 남은 5단계(PWA·백업·운영 문서) 계획 전 §15 와 4c 계획(`docs/superpowers/plans/2026-10-13-phase4c-stats.md`)의 "5단계로 넘기는 것" 참고
```

- **§15**: 새 항목 셋.

```markdown
- 통계는 그 달 식사의 장부를 **한 번에 읽는다**(표마다 1000행 천장을 화면이 알린다). 한 달 식사가 수십 회가 되면 월 합계를 집계 뷰나 `rpc` 로 바꾼다.
- CSV 의 수식 주입 차단은 `'` 접두사다 — 엑셀에서 그 글자가 보인다. 더 깔끔한 길(xlsx 생성)은 라이브러리가 필요해 무료 한도·번들 크기와 맞바꿔야 하므로 두지 않는다.
- 통계에 **경로(본인 폰/담당자 처리)** 와 **식사 등록자** 열은 넣지 않았다. 필요해지면 CSV 열을 늘리고, 등록자를 내보낼 때는 `merge_people` 이 `meals.created_by` 를 옮기지 않는 것부터 다시 본다.
```

- [ ] **Step 3: 이 계획 파일**

"구현 결과와 계획의 차이" 절을 범위 절 다음에 만들어 Task 별로 실제 바뀐 것을 적고, 완료 기준의 수치를 **측정값**으로 채운다. 모든 Step 체크박스를 `[x]` 로 바꾼다(PR 본문의 Test Plan 항목은 그대로 둔다).

- [ ] **Step 4: 전체 검증**

```bash
npm run db:reset && npm run db:test        # pgTAP Files=16, Tests=456
npm run lint && npx tsc -b
npm run test:coverage                      # 임계값(80/80/70/80) 통과 — % 표를 기록한다
npm run build && VITE_BASE_PATH=/meal-ticket/ npm run build && grep -q '/meal-ticket/assets/' dist/index.html && echo SUBPATH_OK
npm run e2e                                # 7 passed
```

- [ ] **Step 5: 커밋** (push·PR 은 컨트롤러가 한다)

```bash
git add README.md docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md docs/superpowers/plans/2026-10-13-phase4c-stats.md
git commit -m "$(cat <<'MSG'
docs: 4c단계 문서 동기화 — README 월 정산, 설계 §8.3·§12·§14·§15, 계획 차이·수치

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

PR 본문:

```markdown
## Summary
- 관리자 **통계** 탭 신설: `#/admin/stats` 월 선택(식사일 기준, 좌우 버튼) → 발급·사용·금액 합계 → 식사별 행 → 이름 검색(구매자·사용자·가족 대표, 적으면 그 사람의 장부 줄과 소계).
- **CSV 저장**(11열 · UTF-8 BOM · CRLF · 숫자 칸 · 수식 주입 차단)과 **카톡으로 공유**(`canShare({files})` 가 참일 때만 버튼). CSV 는 이름 검색과 무관하게 그 달 전체를 담고 취소·무효 행도 들어 있다.
- DB: 마이그레이션 1개 — **사람 초기화가 떼어낸 계정의 연결 코드도 지운다**(4b 가 넘긴 것). pgTAP +10 (총 456). E2E `stats.spec.ts`(총 7).

## 운영 (merge 전 확인)
- 마이그레이션은 **함수 본문 하나와 주석 둘**뿐이다 — 표·인덱스·권한을 건드리지 않고 `create or replace` 와 `comment on` 이라 재실행도 안전하다. 교인 화면은 바뀌지 않는다.
- **사람 초기화의 동작이 하나 늘었다**: 그 계정이 띄워 둔 가족 연결 코드를 함께 지운다. 4b 까지는 코드가 남아, 초기화된 교인이 10분 안에 다시 가입하면 그 코드를 쥔 사람이 그 교인을 자기 가족으로 흡수할 수 있었다.
- 통계는 **읽기 전용**이다. 잘못 눌러 바뀌는 것이 없다.
- CSV 는 폰에 내려받히거나 공유 창으로 간다 — 서버에 저장되지 않는다. **취소 사유가 들어 있으므로** 단체 대화방에 그대로 올리기 전에 한 번 보시길 권한다(설계 §10).

## 검증 (로컬, merge 전)
| 항목 | 결과 |
|---|---|
| pgTAP | Files=16, Tests=456, PASS |
| Vitest | (측정값) |
| 커버리지 (statements / branches / functions / lines) | (측정값) |
| Playwright | 7 passed |
| lint · tsc · 빌드(기본·하위 경로) | 통과 |

## Test Plan
- [ ] CI 녹색 (pgTAP 456 · Vitest · E2E 7)
- [ ] merge 후 Deploy 성공, 운영에서 관리 › 통계 열어 이번 달 합계 확인
- [ ] 실제 폰: CSV 저장 → 엑셀·구글 시트에서 한글이 깨지지 않고 금액이 더해지는지, "카톡으로 공유" 가 보이면 그것도

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

PR 은 사용자가 merge 한다.

---

## 완료 기준

- pgTAP: 010~160 전부 통과, `Files=16, Tests=456` (160 = `plan(10)`).
- Vitest 전부 통과, 커버리지 임계값(lines 80 · functions 80 · branches 70 · statements 80) 통과.
- `npm run lint` · `npx tsc -b` · `npm run build` · 하위 경로 빌드 통과.
- Playwright: 7 passed (admin 1 · family 1 · onboarding 2 · people 1 · stats 1 · tickets 1).
- 수동: 관리자로 통계 → 달 이동 → 이름 검색 → CSV 저장이 화면 문구대로 동작하고, 받은 CSV 가 엑셀에서 한글·숫자 모두 제대로 열린다.
- 운영: merge 뒤 Deploy 성공, 관리 › 통계에서 이번 달 숫자가 보인다.

## 5단계로 넘기는 것

- **5단계 운영**: PWA(홈 화면 추가·오프라인 껍데기), keep-alive 점검, 백업(비공개 저장소), 운영 문서(관리자 지정·복구 절차·카카오·Supabase 설정 안내).
- **통계 규모**: 그 달 장부를 한 번에 읽는다(표마다 1000행 천장). 한 달 식사가 수십 회가 되면 집계 뷰나 `rpc` 로 바꾼다.
- **어른 연결 코드에 `person_id` 를 단다** (4c DB 리뷰에서 나왔다 — 이번에 닫지 못한 경쟁): `create_pairing_code` 는 자기 사람 행을 읽은 **뒤에** `pairing_code:<uid>` 잠금을 잡는다. 그래서 `admin_reset_person` 이 코드를 지운 직후에 교인 폰이 그 함수를 끝내면 **살아 있는** 코드가 한 줄 새로 들어오고, 그 교인이 다시 가입하면 코드를 쥔 사람이 흡수할 수 있다. `admin_reset_person` 안에서는 닫을 수 없다 — delete 를 ② 뒤로 옮기면 `add_family_member` 와 40P01 교착이 난다(실험으로 확인). 제대로 닫는 길은 둘이고 **뒤쪽을 권한다**: ⑴ `pairing_code:<uid>` 잠금을 ①급으로 이 함수에서도 잡고 `create_pairing_code` 에서 사람 행 읽기보다 **위로** 올린다(세 함수를 함께 고친다). ⑵ **어른 코드에 `person_id` 를 달고 `add_family_member` 가 `v_target.id = v_code.person_id` 를 요구하게 한다** — 경쟁 자체가 사라진다. 10분짜리 좁은 창이고 관리자가 초기화를 누르는 순간에만 열린다.
- **xlsx 내보내기**: 수식 주입을 `'` 접두사로 막는 대신 진짜 엑셀 파일을 만들면 그 글자가 안 보인다. 라이브러리가 필요해 번들 크기와 맞바꿔야 하므로 두지 않는다.
- **취소 사유의 비공개**: `issuances` 의 select 권한이 표 단위라 작정한 교인은 사유를 볼 수 있다(설계 §10). 진짜 비공개가 필요하면 관리자 전용 읽기 경로(definer 함수 또는 관리자 전용 뷰)를 만들고 그 열을 교인 권한에서 뺀다. CSV 에도 사유가 들어가므로 함께 결정한다.
- 4b 가 넘긴 나머지는 그대로: `merge_people` 이 `meals.created_by` 를 옮기지 않는 것(통계가 식사 등록자를 내보내게 되면 다시 본다), 되돌리기(분리) 없음, `link_person` 의 더 쉬운 UI, 익명화된 사람 보기 칩.
- 3·4a·4b 가 넘긴 UI 항목도 그대로: `ConfirmButton` 터치 영역(44px), 패널·폼 포커스 복귀, 이름 칸 `maxLength` 의 NFD 문제, `FamilyPage` 의 두 초록 알림 합치기, 조건부 라이브 리전(iOS VoiceOver), 식사 현황판의 sticky 알림이 긴 목록에서 행을 가리는 것, 대신 사용의 60초 중복 확인 창.
