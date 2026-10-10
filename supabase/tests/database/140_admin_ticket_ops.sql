begin;
select plan(44);

-- 권한: anon 은 셋 다 실행 불가, authenticated 는 재정의된 use_ticket 을 여전히 실행할 수 있다
select is(has_function_privilege('anon', 'public.cancel_issuance(uuid,text)', 'EXECUTE'), false, 'anon 은 cancel_issuance 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.use_ticket_as_admin(uuid,uuid,uuid,uuid)', 'EXECUTE'), false, 'anon 은 use_ticket_as_admin 을 실행할 수 없다');
select is(has_function_privilege('anon', 'public.void_usage(uuid)', 'EXECUTE'), false, 'anon 은 void_usage 를 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.use_ticket(uuid,uuid)', 'EXECUTE'), true, '재정의된 use_ticket 은 authenticated 가 실행할 수 있다');

-- 준비: 가족 A = 김철수 + 자녀 서연(익명 계정), 가족 B = 이영희, 관리자, 사람 행 없는 계정. 오늘 식사 + 지난 식사.
select tests.create_user('ops-a@test.local') as a_uid \gset
select tests.create_user() as kid_uid \gset
select tests.create_user('ops-b@test.local') as b_uid \gset
select tests.create_user('ops-admin@test.local') as admin_uid \gset
select tests.create_user('ops-ghost@test.local') as ghost_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01077770001', :'a_uid', now(), '2026-10-07'),
       ('이영희', '01077770002', :'b_uid', now(), '2026-10-07'),
       ('권사',   '01077770009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid, family_id as b_fid from public.people where auth_user_id = :'b_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'a_fid', :'kid_uid', true, :'a_pid', now()) returning id as kid_pid \gset
insert into public.people (name, phone, deleted_at) values ('탈퇴자', null, now()) returning id as deleted_pid \gset
select (now() at time zone 'Asia/Seoul')::date as today \gset
-- ★ 제목은 이 테스트만 쓰는 고유값 (로컬에 남은 행과 (served_on, title) 충돌 방지)
insert into public.meals (title, served_on, created_by) values ('테스트 점심 140', :'today', :'admin_pid') returning id as today_meal \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 140 지난주', :'today'::date - 7, :'admin_pid') returning id as past_meal \gset
-- A 오늘: 3장(i1) + 2장(i2). B 지난주: 1장(i3). B 오늘: 없음.
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'today_meal', 3, 5000, :'admin_pid') returning id as i1 \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'today_meal', 2, 5000, :'admin_pid') returning id as i2 \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'b_pid', :'b_fid', :'past_meal', 1, 5000, :'admin_pid') returning id as i3 \gset

-- 교인(비관리자)은 셋 다 forbidden
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'forbidden', '교인은 발급을 취소할 수 없다');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'a_pid', :'today_meal'), 'P0001', 'forbidden', '교인은 대신 사용 처리를 할 수 없다');
select throws_ok(format($$ select public.void_usage(%L) $$, gen_random_uuid()), 'P0001', 'forbidden', '교인은 사용을 무효 처리할 수 없다');
-- 사람 행이 없는 계정도 forbidden
select tests.authenticate_as(:'ghost_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'forbidden', '사람 행이 없는 계정은 취소할 수 없다');

-- JWT 없이 직접 호출 (세 함수 모두, 090 의 규약에 set local role authenticated 를 더한 것 — grant 가 빠지면 42501 로 드러난다)
select tests.clear_auth();
set local role authenticated;
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'not_authenticated', 'JWT 가 없으면 cancel_issuance 는 not_authenticated');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'a_pid', :'today_meal'), 'P0001', 'not_authenticated', 'JWT 가 없으면 use_ticket_as_admin 은 not_authenticated');
select throws_ok(format($$ select public.void_usage(%L) $$, gen_random_uuid()), 'P0001', 'not_authenticated', 'JWT 가 없으면 void_usage 는 not_authenticated');
reset role;

-- 관리자: 취소
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, gen_random_uuid()), 'P0001', 'issuance_not_found', '없는 발급은 거부');
select throws_ok(format($$ select public.cancel_issuance(%L, %L) $$, :'i2', repeat('가', 101)), 'P0001', 'invalid_reason', '101자 사유는 거부');
select lives_ok(format($$ select public.cancel_issuance(%L, '  실수  ') $$, :'i2'), '관리자는 발급을 취소할 수 있다');
select tests.clear_auth();
select is((select cancel_reason from public.issuances where id = :'i2'), '실수', '사유 공백이 정리돼 기록된다');
select is((select cancelled_by from public.issuances where id = :'i2'), :'admin_pid'::uuid, '취소한 관리자가 기록된다');
select is((select issued from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 3, '취소된 발급은 잔량에서 빠진다');
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i2'), 'P0001', 'already_cancelled', '이미 취소된 발급은 다시 취소할 수 없다');

-- 관리자: 대신 사용
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, gen_random_uuid(), :'today_meal'), 'P0001', 'person_not_found', '없는 사람은 거부');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'deleted_pid', :'today_meal'), 'P0001', 'person_not_found', '탈퇴한 사람은 거부');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'a_pid', gen_random_uuid()), 'P0001', 'meal_not_found', '없는 식사는 거부');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'b_pid', :'today_meal'), 'P0001', 'no_remaining', '잔량이 없는 가족은 거부');
-- 화면이 본 가족(p_family_id)과 사람의 현재 가족이 다르면 거부 — A 의 김철수를 B 가족 블록에서 누른 상황
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L) $$, :'a_pid', :'today_meal', :'b_fid'), 'P0001', 'family_changed', '그 사이 가족이 바뀐 사람은 거부');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'kid_pid', :'today_meal'), '자녀 몫으로도 대신 사용 처리할 수 있다 (잔량은 가족 것)');
-- ④ 잠금: 아직 아무도 잠그지 않은 (B, 지난 식사) 쌍으로 호출 전/후를 비교한다.
-- 주의: throws_ok 안에서 실패한 호출은 서브트랜잭션이 롤백되며 advisory xact 잠금도 풀린다 — 잠금 단언은 성공한 호출 뒤에만 의미가 있다.
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'b_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'past_meal'::text)::bigint & 4294967295)),
          0::bigint, '호출 전에는 (B, 지난 식사) ④ 잠금이 없다');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L) $$, :'b_pid', :'past_meal'), '지난 식사도 대신 사용 처리할 수 있다 (날짜 제한 없음)');
select is((select count(*) from pg_locks
            where locktype = 'advisory' and objsubid = 2 and pid = pg_backend_pid()
              and classid::bigint = (hashtext(:'b_fid'::text)::bigint & 4294967295)
              and objid::bigint   = (hashtext(:'past_meal'::text)::bigint & 4294967295)),
          1::bigint, 'use_ticket_as_admin 이 (가족, 식사) ④ 잠금을 쥔다');
select tests.clear_auth();
select results_eq(
  format($$ select family_id, person_id, used_via, recorded_by, quantity, voided_at from public.usages where meal_id = %L $$, :'today_meal'),
  format($$ values (%L::uuid, %L::uuid, 'admin'::text, %L::uuid, 1, null::timestamptz) $$, :'a_fid', :'kid_pid', :'admin_pid'),
  '대신 사용은 가족·대상(자녀)·admin·처리한 관리자로 기록된다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 2, '대신 사용 뒤 A 가족 남은 장수는 2');
select id as admin_usage from public.usages where meal_id = :'today_meal' and used_via = 'admin' \gset

-- 정상 경로: 화면이 본 가족이 지금 가족과 같으면(p_family_id 일치) 그대로 처리된다
select tests.authenticate_as(:'admin_uid');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L) $$, :'a_pid', :'today_meal', :'a_fid'), '화면이 본 가족이 지금 가족과 같으면 대신 사용할 수 있다 (정상 경로)');
select tests.clear_auth();
select id as a_usage from public.usages where meal_id = :'today_meal' and used_via = 'admin' and person_id = :'a_pid' \gset
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 1, '정상 경로 사용 뒤 A 가족 남은 장수는 1');

-- 관리자: 무효
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.void_usage(%L) $$, gen_random_uuid()), 'P0001', 'usage_not_found', '없는 사용 기록은 거부');
select lives_ok(format($$ select public.void_usage(%L) $$, :'admin_usage'), '관리자는 사용 기록을 무효 처리할 수 있다');
select lives_ok(format($$ select public.void_usage(%L) $$, :'a_usage'), '정상 경로로 쓴 사용 기록도 무효 처리할 수 있다 (상쇄)');
select tests.clear_auth();
select is((select voided_by from public.usages where id = :'admin_usage'), :'admin_pid'::uuid, '무효 처리한 관리자가 기록된다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'today_meal'), 3, '무효 처리된 사용은 잔량에서 빠진다');
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.void_usage(%L) $$, :'admin_usage'), 'P0001', 'already_voided', '이미 무효인 기록은 다시 무효 처리할 수 없다');

-- 관리자: 대신 사용 멱등(p_request_id) — 같은 값은 처음 결과를 돌려준다(use_ticket 과 같은 규칙)
select tests.authenticate_as(:'admin_uid');
select gen_random_uuid() as rid \gset
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L, %L) $$, :'kid_pid', :'today_meal', :'a_fid', :'rid'), '같은 request_id 로 첫 호출은 기록된다');
select lives_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L, %L) $$, :'kid_pid', :'today_meal', :'a_fid', :'rid'), '같은 request_id 로 다시 호출해도 살아 있다 (멱등)');
select tests.clear_auth();
select is((select count(*)::integer from public.usages where request_id = :'rid'), 1, '같은 request_id 는 한 건만');
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.use_ticket_as_admin(%L, %L, %L, %L) $$, :'b_pid', :'past_meal', :'b_fid', :'rid'), 'P0001', 'duplicate_request', '다른 사람·식사에 같은 request_id 를 재사용하면 거부');

-- 재정의된 use_ticket: 교인이 그대로 쓸 수 있고, 그 뒤 잔량보다 큰 발급의 취소는 would_go_negative
select tests.authenticate_as(:'a_uid');
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), '재정의된 use_ticket 으로 교인이 1장 쓴다');
select tests.clear_auth();
select is((select count(*)::integer from public.usages where meal_id = :'today_meal' and used_via = 'self' and voided_at is null), 1, 'self 사용 1건이 남는다');
select tests.authenticate_as(:'admin_uid');
-- A 오늘: 발급 3(i1), 이미 쓴 장수(멱등 대신 사용 1 + self 1)가 있어 i1(3장) 전체 취소는 잔량을 음수로 만든다
select throws_ok(format($$ select public.cancel_issuance(%L, null) $$, :'i1'), 'P0001', 'would_go_negative', '이미 사용된 장수가 있어 잔량이 음수가 되는 취소는 거부');

select * from finish();
rollback;
