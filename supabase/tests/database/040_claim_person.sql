begin;
select plan(13);

-- 권한 구조 고정: 새 함수에 anon 이 자동으로 붙지 않았는지 확인한다 (auto_expose_new_tables=true 대응)
select is(has_function_privilege('anon', 'public.claim_person(text,text,text)', 'EXECUTE'), false, 'anon은 claim_person 을 실행할 수 없다');

select tests.create_user('new@test.local') as new_uid \gset
select tests.create_user('pre@test.local') as pre_uid \gset
select tests.create_user('dup@test.local') as dup_uid \gset
select tests.create_user() as anon_uid \gset

-- 선발급자(관리자가 미리 만든 사람)
insert into public.people (name, phone) values ('이순자', '01022220001');

-- 1) 새 사용자 가입
select tests.authenticate_as(:'new_uid');
select lives_ok(
  $$ select public.claim_person('김철수', '010-2222-0002', '2026-10-07') $$,
  '새 사용자는 가입할 수 있다'
);
select tests.clear_auth();
select is((select phone from public.people where auth_user_id = :'new_uid'), '01022220002', '번호가 정규화되어 저장된다');
select isnt((select consented_at from public.people where auth_user_id = :'new_uid'), null, '동의 시각이 기록된다');
select is((select consent_version from public.people where auth_user_id = :'new_uid'), '2026-10-07', '동의 버전이 기록된다');
select isnt((select family_id from public.people where auth_user_id = :'new_uid'), null, '1인 가족이 생긴다');

-- 2) 같은 계정이 또 가입 → already_registered
select tests.authenticate_as(:'new_uid');
select throws_ok(
  $$ select public.claim_person('김철수', '010-2222-0002', '2026-10-07') $$,
  'P0001', 'already_registered', '이미 가입한 계정은 다시 가입할 수 없다'
);
select tests.clear_auth();

-- 3) 선발급자가 같은 번호·같은 이름으로 가입 → 기존 사람에 연결
select tests.authenticate_as(:'pre_uid');
select lives_ok(
  $$ select public.claim_person('이순자', '01022220001', '2026-10-07') $$,
  '선발급된 번호·이름으로 가입하면 성공한다'
);
select tests.clear_auth();
select is(
  (select auth_user_id from public.people where phone = '01022220001'), :'pre_uid'::uuid,
  '기존 사람 행에 계정이 연결된다 (새 사람이 생기지 않음)'
);

-- 4) 이미 연결된 번호로 다른 계정이 가입 → phone_taken. 이름이 다른 선발급 번호도 phone_taken (가로채기 방지)
insert into public.people (name, phone) values ('박영수', '01022220005');
select tests.authenticate_as(:'dup_uid');
select throws_ok(
  $$ select public.claim_person('가짜이름', '01022220005', '2026-10-07') $$,
  'P0001', 'phone_taken', '선발급 번호라도 이름이 다르면 연결하지 않는다'
);
select throws_ok(
  $$ select public.claim_person('가짜', '01022220001', '2026-10-07') $$,
  'P0001', 'phone_taken', '남이 쓰는 번호로는 가입할 수 없다'
);
select throws_ok(
  $$ select public.claim_person('가짜', '02-123-4567', '2026-10-07') $$,
  'P0001', 'invalid_phone', '휴대폰 형식이 아니면 거부한다'
);
select tests.clear_auth();

-- 5) 익명 계정 → anonymous_cannot_claim
select tests.authenticate_as(:'anon_uid');
select throws_ok(
  $$ select public.claim_person('아이', '01022220009', '2026-10-07') $$,
  'P0001', 'anonymous_cannot_claim', '익명 계정은 어른 가입을 할 수 없다'
);
select tests.clear_auth();

select * from finish();
rollback;
