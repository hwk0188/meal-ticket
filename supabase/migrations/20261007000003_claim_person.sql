-- =========================================================
-- RPC 규약 (모든 SECURITY DEFINER 함수 공통)
--   오류: raise exception '<snake_case 코드>' — 메시지는 코드 문자열만. 값 보간(%) 금지.
--         PostgREST 가 {"code":"P0001","message":"<코드>"} + HTTP 400 으로 내보내고 프론트가 문구로 바꾼다.
--         DB 원시 오류(23503·23505 등)가 그대로 새어 나가면 규약 위반 — 알려진 실패는 전부 코드로 번역한다.
--   멱등: 같은 호출자의 재시도는 성공으로 본다. 가능하면 기존 행을 그대로 반환하고,
--         반환할 수 없을 때만 already_registered 로 알린다 (프론트는 성공으로 처리).
--   보안: security definer + set search_path = public, pg_temp. 모든 객체는 스키마 한정.
--         revoke execute … from public, anon (auto_expose_new_tables=true 대응) 후 필요한 역할에만 grant.
--   반환: returns public.<table> 은 그 테이블의 모든 열을 호출자에게 노출한다 (RLS·열 권한 적용 안 됨).
--         민감한 열을 추가할 때는 반환형을 좁힌다.
-- =========================================================
-- 어른 가입: 카카오(또는 이메일) 로그인 직후 이름·번호·동의를 받아 사람 행을 만들거나 선발급 행에 연결한다.
-- claim_person 코드: not_authenticated | anonymous_cannot_claim | invalid_phone | invalid_name
--                    consent_required | already_registered | phone_taken
-- TODO(후속 단계): 무차별 대입 완화 — phone_taken 경로에서 claim_attempts(auth_user_id, attempted_at) 에 기록하고
--                 최근 N회 초과 시 거부. 1단계는 이름+번호 일치로만 방어한다.
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
  -- 표시용 이름은 공백을 살리고 NFC 로만 맞춘다. 비교는 공백까지 무시하는 v_name_key 로 한다.
  v_name text := normalize(btrim(coalesce(p_name, '')), NFC);
  v_name_key text := public.normalize_name(p_name);
  v_consent text := btrim(coalesce(p_consent_version, ''));
  v_is_anonymous boolean;
  v_person public.people;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select is_anonymous into v_is_anonymous from auth.users where id = v_uid;
  if not found then
    -- 토큰은 유효하지만 계정이 지워졌다. FK 원시 오류(23503) 대신 약속된 코드로 바꾼다.
    raise exception 'not_authenticated';
  end if;
  if v_is_anonymous then
    raise exception 'anonymous_cannot_claim';
  end if;

  -- 형식 검사보다 먼저 본다. 이미 가입한 사람이 번호를 잘못 적었을 때 invalid_phone 대신
  -- 더 도움이 되는 already_registered 를 받게 한다. 행 잠금 전이라 순차 재시도만 잡는다 (동시 요청은 아래 두 곳).
  if exists (select 1 from public.people where auth_user_id = v_uid and deleted_at is null) then
    raise exception 'already_registered';
  end if;

  if v_phone is null or not public.is_valid_mobile(v_phone) then
    raise exception 'invalid_phone';
  end if;
  if v_name_key is null or char_length(v_name) not between 1 and 20 then
    raise exception 'invalid_name';
  end if;
  -- 동의 버전은 공개된 날짜(YYYY-MM-DD)만 받는다. 아무 문자열이나 법적 동의 기록으로 남지 않게 한다.
  if v_consent !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'consent_required';
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
    if v_person.auth_user_id is not null or v_person.is_minor
       or public.normalize_name(v_person.name) <> v_name_key then
      raise exception 'phone_taken';
    end if;
    -- auth_user_id 와 consented_at 은 같은 문장에서 넣어야 people_adult_requires_consent 를 통과한다
    update public.people
       set auth_user_id = v_uid,
           consented_at = now(),
           consent_version = v_consent
     where id = v_person.id
     returning * into v_person;
  else
    -- 번호가 아직 없을 때는 잠글 행이 없어서 동시 insert 를 막을 수 없다. 부분 유일 인덱스가
    -- 중재하므로, 그 충돌을 원시 23505 대신 약속된 코드 문자열로 바꿔 준다.
    begin
      insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
      values (v_name, v_phone, v_uid, now(), v_consent)
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

comment on function public.claim_person(text, text, text) is '어른 가입: 선발급 행 연결 또는 새 사람 생성. 오류 코드는 파일 헤더 참고.';

-- auto_expose_new_tables=true 는 ALTER DEFAULT PRIVILEGES 로 새 함수에 anon=X 를 자동으로 붙인다.
-- 그래서 grant 목록에서 anon 을 빼는 것만으로는 부족하고, anon 에서 명시적으로 revoke 해야 한다.
revoke execute on function public.claim_person(text, text, text) from public, anon;
grant execute on function public.claim_person(text, text, text) to authenticated;
