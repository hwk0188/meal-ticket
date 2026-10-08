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
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('000111', :'k3_uid', 'child', now() + interval '10 minutes');
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.add_family_member('000111', '민준') $$, 'P0001', 'already_registered', '이미 사람 행이 있는 계정의 코드는 거부한다');

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
