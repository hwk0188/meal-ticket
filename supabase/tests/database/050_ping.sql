begin;
select plan(2);

set local role anon;
select is(public.ping(), 1, 'anon도 ping을 호출할 수 있다 (keep-alive용)');
reset role;

select is(
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'ping' and grantee = 'anon'),
  1::bigint, 'ping 실행 권한이 anon에게 있다'
);

select * from finish();
rollback;
