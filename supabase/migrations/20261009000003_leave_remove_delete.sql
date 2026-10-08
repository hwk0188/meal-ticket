-- =========================================================
-- 가족 나가기: 호출자와 그 자녀를 새 가족으로 옮긴다. 장부는 옛 가족에 남는다(함께 쓰던 풀의 것 — 2단계 계획 인계 결정).
-- 나와 내 자녀뿐인 가족이면 아무것도 바꾸지 않고 현재 행을 돌려준다 (옮기면 장부만 떨어져 나간다).
-- 잠금(가족 함수 공통 규칙 ①코드 행 → ②쓸 사람 행 id 순 → ③lock_family 가족 id 순 → ④lock_family_meal): 코드 행은 쓰지 않으므로
-- 내 행(for update) → 옮길 자녀 행(id 순) → lock_family(내 가족) 순이다. 가족 잠금을 쥔 채 사람 행을 새로 잠그지 않는다.
-- 코드: not_authenticated | not_registered | not_adult
-- =========================================================
create or replace function public.leave_family()
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_new_family uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null for update;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;
  -- 옮길 자녀 행을 먼저 잠그고(②), 가족 잠금(③) 뒤에 구성원을 세어야 동시에 진행되는 합류(add_family_member)·자녀 삭제와 판단이 어긋나지 않는다.
  perform 1 from public.people
    where guardian_id = v_me.id and is_minor and deleted_at is null and family_id = v_me.family_id
    order by id for update;
  perform public.lock_family(v_me.family_id);
  -- 나도 아니고 내 자녀도 아닌 산 구성원이 없으면 그대로
  if not exists (
    select 1 from public.people
     where family_id = v_me.family_id and deleted_at is null
       and id <> v_me.id and not (is_minor and guardian_id = v_me.id)
  ) then
    return v_me;
  end if;

  insert into public.families default values returning id into v_new_family;
  update public.people set family_id = v_new_family
   where deleted_at is null and family_id = v_me.family_id
     and (id = v_me.id or (guardian_id = v_me.id and is_minor));
  select * into v_me from public.people where id = v_me.id;
  return v_me;
end
$$;

comment on function public.leave_family() is '호출자와 자녀를 새 가족으로. 장부는 옛 가족에 남는다.';
revoke execute on function public.leave_family() from public, anon;
grant execute on function public.leave_family() to authenticated;

-- =========================================================
-- 자녀 삭제(파기): 이름 치환 · 번호·계정 NULL · deleted_at. 장부는 익명 상태로 남는다. 보호자만.
-- 자녀 계정(익명)은 사람 행을 잃어 하루 뒤 정리 작업이 지운다. 카카오 계정이면 다음 로그인 때 가입 화면부터.
-- 코드: not_authenticated | not_registered | not_adult | child_not_found
-- =========================================================
create or replace function public.remove_child(p_child_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_child public.people;
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
  -- 잠금 순서(가족 함수 공통): ① 코드 행 → ② 사람 행 → ③ 가족. 자녀 계정을 알아야 코드를 지울 수 있으므로
  -- 먼저 잠금 없이 읽고, 코드를 지운 뒤에 자녀 행을 잠그고 다시 읽는다.
  select * into v_child from public.people
   where id = p_child_id and guardian_id = v_me.id and is_minor and deleted_at is null;
  if not found then
    raise exception 'child_not_found';
  end if;
  delete from public.pairing_codes where auth_user_id = v_child.auth_user_id;
  select * into v_child from public.people
   where id = v_child.id and guardian_id = v_me.id and is_minor and deleted_at is null
     for update;
  if not found then
    raise exception 'child_not_found';
  end if;
  -- ③ 가족 잠금. 합류·나가기가 구성원을 세는 동안 자녀가 사라지지 않게 한다.
  perform public.lock_family(v_child.family_id);

  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_child.id;
end
$$;

comment on function public.remove_child(uuid) is '자녀 익명화(파기). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.remove_child(uuid) from public, anon;
grant execute on function public.remove_child(uuid) to authenticated;

-- =========================================================
-- 탈퇴(본인 익명화). 자녀가 있으면 먼저 자녀 삭제를 요구한다. 동의 시각·버전은 증빙으로 남긴다.
-- 카카오 계정 자체는 남지만 사람 행이 없어 다음 로그인 때 가입 화면부터 다시 시작한다 (번호도 다시 쓸 수 있다).
-- 코드: not_authenticated | not_registered | not_adult | has_children
-- =========================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- ① 내 연결 코드 행을 먼저 지운다 (잠금 순서: 코드 행 → 사람 행 → 가족). 뒤에서 예외가 나면 함께 롤백된다.
  delete from public.pairing_codes where auth_user_id = auth.uid();
  -- ② 내 행
  select * into v_me from public.people where auth_user_id = auth.uid() and deleted_at is null for update;
  if not found then
    raise exception 'not_registered';
  end if;
  if v_me.is_minor then
    raise exception 'not_adult';
  end if;
  -- ③ 가족 잠금. 자녀 수를 세는 동안 자녀 추가가 끼어들지 않게 한다.
  perform public.lock_family(v_me.family_id);
  if exists (select 1 from public.people where guardian_id = v_me.id and is_minor and deleted_at is null) then
    raise exception 'has_children';
  end if;

  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_me.id;
end
$$;

comment on function public.delete_my_account() is '본인 익명화(탈퇴). 자녀가 있으면 has_children.';
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
