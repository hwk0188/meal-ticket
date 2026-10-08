-- =========================================================
-- 주기 작업 (설계 §7.5). pg_cron 은 Supabase Free 에서도 쓸 수 있다 (비용 없음). 로컬 CLI 에도 들어 있다.
-- 작업 본문은 함수로 두어 pgTAP 이 직접 호출해 검증한다. cron 은 그 함수를 부르기만 한다.
-- =========================================================
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 만료·사용된 연결 코드 삭제 (매시간)
create or replace function public.cleanup_pairing_codes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.pairing_codes where used_at is not null or expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- 만든 지 24시간이 지났고 사람 행에 연결되지 않았으며 살아 있는 연결 코드도 없는 익명 계정 삭제 (매일).
-- 그 계정의 연결 코드(만료·사용된 것)는 FK cascade 로 함께 지워진다.
-- 살아 있는 코드를 띄워 둔 폰은 남긴다 — 하루 전에 "아이 계정으로 시작" 해 둔 폰이 지금 보호자 앞에서 코드를 보여 주는 중일 수 있다
-- (지우면 코드가 사라지고 그 폰이 로그아웃된다). 카카오 계정은 지우지 않는다 (가입 전 계정도 다음 로그인 때 가입 화면으로 이어진다).
create or replace function public.cleanup_orphan_anonymous_users()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '24 hours'
     and not exists (select 1 from public.people p where p.auth_user_id = u.id)
     and not exists (select 1 from public.pairing_codes pc
                      where pc.auth_user_id = u.id and pc.used_at is null and pc.expires_at > now());
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- 구성원 행도 장부도 없는 가족 삭제 (매일). 만든 지 1시간 안 된 가족은 건드리지 않는다.
-- 장부가 있는 가족은 지우지 않는다 (2단계 계획 인계 결정 — 장부 FK 가 어차피 막지만 조건으로도 명시한다).
create or replace function public.cleanup_empty_families()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.families f
   where f.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.people p where p.family_id = f.id)
     and not exists (select 1 from public.issuances i where i.family_id = f.id)
     and not exists (select 1 from public.usages u where u.family_id = f.id);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.cleanup_pairing_codes(), public.cleanup_orphan_anonymous_users(), public.cleanup_empty_families()
  from public, anon, authenticated;

-- 같은 이름으로 다시 schedule 하면 갱신된다 (db reset 반복에 안전). pg_cron 은 UTC — 18:15 UTC = 03:15 KST.
select cron.schedule('cleanup_pairing_codes', '0 * * * *', $$select public.cleanup_pairing_codes()$$);
select cron.schedule('cleanup_orphan_anonymous_users', '15 18 * * *', $$select public.cleanup_orphan_anonymous_users()$$);
select cron.schedule('cleanup_empty_families', '30 18 * * *', $$select public.cleanup_empty_families()$$);
