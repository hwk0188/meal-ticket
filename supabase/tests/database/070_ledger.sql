begin;
select plan(24);

select has_table('public', 'issuances', 'issuances 테이블이 있다');
select has_table('public', 'usages', 'usages 테이블이 있다');
select has_view('public', 'ticket_balances', 'ticket_balances 뷰가 있다');
select is((select reloptions::text from pg_class where oid = 'public.ticket_balances'::regclass),
  '{security_invoker=true}', '뷰는 security_invoker 라 기반 테이블 RLS 를 그대로 받는다');
select col_is_unique('public', 'usages', 'request_id', 'request_id 는 유일하다 (재시도 중복 방지)');

-- 기본 차단: auto_expose_new_tables=true 라서 새 테이블/뷰는 anon 전체 권한으로 태어난다.
select table_privs_are('public', 'issuances', 'anon', '{}'::text[], 'anon 은 issuances 에 아무 권한이 없다');
select table_privs_are('public', 'usages', 'anon', '{}'::text[], 'anon 은 usages 에 아무 권한이 없다');
select table_privs_are('public', 'ticket_balances', 'anon', '{}'::text[], 'anon 은 ticket_balances 에 아무 권한이 없다');
select table_privs_are('public', 'issuances', 'authenticated', array['SELECT'], 'authenticated 는 issuances 를 읽기만 한다 (쓰기는 함수로만)');
select table_privs_are('public', 'usages', 'authenticated', array['SELECT'], 'authenticated 는 usages 를 읽기만 한다 (쓰기는 함수로만)');
select table_privs_are('public', 'ticket_balances', 'authenticated', array['SELECT'], 'authenticated 는 ticket_balances 를 읽기만 한다');

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
insert into public.meals (title, served_on, created_by) values ('테스트 점심 070', '2026-10-11', :'admin_pid') returning id as meal_id \gset

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
