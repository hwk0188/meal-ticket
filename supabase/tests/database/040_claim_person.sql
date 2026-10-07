begin;
select plan(29);

-- 권한 구조 고정: 새 함수에 anon 이 자동으로 붙지 않았는지 확인한다 (auto_expose_new_tables=true 대응)
select is(has_function_privilege('anon', 'public.claim_person(text,text,text)', 'EXECUTE'), false, 'anon은 claim_person 을 실행할 수 없다');

select tests.create_user('new@test.local') as new_uid \gset
select tests.create_user('pre@test.local') as pre_uid \gset
select tests.create_user('dup@test.local') as dup_uid \gset
select tests.create_user() as anon_uid \gset
select tests.create_user('space@test.local') as space_uid \gset
select tests.create_user('nfd@test.local') as nfd_uid \gset

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

-- 3) 선발급자가 같은 번호·같은 이름으로 가입 → 기존 사람에 연결 (새 사람·새 가족이 생기지 않아야 한다)
select count(*) as people_before from public.people \gset
select count(*) as families_before from public.families \gset
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
select is((select count(*) from public.people), :'people_before'::bigint, '선발급 연결은 사람 수를 늘리지 않는다');
select is((select count(*) from public.families), :'families_before'::bigint, '선발급 연결은 가족 수를 늘리지 않는다');
select isnt((select consented_at from public.people where phone = '01022220001'), null, '선발급 연결에도 동의 시각이 기록된다');
select is((select consent_version from public.people where phone = '01022220001'), '2026-10-07', '선발급 연결에도 동의 버전이 기록된다');

-- 같은 사용자가 순차로 다시 호출하면 잠금 전 검사가 먼저 걸린다.
-- 멱등 분기(auth_user_id = v_uid → 그 행을 그대로 돌려준다)는 동시 요청에서만 닿으므로 pgTAP 로는 재현하지 않는다.
select tests.authenticate_as(:'pre_uid');
select throws_ok(
  $$ select public.claim_person('이순자', '01022220001', '2026-10-07') $$,
  'P0001', 'already_registered', '연결을 마친 계정의 순차 재시도는 already_registered (멱등 분기는 동시 요청 전용)'
);
select tests.clear_auth();

-- 4) 이미 연결된 번호로 다른 계정이 가입 → phone_taken. 이름이 다른 선발급 번호도 phone_taken (가로채기 방지)
insert into public.people (name, phone) values ('박영수', '01022220005');
-- 미성년자 행은 이름까지 맞아도 연결 대상이 아니다 (보호자·관리자가 관리한다)
insert into public.people (name, phone, is_minor, guardian_id, guardian_consented_at)
values ('아이', '01022220007', true, (select id from public.people where phone = '01022220001'), now());
select tests.authenticate_as(:'dup_uid');
select throws_ok(
  $$ select public.claim_person('가짜이름', '01022220005', '2026-10-07') $$,
  'P0001', 'phone_taken', '선발급 번호라도 이름이 다르면 연결하지 않는다'
);
select throws_ok(
  $$ select public.claim_person('가짜', '01022220001', '2026-10-07') $$,
  'P0001', 'phone_taken', '남이 쓰는 번호로는 가입할 수 없다'
);
-- 멱등 분기가 auth_user_id 로만 열리는지 고정한다: 이름까지 정확해도 남의 계정 행은 못 가져간다
select throws_ok(
  $$ select public.claim_person('이순자', '01022220001', '2026-10-07') $$,
  'P0001', 'phone_taken', '이름을 정확히 맞혀도 이미 연결된 남의 행은 가져갈 수 없다'
);
select throws_ok(
  $$ select public.claim_person('아이', '01022220007', '2026-10-07') $$,
  'P0001', 'phone_taken', '미성년자 행은 이름이 맞아도 연결하지 않는다'
);
select throws_ok(
  $$ select public.claim_person('가짜', '02-123-4567', '2026-10-07') $$,
  'P0001', 'invalid_phone', '휴대폰 형식이 아니면 거부한다'
);
select throws_ok(
  $$ select public.claim_person('', '01022220008', '2026-10-07') $$,
  'P0001', 'invalid_name', '이름이 비어 있으면 거부한다'
);
select throws_ok(
  $$ select public.claim_person(repeat('가', 21), '01022220008', '2026-10-07') $$,
  'P0001', 'invalid_name', '이름이 20자를 넘으면 거부한다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220008', '') $$,
  'P0001', 'consent_required', '동의 버전이 없으면 거부한다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220008', '   ') $$,
  'P0001', 'consent_required', '공백뿐인 동의 버전도 거부한다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220008', 'v1') $$,
  'P0001', 'consent_required', '날짜(YYYY-MM-DD) 형식이 아닌 동의 버전은 거부한다'
);
select tests.clear_auth();

-- 5) 이름 비교는 공백과 유니코드 합성 방식을 무시한다 (표시용 이름은 선발급 행 그대로 둔다)
insert into public.people (name, phone) values ('김 철수', '01022220011');
insert into public.people (name, phone) values ('박순희', '01022220012');
select tests.authenticate_as(:'space_uid');
select is(
  (select (public.claim_person('김철수', '01022220011', '2026-10-07')).name), '김 철수',
  '공백만 다른 이름으로 연결되고, 선발급 행의 표시용 이름은 그대로 남는다'
);
select tests.clear_auth();
-- iOS/macOS 가 보내는 NFD(자모 분해) 입력이 NFC 로 저장된 선발급 행과 맞아야 한다
select tests.authenticate_as(:'nfd_uid');
select lives_ok(
  $$ select public.claim_person(normalize('박순희', NFD), '01022220012', '2026-10-07') $$,
  'NFD 로 분해된 이름도 NFC 선발급 행에 연결된다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220013', '   ') $$,
  'P0001', 'already_registered', '가입을 마친 계정은 형식 검사보다 already_registered 가 먼저 나온다'
);
select tests.clear_auth();

-- 6) 익명 계정 → anonymous_cannot_claim
select tests.authenticate_as(:'anon_uid');
select throws_ok(
  $$ select public.claim_person('아이', '01022220009', '2026-10-07') $$,
  'P0001', 'anonymous_cannot_claim', '익명 계정은 어른 가입을 할 수 없다'
);
select tests.clear_auth();

-- 7) JWT 없이 authenticated 역할로 직접 호출. PostgREST 로는 42501 에서 먼저 막히지만 함수 가드도 고정한다.
select tests.clear_auth();
set local role authenticated;
select throws_ok(
  $$ select public.claim_person('김철수', '01022220010', '2026-10-07') $$,
  'P0001', 'not_authenticated', 'JWT 가 없으면 not_authenticated'
);
reset role;

select * from finish();
rollback;
