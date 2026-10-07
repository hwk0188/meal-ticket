begin;
select plan(3);

select ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tests' and p.proname in ('create_user','authenticate_as','clear_auth')) = 3,
  'tests 헬퍼 함수 3개가 존재한다'
);

-- authenticated 역할은 auth.users를 읽을 수 없다. 역할을 바꾸기 전에 기대값을 확보한다.
select tests.create_user('helper@test.local');
create temporary table expected_user as
  select id from auth.users where email = 'helper@test.local';
grant select on expected_user to authenticated;

select tests.authenticate_as((select id from expected_user));
select is(auth.uid(), (select id from expected_user), 'authenticate_as 후 auth.uid()가 그 사용자다');

select tests.clear_auth();
select is(auth.uid(), null, 'clear_auth 후 auth.uid()는 null');

select * from finish();
rollback;
