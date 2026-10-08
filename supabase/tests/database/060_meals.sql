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
