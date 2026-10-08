-- =========================================================
-- 이 파일(가족을 건드리는 모든 함수)의 잠금 규칙. 어기면 40P01(교착)이 난다.
--   ① pairing_codes 행 → ② 쓸 people 행 (id 순, for update) → ③ lock_family (가족 id 순) → ④ lock_family_meal (meal_id 순).
--   가족 잠금을 쥔 채 사람 행을 새로 잠그지 않는다 — 잠글 사람 행은 ② 에서 모두 잡아 둔다.
--   코드 행보다 사람 행을 먼저 잠그면 add_family_member(①→②)와 맞물려 교착한다
--   (T1: 코드 X 를 쥐고 자녀 C 를 기다림 / T2: C 를 쥐고 X 를 기다림).
--   ※ 아는 예외: 매시간 도는 cleanup_pairing_codes 의 벌크 delete(①)는 delete_my_account·remove_child 의
--     코드 삭제와 원리상 교착할 수 있다 — 다음 시간 재시도로 수습되므로 따로 손대지 않는다.
-- =========================================================

-- =========================================================
-- 가족 잠금 헬퍼. 가족 하나를 트랜잭션 단위로 직렬화한다 (구성원·장부를 옮기는 함수들 사이).
-- 단일 키 잠금(objsubid 1)에 'family:' 이름공간을 붙였다 — lock_family_meal 의 두 키 공간(objsubid 2) 과도,
-- create_pairing_code 의 'pairing_code:' 키와도 절대 겹치지 않는다.
-- =========================================================
create or replace function public.lock_family(p_family_id uuid)
returns void
language sql
set search_path = ''
as $$ select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('family:' || p_family_id::text)) $$;
comment on function public.lock_family(uuid) is '가족 단위 트랜잭션 advisory lock (단일 키, 이름공간 ''family:'').';
revoke execute on function public.lock_family(uuid) from public, anon, authenticated;

-- =========================================================
-- 가족 연결: 코드를 띄운 폰의 계정을 호출자(어른 교인)의 가족에 붙인다.
--   child: 자녀 사람 행을 새로 만든다 (이름·법정대리인 동의 버전. is_minor, guardian=호출자, 보호자 동의 시각=now, 계정=코드 계정).
--   adult: 코드 계정의 사람(과 그 자녀)을 호출자 가족으로 옮긴다. 옛 가족에 산 사람이 아무도 남지 않으면
--          그 가족의 장부(issuances·usages)도 통째로 새 가족으로 옮긴다 — 잔량 풀 병합(2단계 계획 인계 결정).
--          누군가 남으면 장부는 옛 가족에 둔다 (가족 나가기와 같은 의미: 함께 쓰던 풀의 것).
--   멱등 재시도(RPC 규약): 이미 쓴 코드로 다시 불러도 그 코드가 만든 결과가 그대로 살아 있으면
--     (내 가족에 사는 내 자녀 / 내 가족에 사는 그 어른) 아무것도 바꾸지 않고 그 행을 돌려준다.
--     남의 결과이거나 그 사이 바뀐 결과면 invalid_code. 만료·없는 코드·자기 코드는 그대로 invalid_code.
--   잠금 순서: 파일 머리의 규칙 그대로 — ① 코드 행 → ② 호출자·대상(한 문장, id 순) 과 함께 옮길 자녀 →
--     ③ 두 가족(가족 id 순) → ④ 옛 가족의 "오늘 이후" 식사(meal_id 순).
--     사람 행보다 가족을 먼저 잠그면 A·B 가 서로의 어른 코드를 동시에 흡수할 때 교착한다.
-- 코드: not_authenticated | not_registered | not_adult | invalid_code | invalid_name | consent_required | already_registered
-- =========================================================
-- 2단계(자녀 동의 버전) 전 2인자 시그니처는 남겨 두지 않는다 — 기본값이 겹쳐 호출이 모호해진다.
drop function if exists public.add_family_member(text, text);

create or replace function public.add_family_member(
  p_code text,
  p_child_name text default null,
  p_consent_version text default null
)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me public.people;
  v_code public.pairing_codes;
  -- 카카오톡에서 붙여 넣은 코드에는 줄바꿈·NBSP 가 섞여 온다. 숫자만 남기지는 않는다 (형식 오류는 그대로 invalid_code).
  v_code_text text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
  -- 표시용 이름은 공백을 살리고 NFC 로만 맞춘다. 유효성은 공백을 모두 지운 비교 키로 본다 (탭·NBSP 만 있는 이름 거부).
  v_name text := normalize(btrim(coalesce(p_child_name, '')), NFC);
  v_consent text := btrim(coalesce(p_consent_version, ''));
  v_target public.people;
  v_target_id uuid;
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

  -- ① 코드 행을 잠근다: 같은 코드로 두 어른이 동시에 연결해도 한 쪽만 성공한다. 자기 코드는 쓸 수 없다.
  select * into v_code from public.pairing_codes where code = v_code_text for update;
  if not found or v_code.expires_at < now() or v_code.auth_user_id = auth.uid() then
    raise exception 'invalid_code';
  end if;
  -- 토큰은 유효한데 계정이 지워진 경우: FK 원시 오류(23503) 대신 약속된 코드.
  -- pairing_codes.auth_user_id 는 on delete cascade 라 보통 코드 행이 먼저 사라진다 (방어선으로 남긴다).
  if not exists (select 1 from auth.users u where u.id = v_code.auth_user_id) then
    raise exception 'invalid_code';
  end if;

  -- 멱등 재시도: 느린 네트워크에서 같은 코드로 두 번 보낸 경우. 아무것도 바꾸지 않고 그때 만든 행을 돌려준다.
  if v_code.used_at is not null then
    select * into v_target from public.people
     where auth_user_id = v_code.auth_user_id and deleted_at is null;
    if found
       and ((v_code.kind = 'child' and v_target.is_minor
             and v_target.guardian_id = v_me.id and v_target.family_id = v_me.family_id)
         or (v_code.kind = 'adult' and not v_target.is_minor
             and v_target.family_id = v_me.family_id)) then
      return v_target;
    end if;
    raise exception 'invalid_code';
  end if;

  if v_code.kind = 'child' then
    if public.normalize_name(p_child_name) is null or char_length(v_name) not between 1 and 20 then
      raise exception 'invalid_name';
    end if;
    -- 법정대리인 동의 텍스트의 버전(공개된 YYYY-MM-DD). claim_person 과 같은 규약 — 아무 문자열이나 동의 기록으로 남지 않게 한다.
    if v_consent !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'consent_required';
    end if;
    -- ② 보호자가 될 내 행을 잠근다: 그 사이 내가 다른 가족으로 옮겨지거나 탈퇴하면 엉뚱한 가족에 자녀가 생긴다.
    perform 1 from public.people where id = v_me.id for update;
    select * into v_me from public.people where id = v_me.id and deleted_at is null;
    if not found then
      raise exception 'not_registered';
    end if;
    -- 코드 계정에 이미 사람이 있으면(다른 어른이 먼저 연결했거나 어른으로 가입한 계정) 연결하지 않는다
    if exists (select 1 from public.people where auth_user_id = v_code.auth_user_id and deleted_at is null) then
      raise exception 'already_registered';
    end if;
    begin
      insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at, consent_version)
      values (v_name, v_me.family_id, v_code.auth_user_id, true, v_me.id, now(), v_consent)
      returning * into v_target;
    exception when unique_violation then
      -- people_auth_user_id_key: 코드 행 잠금을 우회한 동시 연결(이론상) → 약속된 코드로
      raise exception 'already_registered';
    end;
  else
    -- 옮길 사람을 먼저 찾는다 (id 를 알아야 호출자 행과 함께 id 순으로 잠글 수 있다)
    select id into v_target_id from public.people
     where auth_user_id = v_code.auth_user_id and deleted_at is null and is_minor = false;
    if not found then
      raise exception 'invalid_code';
    end if;
    -- ② 쓸 사람 행을 한 문장에서 id 순으로 잠근다 (LockRows 가 Sort 위에 있어 정렬된 순서로 잠근다).
    --    A·B 가 서로의 어른 코드를 동시에 흡수해도 두 세션이 같은 순서로 기다리므로 교착하지 않는다.
    perform 1 from public.people where id in (v_me.id, v_target_id) order by id for update;
    -- 잠근 뒤 다시 읽는다: 기다리는 동안 내가·대상이 탈퇴하거나 다른 가족으로 옮겨졌을 수 있다.
    select * into v_me from public.people where id = v_me.id and deleted_at is null;
    if not found then
      raise exception 'not_registered';
    end if;
    if v_me.is_minor then
      raise exception 'not_adult';
    end if;
    select * into v_target from public.people
     where id = v_target_id and deleted_at is null and is_minor = false
       and auth_user_id = v_code.auth_user_id;
    if not found then
      raise exception 'invalid_code';
    end if;

    if v_target.family_id <> v_me.family_id then
      v_old_family := v_target.family_id;
      -- ② 함께 옮길 자녀 행도 id 순으로 잠근다 (옮기는 사이 그 자녀의 use_ticket·이동이 끼어들지 못하게)
      perform 1 from public.people
       where guardian_id = v_target.id and is_minor and deleted_at is null and family_id = v_old_family
       order by id for update;
      -- ③ 가족 잠금은 가족 id 순으로. 두 가족이 서로를 동시에 흡수해도 같은 순서로 잡는다.
      perform public.lock_family(least(v_old_family, v_me.family_id));
      perform public.lock_family(greatest(v_old_family, v_me.family_id));
      -- ④ use_ticket 이 아직 건드릴 수 있는 식사(서울 오늘 이후)만 잠근다. 지난 식사는 당일 규칙 때문에 쓸 수 없으니
      --    가족의 과거 장부 전체를 잠글 필요가 없다 (오래된 가족일수록 잠금 수가 끝없이 늘어난다).
      for v_meal in
        select i.meal_id from public.issuances i join public.meals m on m.id = i.meal_id
         where i.family_id = v_old_family and m.served_on >= (now() at time zone 'Asia/Seoul')::date
        union
        select u.meal_id from public.usages u join public.meals m on m.id = u.meal_id
         where u.family_id = v_old_family and m.served_on >= (now() at time zone 'Asia/Seoul')::date
        order by 1
      loop
        perform public.lock_family_meal(v_old_family, v_meal);
      end loop;
      -- 대상과 그 자녀를 옮긴다. 자녀는 "옛 가족에 사는" 자녀만 — 보호자가 같아도 다른 가족에 사는 자녀는 그대로 둔다.
      update public.people set family_id = v_me.family_id
       where deleted_at is null and family_id = v_old_family
         and (id = v_target.id or (guardian_id = v_target.id and is_minor));
      if not exists (select 1 from public.people where family_id = v_old_family and deleted_at is null) then
        update public.issuances set family_id = v_me.family_id where family_id = v_old_family;
        update public.usages set family_id = v_me.family_id where family_id = v_old_family;
        -- 참조가 하나도 남지 않았을 때만 지운다 (cleanup_empty_families 와 같은 조건). 익명화된 옛 구성원 행이나
        -- 방금 커밋된 장부가 남아 있으면 FK 원시 오류(23503) 대신 빈 껍데기로 남긴다 — 정리 작업이 나중에 치운다.
        delete from public.families f
         where f.id = v_old_family
           and not exists (select 1 from public.people p where p.family_id = f.id)
           and not exists (select 1 from public.issuances i where i.family_id = f.id)
           and not exists (select 1 from public.usages u where u.family_id = f.id);
      end if;
      select * into v_target from public.people where id = v_target.id;
    end if;
  end if;

  update public.pairing_codes set used_at = now() where code = v_code.code;
  return v_target;
end
$$;

comment on function public.add_family_member(text, text, text) is '자녀 추가(child 코드·법정대리인 동의 버전) / 어른 합류(adult 코드, 빈 가족의 장부는 함께 이동). 재시도는 멱등. 오류 코드는 파일 헤더 참고.';
revoke execute on function public.add_family_member(text, text, text) from public, anon;
grant execute on function public.add_family_member(text, text, text) to authenticated;

-- =========================================================
-- 자녀 재연결: 폰을 바꾼 자녀의 계정을 새 폰의 코드 계정으로 교체한다. 보호자만.
-- 옛 계정은 사람 행을 잃어 다음 접속 때 가입 화면부터 다시 시작한다(옛 폰 접근 차단). 익명이면 하루 뒤 정리된다.
-- 가족·보호자·미성년 여부는 그대로 두고 계정만 바꾼다 (장부도 움직이지 않는다).
-- 잠금 순서: ① 코드 행 → ② 자녀 사람 행 (파일 머리의 규칙). 자녀 행을 먼저 잠그면 add_family_member 와
--   잠금 종류 순서가 뒤집혀 교착한다 (그쪽은 코드 행을 쥐고 자녀 행을 기다린다). 가족 잠금은 쓰지 않는다.
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
  -- add_family_member 와 같은 규칙: 붙여 넣은 코드의 줄바꿈·NBSP 를 지운다
  v_code_text text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
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

  -- ① 코드 행부터 잠근다 (사람 행보다 먼저 — 파일 머리의 잠금 규칙).
  select * into v_code from public.pairing_codes where code = v_code_text for update;
  if not found or v_code.kind <> 'child' or v_code.used_at is not null or v_code.expires_at < now()
     or v_code.auth_user_id = auth.uid() then
    raise exception 'invalid_code';
  end if;
  -- 코드 행은 auth.users 에 on delete cascade 로 묶여 있어 보통 이 분기에 닿지 않는다 (방어선으로 남긴다)
  if not exists (select 1 from auth.users u where u.id = v_code.auth_user_id) then
    raise exception 'invalid_code';
  end if;
  if exists (select 1 from public.people where auth_user_id = v_code.auth_user_id and deleted_at is null) then
    raise exception 'already_registered';
  end if;

  -- ② 그다음 자녀 사람 행 (쓰는 행은 이 하나뿐이라 id 정렬은 필요 없다)
  select * into v_child from public.people
   where id = p_child_id and guardian_id = v_me.id and is_minor and deleted_at is null
     for update;
  if not found then
    raise exception 'child_not_found';
  end if;

  begin
    update public.people set auth_user_id = v_code.auth_user_id where id = v_child.id returning * into v_child;
  exception when unique_violation then
    -- people_auth_user_id_key: 코드 화면에 머문 아이 폰이 그 사이 claim_person 으로 어른 가입을 마쳤다
    -- (위의 already_registered 검사는 상대가 커밋하기 전에 지나갔다) → 원시 23505 대신 약속된 코드로
    raise exception 'already_registered';
  end;
  update public.pairing_codes set used_at = now() where code = v_code.code;
  return v_child;
end
$$;

comment on function public.relink_child(uuid, text) is '자녀 계정을 새 폰의 코드 계정으로 교체(가족·보호자는 그대로). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.relink_child(uuid, text) from public, anon;
grant execute on function public.relink_child(uuid, text) to authenticated;

-- =========================================================
-- 발급과 가족 이동의 경합 닫기: 20261008000003 의 issue_tickets 와 같은 함수인데, 사람 행을 읽을 때 for update 를 더한다.
--   관리자가 어떤 사람에게 발급하는 사이 그 사람이 add_family_member 로 다른 가족에 합쳐지면,
--   발급이 "방금 떠난" 옛 가족의 장부에 꽂혀 양쪽 잔량이 모두 어긋난다 (옛 가족은 비어 정리되고, 새 가족은 못 받는다).
--   합치는 쪽이 대상 사람 행을 잠그므로, for update 가 있으면 발급은 이동이 끝날 때까지 기다린 뒤
--   "새" family_id 를 읽는다. 시그니처·오류 코드·권한은 그대로다 (080 pgTAP 는 그대로 통과한다).
--   ※ 본문을 바꿀 때는 20261008000003_issue_tickets.sql 과 이 블록을 함께 바꾼다 (한쪽만 고치면 조용히 어긋난다).
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
  -- for update: 가족 이동 중이면 끝날 때까지 기다리고 새 family_id 를 읽는다 (이 파일 헤더 참고).
  select family_id, is_minor into v_family, v_is_minor from public.people where id = p_person_id and deleted_at is null for update;
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

comment on function public.issue_tickets(uuid, uuid, integer, integer, text) is '관리자 발급(사람 행 for update — 가족 이동과의 경합 차단). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.issue_tickets(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.issue_tickets(uuid, uuid, integer, integer, text) to authenticated;
