-- =========================================================
-- 가족 연결: 코드를 띄운 폰의 계정을 호출자(어른 교인)의 가족에 붙인다.
--   child: 자녀 사람 행을 새로 만든다 (이름만. is_minor, guardian=호출자, 보호자 동의 시각=now, 계정=코드 계정).
--   adult: 코드 계정의 사람(과 그 자녀)을 호출자 가족으로 옮긴다. 옛 가족에 산 사람이 아무도 남지 않으면
--          그 가족의 장부(issuances·usages)도 통째로 새 가족으로 옮긴다 — 잔량 풀 병합(2단계 계획 인계 결정).
--          누군가 남으면 장부는 옛 가족에 둔다 (가족 나가기와 같은 의미: 함께 쓰던 풀의 것).
-- 코드: not_authenticated | not_registered | not_adult | invalid_code | invalid_name | already_registered
-- =========================================================
create or replace function public.add_family_member(p_code text, p_child_name text default null)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_code public.pairing_codes;
  v_name text := normalize(btrim(coalesce(p_child_name, '')), NFC);
  v_target public.people;
  v_old_family uuid;
  v_meal uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;

  -- 코드 행을 잠근다: 같은 코드로 두 어른이 동시에 연결해도 한 쪽만 성공한다. 자기 코드는 쓸 수 없다.
  select * into v_code from public.pairing_codes where code = btrim(coalesce(p_code, '')) for update;
  if not found or v_code.used_at is not null or v_code.expires_at < now() or v_code.auth_user_id = auth.uid() then
    raise exception 'invalid_code';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_code.auth_user_id) then
    raise exception 'invalid_code';
  end if;

  if v_code.kind = 'child' then
    if char_length(v_name) not between 1 and 20 then
      raise exception 'invalid_name';
    end if;
    -- 코드 계정에 이미 사람이 있으면(다른 어른이 먼저 연결했거나 어른으로 가입한 계정) 연결하지 않는다
    if exists (select 1 from public.people where auth_user_id = v_code.auth_user_id and deleted_at is null) then
      raise exception 'already_registered';
    end if;
    begin
      insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
      values (v_name, v_me.family_id, v_code.auth_user_id, true, v_me.id, now())
      returning * into v_target;
    exception when unique_violation then
      -- people_auth_user_id_key: 코드 행 잠금을 우회한 동시 연결(이론상) → 약속된 코드로
      raise exception 'already_registered';
    end;
  else
    select * into v_target from public.people
     where auth_user_id = v_code.auth_user_id and deleted_at is null and is_minor = false
       for update;
    if not found then
      raise exception 'invalid_code';
    end if;
    if v_target.family_id <> v_me.family_id then
      v_old_family := v_target.family_id;
      -- 옛 가족의 장부에 있는 식사마다 use_ticket 과 같은 잠금을 잡아, 옮기는 도중 사용 처리가 끼어들지 못하게 한다
      for v_meal in
        select meal_id from public.issuances where family_id = v_old_family
        union
        select meal_id from public.usages where family_id = v_old_family
        order by 1
      loop
        perform public.lock_family_meal(v_old_family, v_meal);
      end loop;
      update public.people set family_id = v_me.family_id
       where deleted_at is null and (id = v_target.id or (guardian_id = v_target.id and is_minor));
      if not exists (select 1 from public.people where family_id = v_old_family and deleted_at is null) then
        update public.issuances set family_id = v_me.family_id where family_id = v_old_family;
        update public.usages set family_id = v_me.family_id where family_id = v_old_family;
        -- 익명화된 옛 구성원 행이 남아 있으면 FK 때문에 못 지운다 — 그런 가족은 빈 껍데기로 남는다 (정리 작업도 건드리지 않는다)
        delete from public.families where id = v_old_family
           and not exists (select 1 from public.people where family_id = v_old_family);
      end if;
      select * into v_target from public.people where id = v_target.id;
    end if;
  end if;

  update public.pairing_codes set used_at = now() where code = v_code.code;
  return v_target;
end
$$;

comment on function public.add_family_member(text, text) is '자녀 추가(child 코드) / 어른 합류(adult 코드, 빈 가족의 장부는 함께 이동). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.add_family_member(text, text) from public, anon;
grant execute on function public.add_family_member(text, text) to authenticated;

-- =========================================================
-- 자녀 재연결: 폰을 바꾼 자녀의 계정을 새 폰의 코드 계정으로 교체한다. 보호자만.
-- 옛 계정은 사람 행을 잃어 다음 접속 때 가입 화면부터 다시 시작한다(옛 폰 접근 차단). 익명이면 하루 뒤 정리된다.
-- 코드: not_authenticated | not_registered | not_adult | child_not_found | invalid_code | already_registered
-- =========================================================
create or replace function public.relink_child(p_child_id uuid, p_code text)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_child public.people;
  v_code public.pairing_codes;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;
  select * into v_child from public.people
   where id = p_child_id and guardian_id = v_me.id and is_minor and deleted_at is null
     for update;
  if not found then
    raise exception 'child_not_found';
  end if;

  select * into v_code from public.pairing_codes where code = btrim(coalesce(p_code, '')) for update;
  if not found or v_code.kind <> 'child' or v_code.used_at is not null or v_code.expires_at < now()
     or v_code.auth_user_id = auth.uid() then
    raise exception 'invalid_code';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_code.auth_user_id) then
    raise exception 'invalid_code';
  end if;
  if exists (select 1 from public.people where auth_user_id = v_code.auth_user_id and deleted_at is null) then
    raise exception 'already_registered';
  end if;

  update public.people set auth_user_id = v_code.auth_user_id where id = v_child.id returning * into v_child;
  update public.pairing_codes set used_at = now() where code = v_code.code;
  return v_child;
end
$$;

comment on function public.relink_child(uuid, text) is '자녀 계정을 새 폰의 코드 계정으로 교체. 오류 코드는 파일 헤더 참고.';
revoke execute on function public.relink_child(uuid, text) from public, anon;
grant execute on function public.relink_child(uuid, text) to authenticated;
