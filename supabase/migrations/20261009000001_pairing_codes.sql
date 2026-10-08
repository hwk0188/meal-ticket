-- =========================================================
-- 연결 코드: 아이 폰(또는 합류할 어른 폰)에 뜨는 8자리 1회용 코드. 10분. 함수로만 읽고 쓴다 (정책 없음).
-- 왜 8자리인가: 어른 코드를 한 번 맞히면 그 가족과 장부, 가려지지 않은 전화번호가 공격자 가족으로 통째로 합쳐진다 (피해 범위가 크다).
--   호출 횟수 제한이 아직 없어 방어는 추측 공간뿐이다 — 10분 창 × 10^8 가지로 6자리(10^6)보다 100배 비싸게 만든다.
-- =========================================================
-- 코드 난수는 pgcrypto 의 gen_random_bytes 로 뽑는다. Supabase 는 기본으로 켜 두지만 명시해 로컬·운영을 같게 한다.
create extension if not exists pgcrypto with schema extensions;
-- pgcrypto 가 다른 스키마에 이미 있으면 위 문장은 조용히 넘어간다. 함수는 실행 시점에야 extensions.gen_random_bytes 를 찾으므로 여기서 미리 확인한다.
do $$ begin perform extensions.gen_random_bytes(1); end $$;

create table public.pairing_codes (
  code text primary key check (code ~ '^[0-9]{8}$'),
  auth_user_id uuid not null references auth.users(id) on delete cascade, -- 코드를 띄운 폰의 계정
  kind text not null check (kind in ('child', 'adult')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index pairing_codes_auth_user_idx on public.pairing_codes (auth_user_id);

-- 기본 차단. 정책을 하나도 두지 않으므로 API 역할은 직접 읽지도 쓰지도 못한다 (설계 §7.4).
alter table public.pairing_codes enable row level security;
revoke all on public.pairing_codes from anon, authenticated;

-- =========================================================
-- 가족·식사 잠금 헬퍼. use_ticket 의 pg_advisory_xact_lock(hashtext(family), hashtext(meal)) 과 같은 키.
-- 잔량을 바꾸거나 장부를 옮기는 함수는 이 헬퍼로 잠근다 (4단계에서 use_ticket 도 이 헬퍼로 바꾼다).
-- =========================================================
create or replace function public.lock_family_meal(p_family_id uuid, p_meal_id uuid)
returns void
language sql
set search_path = ''
as $$ select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_family_id::text), pg_catalog.hashtext(p_meal_id::text)) $$;
comment on function public.lock_family_meal(uuid, uuid) is '가족·식사 단위 트랜잭션 advisory lock. use_ticket 과 같은 키.';
revoke execute on function public.lock_family_meal(uuid, uuid) from public, anon, authenticated;

-- =========================================================
-- 연결 코드 발급.
--   child: 사람 행이 없는 계정만 (익명 계정, 또는 카카오 로그인 뒤 "만 14세 미만" 을 고른 계정).
--   adult: 가입을 마친 어른만 (배우자 가족에 합류할 때 보여 주는 코드).
--   같은 계정의 이전 코드는 지운다 (한 폰에 코드는 하나). 동시 호출은 계정 단위 잠금으로 직렬화한다. 만료·사용된 남의 코드 자리는 재활용한다.
-- 코드: not_authenticated | invalid_kind | already_registered | not_registered | not_adult | code_generation_failed
-- =========================================================
create or replace function public.create_pairing_code(p_kind text)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- 반환 열 이름(code, expires_at)이 테이블 열과 같다. 본문은 그 열을 변수로 쓰지 않으므로(v_code·v_expires 를 쓴다)
-- 이름이 겹치는 자리(on conflict (code) 등)는 열로 해석하게 한다.
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_person public.people;
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_kind is null or p_kind not in ('child', 'adult') then
    raise exception 'invalid_kind';
  end if;
  -- 토큰은 유효한데 계정이 지워진 경우: FK 원시 오류(23503) 대신 약속된 코드
  if not exists (select 1 from auth.users u where u.id = v_uid) then
    raise exception 'not_authenticated';
  end if;

  select * into v_person from public.people p where p.auth_user_id = v_uid and p.deleted_at is null;
  if p_kind = 'child' then
    if found then
      raise exception 'already_registered';
    end if;
  else
    if not found then
      raise exception 'not_registered';
    end if;
    if v_person.is_minor then
      raise exception 'not_adult';
    end if;
  end if;

  -- 같은 계정의 동시 호출(연타·느린 네트워크)을 직렬화한다. 단일 키 잠금(objsubid 1)이라 lock_family_meal 의
  -- 두 키 잠금(objsubid 2)과 겹치지 않는다. 트랜잭션이 끝나면 풀린다.
  perform pg_advisory_xact_lock(hashtext('pairing_code:' || v_uid::text));

  delete from public.pairing_codes pc where pc.auth_user_id = v_uid;

  for v_try in 1..10 loop
    -- 암호학적 난수 8바이트 → 0..99999999 (random() 은 예측 가능해 쓰지 않는다).
    -- 부호 비트를 지워(& 2^63-1) 음수를 막는다 — 음수에 % 를 쓰면 '-12345' 같은 값이 나와 형식 제약에 걸린다.
    -- 2^63-1 은 10^8 의 배수가 아니라 modulo 편향이 남지만 10^-11 수준이라 추측 난이도에 영향이 없다.
    v_code := lpad((((('x' || encode(extensions.gen_random_bytes(8), 'hex'))::bit(64)::bigint) & 9223372036854775807) % 100000000)::text, 8, '0');
    -- 살아 있는 남의 코드와 겹치면 where 절이 막아 아무 행도 바뀌지 않는다(found = false) → 다시 뽑는다.
    -- 이 upsert 는 100_pairing_codes.sql 의 재활용 테스트가 그대로 복사해 검증한다. 바꾸면 그쪽도 바꾼다.
    insert into public.pairing_codes as pc (code, auth_user_id, kind, expires_at)
    values (v_code, v_uid, p_kind, v_expires)
    on conflict (code) do update
      set auth_user_id = excluded.auth_user_id, kind = excluded.kind,
          created_at = now(), expires_at = excluded.expires_at, used_at = null
      where pc.used_at is not null or pc.expires_at < now();
    if found then
      return query select v_code, v_expires;
      return;
    end if;
  end loop;
  raise exception 'code_generation_failed';
end
$$;

comment on function public.create_pairing_code(text) is '연결 코드 발급(8자리·10분·1회용). 오류 코드는 파일 헤더 참고.';
revoke execute on function public.create_pairing_code(text) from public, anon;
grant execute on function public.create_pairing_code(text) to authenticated;
