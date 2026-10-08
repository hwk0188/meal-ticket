begin;
-- 두 세션이 겹치는 경합(A·B 가 서로의 어른 코드를 동시에 흡수 / 합치는 중 발급)은 pgTAP(단일 세션)로
-- 재현할 수 없어 리뷰 때 psql 두 세션으로 수동 검증했다 (2026-10-09: 한 쪽이 기다렸다가 순차 성공, 교착 없음).
select plan(62);

select is(has_function_privilege('anon', 'public.add_family_member(text,text,text)', 'EXECUTE'), false, 'anon 은 add_family_member 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.relink_child(uuid,text)', 'EXECUTE'), false, 'anon 은 relink_child 를 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.lock_family(uuid)', 'EXECUTE'), false, 'lock_family 는 API 역할에 열려 있지 않다 (함수 안에서만)');

-- 가족 잠금 헬퍼: 단일 키(objsubid 1) + 'family:' 이름공간 → lock_family_meal 의 두 키 공간과 겹치지 않는다
select gen_random_uuid() as lock_fam \gset
select lives_ok(format($$ select public.lock_family(%L) $$, :'lock_fam'), 'lock_family 를 잡을 수 있다');
select is(
  (select count(*) from pg_locks
    where locktype = 'advisory' and objsubid = 1 and pid = pg_backend_pid()
      and classid::bigint = ((hashtext('family:' || :'lock_fam'::text)::bigint >> 32) & 4294967295)
      and objid::bigint = (hashtext('family:' || :'lock_fam'::text)::bigint & 4294967295)),
  1::bigint, '잠금 키는 hashtext(''family:'' || 가족 id) 단일 키다');

-- 준비: 가족 A(김철수), 가족 B(이영희), 가족 C(박민수+최지우), 가족 E(이준호), 관리자, 익명 자녀 계정 K1~K3, 가입 전 카카오 G
select tests.create_user('fam-a@test.local') as a_uid \gset
select tests.create_user('fam-b@test.local') as b_uid \gset
select tests.create_user('fam-c@test.local') as c_uid \gset
select tests.create_user('fam-d@test.local') as d_uid \gset
select tests.create_user('fam-e@test.local') as e_uid \gset
select tests.create_user('fam-admin@test.local') as admin_uid \gset
select tests.create_user('fam-ghost@test.local') as ghost_uid \gset
select tests.create_user() as k1_uid \gset
select tests.create_user() as k2_uid \gset
select tests.create_user() as k3_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01088880001', :'a_uid', now(), '2026-10-07'),
       ('이영희', '01088880002', :'b_uid', now(), '2026-10-07'),
       ('박민수', '01088880003', :'c_uid', now(), '2026-10-07'),
       ('이준호', '01088880005', :'e_uid', now(), '2026-10-07'),
       ('권사',   '01088880009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid, family_id as b_fid from public.people where auth_user_id = :'b_uid' \gset
select id as c_pid, family_id as c_fid from public.people where auth_user_id = :'c_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, phone, family_id, auth_user_id, consented_at, consent_version)
values ('최지우', '01088880004', :'c_fid', :'d_uid', now(), '2026-10-07');
select id as d_pid from public.people where auth_user_id = :'d_uid' \gset
-- 식사 날짜는 고정값이 아니라 "서울 오늘" 로 둔다: 고정 날짜를 쓰면 그날이 지난 뒤 어른 합류의 식사 잠금 루프
-- (served_on >= 서울 오늘) 가 조용히 빈 루프가 되어, 아래 잠금 단언이 아무것도 검증하지 않게 된다.
select (now() at time zone 'Asia/Seoul')::date as today \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 110', :'today', :'admin_pid') returning id as meal_id \gset
-- 지난 식사: use_ticket 이 당일만 쓰므로 합칠 때 잠그지 않아야 한다 (제목은 이 파일 전용 고유값)
insert into public.meals (title, served_on, created_by) values ('테스트 점심 110 지난주', :'today'::date - 7, :'admin_pid') returning id as past_meal_id \gset

-- ---------- child ----------
select tests.authenticate_as(:'k1_uid');
select (select code from public.create_pairing_code('child')) as k1_code \gset
select tests.authenticate_as(:'a_uid');
select results_eq(
  format($$ select name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at is not null, consented_at
              from public.add_family_member(%L, ' 서연 ', '2026-10-07') $$, :'k1_code'),
  format($$ values ('서연'::text, %L::uuid, %L::uuid, true, %L::uuid, true, null::timestamptz) $$, :'a_fid', :'k1_uid', :'a_pid'),
  '자녀 추가: 이름(공백 제거)·호출자 가족·코드 계정·is_minor·보호자·보호자 동의 시각이 기록된다');
select tests.clear_auth();
select id as seoyeon_pid from public.people where auth_user_id = :'k1_uid' \gset
select is((select consent_version from public.people where id = :'seoyeon_pid'), '2026-10-07', '법정대리인 동의 버전이 받은 값 그대로 저장된다');
select isnt((select used_at from public.pairing_codes where code = :'k1_code'), null, '쓴 코드는 used_at 이 기록된다');

-- 멱등 재시도(RPC 규약): 같은 보호자가 같은 코드로 다시 불러도 그때 만든 자녀 행을 그대로 돌려준다
select tests.authenticate_as(:'a_uid');
select results_eq(
  format($$ select id, family_id, guardian_id from public.add_family_member(%L, '다른이름', '2026-10-07') $$, :'k1_code'),
  format($$ values (%L::uuid, %L::uuid, %L::uuid) $$, :'seoyeon_pid', :'a_fid', :'a_pid'),
  '멱등: 사용된 자녀 코드로 다시 불러도 같은 자녀 행이 돌아온다');
select tests.clear_auth();
select is((select name from public.people where id = :'seoyeon_pid'), '서연', '멱등 재시도는 이름을 덮어쓰지 않는다');
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.add_family_member(%L, '서연', '2026-10-07') $$, :'k1_code'), 'P0001', 'invalid_code',
  '남의 자녀의 사용된 코드는 거부한다 (멱등은 그 코드로 연결한 보호자에게만)');
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.add_family_member('99999999', '서연', '2026-10-07') $$, 'P0001', 'invalid_code', '없는 코드는 거부한다');
select throws_ok($$ select public.add_family_member(null, '서연', '2026-10-07') $$, 'P0001', 'invalid_code', 'null 코드도 거부한다');

-- 자녀 계정이 된 K1 은 더 이상 자녀 코드를 못 받는다 (100 에서도 고정) — 여기서는 자녀 계정의 add_family_member 호출을 본다
select tests.authenticate_as(:'k1_uid');
select throws_ok($$ select public.add_family_member('12345678', '누구', '2026-10-07') $$, 'P0001', 'not_adult', '자녀 계정은 가족을 추가할 수 없다');
select tests.authenticate_as(:'ghost_uid');
select throws_ok($$ select public.add_family_member('12345678', '누구', '2026-10-07') $$, 'P0001', 'not_registered', '가입 전 계정은 가족을 추가할 수 없다');

-- 이름·동의 버전 검증
select tests.authenticate_as(:'k2_uid');
select (select code from public.create_pairing_code('child')) as k2_code \gset
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.add_family_member(%L, '   ', '2026-10-07') $$, :'k2_code'), 'P0001', 'invalid_name', '자녀 이름이 비면 거부한다');
select throws_ok(format($$ select public.add_family_member(%L, null, '2026-10-07') $$, :'k2_code'), 'P0001', 'invalid_name', '자녀 코드에 이름이 없으면 거부한다');
select throws_ok(format($$ select public.add_family_member(%L, E'\t', '2026-10-07') $$, :'k2_code'), 'P0001', 'invalid_name', '탭뿐인 이름도 거부한다 (btrim 만으로는 통과한다)');
select throws_ok(format($$ select public.add_family_member(%L, repeat('가', 21), '2026-10-07') $$, :'k2_code'), 'P0001', 'invalid_name', '21자 이름은 거부한다');
select throws_ok(format($$ select public.add_family_member(%L, '서연') $$, :'k2_code'), 'P0001', 'consent_required', '법정대리인 동의 버전이 없으면 거부한다');
select throws_ok(format($$ select public.add_family_member(%L, '서연', '동의함') $$, :'k2_code'), 'P0001', 'consent_required', '날짜(YYYY-MM-DD)가 아닌 동의 버전은 거부한다');
select tests.clear_auth();
select is((select used_at from public.pairing_codes where code = :'k2_code'), null, '거부된 시도는 코드를 소모하지 않는다');

-- 카카오톡에서 붙여 넣은 코드(앞뒤 공백·줄바꿈)도 받는다
select tests.create_user() as k5_uid \gset
select tests.authenticate_as(:'k5_uid');
select (select code from public.create_pairing_code('child')) as k5_code \gset
select tests.authenticate_as(:'a_uid');
select is((select family_id from public.add_family_member(E' ' || :'k5_code' || E'\n', '지호', '2026-10-07')), :'a_fid'::uuid,
  '코드에 섞인 공백·줄바꿈은 지우고 받는다');

-- 만료된 코드
select tests.clear_auth();
update public.pairing_codes set expires_at = now() - interval '1 second' where code = :'k2_code';
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.add_family_member(%L, '서연', '2026-10-07') $$, :'k2_code'), 'P0001', 'invalid_code', '만료된 코드는 거부한다');

-- 코드 계정에 이미 사람이 있으면 (코드를 받은 뒤 어른으로 가입해 버린 경우) 거부
select tests.authenticate_as(:'k3_uid');
select (select code from public.create_pairing_code('child')) as k3_code \gset
select tests.clear_auth();
-- K3 를 B 의 자녀로 먼저 연결해 둔다 (다른 어른이 먼저 연결한 상황)
select tests.authenticate_as(:'b_uid');
select lives_ok(format($$ select public.add_family_member(%L, '민준', '2026-10-07') $$, :'k3_code'), 'B 가 K3 를 자녀로 연결한다');
select tests.clear_auth();
select id as minjun_pid from public.people where auth_user_id = :'k3_uid' \gset
-- 같은 계정이 살아 있는 코드를 또 갖고 있었다면(이론상) 두 번째 어른은 already_registered 를 받는다: 코드 행을 직접 심어 재현
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000111', :'k3_uid', 'child', now() + interval '10 minutes');
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.add_family_member('00000111', '민준', '2026-10-07') $$, 'P0001', 'already_registered', '이미 사람 행이 있는 계정의 코드는 거부한다');

-- 자기 코드는 쓸 수 없다
select (select code from public.create_pairing_code('adult')) as a_code \gset
select throws_ok(format($$ select public.add_family_member(%L) $$, :'a_code'), 'P0001', 'invalid_code', '자기 코드는 쓸 수 없다');
select tests.clear_auth();

-- ---------- adult: 빈 가족 → 장부까지 이동 ----------
-- B 에게 자녀를 하나 더 두고(민준과 둘), 보호자는 B 이지만 C 가족에 사는 자녀도 하나 만든다 (이 아이는 따라오면 안 된다)
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('둘째', :'b_fid', true, :'b_pid', now()) returning id as b_kid2 \gset
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('딴집아이', :'c_fid', true, :'b_pid', now()) returning id as b_kid3 \gset
-- B 가족에 발급 2장·사용 1장을 적어 둔다
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'b_pid', :'b_fid', :'meal_id', 2, 5000, :'admin_pid') returning id as b_issuance \gset
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id)
values (:'b_fid', :'b_pid', :'meal_id', 'self', :'b_pid', gen_random_uuid()) returning id as b_usage \gset
-- 지난 식사의 발급도 하나 적어 둔다 (장부는 함께 옮겨지지만 식사 잠금은 잡히지 않아야 한다)
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'b_pid', :'b_fid', :'past_meal_id', 1, 5000, :'admin_pid') returning id as b_past_issuance \gset
select tests.authenticate_as(:'b_uid');
select (select code from public.create_pairing_code('adult')) as b_code \gset
select tests.authenticate_as(:'a_uid');
select results_eq(
  format($$ select id, family_id from public.add_family_member(%L) $$, :'b_code'),
  format($$ values (%L::uuid, %L::uuid) $$, :'b_pid', :'a_fid'),
  '어른 합류: 코드 계정의 사람이 호출자 가족으로 옮겨진 행이 돌아온다');
select tests.clear_auth();
select is((select family_id from public.people where id = :'minjun_pid'), :'a_fid'::uuid, '그 사람의 자녀도 함께 옮겨진다');
select is((select family_id from public.people where id = :'b_kid2'), :'a_fid'::uuid, '자녀가 둘이면 둘 다 옮겨진다');
select is((select family_id from public.people where id = :'b_kid3'), :'c_fid'::uuid, '보호자가 같아도 다른 가족에 사는 자녀는 옮기지 않는다');
select is((select family_id from public.issuances where id = :'b_issuance'), :'a_fid'::uuid, '옛 가족이 비었으므로 발급 장부가 새 가족으로 옮겨진다 (풀 병합)');
select is((select family_id from public.usages where id = :'b_usage'), :'a_fid'::uuid, '사용 장부도 함께 옮겨진다');
select is((select count(*) from public.families where id = :'b_fid'), 0::bigint, '비어 버린 옛 가족 행은 지워진다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'meal_id'), 1, '새 가족 잔량 = 옮겨 온 발급 2 − 사용 1');
select isnt((select used_at from public.pairing_codes where code = :'b_code'), null, '어른 코드도 사용 처리된다');
-- 합치는 동안 잡은 식사 잠금은 트랜잭션이 끝날 때까지 이 세션이 쥐고 있다 (use_ticket 과 같은 두 키: 옛 가족·식사)
select is(
  (select count(*) from pg_locks
    where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
      and classid::bigint = (hashtext(:'b_fid'::text)::bigint & 4294967295)
      and objid::bigint = (hashtext(:'meal_id'::text)::bigint & 4294967295)),
  1::bigint, '합치는 동안 옛 가족·오늘 식사의 use_ticket 잠금을 쥐었다');
select is(
  (select count(*) from pg_locks
    where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
      and classid::bigint = (hashtext(:'b_fid'::text)::bigint & 4294967295)
      and objid::bigint = (hashtext(:'past_meal_id'::text)::bigint & 4294967295)),
  0::bigint, '지난 식사는 잠그지 않는다 (use_ticket 이 쓸 수 없는 식사까지 잠그지 않는다)');

-- 멱등 재시도: 사용된 어른 코드로 다시 불러도 그 어른 행이 그대로 돌아온다
select tests.authenticate_as(:'a_uid');
select results_eq(
  format($$ select id, family_id from public.add_family_member(%L) $$, :'b_code'),
  format($$ values (%L::uuid, %L::uuid) $$, :'b_pid', :'a_fid'),
  '멱등: 사용된 어른 코드로 다시 불러도 그 어른 행이 돌아온다');

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

-- 발급과 가족 이동의 경합: 옮겨진 사람에게 발급하면 옛 가족이 아니라 "현재" 가족에 꽂힌다.
-- (두 세션이 겹치는 경합은 단일 세션 pgTAP 로 재현할 수 없어, issue_tickets 가 이동 뒤의 family_id 를 읽는지만 고정한다)
select tests.authenticate_as(:'admin_uid');
select is((select family_id from public.issue_tickets(:'b_pid', :'meal_id', 1, 5000, null)), :'a_fid'::uuid,
  '합쳐진 뒤 발급하면 새 가족(A)으로 기록된다 (issue_tickets 가 사람 행을 잠그고 현재 가족을 읽는다)');
select tests.clear_auth();

-- ---------- relink_child ----------
select tests.create_user() as k4_uid \gset
select tests.create_user() as k6_uid \gset
select tests.authenticate_as(:'k4_uid');
select (select code from public.create_pairing_code('child')) as k4_code \gset
-- 살아 있는 어른 코드: kind <> 'child' 가드를 실제로 때린다 (사용된 어른 코드는 used_at 에서 먼저 걸려 가드가 검증되지 않는다)
select tests.authenticate_as(:'e_uid');
select (select code from public.create_pairing_code('adult')) as e_code \gset
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, :'seoyeon_pid', :'k4_code'), 'P0001', 'child_not_found', '남의 자녀는 재연결할 수 없다 (보호자만)');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, :'seoyeon_pid', :'e_code'), 'P0001', 'invalid_code', '살아 있는 어른 코드로는 자녀를 재연결할 수 없다');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, gen_random_uuid(), :'k4_code'), 'P0001', 'child_not_found', '없는 자녀 id 는 거부한다');
select tests.authenticate_as(:'ghost_uid');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, :'seoyeon_pid', :'k4_code'), 'P0001', 'not_registered', '가입 전 계정은 재연결할 수 없다');
select tests.clear_auth();
-- 사람 행이 있는 계정의 코드 / 자기 코드 / 만료된 코드: 코드 행을 직접 심어 재현
-- (코드 계정이 auth.users 에서 지워진 경우는 FK on delete cascade 가 코드 행까지 지워 버려 그 분기에 닿을 수 없다 — 같은 invalid_code 로 수렴한다)
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000222', :'c_uid', 'child', now() + interval '10 minutes');
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000333', :'a_uid', 'child', now() + interval '10 minutes');
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000444', :'k6_uid', 'child', now() - interval '1 second');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.relink_child(%L, '00000222') $$, :'seoyeon_pid'), 'P0001', 'already_registered', '이미 사람 행이 있는 계정의 코드로는 재연결할 수 없다');
select throws_ok(format($$ select public.relink_child(%L, '00000333') $$, :'seoyeon_pid'), 'P0001', 'invalid_code', '자기 코드로는 재연결할 수 없다');
select throws_ok(format($$ select public.relink_child(%L, '00000444') $$, :'seoyeon_pid'), 'P0001', 'invalid_code', '만료된 코드로는 재연결할 수 없다');
select is((select auth_user_id from public.relink_child(:'seoyeon_pid', E' ' || :'k4_code' || E'\n')), :'k4_uid'::uuid,
  '재연결: 자녀 계정이 새 폰의 계정으로 바뀐다 (코드의 공백·줄바꿈도 무시한다)');
select tests.clear_auth();
select is((select count(*) from public.people where auth_user_id = :'k1_uid'), 0::bigint, '옛 폰의 계정은 사람 행을 잃는다 (접근 차단)');
select results_eq(
  format($$ select family_id, guardian_id, is_minor from public.people where id = %L $$, :'seoyeon_pid'),
  format($$ values (%L::uuid, %L::uuid, true) $$, :'a_fid', :'a_pid'),
  '재연결은 가족·보호자·미성년 여부를 바꾸지 않는다');
select isnt((select used_at from public.pairing_codes where code = :'k4_code'), null, '재연결에 쓴 코드도 사용 처리된다');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.relink_child(%L, %L) $$, :'seoyeon_pid', :'k4_code'), 'P0001', 'invalid_code', '사용된 코드로는 재연결할 수 없다');
select tests.authenticate_as(:'k4_uid');
select throws_ok(format($$ select public.relink_child(%L, '12345678') $$, :'seoyeon_pid'), 'P0001', 'not_adult', '자녀 계정은 재연결을 호출할 수 없다');
select tests.clear_auth();

-- JWT 없이 직접 호출
set local role authenticated;
select throws_ok($$ select public.add_family_member('12345678', '서연', '2026-10-07') $$, 'P0001', 'not_authenticated', 'add_family_member: JWT 가 없으면 not_authenticated');
select throws_ok(format($$ select public.relink_child(%L, '12345678') $$, :'seoyeon_pid'), 'P0001', 'not_authenticated', 'relink_child: JWT 가 없으면 not_authenticated');
reset role;

select * from finish();
rollback;
