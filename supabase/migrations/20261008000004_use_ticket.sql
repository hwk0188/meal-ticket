-- =========================================================
-- 사용: 가족 구성원(자녀 포함)이 자기 폰에서 식권 1장을 쓴다. 담당자가 교인 폰을 꾹 누르면 호출된다.
--   · 멱등: 같은 request_id 는 처음 결과를 그대로 돌려준다 (느린 네트워크 재시도 → 이중 차감 없음).
--   · 당일만: served_on 이 서울 기준 오늘이 아니면 not_today. 서버가 판정하므로 폰 시계는 믿지 않는다.
--   · 직렬화: 가족·식사 단위 advisory lock. 같은 가족의 두 폰이 동시에 눌러도 잔량 계산이 겹치지 않는다.
-- 코드: not_authenticated | not_registered | invalid_request | meal_not_found | not_today | no_remaining | duplicate_request
-- =========================================================
create or replace function public.use_ticket(p_meal_id uuid, p_request_id uuid)
returns public.usages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_person public.people;
  v_meal public.meals;
  v_row public.usages;
  v_remaining integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_person from public.people where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_registered';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request';
  end if;

  -- 잠금을 멱등 조회보다 먼저 건다: 같은 request_id 의 동시 재시도가, 먼저 들어간 요청이 커밋한 행을 보게 된다.
  -- 두 int4 키: 가족·식사 해시. 트랜잭션이 끝나면 자동 해제된다.
  perform pg_advisory_xact_lock(hashtext(v_person.family_id::text), hashtext(p_meal_id::text));

  -- 멱등 분기. 남의 request_id 로 남의 결과를 받아 가지는 못하게 person 까지 맞춘다.
  -- 다른 식사로 재사용된 request_id(클라이언트 버그)도 같은 코드로 거부한다.
  select * into v_row from public.usages where request_id = p_request_id;
  if found then
    if v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
      raise exception 'duplicate_request';
    end if;
    return v_row;
  end if;

  select * into v_meal from public.meals where id = p_meal_id;
  if not found then
    raise exception 'meal_not_found';
  end if;
  if v_meal.served_on <> (now() at time zone 'Asia/Seoul')::date then
    raise exception 'not_today';
  end if;

  select coalesce(sum(i.quantity), 0)
         - (select coalesce(sum(u.quantity), 0) from public.usages u
             where u.family_id = v_person.family_id and u.meal_id = p_meal_id and u.voided_at is null)
    into v_remaining
    from public.issuances i
   where i.family_id = v_person.family_id and i.meal_id = p_meal_id and i.cancelled_at is null;
  if v_remaining < 1 then
    raise exception 'no_remaining';
  end if;

  begin
    insert into public.usages (family_id, person_id, meal_id, quantity, used_via, recorded_by, request_id)
    values (v_person.family_id, v_person.id, p_meal_id, 1, 'self', v_person.id, p_request_id)
    returning * into v_row;
  exception when unique_violation then
    -- 가족·식사 잠금이 같은 식사의 재시도는 직렬화하므로, 여기 닿는 것은 다른 사람·다른 식사에서 온 같은 request_id 뿐이다.
    select * into v_row from public.usages where request_id = p_request_id;
    if not found or v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
      raise exception 'duplicate_request';
    end if;
  end;
  return v_row;
end
$$;

comment on function public.use_ticket(uuid, uuid) is '식권 1장 사용(멱등·당일·가족 잠금). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.use_ticket(uuid, uuid) from public, anon;
grant execute on function public.use_ticket(uuid, uuid) to authenticated;
