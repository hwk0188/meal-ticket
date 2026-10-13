-- 4c단계 ⑯: admin_reset_person 이 떼어낸 계정의 연결 코드를 지운다.
--
-- 왜: 같은 익명화를 하는 두 형제 함수(delete_my_account · remove_child)는 모두 코드를 먼저 지운다.
--   초기화만 지우지 않아, 교인이 가족 탭에서 어른 코드를 띄워 둔 채 초기화되고 10분 안에 다시 가입하면
--   그 코드가 새로 생긴 사람 행에 대해 유효해진다(add_family_member 는 auth_user_id 로 대상을 찾는다) —
--   코드를 쥔 사람이 그 교인을 자기 가족으로 흡수할 수 있다.
--
-- 잠금 순서는 이 저장소의 규칙(① 코드 → ② 사람 → ③ 가족)을 그대로 지킨다. 사람 행을 잠그기 전에 계정 id 를
--   알아야 하므로 잠그지 않고 한 번 읽는다 — remove_child 가 같은 모양이고 같은 이유를 적어 뒀다.
--
-- 함수 본문 외 변경 없음: 표·인덱스·권한을 건드리지 않고 create or replace 와 comment 뿐이라 재실행도 안전하다.
-- 오류 코드는 4b 와 같다: not_authenticated | forbidden | person_not_found | minor_not_allowed | has_children | last_admin

create or replace function public.admin_reset_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_person_id();
  v_person public.people;
  v_account uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_admin is null or not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- ① 연결 코드. 잠그지 않고 읽은 계정 id 기준으로 지운다.
  --   경쟁: 이 사이에 그 계정이 다른 사람 행으로 옮겨 가면(link_person·claim_person) 이미 쓰인 죽은 코드 행이
  --   하나 남을 수 있다. 무해하고(used_at 이 찍힌 행은 다시 못 쓴다) 매시간 cleanup_pairing_codes 가 지운다.
  --   사람 행을 잠근 뒤에 지우면 ②가 ①보다 먼저 와 이 저장소의 잠금 순서를 어긴다 — remove_child 와 같은 판단.
  --   아래에서 예외가 나면(미성년자·자녀 있음·마지막 관리자) 이 delete 도 같은 트랜잭션에서 되돌아간다.
  select auth_user_id into v_account from public.people where id = p_person_id and deleted_at is null;
  if v_account is not null then
    delete from public.pairing_codes where auth_user_id = v_account;
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

comment on function public.admin_reset_person(uuid) is
  '관리자 사람 초기화(익명화 + 계정 해제 + 그 계정의 연결 코드 삭제, 장부 보존). 오류 코드: not_authenticated | forbidden | person_not_found | minor_not_allowed | has_children | last_admin';
revoke execute on function public.admin_reset_person(uuid) from public, anon;
grant execute on function public.admin_reset_person(uuid) to authenticated;

-- 4b 의 안내 주석 정정. 배포된 마이그레이션 파일은 역사 기록이라 손대지 않고 주석만 덮어쓴다.
-- 잘못된 설명: "초기화 뒤 같은 계정으로 되돌릴 때만 쓴다" — link_person 은 deleted_at is null 을 요구하므로
-- 초기화된 사람에게는 쓸 수 없다(pgTAP 150 이 양방향으로 못 박는다). 실제로 닿는 경우는 auth.users 행이
-- 사라져(on delete set null) 연결이 끊긴 살아 있는 어른이다.
comment on function public.link_person(uuid, uuid) is
  '카카오 계정 수동 연결(복구 경로): auth.users 행이 사라져 연결이 끊긴, 동의 기록이 있는 살아 있는 어른에게만. 초기화된 사람은 되돌릴 수 없다. 오류 코드는 20261011000001 헤더 참고.';
