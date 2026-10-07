-- keep-alive 용. 무료 플랜의 7일 미사용 일시정지를 막기 위해 GitHub Actions가 3일마다 호출한다.
-- 데이터에 접근하지 않는 상수 함수라 anon 노출이 안전하다 (public 함수 중 유일한 anon 예외).
create or replace function public.ping()
returns integer
language sql
stable
as $$ select 1 $$;

comment on function public.ping() is 'keep-alive 핑. 상수 1 만 돌려주며 데이터에 접근하지 않는다.';

-- auto_expose_new_tables=true 가 붙여 주는 anon=X 에 의존하지 않고, 권한을 여기서 명시적으로 고정한다.
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
