-- RLS 활성화와 권한 회수는 앞 마이그레이션(테이블 생성)에서 이미 했다. 여기서는 필요한 권한과 정책만 부여한다.
grant select on public.families to authenticated;
grant select on public.people to authenticated;
-- 본인 수정은 이름·전화만, 관리자 선발급 입력도 이름·전화만 (나머지 열은 함수로만 바꾼다)
grant update (name, phone) on public.people to authenticated;
grant insert (name, phone) on public.people to authenticated;

-- 정책 안의 함수 호출은 (select …) 로 감싼다. 감싸지 않으면 행마다 함수를 다시 실행해
-- 2만 행 기준 253ms vs 1.7ms 차이가 난다 (InitPlan 으로 한 번만 평가됨). 이후 모든 테이블에 같은 규칙.
create policy families_select_own_or_admin on public.families
  for select to authenticated
  using (id = (select public.current_family_id()) or (select public.is_admin()));

-- people
create policy people_select_family_or_admin on public.people
  for select to authenticated
  using (
    (family_id = (select public.current_family_id()) and deleted_at is null)
    or (select public.is_admin())
  );

create policy people_update_self on public.people
  for update to authenticated
  using (auth_user_id = (select auth.uid()) and deleted_at is null)
  with check (auth_user_id = (select auth.uid()));

create policy people_insert_admin on public.people
  for insert to authenticated
  with check ((select public.is_admin()));

create policy people_update_admin on public.people
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
