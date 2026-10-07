begin;
select plan(19);

-- 준비: 사용자 A(김철수), B(이영희, 다른 가족), 관리자(권사). uid 는 역할 전환 전에 \gset 으로 받아 둔다.
select tests.create_user('a@test.local') as a_uid \gset
select tests.create_user('b@test.local') as b_uid \gset
select tests.create_user('admin@test.local') as admin_uid \gset

insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01011110001', :'a_uid', now(), 'v1'),
       ('이영희', '01011110002', :'b_uid', now(), 'v1'),
       ('권사',   '01011110009', :'admin_uid', now(), 'v1');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
-- 선발급자(계정 없음)
insert into public.people (name, phone) values ('이순자', '01011110003');

-- A 로서
select tests.authenticate_as(:'a_uid');
select is((select count(*) from public.people), 1::bigint, 'A는 자기 가족(자기 자신)만 본다');
select is((select name from public.people), '김철수', '보이는 사람은 본인이다');
select is((select count(*) from public.families), 1::bigint, 'A는 자기 가족 행만 본다');

-- A 가족에 식구를 붙인다: 탈퇴한 구성원 · 살아 있는 형제 · 자녀 계정(익명 로그인)
select tests.clear_auth();
insert into public.people (name, family_id, deleted_at)
values ('탈퇴가족원', (select family_id from public.people where auth_user_id = :'a_uid'), now());
insert into public.people (name, family_id)
values ('가족형제', (select family_id from public.people where auth_user_id = :'a_uid'));
select tests.create_user() as kid_uid \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', (select family_id from public.people where auth_user_id = :'a_uid'), :'kid_uid', true,
        (select id from public.people where auth_user_id = :'a_uid'), now());
select tests.authenticate_as(:'a_uid');

-- 탈퇴한 구성원은 보이지 않는다 (정책의 deleted_at is null 절)
select is((select count(*) from public.people), 3::bigint, 'A는 살아 있는 가족 구성원만 본다 (탈퇴자 제외)');

-- 같은 가족이라도 남의 행은 고칠 수 없다 (people_update_self 의 USING 범위)
update public.people set name = '해킹' where name = '가족형제';
select is((select name from public.people where name in ('가족형제','해킹')), '가족형제', 'A는 같은 가족이라도 남의 이름을 바꿀 수 없다');

update public.people set name = '김철수A' where auth_user_id = auth.uid();
select is((select name from public.people where auth_user_id = auth.uid()), '김철수A', 'A는 자기 이름을 바꿀 수 있다');

select throws_ok(
  $$ update public.people set role = 'admin' where auth_user_id = auth.uid() $$,
  '42501', null, 'A는 role 열을 바꿀 수 없다 (열 권한 없음)'
);

select throws_ok(
  $$ insert into public.people (name, phone) values ('새사람', '01099990000') $$,
  '42501', null, 'A는 사람을 만들 수 없다'
);

-- 자녀 계정: 가족은 보이지만 자기 행도 고칠 수 없다 (is_minor = false 절)
select tests.authenticate_as(:'kid_uid');
select is((select count(*) from public.people), 3::bigint, '자녀 계정도 가족 구성원을 본다');
update public.people set name = '내가정한이름' where auth_user_id = (select auth.uid());
select is((select name from public.people where auth_user_id = (select auth.uid())), '서연', '자녀 계정은 자기 이름을 바꿀 수 없다 (조회만)');

-- 거부된 insert 가 트리거로 만든 가족 행을 남기지 않았는지 (문장 단위 롤백)
select tests.clear_auth();
select is(
  (select count(*) from public.families f
    where f.created_at = now()
      and not exists (select 1 from public.people p where p.family_id = f.id)),
  0::bigint, '구성원 없는 가족 행이 남지 않는다 (거부된 insert 의 트리거 흔적 없음)');

-- 관리자로서
select tests.authenticate_as(:'admin_uid');
select set_eq(
  $$ select name from public.people $$,
  $$ values ('김철수A'::text),('이영희'),('권사'),('이순자'),('탈퇴가족원'),('가족형제'),('서연') $$,
  '관리자는 모든 사람을 본다 (탈퇴자·타가족·자녀 포함)');
select lives_ok(
  $$ insert into public.people (name, phone) values ('방문자', '01099990000') $$,
  '관리자는 선발급용 사람을 만들 수 있다'
);
select isnt_empty(
  $$ select id from public.families where id <> (select public.current_family_id()) $$,
  '관리자는 자기 가족이 아닌 가족 행도 본다');

select throws_ok(
  $$ delete from public.people where name = '이순자' $$,
  '42501', null, '관리자도 행을 지울 수 없다 (소프트 삭제만)'
);

-- 익명화(파기)된 행은 관리자도 되살릴 수 없다 (people_update_admin 의 deleted_at is null 절)
select tests.clear_auth();
update public.people set name = '탈퇴한 사용자', phone = null, auth_user_id = null where name = '탈퇴가족원';
select tests.authenticate_as(:'admin_uid');
update public.people set name = '복구시도' where name = '탈퇴한 사용자';
select is((select count(*) from public.people where name = '복구시도'), 0::bigint, '관리자도 익명화된 행은 고칠 수 없다');

-- 정책 구조를 고정한다: 정책이 늘거나 사라지면 여기서 잡힌다
select policies_are('public', 'people',
  array['people_select_family_or_admin','people_update_self','people_insert_admin','people_update_admin'],
  'people 정책은 정확히 4개');
select policies_are('public', 'families', array['families_select_own_or_admin'], 'families 정책은 정확히 1개');

-- 비로그인(anon)
select tests.clear_auth();
set local role anon;
select throws_ok($$ select count(*) from public.people $$, '42501', null, 'anon은 people을 읽을 수 없다');
reset role;

select * from finish();
rollback;
