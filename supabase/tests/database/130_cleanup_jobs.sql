begin;
select plan(18);

select has_extension('pg_cron', 'pg_cron 확장이 설치되어 있다');
select set_eq(
  $$ select jobname from cron.job where jobname like 'cleanup_%' $$,
  $$ values ('cleanup_pairing_codes'::name), ('cleanup_orphan_anonymous_users'), ('cleanup_empty_families') $$,
  '정리 작업 3건이 등록되어 있다');
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
select is(public.cleanup_pairing_codes(), 2, '만료·사용된 코드 2건을 지운다');
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
select is(public.cleanup_orphan_anonymous_users(), 1, '24시간 지난 미연결 익명 계정 중 살아 있는 코드가 없는 1건만 지운다');
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
select is(public.cleanup_empty_families(), 1, '사람도 장부도 없고 1시간 지난 가족 1건만 지운다');
select is((select count(*) from public.families where id = :'empty_old'), 0::bigint, '오래된 빈 가족이 지워졌다');
select is((select count(*) from public.families where id = :'empty_new'), 1::bigint, '방금 만든 빈 가족은 남는다 (진행 중인 가입일 수 있다)');
select is((select count(*) from public.families where id = :'ledger_only'), 1::bigint, '장부가 있는 가족은 남는다');
select is((select count(*) from public.families where id = (select family_id from public.people where id = :'admin_pid')), 1::bigint, '구성원이 있는 가족은 남는다');

select * from finish();
rollback;
