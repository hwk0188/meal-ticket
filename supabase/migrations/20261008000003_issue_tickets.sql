-- =========================================================
-- 발급: 관리자가 입금 확인 후 사람에게 식권을 준다. family_id 는 그 사람의 "현재" 가족을 스냅샷으로 남긴다.
-- issue_tickets 코드: not_authenticated | forbidden | invalid_quantity | invalid_price | invalid_memo
--                     | person_not_found | person_is_minor | meal_not_found
-- =========================================================
create or replace function public.issue_tickets(
  p_person_id uuid,
  p_meal_id uuid,
  p_quantity integer,
  p_unit_price integer,
  p_memo text default null
)
returns public.issuances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_family uuid;
  v_is_minor boolean;
  v_memo text := nullif(btrim(coalesce(p_memo, '')), '');
  v_row public.issuances;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- 사람 행이 없는 계정(가입 전)도 forbidden 으로 본다. 관리자 여부는 is_admin() 이 deleted_at 까지 본다.
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity';
  end if;
  if p_unit_price is null or p_unit_price < 0 or p_unit_price > 1000000 then
    raise exception 'invalid_price';
  end if;
  if v_memo is not null and char_length(v_memo) > 100 then
    raise exception 'invalid_memo';
  end if;

  -- 식권은 어른(구매자) 이름으로 기록하고 잔량은 가족이 공유하므로 자녀 이름으로는 발급하지 않는다.
  select family_id, is_minor into v_family, v_is_minor from public.people where id = p_person_id and deleted_at is null;
  if not found then
    raise exception 'person_not_found';
  end if;
  if v_is_minor then
    raise exception 'person_is_minor';
  end if;
  if not exists (select 1 from public.meals where id = p_meal_id) then
    raise exception 'meal_not_found';
  end if;

  insert into public.issuances (person_id, family_id, meal_id, quantity, unit_price, memo, issued_by)
  values (p_person_id, v_family, p_meal_id, p_quantity, p_unit_price, v_memo, v_admin)
  returning * into v_row;
  return v_row;
end
$$;

comment on function public.issue_tickets(uuid, uuid, integer, integer, text) is '관리자 발급. 오류 코드는 파일 헤더 참고.';
revoke execute on function public.issue_tickets(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.issue_tickets(uuid, uuid, integer, integer, text) to authenticated;

-- =========================================================
-- 다음 주일 점심 만들기. 기준일 = max(가장 늦은 '주일 점심' 날짜, 어제). 기준일 다음의 첫 일요일에 만든다.
--   · 보통: 10/11(일) 이 있으면 10/18. 오래 쉬어 가장 늦은 식사가 과거면 오늘 이후 첫 일요일(오늘이 일요일이면 오늘).
--   · 같은 날짜가 이미 있으면(동시 클릭이 겹친 경우) on conflict 로 수렴해 그 행을 돌려준다. 순차 재호출은
--     "다음" 일요일을 만든다 — 프론트는 이 RPC 를 자동 재시도하지 않는다.
-- p_today 는 테스트와 날짜 미리보기용. 기본값은 서울 오늘. 관리자 전용이라 임의 날짜를 넣어도 해가 없다.
-- 코드: not_authenticated | forbidden | invalid_date
-- =========================================================
create or replace function public.create_next_sunday_lunch(
  p_today date default (now() at time zone 'Asia/Seoul')::date
)
returns public.meals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_base date;
  v_target date;
  v_row public.meals;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_today is null then
    raise exception 'invalid_date';
  end if;

  select greatest(coalesce(max(served_on), p_today - 1), p_today - 1)
    into v_base
    from public.meals
   where title = '주일 점심';
  -- dow: 일=0 … 토=6. 기준일 "다음" 일요일까지 날수: 일→7, 월→6, …, 토→1
  v_target := v_base + ((6 - extract(dow from v_base)::integer) % 7 + 1);

  -- meals 의 BEFORE 트리거는 정규화만 하므로(people 과 달리 부수 행을 만들지 않음) on conflict 가 안전하다
  insert into public.meals (title, served_on, created_by)
  values ('주일 점심', v_target, v_admin)
  on conflict (served_on, title) do nothing;

  select * into v_row from public.meals where served_on = v_target and title = '주일 점심';
  return v_row;
end
$$;

comment on function public.create_next_sunday_lunch(date) is '다음 주일 점심 생성. 동시 클릭만 수렴하고 순차 재호출은 다음 일요일을 만든다 (자동 재시도 금지). 프론트 lib/dates.ts 의 nextSundayAfter 와 같은 규칙.';
revoke execute on function public.create_next_sunday_lunch(date) from public, anon;
grant execute on function public.create_next_sunday_lunch(date) to authenticated;
