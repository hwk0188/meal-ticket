-- =========================================================
-- 이 파일(가족 나가기·자녀 삭제·탈퇴)의 잠금 규칙은 20261009000002_family_functions.sql 헤더의 것을 따른다
-- (①pairing_codes 행 → ②쓸 people 행 id 순 for update → ③lock_family 가족 id 순 → ④lock_family_meal meal_id 순).
-- 모든 가족 함수는 자녀 행보다 어른(본인) 행을 먼저 잠근다: add_family_member(어른 → 자녀), delete_my_account(본인),
-- issue_tickets(대상 어른)이 그렇고, relink_child 는 자녀 행만 잠근다. 새 함수가 자녀 행을 어른 행보다 먼저
-- 잠그면 40P01(교착)이 생긴다.
-- ④ lock_family_meal 은 이 파일의 세 함수 모두에서 생략한다 — 세 함수는 issuances·usages 를 쓰지 않고,
-- use_ticket 은 (family_id, meal_id) 기준으로 그 두 표만 세므로 구성원 이동이 끼어들어도 잔량 계산이 어긋나지 않는다.
-- =========================================================

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
  -- 대상이 남의 자녀든, 어른이든, 존재하지 않는 id 든 모두 child_not_found 하나로 묶는다 — "이 id 가 어른이다" 같은
  -- 열거를 응답에 흘리지 않기 위함이다 (보호자가 아닌 호출자에게 대상의 신원을 추론할 단서를 주지 않는다).
  select * into v_child from public.people
   where id = p_child_id and guardian_id = v_me.id and is_minor and deleted_at is null;
  if not found then
    raise exception 'child_not_found';
  end if;
  -- 여기서 지우는 것은 "잠그기 전" auth_user_id 기준이다 — 두 탭 경쟁: 이 트랜잭션이 코드를 지우는 사이
  -- relink_child 가 먼저 끝나 이 자녀 행의 auth_user_id 가 바뀌면, 새 계정 쪽에 이미 쓰인 코드 행이 하나
  -- 남을 수 있다. 무해하다(이미 used_at 이 찍힌 죽은 행이라 다시 못 쓴다) — 매시간 cleanup_pairing_codes 가
  -- 지운다. 자녀 행을 잠근 뒤(④ 아래) 다시 지우면 되지 않느냐 하면: 그러면 ①(코드)보다 ②(사람 행 for update)가
  -- 먼저 와 버려 이 파일의 잠금 순서를 어기고 다른 함수와 교착할 수 있다 — 그래서 그대로 둔다.
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
-- 코드: not_authenticated | not_registered | not_adult | has_children | last_admin
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
  -- 마지막 관리자가 탈퇴하면 role 을 바꿀 화면이 없어(관리자 지정은 SQL 로만) 운영이 멈춘다
  if v_me.role = 'admin' and not exists (
    select 1 from public.people where role = 'admin' and deleted_at is null and id <> v_me.id
  ) then
    raise exception 'last_admin';
  end if;

  update public.people
     set name = '탈퇴한 사용자', phone = null, auth_user_id = null, deleted_at = now()
   where id = v_me.id;
end
$$;

comment on function public.delete_my_account() is '본인 익명화(탈퇴). 자녀가 있으면 has_children.';
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
