begin;
select plan(37);

select is(has_function_privilege('anon', 'public.leave_family()', 'EXECUTE'), false, 'anon 은 leave_family 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.remove_child(uuid)', 'EXECUTE'), false, 'anon 은 remove_child 를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE'), false, 'anon 은 delete_my_account 를 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.lock_family(uuid)', 'EXECUTE'), false, 'lock_family 는 API 역할에 열려 있지 않다 (함수 안에서만)');

-- 준비: 가족 A = 김철수(a) + 이영희(b) + 서연(a 의 자녀, 익명) + 민준(b 의 자녀, 익명). 관리자. 가족 A 에 발급 2장.
select tests.create_user('leave-a@test.local') as a_uid \gset
select tests.create_user('leave-b@test.local') as b_uid \gset
select tests.create_user('leave-admin@test.local') as admin_uid \gset
select tests.create_user('leave-ghost@test.local') as ghost_uid \gset
select tests.create_user() as s_uid \gset
select tests.create_user() as m_uid \gset
insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01099990001', :'a_uid', now(), '2026-10-07'),
       ('권사',   '01099990009', :'admin_uid', now(), '2026-10-07');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
select id as a_pid, family_id as a_fid from public.people where auth_user_id = :'a_uid' \gset
select id as admin_pid from public.people where auth_user_id = :'admin_uid' \gset
insert into public.people (name, phone, family_id, auth_user_id, consented_at, consent_version)
values ('이영희', '01099990002', :'a_fid', :'b_uid', now(), '2026-10-07');
select id as b_pid from public.people where auth_user_id = :'b_uid' \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', :'a_fid', :'s_uid', true, :'a_pid', now()),
       ('민준', :'a_fid', :'m_uid', true, :'b_pid', now());
select id as s_pid from public.people where auth_user_id = :'s_uid' \gset
select id as m_pid from public.people where auth_user_id = :'m_uid' \gset
-- a 의 자녀지만 다른 가족에 사는 아이 (4단계 merge_people 같은 흐름이 만들 수 있는 모양) — 나가기는 내 가족 범위만 옮겨야 한다
insert into public.families default values returning id as far_fid \gset
insert into public.people (name, family_id, is_minor, guardian_id, guardian_consented_at)
values ('먼아이', :'far_fid', true, :'a_pid', now()) returning id as far_pid \gset
insert into public.meals (title, served_on, created_by) values ('테스트 점심 120', '2026-10-25', :'admin_pid') returning id as meal_id \gset
insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, issued_by)
values (:'a_pid', :'a_fid', :'meal_id', 2, 5000, :'admin_pid') returning id as issuance \gset

-- ---------- leave_family ----------
select tests.authenticate_as(:'s_uid');
select throws_ok($$ select public.leave_family() $$, 'P0001', 'not_adult', '자녀 계정은 가족을 나갈 수 없다');
select tests.authenticate_as(:'ghost_uid');
select throws_ok($$ select public.leave_family() $$, 'P0001', 'not_registered', '가입 전 계정은 가족을 나갈 수 없다');

select tests.authenticate_as(:'a_uid');
select (select family_id from public.leave_family()) as new_fid \gset
select tests.clear_auth();
select isnt(:'new_fid'::uuid, :'a_fid'::uuid, '가족 나가기: 새 가족 id 를 받는다');
select is((select count(*) from public.families where id = :'new_fid'), 1::bigint, '새 가족 행이 실제로 있다');
select set_eq(
  format($$ select name from public.people where family_id = %L and deleted_at is null $$, :'new_fid'),
  $$ values ('김철수'::text), ('서연') $$,
  '나와 내 자녀만 새 가족으로 옮겨진다');
select set_eq(
  format($$ select name from public.people where family_id = %L and deleted_at is null $$, :'a_fid'),
  $$ values ('이영희'::text), ('민준') $$,
  '다른 어른과 그 자녀는 옛 가족에 남는다');
select is((select family_id from public.issuances where id = :'issuance'), :'a_fid'::uuid, '장부는 옛 가족에 남는다 (함께 쓰던 풀의 것)');
select is((select count(*) from public.ticket_balances where family_id = :'new_fid'), 0::bigint, '새 가족에는 잔량이 없다');
select is((select family_id from public.people where id = :'far_pid'), :'far_fid'::uuid, '보호자가 나여도 다른 가족에 사는 자녀는 옮기지 않는다 (옛 가족 범위로만)');

-- 나와 내 자녀뿐이면 아무것도 바뀌지 않는다
select count(*) as families_before from public.families \gset
select tests.authenticate_as(:'a_uid');
select is((select family_id from public.leave_family()), :'new_fid'::uuid, '혼자(자녀만 있는) 가족에서 나가기는 아무것도 바꾸지 않는다');
select tests.clear_auth();
select is((select count(*) from public.families), :'families_before'::bigint, '두 번째 호출은 가족 행을 더 만들지 않는다');

-- ---------- remove_child ----------
-- 민준 계정의 연결 코드가 남아 있어도 함께 지워진다 (사람 행이 있어 함수로는 못 만드니 직접 심는다)
insert into public.pairing_codes (code, auth_user_id, kind, expires_at) values ('00000222', :'m_uid', 'child', now() + interval '10 minutes');
select tests.authenticate_as(:'a_uid');
select throws_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), 'P0001', 'child_not_found', '남의 자녀는 삭제할 수 없다 (보호자만)');
select throws_ok(format($$ select public.remove_child(%L) $$, :'b_pid'), 'P0001', 'child_not_found', '어른은 자녀 삭제 대상이 아니다');
select tests.authenticate_as(:'s_uid');
select throws_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), 'P0001', 'not_adult', '자녀 계정은 자녀를 삭제할 수 없다');
select tests.authenticate_as(:'b_uid');
select lives_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), '보호자가 자녀를 삭제한다');
select tests.clear_auth();
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null, guardian_id from public.people where id = %L $$, :'m_pid'),
  format($$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true, %L::uuid) $$, :'b_pid'),
  '자녀는 익명화된다 (이름 치환, 번호·계정 NULL, deleted_at). 보호자 동의 기록은 남는다');
select is((select count(*) from public.pairing_codes where code = '00000222'), 0::bigint, '자녀 계정의 연결 코드도 지워진다');
select tests.authenticate_as(:'b_uid');
select throws_ok(format($$ select public.remove_child(%L) $$, :'m_pid'), 'P0001', 'child_not_found', '이미 삭제된 자녀는 다시 찾을 수 없다');
select tests.authenticate_as(:'m_uid');
select is((select public.current_person_id()), null, '삭제된 자녀의 계정은 사람 행이 없다 (다음 접속 때 시작 화면)');
select tests.clear_auth();

-- ---------- delete_my_account ----------
select tests.authenticate_as(:'s_uid');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'not_adult', '자녀 계정은 스스로 탈퇴할 수 없다 (보호자가 삭제)');
select tests.authenticate_as(:'ghost_uid');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'not_registered', '가입 전 계정은 탈퇴할 것이 없다');
select tests.authenticate_as(:'a_uid');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'has_children', '자녀가 있으면 먼저 자녀를 삭제해야 한다');
select lives_ok(format($$ select public.remove_child(%L) $$, :'s_pid'), '자녀를 삭제한다');
select lives_ok(format($$ select public.remove_child(%L) $$, :'far_pid'), '다른 가족에 사는 자녀도 보호자가 삭제할 수 있다 (탈퇴 전에 모두 정리)');
select lives_ok($$ select public.delete_my_account() $$, '자녀가 없으면 탈퇴할 수 있다');
select tests.clear_auth();
select results_eq(
  format($$ select name, phone, auth_user_id, deleted_at is not null, consented_at is not null, consent_version from public.people where id = %L $$, :'a_pid'),
  $$ values ('탈퇴한 사용자'::text, null::text, null::uuid, true, true, '2026-10-07'::text) $$,
  '본인은 익명화되고 동의 기록은 증빙으로 남는다');
select is((select family_id from public.issuances where id = :'issuance'), :'a_fid'::uuid, '장부는 익명 상태로 보존된다');
-- 같은 카카오 계정으로 다시 가입할 수 있고, 예전 번호도 다시 쓸 수 있다
select tests.authenticate_as(:'a_uid');
select is((select public.current_person_id()), null, '탈퇴한 계정은 사람 행이 없다 (가입 화면부터 다시)');
select lives_ok($$ select public.claim_person('김철수', '01099990001', '2026-10-07') $$, '탈퇴 뒤 같은 계정·같은 번호로 다시 가입할 수 있다');
select tests.clear_auth();
select is((select count(*) from public.people where phone = '01099990001' and deleted_at is null), 1::bigint, '다시 가입한 행은 새 행이다 (익명화된 옛 행은 그대로)');

-- JWT 없이 직접 호출
set local role authenticated;
select throws_ok($$ select public.leave_family() $$, 'P0001', 'not_authenticated', 'leave_family: JWT 가 없으면 not_authenticated');
select throws_ok(format($$ select public.remove_child(%L) $$, :'s_pid'), 'P0001', 'not_authenticated', 'remove_child: JWT 가 없으면 not_authenticated');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'not_authenticated', 'delete_my_account: JWT 가 없으면 not_authenticated');
reset role;

select * from finish();
rollback;
