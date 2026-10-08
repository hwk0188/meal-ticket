begin;
select plan(33);

select is(has_function_privilege('anon', 'public.issue_tickets(uuid,uuid,integer,integer,text)', 'EXECUTE'), false, 'anon 은 issue_tickets 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.create_next_sunday_lunch(date)', 'EXECUTE'), false, 'anon 은 create_next_sunday_lunch 를 실행할 수 없다');

-- create_next_sunday_lunch 는 "가장 늦은 '주일 점심'" 이라는 전역 상태에 의존한다. 로컬 DB 에 수동·E2E 로 남은
-- '주일 점심' 행이 있으면 날짜 계산이 어긋나므로, 이 트랜잭션 안에서 관련 장부와 식사를 먼저 비운다 (끝에 rollback 되므로 실제 데이터는 그대로다).
delete from public.usages where meal_id in (select id from public.meals where title = '주일 점심');
delete from public.issuances where meal_id in (select id from public.meals where title = '주일 점심');
delete from public.meals where title = '주일 점심';

select tests.create_user('issue-a@test.local') as a_uid \gset
select tests.create_user('issue-admin@test.local') as admin_uid \gset
select tests.create_user('issue-noperson@test.local') as ghost_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01055550001', :'a_uid', now(), '2026-10-07'),
       ('권사',   '01055550009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
insert into public.people (name, phone) values ('방문자', '01055550003');  -- 선발급 대상 (계정 없음)
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as v_pid from public.people where phone = '01055550003' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.meals (title, served_on, created_by) values ('주일 점심', '2026-10-11', :'admin_pid') returning id as meal_id \gset
-- 탈퇴(소프트 삭제)한 사람: person_not_found 로 거부되어야 한다
insert into public.people (name, phone, deleted_at) values ('탈퇴자', null, now()) returning id as deleted_pid \gset
-- 미성년 자녀: A 가족 소속, 보호자는 A. person_is_minor 로 거부되어야 한다
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'a_fid', true, :'a_pid', now()) returning id as minor_pid \gset

-- 비관리자 거부
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 4, 5000, null) $$, :'a_pid', :'meal_id'),
  'P0001', 'forbidden', '교인은 발급할 수 없다');
select throws_ok($$ select public.create_next_sunday_lunch('2026-10-08') $$, 'P0001', 'forbidden', '교인은 식사를 만들 수 없다');
-- 계정은 있지만 사람 행이 없는 호출자도 forbidden
select tests.authenticate_as(:'ghost_uid');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 4, 5000, null) $$, :'a_pid', :'meal_id'),
  'P0001', 'forbidden', '사람 행이 없는 계정은 발급할 수 없다');

-- 관리자: 검증 오류
select tests.authenticate_as(:'admin_uid');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 0, 5000, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_quantity', '0장은 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 100, 5000, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_quantity', '100장은 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, null, 5000, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_quantity', '수량이 null 이면 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, -1, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_price', '음수 단가는 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 1000001, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_price', '100만 원 초과 단가는 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, null, null) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_price', '단가가 null 이면 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, repeat('가', 101)) $$, :'a_pid', :'meal_id'), 'P0001', 'invalid_memo', '101자 메모는 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, null) $$, gen_random_uuid(), :'meal_id'), 'P0001', 'person_not_found', '없는 사람은 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, null) $$, :'deleted_pid', :'meal_id'), 'P0001', 'person_not_found', '탈퇴한 사람은 거부');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, null) $$, :'minor_pid', :'meal_id'), 'P0001', 'person_is_minor', '미성년 자녀 이름으로는 발급할 수 없다');
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, null) $$, :'a_pid', gen_random_uuid()), 'P0001', 'meal_not_found', '없는 식사는 거부');

-- 관리자: 성공. family 스냅샷·issued_by·메모 정리
select lives_ok(format($$ select public.issue_tickets(%L, %L, 4, 5000, '  입금 확인 ') $$, :'a_pid', :'meal_id'), '관리자는 발급할 수 있다');
select results_eq(
  format($$ select family_id, issued_by, quantity, unit_price, memo, cancelled_at from public.issuances where person_id = %L $$, :'a_pid'),
  format($$ values (%L::uuid, %L::uuid, 4, 5000, '입금 확인'::text, null::timestamptz) $$, :'a_fid', :'admin_pid'),
  '가족 스냅샷·발급자·장수·단가가 기록되고 메모 공백이 정리된다');
select lives_ok(format($$ select public.issue_tickets(%L, %L, 1, 0, '10/5 이월') $$, :'v_pid', :'meal_id'), '계정 없는 선발급 대상에게 0원 발급(이월)이 된다');
select is((select remaining from public.ticket_balances where family_id = :'a_fid' and meal_id = :'meal_id'), 4, '발급 직후 잔량은 장수와 같다');
select lives_ok(format($$ select public.issue_tickets(%L, %L, 2, 5000, '   ') $$, :'v_pid', :'meal_id'), '공백뿐인 메모로도 발급할 수 있다');
select is((select memo from public.issuances where person_id = :'v_pid' and quantity = 2 and unit_price = 5000), null, '공백뿐인 메모는 null 로 저장된다');

-- 다음 주일 점심: 2026-10-08(목) 기준, 주일 점심이 10/11(일) 에 있으므로 → 10/18
select is((select served_on from public.create_next_sunday_lunch('2026-10-08')), '2026-10-18'::date, '가장 늦은 주일 점심 다음 일요일을 만든다');
select is((select served_on from public.create_next_sunday_lunch('2026-10-08')), '2026-10-25'::date, '한 번 더 누르면 그 다음 일요일');
-- 오래 쉬어 가장 늦은 주일 점심이 과거면, 기준은 어제 → 오늘 이후 첫 일요일
select is((select served_on from public.create_next_sunday_lunch('2026-12-06')), '2026-12-06'::date, '오늘이 일요일이고 그 뒤 식사가 없으면 오늘을 만든다');
select is((select served_on from public.create_next_sunday_lunch('2026-12-07')), '2026-12-13'::date, '월요일이면 다가오는 일요일');

-- 날짜가 없으면 거부
select throws_ok($$ select public.create_next_sunday_lunch(null) $$, 'P0001', 'invalid_date', '날짜가 null 이면 거부');

-- 인자 없이 부르면(프론트가 실제로 호출하는 시그니처) 서울 "오늘" 기준으로 동작한다.
-- 테스트 실행 시각의 실제 날짜에 영향받지 않도록, 결과가 "기준일(가장 늦은 주일 점심과 서울 오늘-1 중 큰 값) 뒤
-- 1~7일 안의 일요일"이라는 규칙만 확인한다 (날짜 규칙은 위에서 이미 명시적 p_today 로 촘촘히 검증했다).
select (public.create_next_sunday_lunch()).served_on as default_served_on \gset
select ok(:'default_served_on'::date > greatest('2026-12-13'::date, (now() at time zone 'Asia/Seoul')::date - 1),
  '인자 없이 부르면 서울 오늘 기준으로 동작한다');
select is(extract(dow from :'default_served_on'::date)::int, 0, '만들어진 날은 일요일이다');
select ok(:'default_served_on'::date - greatest('2026-12-13'::date, (now() at time zone 'Asia/Seoul')::date - 1) between 1 and 7,
  '기준일 뒤 7일 안의 일요일이다');

select is((select count(*) from public.meals where title = '주일 점심'), 6::bigint, '주일 점심은 6개(수동 1 + 함수 5)뿐이다 (중복 없음)');  -- 시작 때 비웠으므로 전체를 센다
select is((select created_by from public.meals where served_on = '2026-10-18' and title = '주일 점심'), :'admin_pid'::uuid, '함수가 만든 식사에도 created_by 가 들어간다');  -- title 로도 좁힌다
select tests.clear_auth();

-- JWT 없이 authenticated 역할로 직접 호출
set local role authenticated;
select throws_ok(format($$ select public.issue_tickets(%L, %L, 1, 5000, null) $$, :'a_pid', :'meal_id'), 'P0001', 'not_authenticated', 'JWT 가 없으면 not_authenticated');
reset role;

select * from finish();
rollback;
