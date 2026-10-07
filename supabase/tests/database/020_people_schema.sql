begin;
select plan(11);

select has_table('public', 'families', 'families 테이블이 있다');
select has_table('public', 'people', 'people 테이블이 있다');

-- 1인 가족 자동 생성
insert into public.people (name, phone) values ('김철수', '010-1234-5678');
select isnt(
  (select family_id from public.people where name = '김철수'), null,
  '사람을 만들면 family_id가 자동으로 채워진다'
);
select is(
  (select count(*) from public.families where id = (select family_id from public.people where name = '김철수')),
  1::bigint, '그 가족 행이 실제로 존재한다'
);

-- 전화번호 정규화
select is(
  (select phone from public.people where name = '김철수'), '01012345678',
  '전화번호는 숫자만 남겨 저장한다'
);
select is(public.normalize_phone('+82 10-9876-5432'), '01098765432', '+82 국제 표기는 010 으로 바꾼다');
select is(public.normalize_phone(''), null, '빈 문자열은 null');

-- 잘못된 번호 거부 (check 위반 23514)
select throws_ok(
  $$ insert into public.people (name, phone) values ('홍길동', '02-123-4567') $$,
  '23514', null, '휴대폰 형식이 아니면 거부한다'
);

-- 번호 중복 거부, 단 탈퇴한 사람의 번호는 재사용 가능
select throws_ok(
  $$ insert into public.people (name, phone) values ('김철수2', '01012345678') $$,
  '23505', null, '같은 번호를 두 번 등록할 수 없다'
);
update public.people set deleted_at = now() where name = '김철수';
select lives_ok(
  $$ insert into public.people (name, phone) values ('김철수3', '01012345678') $$,
  '탈퇴한 사람의 번호는 다시 쓸 수 있다'
);

-- 미성년자는 보호자·보호자 동의 필수
select throws_ok(
  $$ insert into public.people (name, is_minor) values ('김민준', true) $$,
  '23514', null, '보호자 없는 미성년자는 거부한다'
);

select * from finish();
rollback;
