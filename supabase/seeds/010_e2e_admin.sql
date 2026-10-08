-- 로컬·CI 전용 관리자 계정. E2E(e2e/tickets.spec.ts)와 수동 확인에 쓴다.
--   이메일 e2e-admin@test.local / 비밀번호 password123 (개발 로그인 폼)
-- 운영 DB 에는 들어가지 않는다 (seeds 는 db reset/start 에서만 적용된다).
-- 이메일을 'admin@test.local' 이 아니라 'e2e-admin@test.local' 로 둔 이유:
--   supabase/tests/database/030_people_rls.sql 이 tests.create_user('admin@test.local') 로
--   같은 이메일의 임시 auth 사용자를 만든다. auth.users 는 email 에 부분 유니크 인덱스
--   (users_email_partial_key, WHERE is_sso_user = false) 를 걸어 두므로 이 시드가 먼저 그 이메일을
--   영구 사용자로 선점하면 해당 pgTAP 파일 전체(19건)가 23505 로 깨진다. 다른 pgTAP 파일들은
--   meal-admin@/issue-admin@ 처럼 접두어를 붙여 충돌을 피하고 있어, 이 시드도 같은 관례를 따른다.
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-000000000001';
  v_email text := 'e2e-admin@test.local';
begin
  if not exists (select 1 from auth.users where id = v_uid) then
    -- confirmation_token 등 토큰 열은 기본값이 NULL 인데, GoTrue 의 비밀번호 로그인 쿼리는 이를
    -- Go string 으로 그대로 Scan 해 NULL 이면 "converting NULL to string is unsupported" 로 500 을 낸다.
    -- 실제 가입(signUp)이 만드는 행처럼 빈 문자열로 채워 둔다.
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
      extensions.crypt('password123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now(),
      '', '', '', ''
    );
    -- GoTrue 는 이메일 로그인 때 identities 행도 본다
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, 'email',
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), now(), now(), now());
  end if;
  if not exists (select 1 from public.people where auth_user_id = v_uid) then
    insert into public.people (name, phone, auth_user_id, role, consented_at, consent_version)
    values ('권사', '01000000001', v_uid, 'admin', now(), '2026-10-07');
  end if;
end
$$;
