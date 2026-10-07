begin;
select plan(5);

select has_function('tests', 'create_user',     array['text'], 'tests.create_user(text)가 있다');
select has_function('tests', 'authenticate_as', array['uuid'], 'tests.authenticate_as(uuid)가 있다');
select has_function('tests', 'clear_auth',      'tests.clear_auth()가 있다');

select tests.create_user('helper@test.local') as uid \gset

select tests.authenticate_as(:'uid');
select is(auth.uid(), :'uid'::uuid, 'authenticate_as 후 auth.uid()가 그 사용자다');

select tests.clear_auth();
select is(auth.uid(), null, 'clear_auth 후 auth.uid()는 null');

select * from finish();
rollback;
