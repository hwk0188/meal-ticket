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
