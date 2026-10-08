begin;
select plan(29);

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
values ('김철수', '01077000001', :'a_uid', now(), '2026-10-07');
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
-- 코드는 100만 가지 중 균등 추출이라 1e-6 확률로 같은 값이 나올 수 있다 (실패해도 버그가 아닐 수 있다)
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
-- 이 upsert 는 create_pairing_code 본문의 문장과 같아야 한다 (migration 20261009000001 참고). 함수 쪽을 바꾸면 여기도 바꾼다.
select tests.create_user() as old_uid \gset
select tests.create_user() as recycle_uid \gset
insert into public.pairing_codes (code, auth_user_id, kind, expires_at, used_at)
values ('000000', :'old_uid', 'child', now() - interval '1 minute', now() - interval '2 minutes');
insert into public.pairing_codes as pc (code, auth_user_id, kind, expires_at)
values ('000000', :'recycle_uid', 'child', now() + interval '10 minutes')
on conflict (code) do update set auth_user_id = excluded.auth_user_id, kind = excluded.kind, created_at = now(), expires_at = excluded.expires_at, used_at = null
  where pc.used_at is not null or pc.expires_at < now();
select results_eq(
  $$ select auth_user_id, used_at from public.pairing_codes where code = '000000' $$,
  format($$ values (%L::uuid, null::timestamptz) $$, :'recycle_uid'),
  '사용된 코드 자리는 새 계정의 코드로 덮어쓸 수 있다');
-- 살아 있는 코드는 덮어쓰지 못한다
insert into public.pairing_codes as pc (code, auth_user_id, kind, expires_at)
values ('000000', :'old_uid', 'child', now() + interval '10 minutes')
on conflict (code) do update set auth_user_id = excluded.auth_user_id, kind = excluded.kind, created_at = now(), expires_at = excluded.expires_at, used_at = null
  where pc.used_at is not null or pc.expires_at < now();
select is((select auth_user_id from public.pairing_codes where code = '000000'), :'recycle_uid'::uuid, '살아 있는 남의 코드는 덮어쓰지 않는다');

-- 형식 제약
select throws_ok(
  format($$ insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('12345', %L, 'child', now()) $$, :'old_uid'),
  '23514', null, '6자리 숫자가 아닌 코드는 거부한다');

-- 토큰은 유효한데 계정이 지워진 경우 (JWT 는 최대 1시간 더 살아 있다): FK 23503 대신 약속된 코드
select tests.create_user() as gone_uid \gset
select tests.clear_auth();
delete from auth.users where id = :'gone_uid';
select set_config('request.jwt.claims', json_build_object('sub', :'gone_uid', 'role', 'authenticated', 'aud', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select public.create_pairing_code('child') $$, 'P0001', 'not_authenticated', '계정이 지워진 토큰은 not_authenticated');
reset role;

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
