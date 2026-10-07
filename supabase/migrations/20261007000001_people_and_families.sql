-- =========================================================
-- 가족 · 사람
-- =========================================================
create table public.families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- 전화번호: 숫자만 남긴다. 빈 문자열은 null. 국제 표기(+82 10…)는 국내 표기(010…)로 바꾼다.
create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when d is null then null
    when d ~ '^82(1[0-9]{8,9})$' then '0' || substring(d from 3)
    else d
  end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')) as t(d)
$$;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  name text not null check (char_length(name) between 1 and 20),
  phone text check (phone ~ '^01[0-9]{8,9}$'),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'member' check (role in ('member', 'admin')),
  is_minor boolean not null default false,
  guardian_id uuid references public.people(id),
  consented_at timestamptz,
  consent_version text,
  guardian_consented_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 미성년자는 보호자와 보호자 동의가 반드시 있어야 한다
  constraint people_minor_requires_guardian
    check (is_minor = false or (guardian_id is not null and guardian_consented_at is not null)),
  -- 계정이 연결된 어른은 본인 동의가 있어야 한다 (선발급자는 계정이 없으므로 예외)
  constraint people_adult_requires_consent
    check (is_minor = true or auth_user_id is null or deleted_at is not null or consented_at is not null)
);

create unique index people_phone_unique
  on public.people (phone)
  where phone is not null and deleted_at is null;
create index people_family_idx on public.people (family_id);
-- auth_user_id 는 unique 제약이 이미 인덱스를 만든다 (people_auth_user_id_key).
create index people_guardian_idx on public.people (guardian_id);

-- insert: 가족이 없으면 1인 가족 생성 / insert·update: 번호 정규화, updated_at 갱신
-- security definer: 관리자가 authenticated 역할로 사람을 insert할 때도 families에 쓸 수 있어야 한다
create or replace function public.people_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.family_id is null then
    insert into public.families default values returning id into new.family_id;
  end if;
  new.phone := public.normalize_phone(new.phone);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end
$$;

create trigger people_before_write
  before insert or update on public.people
  for each row execute function public.people_before_write();

-- =========================================================
-- 현재 사용자 헬퍼 (RLS 정책에서 사용. security definer로 재귀 RLS 회피)
-- =========================================================
create or replace function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.people
   where auth_user_id = auth.uid() and deleted_at is null
   limit 1
$$;

create or replace function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.people
   where auth_user_id = auth.uid() and deleted_at is null
   limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.people
     where auth_user_id = auth.uid() and role = 'admin' and deleted_at is null
  )
$$;

revoke execute on function public.current_person_id(), public.current_family_id(), public.is_admin() from public;
grant execute on function public.current_person_id(), public.current_family_id(), public.is_admin() to authenticated, anon;

-- =========================================================
-- 기본 차단: RLS 켜고 API 역할 권한 회수. 정책과 세부 권한은 다음 마이그레이션(RLS)에서 부여한다.
-- =========================================================
alter table public.families enable row level security;
alter table public.people enable row level security;
revoke all on public.families from anon, authenticated;
revoke all on public.people from anon, authenticated;
