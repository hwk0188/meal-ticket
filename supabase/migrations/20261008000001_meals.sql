-- =========================================================
-- 1단계 이월: invoker 헬퍼의 search_path 고정.
-- 호출하는 것은 pg_catalog 함수(regexp_replace, normalize…)뿐이라 빈 search_path 로 충분하다.
-- 보안 영향은 없지만(invoker 권한) Supabase 어드바이저 경고를 없앤다.
-- =========================================================
alter function public.normalize_phone(text) set search_path = '';
alter function public.is_valid_mobile(text) set search_path = '';
alter function public.normalize_name(text) set search_path = '';

-- =========================================================
-- 식사 — "10월 12일 주일 점심" 처럼 날짜와 이름을 가진 한 끼. 관리자만 만든다.
-- =========================================================
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 30),
  served_on date not null,
  note text check (note is null or char_length(note) <= 100),
  -- 만든 관리자. 기본값이 호출자의 사람 행이라 프론트는 이 열을 넣지 않는다 (insert 열 권한에도 없다).
  created_by uuid references public.people(id) default public.current_person_id(),
  created_at timestamptz not null default now(),
  constraint meals_served_on_title_key unique (served_on, title)
);
create index meals_served_on_idx on public.meals (served_on desc);

-- 제목은 앞뒤 공백 제거 + NFC (people.name 과 같은 규칙). 공백뿐인 비고는 null.
create or replace function public.meals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := normalize(btrim(coalesce(new.title, '')), NFC);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  return new;
end
$$;
create trigger meals_before_write
  before insert or update on public.meals
  for each row execute function public.meals_before_write();
-- 트리거 함수는 RPC 로 노출할 이유가 없다 (auto_expose_new_tables 대응으로 명시 revoke)
revoke execute on function public.meals_before_write() from public, anon, authenticated;

-- 기본 차단 후 필요한 권한만. 삭제는 발급(issuances.meal_id FK, 다음 마이그레이션)이 있으면 23503 으로 막힌다.
alter table public.meals enable row level security;
revoke all on public.meals from anon, authenticated;
grant select on public.meals to authenticated;
grant insert (title, served_on, note), update (title, served_on, note), delete on public.meals to authenticated;

create policy meals_select_all on public.meals
  for select to authenticated using (true);
create policy meals_insert_admin on public.meals
  for insert to authenticated with check ((select public.is_admin()));
create policy meals_update_admin on public.meals
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy meals_delete_admin on public.meals
  for delete to authenticated using ((select public.is_admin()));
