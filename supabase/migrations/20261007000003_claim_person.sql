-- 어른 가입: 카카오(또는 이메일) 로그인 직후 이름·번호·동의를 받아 사람 행을 만들거나 선발급 행에 연결한다.
-- 오류는 message에 코드 문자열을 담는다. 프론트가 사용자 문구로 바꾼다.
-- 무차별 대입 완화(실패 횟수 제한)는 후속 단계 과제. 1단계는 이름+번호 일치로만 방어한다.
create or replace function public.claim_person(
  p_name text,
  p_phone text,
  p_consent_version text
)
returns public.people
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := public.normalize_phone(p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_person public.people;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce((select is_anonymous from auth.users where id = v_uid), false) then
    raise exception 'anonymous_cannot_claim';
  end if;
  if v_phone is null or v_phone !~ '^01[0-9]{8,9}$' then
    raise exception 'invalid_phone';
  end if;
  if char_length(v_name) not between 1 and 20 then
    raise exception 'invalid_name';
  end if;
  if p_consent_version is null or p_consent_version = '' then
    raise exception 'consent_required';
  end if;

  -- 이 검사는 행 잠금 전에 돌기 때문에 순차 재시도만 잡는다. 동시 요청은 아래 두 곳에서 걸러진다.
  if exists (select 1 from public.people where auth_user_id = v_uid and deleted_at is null) then
    raise exception 'already_registered';
  end if;

  -- 같은 번호의 사람이 있으면 (선발급) 연결. 이미 다른 계정이거나 이름이 다르면 거부.
  -- 이름까지 맞아야 연결되므로, 번호만 대입해 남의 선발급 식권을 가로채는 시도를 막는다.
  select * into v_person
    from public.people
   where phone = v_phone and deleted_at is null
   for update;

  if found then
    -- 같은 사용자의 중복 요청(더블 탭·재시도)은 성공으로 본다. 동시 요청에서 뒤늦게 잠금을 얻은
    -- 쪽이 여기 닿는다 (위의 already_registered 검사는 상대가 커밋하기 전에 지나갔다).
    if v_person.auth_user_id = v_uid then
      return v_person;
    end if;
    if v_person.auth_user_id is not null or v_person.is_minor or btrim(v_person.name) <> v_name then
      raise exception 'phone_taken';
    end if;
    -- auth_user_id 와 consented_at 은 같은 문장에서 넣어야 people_adult_requires_consent 를 통과한다
    update public.people
       set auth_user_id = v_uid,
           consented_at = now(),
           consent_version = p_consent_version
     where id = v_person.id
     returning * into v_person;
  else
    -- 번호가 아직 없을 때는 잠글 행이 없어서 동시 insert 를 막을 수 없다. 부분 유일 인덱스가
    -- 중재하므로, 그 충돌을 원시 23505 대신 약속된 코드 문자열로 바꿔 준다.
    begin
      insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
      values (v_name, v_phone, v_uid, now(), p_consent_version)
      returning * into v_person;
    exception when unique_violation then
      -- people_auth_user_id_key 충돌: 같은 사용자가 동시에 두 번 보냈다 → 먼저 만들어진 자기 행을 돌려준다.
      select * into v_person
        from public.people
       where auth_user_id = v_uid and deleted_at is null;
      if found then
        return v_person;
      end if;
      -- people_phone_unique 충돌: 같은 번호로 가입한 다른 사용자가 먼저 들어갔다.
      raise exception 'phone_taken';
    end;
  end if;

  return v_person;
end
$$;

-- auto_expose_new_tables=true 는 ALTER DEFAULT PRIVILEGES 로 새 함수에 anon=X 를 자동으로 붙인다.
-- 그래서 grant 목록에서 anon 을 빼는 것만으로는 부족하고, anon 에서 명시적으로 revoke 해야 한다.
revoke execute on function public.claim_person(text, text, text) from public, anon;
grant execute on function public.claim_person(text, text, text) to authenticated;
