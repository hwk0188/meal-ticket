begin;
select plan(20);

select is(has_function_privilege('anon', 'public.use_ticket(uuid,uuid)', 'EXECUTE'), false, 'anon 은 use_ticket 을 실행할 수 없다');

-- 준비: 가족 A = 어른 김철수 + 자녀 서연(익명 계정, 같은 가족). 가족 B = 이영희. 관리자. 오늘 식사 + 다음 주 식사.
select tests.create_user('use-a@test.local') as a_uid \gset
select tests.create_user() as kid_uid \gset
select tests.create_user('use-b@test.local') as b_uid \gset
select tests.create_user('use-admin@test.local') as admin_uid \gset
select tests.create_user('use-ghost@test.local') as ghost_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01066660001', :'a_uid', now(), '2026-10-07'),
       ('이영희', '01066660002', :'b_uid', now(), '2026-10-07'),
       ('권사',   '01066660009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as b_pid, family_id as b_fid from public.people where auth_user_id = :'b_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'a_fid', :'kid_uid', true, :'a_pid', now());
select (now() at time zone 'Asia/Seoul')::date as today \gset
-- ★ 제목은 이 테스트만 쓰는 고유값 (로컬에 남은 '주일 점심' 행과 (served_on, title) 충돌을 피한다). use_ticket 은 제목에 의존하지 않는다.
insert into public.meals (title, served_on, created_by) values ('테스트 점심 090', :'today', :'admin_pid') returning id as today_meal \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 090 다음주', :'today'::date + 7, :'admin_pid') returning id as next_meal \gset
-- A 가족 오늘 2장, 다음 주 1장. B 가족은 없음.
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'today_meal', 2, 5000, :'admin_pid'),
       (:'a_pid', :'a_fid', :'next_meal', 1, 5000, :'admin_pid');
-- ★ 잔량 계산에서 빠져야 하는 행: 취소된 발급 5장, 무효 처리된 사용 1장 (둘 다 A 가족 오늘 식사)
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by, cancelled_at, cancelled_by, cancel_reason)
values (:'a_pid', :'a_fid', :'today_meal', 5, 5000, :'admin_pid', now(), :'admin_pid', '실수');
insert into public.usages (family_id, person_id, meal_id, used_via, recorded_by, request_id, voided_at, voided_by)
values (:'a_fid', :'a_pid', :'today_meal', 'self', :'a_pid', gen_random_uuid(), now(), :'admin_pid');

-- 가입 전 계정
select tests.authenticate_as(:'ghost_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'not_registered', '사람 행이 없는 계정은 쓸 수 없다');

-- A: 검증
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, gen_random_uuid(), gen_random_uuid()), 'P0001', 'meal_not_found', '없는 식사');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'next_meal', gen_random_uuid()), 'P0001', 'not_today', '오늘이 아닌 식사의 식권은 쓸 수 없다');
select throws_ok(format($$ select public.use_ticket(%L, null) $$, :'today_meal'), 'P0001', 'invalid_request', 'request_id 가 없으면 거부');

-- A: 성공 + 멱등
select gen_random_uuid() as req1 \gset
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req1'), '오늘 식권을 1장 쓴다');
select results_eq(
  format($$ select family_id, person_id, quantity, used_via, recorded_by, voided_at from public.usages where request_id = %L $$, :'req1'),
  format($$ values (%L::uuid, %L::uuid, 1, 'self'::text, %L::uuid, null::timestamptz) $$, :'a_fid', :'a_pid', :'a_pid'),
  '사용 기록: 가족·누른 폰·1장·self');
select is((select remaining from public.ticket_balances where meal_id = :'today_meal'), 1, '잔량이 1 줄었다 (취소된 발급·무효 사용은 계산에서 빠진다)');
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req1'), '같은 request_id 재시도는 성공으로 본다');
select is((select count(*) from public.usages where meal_id = :'today_meal' and voided_at is null), 1::bigint, '재시도는 새 사용을 만들지 않는다');
select is((select remaining from public.ticket_balances where meal_id = :'today_meal'), 1, '재시도 뒤에도 잔량은 그대로');

-- 자녀 계정(같은 가족)이 2장째를 쓴다 → 0장
select tests.authenticate_as(:'kid_uid');
select gen_random_uuid() as req2 \gset
select lives_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req2'), '자녀 계정도 가족 식권을 쓸 수 있다');
select is((select person_id from public.usages where request_id = :'req2'),
  (select id from public.people where auth_user_id = :'kid_uid'), '어느 폰에서 썼는지(자녀)가 남는다');
select is((select remaining from public.ticket_balances where meal_id = :'today_meal'), 0, '가족 잔량이 0 이 된다');
-- 남의 request_id 로는 결과를 가져갈 수 없다
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', :'req1'), 'P0001', 'duplicate_request', '다른 사람의 request_id 는 거부');

-- 잔량 초과
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'no_remaining', '잔량이 없으면 거부');
select is((select count(*) from public.usages where meal_id = :'today_meal' and voided_at is null), 2::bigint, '거부된 호출은 기록을 남기지 않는다');

-- B(다른 가족): 발급이 없으므로 no_remaining. A 의 식권을 가져다 쓸 수 없다
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'no_remaining', '다른 가족은 남의 식권을 쓸 수 없다');

-- 관리자도 자기 가족 식권만 (관리자 대신 처리는 4단계 use_ticket_as_admin)
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'no_remaining', '관리자도 use_ticket 으로는 남의 식권을 쓸 수 없다');

-- JWT 없이 직접 호출
select tests.clear_auth();
set local role authenticated;
select throws_ok(format($$ select public.use_ticket(%L, %L) $$, :'today_meal', gen_random_uuid()), 'P0001', 'not_authenticated', 'JWT 가 없으면 not_authenticated');
reset role;

select * from finish();
rollback;
