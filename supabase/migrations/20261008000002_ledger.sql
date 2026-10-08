-- =========================================================
-- 장부: 발급(issuances)과 사용(usages)은 지우지 않고 쌓는다.
-- 발급 취소는 cancelled_at, 사용 무효는 voided_at 으로 표시한다 (4단계 함수가 채운다).
-- 쓰기는 함수(issue_tickets, use_ticket …)로만 한다. 그래서 insert/update 정책을 아예 두지 않는다.
-- =========================================================
create table public.issuances (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),   -- 구매자 (통계는 이 사람 이름으로)
  family_id uuid not null references public.families(id), -- 발급 시점 구매자의 가족 (잔량은 가족 단위)
  meal_id uuid not null references public.meals(id),      -- 삭제는 restrict (기본). 발급이 있으면 식사를 못 지운다
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),    -- 원. 이월은 0
  memo text check (memo is null or char_length(memo) <= 100),
  issued_by uuid not null references public.people(id),
  issued_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.people(id),
  cancel_reason text,
  constraint issuances_cancel_consistent check ((cancelled_at is null) = (cancelled_by is null))
);
create index issuances_family_meal_idx on public.issuances (family_id, meal_id);
create index issuances_meal_idx on public.issuances (meal_id);
create index issuances_issued_at_idx on public.issuances (issued_at desc);

create table public.usages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id), -- 차감된 가족
  person_id uuid not null references public.people(id),   -- self: 어느 폰에서 / admin: 누구 몫으로
  meal_id uuid not null references public.meals(id),
  quantity integer not null default 1 check (quantity = 1), -- 낱장 사용
  used_via text not null check (used_via in ('self', 'admin')),
  recorded_by uuid not null references public.people(id), -- self 면 person_id 와 같음, admin 이면 관리자
  request_id uuid not null unique,                         -- 클라이언트 생성. 같은 시도의 재시도는 같은 값
  used_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.people(id),
  constraint usages_void_consistent check ((voided_at is null) = (voided_by is null))
);
create index usages_family_meal_idx on public.usages (family_id, meal_id);
create index usages_meal_idx on public.usages (meal_id);
create index usages_used_at_idx on public.usages (used_at desc);

alter table public.issuances enable row level security;
alter table public.usages enable row level security;
revoke all on public.issuances, public.usages from anon, authenticated;
grant select on public.issuances, public.usages to authenticated;

create policy issuances_select_family_or_admin on public.issuances
  for select to authenticated
  using (family_id = (select public.current_family_id()) or (select public.is_admin()));
create policy usages_select_family_or_admin on public.usages
  for select to authenticated
  using (family_id = (select public.current_family_id()) or (select public.is_admin()));

-- =========================================================
-- 가족·식사별 잔량. security_invoker 라 호출자의 RLS 가 기반 테이블에 그대로 적용된다
-- (교인은 자기 가족 행만, 관리자는 전부).
-- meal_id/family_id 가 coalesce 식이라 PostgREST 는 이 뷰에서 meals 를 임베딩하지 못한다.
-- 프론트는 뷰를 읽은 뒤 meals 를 id 목록으로 따로 읽는다.
-- =========================================================
create view public.ticket_balances with (security_invoker = true) as
with issued as (
  select family_id, meal_id,
         sum(quantity)::integer as issued,
         sum(quantity * unit_price)::integer as amount
    from public.issuances
   where cancelled_at is null
   group by family_id, meal_id
), used as (
  select family_id, meal_id, sum(quantity)::integer as used
    from public.usages
   where voided_at is null
   group by family_id, meal_id
)
select coalesce(i.family_id, u.family_id) as family_id,
       coalesce(i.meal_id, u.meal_id) as meal_id,
       coalesce(i.issued, 0) as issued,
       coalesce(u.used, 0) as used,
       coalesce(i.issued, 0) - coalesce(u.used, 0) as remaining,
       coalesce(i.amount, 0) as amount
  from issued i
  full outer join used u on u.family_id = i.family_id and u.meal_id = i.meal_id;

-- auto_expose_new_tables=true 는 뷰에도 authenticated=arwdDxt 를 자동으로 붙인다.
-- 다른 테이블과 같은 패턴으로 anon·authenticated 둘 다 revoke 한 뒤 select 만 다시 준다.
revoke all on public.ticket_balances from anon, authenticated;
grant select on public.ticket_balances to authenticated;
