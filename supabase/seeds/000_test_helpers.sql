-- 테스트 전용 헬퍼. 로컬 db reset 때만 적용된다.
create schema if not exists tests;

-- 가짜 auth 사용자 생성. 이메일이 null이면 익명 사용자.
create or replace function tests.create_user(p_email text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, case when p_email is null then null else now() end,
    case when p_email is null then '{"provider":"anonymous","providers":["anonymous"]}'::jsonb
         else '{"provider":"email","providers":["email"]}'::jsonb end,
    '{}'::jsonb, p_email is null, now(), now()
  );
  return v_id;
end
$$;

-- 이후 문장을 해당 사용자로 실행 (auth.uid() = p_user)
create or replace function tests.authenticate_as(p_user uuid)
returns void
language plpgsql
as $$
declare
  v_anon boolean;
begin
  select is_anonymous into v_anon from auth.users where id = p_user;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', coalesce(v_anon, false))::text,
    true);
  execute 'set local role authenticated';
end
$$;

-- 다시 슈퍼유저(postgres)로
create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- 역할을 바꾼 뒤에도 헬퍼(특히 clear_auth)를 호출할 수 있어야 한다.
-- 함수 EXECUTE는 기본적으로 PUBLIC에 열려 있지만, 스키마 USAGE는 따로 필요하다.
grant usage on schema tests to authenticated, anon, service_role;
