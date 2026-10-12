begin;
select plan(54);

-- ---------- 권한 ----------
select is(has_function_privilege('anon', 'public.merge_people(uuid,uuid)', 'EXECUTE'), false, 'anon 은 merge_people 을 실행할 수 없다');
select is(has_function_privilege('anon', 'public.admin_reset_person(uuid)', 'EXECUTE'), false, 'anon 은 admin_reset_person 을 실행할 수 없다');
select is(has_function_privilege('anon', 'public.link_person(uuid,uuid)', 'EXECUTE'), false, 'anon 은 link_person 을 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.merge_people(uuid,uuid)', 'EXECUTE'), true, 'authenticated 는 merge_people 을 실행할 수 있다');

-- ---------- 준비 ----------
-- 권사(관리자) · 김철수(계정 있음) · 이영희(계정 있음, 뒤에서 관리자로 올린다) · 사람 행 없는 계정 · 익명 계정
select tests.create_user('people-admin@test.local') as admin_uid \gset
select tests.create_user('people-a@test.local') as a_uid \gset
select tests.create_user('people-b@test.local') as b_uid \gset
select tests.create_user('people-ghost@test.local') as ghost_uid \gset
select tests.create_user() as anon_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('권사',   '01015150001', :'admin_uid', now(), '2026-10-07'),
       ('김철수', '01015150002', :'a_uid',     now(), '2026-10-07'),
       ('이영희', '01015150003', :'b_uid',     now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid from public.people where auth_user_id = :'b_uid' \gset

-- 같은 사람(김철수)이 선발급으로 한 번 더 들어간 중복 행: 계정 없음, 1인 가족, 자녀 하나, 오늘 식사 장부
insert into public.people (name, phone) values ('김철수', '01015150004') returning id as dup_pid \gset
select family_id as dup_fid from public.people where id = :'dup_pid' \gset
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'dup_fid', true, :'dup_pid', now()) returning id as kid_pid \gset
-- 익명화된 행 (person_not_found 확인용)
insert into public.people (name, phone, deleted_at) values ('탈퇴한 사용자', null, now()) returning id as gone_pid \gset
select (now() at time zone 'Asia/Seoul')::date as today \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 150', :'today', :'admin_pid') returning id as today_meal \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'dup_pid', :'dup_fid', :'today_meal', 2, 5000, :'admin_pid') returning id as dup_iss \gset
-- self 사용 1건: 쓴 사람과 기록자가 같다 (usages_self_recorded_by_person) — 합칠 때 두 열이 함께 옮겨져야 한다
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id)
values (:'dup_fid', :'dup_pid', :'today_meal', 'self', :'dup_pid', gen_random_uuid()) returning id as dup_use \gset
-- 관리자(dup_pid)가 직접 처리한 발급 1건 + 취소 1건, admin 사용 1건 + 무효 1건: 처리자 네 열(issued_by·
-- cancelled_by·recorded_by·voided_by)이 합치기 때 함께 옮겨지는지 못 박는 데만 쓴다
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'today_meal', 1, 5000, :'dup_pid') returning id as hand_iss \gset
update public.issuances set cancelled_at = now(), cancelled_by = :'dup_pid' where id = :'hand_iss';
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id)
values (:'a_fid', :'a_pid', :'today_meal', 'admin', :'dup_pid', gen_random_uuid()) returning id as hand_use \gset
update public.usages set voided_at = now(), voided_by = :'dup_pid' where id = :'hand_use';

-- ---------- 로그인하지 않은 호출 ----------
select tests.clear_auth();
set local role authenticated;
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'a_pid'), 'P0001', 'not_authenticated', '로그인 없이 합칠 수 없다');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'a_pid'), 'P0001', 'not_authenticated', '로그인 없이 초기화할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'dup_pid', :'ghost_uid'), 'P0001', 'not_authenticated', '로그인 없이 연결할 수 없다');
reset role;

-- ---------- 교인(비관리자)은 셋 다 forbidden ----------
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'a_pid'), 'P0001', 'forbidden', '교인은 사람을 합칠 수 없다');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'dup_pid'), 'P0001', 'forbidden', '교인은 사람을 초기화할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'dup_pid', :'ghost_uid'), 'P0001', 'forbidden', '교인은 계정을 연결할 수 없다');

-- ---------- merge_people: 검증 ----------
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'a_pid', :'a_pid'), 'P0001', 'same_person', '같은 사람끼리는 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, gen_random_uuid(), :'a_pid'), 'P0001', 'person_not_found', '없는 사람은 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'gone_pid', :'a_pid'), 'P0001', 'person_not_found', '익명화된 사람은 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'gone_pid'), 'P0001', 'person_not_found', '익명화된 사람으로는 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'kid_pid', :'a_pid'), 'P0001', 'minor_not_allowed', '자녀를 합칠 수 없다 (가족 탭에서 관리)');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'kid_pid'), 'P0001', 'minor_not_allowed', '자녀에게로 합칠 수 없다');
select throws_ok(format($$ select public.merge_people(%L, %L) $$, :'b_pid', :'a_pid'), 'P0001', 'both_have_accounts', '둘 다 계정이 있으면 거부');

-- ④ 잠금: 합치기 전에는 (중복 행 가족, 오늘 식사) 잠금이 없다
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'dup_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'today_meal'::text)::bigint & 4294967295)),
          0::bigint, '합치기 전에는 (옛 가족, 오늘 식사) ④ 잠금이 없다');

-- ---------- merge_people: 성공 (선발급 중복 → 계정 있는 본인) ----------
select lives_ok(format($$ select public.merge_people(%L, %L) $$, :'dup_pid', :'a_pid'), '관리자는 중복 사람을 합칠 수 있다');
-- 여기까지 실패한 호출들은 모두 ③ lock_family 에 닿기 전에 예외를 던졌다 — 지금이 이 트랜잭션에서
-- dup_fid·a_fid 를 처음 잠그는 순간이라 아래 두 단언은 헛돌지 않는다
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 1 and pid = pg_backend_pid()
              and classid::bigint = ((hashtext('family:' || :'dup_fid'::text)::bigint >> 32) & 4294967295)
              and objid::bigint   =  (hashtext('family:' || :'dup_fid'::text)::bigint & 4294967295)),
          1::bigint, 'merge_people 이 옛 가족의 ③ lock_family 잠금을 쥔다');
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 1 and pid = pg_backend_pid()
              and classid::bigint = ((hashtext('family:' || :'a_fid'::text)::bigint >> 32) & 4294967295)
              and objid::bigint   =  (hashtext('family:' || :'a_fid'::text)::bigint & 4294967295)),
          1::bigint, 'merge_people 이 받는 쪽 가족의 ③ lock_family 잠금도 쥔다');
-- 실패한 호출은 서브트랜잭션 롤백으로 잠금이 풀린다 — 성공한 호출 뒤에만 의미가 있다
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'dup_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'today_meal'::text)::bigint & 4294967295)),
          1::bigint, 'merge_people 이 옛 가족의 오늘 식사 ④ 잠금을 쥔다');
select tests.clear_auth();
select results_eq(
  format($$ select person_id, family_id, issued_by from public.issuances where id = %L $$, :'dup_iss'),
  format($$ values (%L::uuid, %L::uuid, %L::uuid) $$, :'a_pid', :'a_fid', :'admin_pid'),
  '발급은 구매자와 가족이 합쳐진 쪽으로 옮겨진다 (발급한 관리자는 그대로)');
select results_eq(
  format($$ select person_id, recorded_by, family_id from public.usages where id = %L $$, :'dup_use'),
  format($$ values (%L::uuid, %L::uuid, %L::uuid) $$, :'a_pid', :'a_pid', :'a_fid'),
  'self 사용은 쓴 사람·기록자가 함께 옮겨진다 (제약 위반 없이)');
select results_eq(
  format($$ select issued_by, cancelled_by from public.issuances where id = %L $$, :'hand_iss'),
  format($$ values (%L::uuid, %L::uuid) $$, :'a_pid', :'a_pid'),
  '발급·취소 처리자도 합쳐진 쪽으로 옮겨진다');
select results_eq(
  format($$ select recorded_by, voided_by from public.usages where id = %L $$, :'hand_use'),
  format($$ values (%L::uuid, %L::uuid) $$, :'a_pid', :'a_pid'),
  'admin 사용의 기록자·무효 처리자도 옮겨진다 (self 제약과 무관하게)');
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null from public.people where id = %L $$, :'dup_pid'),
  $$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true) $$,
  '합쳐진 쪽은 익명화된다');
select results_eq(
  format($$ select guardian_id, family_id from public.people where id = %L $$, :'kid_pid'),
  format($$ values (%L::uuid, %L::uuid) $$, :'a_pid', :'a_fid'),
  '자녀의 보호자와 가족도 함께 옮겨진다');
select is((select count(*) from public.families where id = :'dup_fid'), 0::bigint, '사람도 장부도 남지 않은 옛 가족은 지워진다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 1, '잔량 풀이 합쳐진다 (2장 발급 − 1장 사용)');

-- ---------- merge_people: 계정·관리자 권한이 옮겨 간다 ----------
-- 이영희(계정 있음)를 관리자로 올리고, 계정 없는 선발급 중복 행으로 합친다
update public.people set role = 'admin' where id = :'b_pid';
insert into public.people (name, phone) values ('이영희', '01015150005') returning id as dup2_pid \gset
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.merge_people(%L, %L) $$, :'b_pid', :'dup2_pid'), '계정이 한쪽에만 있으면 합칠 수 있다');
select tests.clear_auth();
select results_eq(
  format($$ select auth_user_id, consented_at is not null, role from public.people where id = %L $$, :'dup2_pid'),
  format($$ values (%L::uuid, true, 'admin'::text) $$, :'b_uid'),
  '계정·동의 기록·관리자 권한이 합쳐진 쪽으로 옮겨진다');
select is((select auth_user_id from public.people where id = :'b_pid'), null, '합쳐진 쪽의 계정 연결은 끊긴다');

-- ---------- merge_people: 옛 가족에 산 사람이 남으면 장부는 그 가족에 둔다 ----------
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('박민수', '01015150006', null, null, null) returning id as c1_pid \gset
select family_id as c_fid from public.people where id = :'c1_pid' \gset
insert into public.people (name, phone, family_id) values ('박서준', '01015150007', :'c_fid') returning id as c2_pid \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'c1_pid', :'c_fid', :'today_meal', 3, 5000, :'admin_pid') returning id as c1_iss \gset
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.merge_people(%L, %L) $$, :'c1_pid', :'a_pid'), '가족에 다른 사람이 남아 있어도 합칠 수 있다');
select tests.clear_auth();
select results_eq(
  format($$ select person_id, family_id from public.issuances where id = %L $$, :'c1_iss'),
  format($$ values (%L::uuid, %L::uuid) $$, :'a_pid', :'c_fid'),
  '장부의 구매자는 옮기지만 가족(함께 쓰던 풀)은 남긴다');
select is((select count(*) from public.families where id = :'c_fid'), 1::bigint, '산 사람이 남은 가족은 지우지 않는다');

-- ---------- admin_reset_person ----------
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'gone_pid'), 'P0001', 'person_not_found', '익명화된 사람은 초기화할 수 없다');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'kid_pid'), 'P0001', 'minor_not_allowed', '자녀는 초기화할 수 없다 (가족 탭에서 삭제)');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'a_pid'), 'P0001', 'has_children', '자녀가 딸린 사람은 먼저 자녀를 정리해야 한다');
select lives_ok(format($$ select public.admin_reset_person(%L) $$, :'c2_pid'), '관리자는 잘못 들어온 사람을 초기화할 수 있다');
-- c2_pid 의 가족(c_fid)은 위의 "가족에 다른 사람이 남으면" merge_people(c1_pid, a_pid) 호출이 이미
-- ③ 로 잠가 둬서, 여기서 다시 확인하면 admin_reset_person 자신의 lock_family 호출을 지워도 헛돈다.
-- 이 트랜잭션에서 아직 아무도 건드리지 않은 가족을 새로 하나 만들어 그 가족에 대해서만 확인한다.
insert into public.people (name, phone) values ('초기화전용', '01015150000') returning id as iso_pid \gset
select family_id as iso_fid from public.people where id = :'iso_pid' \gset
select public.admin_reset_person(:'iso_pid');
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 1 and pid = pg_backend_pid()
              and classid::bigint = ((hashtext('family:' || :'iso_fid'::text)::bigint >> 32) & 4294967295)
              and objid::bigint   =  (hashtext('family:' || :'iso_fid'::text)::bigint & 4294967295)),
          1::bigint, 'admin_reset_person 이 대상 가족의 ③ lock_family 잠금을 쥔다');
select tests.clear_auth();
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null from public.people where id = %L $$, :'c2_pid'),
  $$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true) $$,
  '초기화는 익명화 + 계정 연결 해제다');
select is((select count(*) from public.issuances where family_id = :'c_fid'), 1::bigint, '초기화해도 장부는 보존된다');
-- 마지막 관리자: 010_e2e_admin.sql 시드와 위에서 올린 관리자들을 이 트랜잭션 동안만 member 로 내린다 (rollback 으로 복구)
update public.people set role = 'member' where role = 'admin' and deleted_at is null and id <> :'admin_pid';
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.admin_reset_person(%L) $$, :'admin_pid'), 'P0001', 'last_admin', '마지막 관리자는 초기화할 수 없다');

-- ---------- link_person ----------
-- 연결 대상: 동의 기록이 있는 계정 없는 사람. 박민수는 동의 기록이 없어 consent_required 가 된다.
-- people 에 대한 authenticated 의 insert 권한은 (name, phone) 열뿐이다 — consented_at·consent_version 을
-- 가진 테스트 시드 행은 postgres 로 넣고, 검증은 다시 admin_uid 로 돌아와 한다.
select tests.clear_auth();
insert into public.people (name, phone, consented_at, consent_version)
values ('최은지', '01015150008', now(), '2026-10-07') returning id as link_pid \gset
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'gone_pid', :'ghost_uid'), 'P0001', 'person_not_found', '익명화된 사람에게는 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'kid_pid', :'ghost_uid'), 'P0001', 'minor_not_allowed', '자녀에게는 연결할 수 없다 (가족 탭의 다시 연결)');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'a_pid', :'ghost_uid'), 'P0001', 'already_registered', '이미 계정이 있는 사람에게는 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'c1_pid', :'ghost_uid'), 'P0001', 'person_not_found', '합쳐져 익명화된 사람에게는 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', gen_random_uuid()), 'P0001', 'account_not_found', '없는 계정은 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', :'anon_uid'), 'P0001', 'anonymous_cannot_claim', '익명(아이) 계정은 연결할 수 없다');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', :'a_uid'), 'P0001', 'account_taken', '다른 사람이 쓰는 계정은 연결할 수 없다');
select lives_ok(format($$ select public.link_person(%L, %L) $$, :'link_pid', :'ghost_uid'), '관리자는 동의 기록이 있는 사람에게 계정을 연결할 수 있다');
select tests.clear_auth();
select is((select auth_user_id from public.people where id = :'link_pid'), :'ghost_uid'::uuid, '연결된 계정이 기록된다');
-- 동의 기록이 없는 사람에게는 연결하지 않는다 (동의를 대신 만들지 않는다)
insert into public.people (name, phone) values ('동의없음', '01015150009') returning id as noconsent_pid \gset
select tests.create_user('people-ghost2@test.local') as ghost2_uid \gset
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.link_person(%L, %L) $$, :'noconsent_pid', :'ghost2_uid'), 'P0001', 'consent_required', '동의 기록이 없는 사람에게는 연결할 수 없다');

select * from finish();
rollback;
