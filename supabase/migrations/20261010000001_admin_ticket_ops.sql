-- =========================================================
-- 4a단계: 관리자 식권 조작 3종 + use_ticket 재정의
-- 잠금 규칙(3단계 20261009000002_family_functions.sql 헤더): ② 쓸 people 행 for update → ③ lock_family →
--   ④ lock_family_meal(family, meal) → 장부 행(issuances·usages) 잠금은 ④ 뒤에.
--   합류(add_family_member)는 ③ → ④ → 장부 update 순이라, 장부 행을 먼저 잠그고 ④ 를 기다리면 40P01 이 난다.
--   그래서 cancel_issuance·void_usage 는 행을 잠그지 않고 읽어 (family, meal) 을 알아낸 뒤 ④ → 행 for update 재조회 순으로 간다.
--   과거 식사는 합류가 ④ 를 잡지 않아 그 사이 family_id 가 바뀔 수 있다 → 재조회한 가족이 다르면 그 쌍도 잠근다.
--   (이론상 두 세션이 서로 다른 가족의 재조회에서 서로를 기다리는 상호 합류 40P01 도 생각해 볼 수 있지만, 앱에서는
--   합류의 도착 가족이 항상 호출자 자신의 가족이고 leave_family 는 새 가족을 만들 뿐이라 이 경로로는 닿지 않는다 —
--   혹시 나타나면 40P01 은 그대로 일반 오류 문구로 보여도 된다.)
-- use_ticket: 2단계 파일(20261008000004)은 운영에 적용됐으므로 고치지 않고 여기서 같은 시그니처로 재정의한다.
--   바뀐 점 = 사람 행 for update(합류 중이면 끝날 때까지 기다려 새 family_id 를 읽는다 — 3단계 최종 리뷰가 넘긴 틈) +
--   잠금을 lock_family_meal 헬퍼로(키는 100_pairing_codes.sql 이 같음을 고정). 멱등·당일·잔량 규칙은 그대로.
-- =========================================================

-- =========================================================
-- 발급 취소: 발급 한 건을 통째로 취소한다. 취소 뒤 가족 잔량이 음수가 되면 거부(이미 쓴 장수가 남은 발급으로 덮여야 한다).
-- 코드: not_authenticated | forbidden | invalid_reason | issuance_not_found | already_cancelled | would_go_negative
-- =========================================================
create or replace function public.cancel_issuance(p_issuance_id uuid, p_reason text default null)
returns public.issuances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.issuances;
  v_locked_family uuid;
  v_remaining integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if v_reason is not null and char_length(v_reason) > 100 then
    raise exception 'invalid_reason';
  end if;

  select * into v_row from public.issuances where id = p_issuance_id;
  if not found then
    raise exception 'issuance_not_found';
  end if;
  -- ④ 를 먼저, 행 잠금은 그 뒤 (파일 헤더 참고)
  perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  v_locked_family := v_row.family_id;
  select * into v_row from public.issuances where id = p_issuance_id for update;
  if not found then
    raise exception 'issuance_not_found';
  end if;
  if v_row.family_id <> v_locked_family then
    perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'already_cancelled';
  end if;

  select coalesce(sum(i.quantity), 0)
         - (select coalesce(sum(u.quantity), 0) from public.usages u
             where u.family_id = v_row.family_id and u.meal_id = v_row.meal_id and u.voided_at is null)
    into v_remaining
    from public.issuances i
   where i.family_id = v_row.family_id and i.meal_id = v_row.meal_id and i.cancelled_at is null;
  if v_remaining - v_row.quantity < 0 then
    raise exception 'would_go_negative';
  end if;

  update public.issuances
     set cancelled_at = now(), cancelled_by = v_admin, cancel_reason = v_reason
   where id = v_row.id
  returning * into v_row;
  return v_row;
end
$$;

comment on function public.cancel_issuance(uuid, text) is '관리자 발급 취소(잔량 음수 거부, ④ 뒤 행 잠금). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.cancel_issuance(uuid, text) from public, anon;
grant execute on function public.cancel_issuance(uuid, text) to authenticated;

-- =========================================================
-- 사용 무효: 사용 기록 한 건을 무효로 표시한다(잔량 +1). 삭제하지 않는다.
-- 코드: not_authenticated | forbidden | usage_not_found | already_voided
-- =========================================================
create or replace function public.void_usage(p_usage_id uuid)
returns public.usages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_row public.usages;
  v_locked_family uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.usages where id = p_usage_id;
  if not found then
    raise exception 'usage_not_found';
  end if;
  perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  v_locked_family := v_row.family_id;
  select * into v_row from public.usages where id = p_usage_id for update;
  if not found then
    raise exception 'usage_not_found';
  end if;
  if v_row.family_id <> v_locked_family then
    perform public.lock_family_meal(v_row.family_id, v_row.meal_id);
  end if;
  if v_row.voided_at is not null then
    raise exception 'already_voided';
  end if;

  update public.usages set voided_at = now(), voided_by = v_admin where id = v_row.id returning * into v_row;
  return v_row;
end
$$;

comment on function public.void_usage(uuid) is '관리자 사용 무효 처리(④ 뒤 행 잠금). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.void_usage(uuid) from public, anon;
grant execute on function public.void_usage(uuid) to authenticated;

-- =========================================================
-- 대신 사용: 담당자가 교인 폰 없이 1장을 사용 처리한다(사후 기록 포함 — 날짜 제한 없음). 자녀 몫도 허용(잔량은 가족 것).
-- p_family_id(선택): 화면이 본 가족. 그 사이 사람이 가족을 옮겼으면(가족 나가기·합류) family_changed 로 거부한다 — 옛 가족 블록에서 눌렀는데
-- 새 가족 풀에서 깎이는 것을 막는다(장부의 family_id 는 발급 시점 스냅샷, 함수는 현재 가족으로 깎는다 — Task 1 리뷰).
-- p_request_id(선택): 클라이언트가 만든 재시도 키 — 같은 값은 처음 결과를 돌려준다(use_ticket 과 같은 규칙). 없으면 서버가 만든다(멱등 아님).
-- 코드: not_authenticated | forbidden | person_not_found | family_changed | meal_not_found | no_remaining | duplicate_request
-- =========================================================
-- 로컬에서 3인자 버전을 이미 만든 DB 가 있을 수 있다(migration up). 운영에는 간 적 없어 no-op.
drop function if exists public.use_ticket_as_admin(uuid, uuid, uuid);

create or replace function public.use_ticket_as_admin(
  p_person_id uuid,
  p_meal_id uuid,
  p_family_id uuid default null,
  p_request_id uuid default null
)
returns public.usages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
  v_remaining integer;
  v_row public.usages;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- ② 대상 사람 행 for update: 합류 중이면 끝날 때까지 기다렸다 새 family_id 를 읽는다
  select * into v_person from public.people where id = p_person_id and deleted_at is null for update;
  if not found then
    raise exception 'person_not_found';
  end if;
  if p_family_id is not null and v_person.family_id <> p_family_id then
    raise exception 'family_changed';
  end if;
  if not exists (select 1 from public.meals where id = p_meal_id) then
    raise exception 'meal_not_found';
  end if;

  -- ④
  perform public.lock_family_meal(v_person.family_id, p_meal_id);

  if p_request_id is not null then
    select * into v_row from public.usages where request_id = p_request_id;
    if found then
      if v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
        raise exception 'duplicate_request';
      end if;
      return v_row;
    end if;
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
    values (v_person.family_id, v_person.id, p_meal_id, 1, 'admin', v_admin, coalesce(p_request_id, gen_random_uuid()))
    returning * into v_row;
  exception when unique_violation then
    select * into v_row from public.usages where request_id = p_request_id;
    if not found or v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
      raise exception 'duplicate_request';
    end if;
  end;
  return v_row;
end
$$;

comment on function public.use_ticket_as_admin(uuid, uuid, uuid, uuid) is '관리자 대신 사용 처리(날짜 제한 없음, ② 사람 행 → ④, 가족 확인, p_request_id 로 멱등). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.use_ticket_as_admin(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.use_ticket_as_admin(uuid, uuid, uuid, uuid) to authenticated;

-- =========================================================
-- use_ticket 재정의 (시그니처·동작 동일, 잠금만 보강). 원본 설명은 20261008000004_use_ticket.sql 참고.
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
  -- ② 내 사람 행 for update: 합류가 커밋되는 사이에 옛 가족 풀에 기록되는 틈을 막는다 (3단계 최종 리뷰)
  select * into v_person from public.people where auth_user_id = auth.uid() and deleted_at is null for update;
  if not found then
    raise exception 'not_registered';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request';
  end if;

  -- ④ 잠금을 멱등 조회보다 먼저 건다 (같은 request_id 의 동시 재시도가 먼저 커밋된 행을 보게 된다)
  perform public.lock_family_meal(v_person.family_id, p_meal_id);

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
    select * into v_row from public.usages where request_id = p_request_id;
    if not found or v_row.person_id <> v_person.id or v_row.meal_id <> p_meal_id then
      raise exception 'duplicate_request';
    end if;
  end;
  return v_row;
end
$$;

comment on function public.use_ticket(uuid, uuid) is '식권 1장 사용(멱등·당일·② 사람 행 for update·④ lock_family_meal). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.use_ticket(uuid, uuid) from public, anon;
grant execute on function public.use_ticket(uuid, uuid) to authenticated;
