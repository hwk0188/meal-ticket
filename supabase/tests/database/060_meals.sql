begin;
select plan(23);

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
select table_privs_are('public', 'meals', 'anon', '{}'::text[], 'anon 은 meals 에 아무 권한이 없다');
select table_privs_are('public', 'meals', 'authenticated', array['SELECT', 'DELETE'],
  'authenticated 의 테이블 권한은 SELECT·DELETE 뿐이다 (insert/update 는 열 권한)');

-- 사용자: 교인 A, 관리자
select tests.create_user('meal-a@test.local') as a_uid \gset
select tests.create_user('meal-admin@test.local') as admin_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01033330001', :'a_uid', now(), '2026-10-07'),
       ('권사',   '01033330009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset

-- 관리자: 만들 수 있고, created_by 는 기본값으로 본인이 들어간다. 제목은 공백 제거·NFC.
-- 같은 날짜에 다른 테스트/E2E 가 남긴 식사가 있을 수 있으므로, 이 테스트만의 고유한 제목을 쓰고
-- 이후 조회는 served_on 이 아니라 insert 가 돌려준 id 로만 한다 (여러 행이 잡혀 서브쿼리가 터지는 것을 막는다).
select tests.authenticate_as(:'admin_uid');
insert into public.meals (title, served_on, note) values ('  테스트 점심 060 ', '2026-10-12', '  ') returning id as meal_id \gset
select isnt(:'meal_id'::uuid, null, '관리자는 식사를 만들 수 있다');
select is((select title from public.meals where id = :'meal_id'), '테스트 점심 060', '제목의 앞뒤 공백이 지워진다');
select is((select note from public.meals where id = :'meal_id'), null, '공백뿐인 비고는 null 이 된다');
select is((select created_by from public.meals where id = :'meal_id'),
  (select id from public.people where auth_user_id = :'admin_uid'), 'created_by 는 기본값으로 만든 관리자가 들어간다');
select throws_ok(
  $$ insert into public.meals (title, served_on) values ('테스트 점심 060', '2026-10-12') $$,
  '23505', null, '같은 날짜·제목은 거부된다');
select throws_ok(
  $$ insert into public.meals (title, served_on) values ('', '2026-10-13') $$,
  '23514', null, '빈 제목은 거부된다');
select lives_ok(
  format($$ update public.meals set note = '추수감사' where id = %L $$, :'meal_id'),
  '관리자는 식사를 고칠 수 있다');
select throws_ok(
  format($$ insert into public.meals (title, served_on, created_by) values ('위조', '2026-10-15', %L) $$, :'admin_pid'),
  '42501', null, '관리자도 created_by 를 직접 넣을 수 없다 (열 권한 없음)');
select throws_ok(
  $$ insert into public.meals (title, served_on) values (normalize('테스트 점심 060', NFD), '2026-10-12') $$,
  '23505', null, 'NFD 로 분해된 제목도 NFC 로 저장되어 같은 식사와 충돌한다');
select throws_ok(
  $$ insert into public.meals (title, served_on) values (repeat('가', 31), '2026-10-16') $$,
  '23514', null, '31자 제목은 거부된다');
select throws_ok(
  $$ insert into public.meals (title, served_on, note) values ('비고길이', '2026-10-16', repeat('가', 101)) $$,
  '23514', null, '101자 비고는 거부된다');

-- 교인: 전부 볼 수 있지만 쓸 수 없다
select tests.authenticate_as(:'a_uid');
select is((select count(*) from public.meals where id = :'meal_id'), 1::bigint, '교인은 모든 식사를 본다');
select throws_ok(
  $$ insert into public.meals (title, served_on) values ('몰래', '2026-10-14') $$,
  '42501', null, '교인은 식사를 만들 수 없다');
-- update/delete 는 정책이 걸러 "0건 변경" 으로 조용히 끝난다 (오류가 아니다). 행이 그대로인지 본다.
update public.meals set title = '바꿈' where id = :'meal_id';
delete from public.meals where id = :'meal_id';
select tests.clear_auth();
select is((select title from public.meals where id = :'meal_id'), '테스트 점심 060', '교인의 수정·삭제는 아무 행도 바꾸지 못한다');

-- 관리자: 발급 없는 식사는 지울 수 있다 (삭제 정책 확인)
select tests.authenticate_as(:'admin_uid');
select lives_ok(
  format($$ delete from public.meals where id = %L $$, :'meal_id'),
  '관리자는 발급 없는 식사를 지울 수 있다');
select is((select count(*) from public.meals where id = :'meal_id'), 0::bigint, '삭제된 식사는 사라진다');

select * from finish();
rollback;
