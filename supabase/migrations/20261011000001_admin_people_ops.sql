-- =========================================================
-- 4b단계: 관리자 사람 관리 3종 (중복 합치기 · 초기화 · 계정 수동 연결)
-- 잠금 규칙은 20261009000002_family_functions.sql 헤더 그대로:
--   ② 쓸 people 행을 한 문장에서 id 순 for update → ③ lock_family 가족 id 순 → ④ lock_family_meal(가족, 식사) → 장부 행.
--   merge_people 은 ②(from·into) → ②(옮길 자녀) → ③(두 가족) → ④(옛 가족의 "오늘 이후" 식사) 를 쓴다.
--   ④ 가 필요한 이유: 옛 가족에 산 사람이 남지 않으면 그 가족의 장부를 통째로 옮기는데(add_family_member 와 같은 결정),
--   그 사이 옛 가족의 다른 구성원이 use_ticket 으로 잔량을 깎으면 음수가 될 수 있다. 지난 식사는 당일 규칙 때문에
--   쓸 수 없으니 잠그지 않는다.
--   자녀의 guardian_id 를 바꾸므로 대상 보호자(into) 행을 반드시 잠근다 (3단계 Task 3 리뷰).
-- 익명화 문구는 기존 두 경로와 같은 '탈퇴한 사용자' (remove_child · delete_my_account).
-- =========================================================

-- =========================================================
-- 중복 사람 합치기: from 의 장부·자녀·계정·관리자 권한을 into 로 옮기고 from 을 익명화한다.
--   · 장부의 구매자·사용자(person_id)와 처리자(issued_by·recorded_by·cancelled_by·voided_by)는 언제나 into 로.
--   · 장부의 가족(family_id)은 "옛 가족에 산 사람이 아무도 남지 않을 때만" 통째로 옮긴다 — 함께 쓰던 풀의 것은
--     남긴다(leave_family·add_family_member 와 같은 결정). 그래서 1인 가족 선발급 중복은 잔량까지 합쳐지고,
--     식구가 남은 가족의 장부는 그 가족에 남는다.
--   · 둘 다 계정이 있으면 both_have_accounts — 한 사람에 두 카카오 계정을 붙일 수 없다(먼저 한쪽을 초기화한다).
--   · 자녀는 양쪽 모두 거부한다(minor_not_allowed) — 자녀는 가족 탭의 "다시 연결"·"자녀 삭제" 로 관리한다.
-- 코드: not_authenticated | forbidden | same_person | person_not_found | minor_not_allowed | both_have_accounts
-- =========================================================
create or replace function public.merge_people(p_from_id uuid, p_into_id uuid)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_from public.people;
  v_into public.people;
  v_from_family uuid;
  v_meal uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_from_id is null or p_into_id is null then
    raise exception 'person_not_found';
  end if;
  if p_from_id = p_into_id then
    raise exception 'same_person';
  end if;

  -- ② 두 사람 행을 한 문장에서 id 순으로 잠근다 (두 관리자가 반대 방향으로 합쳐도 교착하지 않는다)
  perform 1 from public.people where id in (p_from_id, p_into_id) order by id for update;
  select * into v_from from public.people where id = p_from_id and deleted_at is null;
  if not found then
    raise exception 'person_not_found';
  end if;
  select * into v_into from public.people where id = p_into_id and deleted_at is null;
  if not found then
    raise exception 'person_not_found';
  end if;
  if v_from.is_minor or v_into.is_minor then
    raise exception 'minor_not_allowed';
  end if;
  if v_from.auth_user_id is not null and v_into.auth_user_id is not null then
    raise exception 'both_have_accounts';
  end if;

  v_from_family := v_from.family_id;

  -- ② 함께 옮길 자녀 행 (보호자 행을 이미 잠근 뒤다 — 어른 → 자녀 순서)
  perform 1 from public.people
   where guardian_id = v_from.id and is_minor and deleted_at is null
   order by id for update;

  -- ③ 가족 잠금은 가족 id 순으로
  if v_from_family <> v_into.family_id then
    perform public.lock_family(least(v_from_family, v_into.family_id));
    perform public.lock_family(greatest(v_from_family, v_into.family_id));
  else
    perform public.lock_family(v_from_family);
  end if;

  -- ④ 옛 가족의 "서울 오늘 이후" 식사만 (use_ticket 이 아직 건드릴 수 있는 것)
  for v_meal in
    select i.meal_id from public.issuances i join public.meals m on m.id = i.meal_id
     where i.family_id = v_from_family and m.served_on >= (now() at time zone 'Asia/Seoul')::date
    union
    select u.meal_id from public.usages u join public.meals m on m.id = u.meal_id
     where u.family_id = v_from_family and m.served_on >= (now() at time zone 'Asia/Seoul')::date
    order by 1
  loop
    perform public.lock_family_meal(v_from_family, v_meal);
  end loop;

  -- 장부: 구매자·사용자와 처리자를 into 로. self 사용은 person_id 와 recorded_by 가 같아야 하므로
  -- (usages_self_recorded_by_person) 두 열을 한 문장에서 바꾼다.
  update public.issuances
     set person_id    = case when person_id = v_from.id then v_into.id else person_id end,
         issued_by    = case when issued_by = v_from.id then v_into.id else issued_by end,
         cancelled_by = case when cancelled_by = v_from.id then v_into.id else cancelled_by end
   where person_id = v_from.id or issued_by = v_from.id or cancelled_by = v_from.id;
  update public.usages
     set person_id   = case when person_id = v_from.id then v_into.id else person_id end,
         recorded_by = case when recorded_by = v_from.id then v_into.id else recorded_by end,
         voided_by   = case when voided_by = v_from.id then v_into.id else voided_by end
   where person_id = v_from.id or recorded_by = v_from.id or voided_by = v_from.id;

  -- 자녀: 보호자와 가족을 into 로 (익명화보다 먼저 — 익명화된 보호자 밑에 산 자녀가 남지 않게)
  update public.people
     set guardian_id = v_into.id, family_id = v_into.family_id
   where guardian_id = v_from.id and is_minor and deleted_at is null;

  -- 관리자 권한은 사람이 아니라 역할이다 — 같은 사람이므로 이어 준다 (합치기로 마지막 관리자가 사라지지 않는다)
  if v_from.role = 'admin' then
    update public.people set role = 'admin' where id = v_into.id;
  end if;

  -- from 익명화. 계정을 여기서 끊어야 아래에서 into 에 붙일 때 auth_user_id unique 와 부딪히지 않는다.
  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_from.id;

  -- 계정이 from 에만 있었으면 into 로 옮긴다. 동의 기록이 없으면 함께 옮긴다
  -- (people_adult_requires_consent: 계정이 붙은 어른은 동의 기록이 있어야 한다).
  if v_from.auth_user_id is not null then
    update public.people
       set auth_user_id = v_from.auth_user_id,
           consented_at = coalesce(v_into.consented_at, v_from.consented_at),
           consent_version = coalesce(v_into.consent_version, v_from.consent_version)
     where id = v_into.id;
  end if;

  -- 옛 가족에 산 사람이 남지 않으면 장부를 옮기고 빈 가족을 지운다 (add_family_member 와 같은 조건·같은 이유)
  if v_from_family <> v_into.family_id
     and not exists (select 1 from public.people where family_id = v_from_family and deleted_at is null) then
    update public.issuances set family_id = v_into.family_id where family_id = v_from_family;
    update public.usages set family_id = v_into.family_id where family_id = v_from_family;
    -- 익명화된 from 행 자신도 옛 가족을 여전히 가리키고 있다 (익명화는 family_id 를 건드리지 않는다) —
    -- FK(people_family_id_fkey) 때문에 이 행을 옮기지 않으면 가족을 지울 수 없다.
    update public.people set family_id = v_into.family_id where id = v_from.id and family_id = v_from_family;
    delete from public.families f
     where f.id = v_from_family
       and not exists (select 1 from public.people p where p.family_id = f.id)
       and not exists (select 1 from public.issuances i where i.family_id = f.id)
       and not exists (select 1 from public.usages u where u.family_id = f.id);
  end if;

  select * into v_into from public.people where id = v_into.id;
  return v_into;
end
$$;

comment on function public.merge_people(uuid, uuid) is '중복 사람 합치기(장부·자녀·계정·권한 이동 + from 익명화). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.merge_people(uuid, uuid) from public, anon;
grant execute on function public.merge_people(uuid, uuid) to authenticated;

-- =========================================================
-- 사람 초기화: 잘못 가입한 사람(예: 만 14세 미만이 어른으로 가입)을 익명화하고 계정 연결을 끊는다.
--   장부는 그대로 둔다 — 그 폰은 다음 접속 때 가입 화면부터 다시 시작한다.
--   자녀가 딸려 있으면 먼저 정리해야 한다(has_children). 마지막 관리자는 거부한다(last_admin) —
--   role 을 바꿀 화면이 없어 운영이 멈춘다 (delete_my_account 와 같은 이유).
-- 코드: not_authenticated | forbidden | person_not_found | minor_not_allowed | has_children | last_admin
-- =========================================================
create or replace function public.admin_reset_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- ② 대상 사람 행
  select * into v_person from public.people where id = p_person_id and deleted_at is null for update;
  if not found then
    raise exception 'person_not_found';
  end if;
  if v_person.is_minor then
    raise exception 'minor_not_allowed';
  end if;

  -- ③ 자녀 수를 세는 동안 자녀 추가가 끼어들지 않게 (delete_my_account 와 같은 순서)
  perform public.lock_family(v_person.family_id);
  if exists (select 1 from public.people where guardian_id = v_person.id and is_minor and deleted_at is null) then
    raise exception 'has_children';
  end if;
  -- 관리자 수는 전역이지만 잠금은 그 가족뿐이다 — 서로 다른 가족의 두 관리자를 같은 순간에 초기화하면 둘 다 통과할 수 있다.
  -- 관리자는 한두 명이고 복구는 SQL 한 줄이라 그대로 둔다 (delete_my_account 와 같은 판단).
  if v_person.role = 'admin' and not exists (
    select 1 from public.people where role = 'admin' and deleted_at is null and id <> v_person.id
  ) then
    raise exception 'last_admin';
  end if;

  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_person.id;
end
$$;

comment on function public.admin_reset_person(uuid) is '관리자 사람 초기화(익명화 + 계정 해제, 장부 보존). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.admin_reset_person(uuid) from public, anon;
grant execute on function public.admin_reset_person(uuid) to authenticated;

-- =========================================================
-- 카카오 계정 수동 연결: 초기화 뒤 같은 계정으로 되돌릴 때만 쓰는 복구 경로.
--   교인이 스스로 가입하면 claim_person 이 번호·이름으로 자동 연결하거나 중복 행이 생겨 merge_people 로 해결된다.
--   동의 기록이 없는 사람에게는 연결하지 않는다(consent_required) — 동의를 대신 만들지 않는다(설계 §10).
--   익명(아이) 계정은 거부한다 — 자녀 연결은 가족 탭의 relink_child 가 한다.
-- 코드: not_authenticated | forbidden | person_not_found | minor_not_allowed | already_registered |
--       consent_required | account_not_found | anonymous_cannot_claim | account_taken
-- =========================================================
create or replace function public.link_person(p_person_id uuid, p_auth_user_id uuid)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
  v_is_anonymous boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_auth_user_id is null then
    raise exception 'account_not_found';
  end if;

  -- ② 대상 사람 행
  select * into v_person from public.people where id = p_person_id and deleted_at is null for update;
  if not found then
    raise exception 'person_not_found';
  end if;
  if v_person.is_minor then
    raise exception 'minor_not_allowed';
  end if;
  if v_person.auth_user_id is not null then
    raise exception 'already_registered';
  end if;
  if v_person.consented_at is null then
    raise exception 'consent_required';
  end if;

  select is_anonymous into v_is_anonymous from auth.users where id = p_auth_user_id;
  if not found then
    raise exception 'account_not_found';
  end if;
  if v_is_anonymous then
    raise exception 'anonymous_cannot_claim';
  end if;
  if exists (select 1 from public.people where auth_user_id = p_auth_user_id and deleted_at is null) then
    raise exception 'account_taken';
  end if;

  begin
    update public.people set auth_user_id = p_auth_user_id where id = v_person.id
    returning * into v_person;
  exception when unique_violation then
    -- 위 검사와 이 update 사이에 다른 관리자가 같은 계정을 붙였다 (auth_user_id unique)
    raise exception 'account_taken';
  end;
  return v_person;
end
$$;

comment on function public.link_person(uuid, uuid) is '관리자 카카오 계정 수동 연결(복구 경로). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.link_person(uuid, uuid) from public, anon;
grant execute on function public.link_person(uuid, uuid) to authenticated;
