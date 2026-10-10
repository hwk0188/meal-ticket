# 교회 식권

교회 주일 식사 식권의 발급·사용·관리를 모바일 웹에서 처리하는 서비스.
설계: `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md` · 구현 계획: `docs/superpowers/plans/`

## 로컬 개발

필요: Node 20.19 이상(`.nvmrc` 참고. CI는 Node 22), Docker Desktop.

```bash
npm install
npm run db:start           # 로컬 Supabase (처음 1~3분)
npx supabase status -o env # API_URL, PUBLISHABLE_KEY 확인 → .env.local 에 기입 (.env.example 참고)
npm run dev                # http://localhost:5173
```

로컬은 카카오 대신 **개발용 이메일 로그인**을 쓴다(`VITE_ENABLE_DEV_LOGIN=true`). 개발 서버(`npm run dev`)에서만 보이고, `npm run preview`와 운영 번들에는 코드 자체가 없다.

| 명령 | 설명 |
|---|---|
| `npm test` / `npm run test:coverage` | 단위·컴포넌트 테스트 (Vitest) |
| `npm run db:test` | DB 함수·RLS 테스트 (pgTAP) |
| `npm run e2e` | Playwright 스모크 (로컬 Supabase 필요) |
| `npm run db:reset` | 마이그레이션·시드 재적용 |
| `npm run db:types` | DB 타입 재생성 (`src/lib/database.types.ts`) |
| `npx supabase migration new <이름>` | 새 마이그레이션 파일 |

- 로컬 관리자 계정: `e2e-admin@test.local / password123` (`supabase/seeds/010_e2e_admin.sql`, 운영에는 없음 — `db push` 는 마이그레이션만 올린다). 개발 로그인 폼에 넣으면 하단 "관리" 탭이 보인다.
- 마이그레이션을 추가하면 `npm run db:reset && npm run db:types` 로 타입을 다시 만들어 커밋한다. 새 함수는 반드시 `revoke execute … from public, anon` (auto_expose_new_tables 때문; pgTAP 020 이 잡는다).
- E2E 는 로컬 Supabase 한 DB 를 공유하므로 단일 워커로 직렬 실행한다 (`playwright.config.ts` `workers: 1`).
- 아이 계정(익명 로그인)은 로컬 `config.toml` 에서 이미 켜져 있다(`enable_anonymous_sign_ins = true`). E2E `family.spec.ts` 가 쓴다.
- E2E 는 실행마다 오늘 식사·사람·가족·아이 계정을 남긴다(정리 작업은 연결된 자녀와 장부 있는 가족을 지우지 않는다). 홈이 식사 카드로 붐비면 `npm run db:reset`. 로컬 Auth 속도 제한(5분당 가입·로그인 30회, 시간당 익명 30회 — `config.toml` `[auth.rate_limit]`)에 걸리면 429 가 테스트 실패처럼 보이니 연속 실행은 5분에 세 번 안쪽으로.
- pg_cron 정리 작업 3건(`cleanup_pairing_codes` 매시간, `cleanup_orphan_anonymous_users`·`cleanup_empty_families` 매일 03:15/03:30 KST)은 마이그레이션이 확장을 켜고 `cron.schedule` 로 등록한다. 로컬에서도 돈다. 상태는 `select jobname, schedule, active from cron.job;` 과 `select * from cron.job_run_details order by start_time desc limit 20;`. **Supabase 공식 문서의 `grant usage on schema cron to postgres; grant all privileges on all tables in schema cron to postgres;` 스니펫은 실행하지 말 것** — supautils 가 이미 권한을 주며, 그 grant 가 남아 있으면 이후 `create extension pg_cron` 이 2BP01 로 실패한다(마이그레이션이 그런 grant 를 먼저 거둔다).

## 운영 설정 (최초 1회)

### 1. Supabase 프로젝트 (Free)

1. https://supabase.com 에서 프로젝트 생성 (리전: **Northeast Asia (Seoul)** — 처리방침이 "국내(서울) 리전 보관"을 명시하므로 다른 리전을 고르면 안 된다). DB 비밀번호를 안전한 곳에 보관.
2. **Authentication › URL Configuration**
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: 같은 주소 추가.
3. **Authentication › Sign In / Providers**
   - Email: 운영에서는 **끄기** (개발용 로그인은 운영 빌드에 없다. 켜 두면 카카오 없이 이메일로 자가 가입이 가능해진다).
   - Anonymous sign-ins: **켜기** (3단계 아이 계정 — 켜지 않으면 "아이 계정으로 시작하기" 가 "아이 계정 시작이 꺼져 있어요. 권사님께 문의해 주세요." 로 실패한다). 익명 가입 속도 제한은 기본값(IP 당 시간 30회)으로 둔다. 캡차는 붙이지 않는다(무료지만 UI 가 복잡해진다).
   - Kakao: **켜기**. 아래 카카오 콘솔에서 받은 REST API 키를 Client ID에, Client Secret 코드를 Secret에 입력. **"Allow users without an email"을 켠다.**
   - Kakao 설정 화면에 표시되는 Callback URL(`https://<ref>.supabase.co/auth/v1/callback`)을 복사해 둔다.
4. **Project Settings › API Keys**: Project URL과 **Publishable key**(`sb_publishable_…`)를 복사해 둔다. 레거시 anon JWT는 쓰지 않는다.
5. **Project Settings › General**: Reference ID(`<ref>`)를 복사해 둔다.
6. **Account › Access Tokens**에서 CI용 토큰을 하나 만든다.

### 2. 카카오 개발자 콘솔

1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가. 앱 이름은 `src/config/church.ts` 의 appName 과 같게(현재 `새기쁨교회 모바일 식권`), 회사명 교회명. 카카오 동의 화면에는 콘솔의 앱 이름이 보인다.
2. **앱 › 일반 › 비즈니스 정보**: **개인 개발자 비즈 앱 전환**(무료, 사업자번호 불필요). Supabase 가 카카오에 `account_email` scope 를 항상 요청하기 때문에, 이메일 동의항목을 등록할 수 있는 비즈 앱이어야 로그인이 된다(아니면 KOE205 오류).
3. Web 플랫폼(사이트 도메인) 등록은 **필요 없다**. 카카오 인증은 Supabase 서버가 REST API 키로 처리하므로 JavaScript 키·SDK 도메인을 쓰지 않는다. (개편된 콘솔에는 "앱 설정/제품 설정" 묶음이 없고, 좌측 메뉴가 **앱**, **카카오 로그인** 등으로 나뉜다.)
4. **카카오 로그인 › 사용 설정**: 활성화 ON. OpenID Connect 는 OFF.
   리다이렉트 URI는 **앱 › 플랫폼 키 › REST API 키**의 "카카오 로그인 리다이렉트 URI"에 Supabase Callback URL(`https://<project-ref>.supabase.co/auth/v1/callback`)을 등록하고 **저장**. 리다이렉트 URI는 **키별로 따로** 관리되므로 JavaScript 키 쪽에 넣으면 KOE006(등록되지 않은 리다이렉트 URI)이 난다. Supabase 는 REST API 키를 client_id 로 쓴다.
   ※ 카카오는 리다이렉트 URI·동의항목 검사를 **사용자가 카카오 로그인을 마친 뒤**에 하므로, 로그인 없이 authorize 주소만 열어 보는 방식으로는 설정 오류를 미리 잡을 수 없다. 실제 로그인으로만 확인된다.
5. **카카오 로그인 › 동의항목**: 닉네임(profile_nickname)·프로필 사진(profile_image)·카카오계정 이메일(account_email) 세 항목을 모두 **선택 동의**로 켠다(앱은 세 값을 쓰지 않으며, 회원번호만 계정 키로 쓴다). "사용 안 함"인 항목이 있으면 Supabase 가 그 scope 를 요청하다가 KOE205 오류가 난다. 교인이 세 항목을 모두 거부해도 로그인된다.
6. **앱 › 플랫폼 키 › REST API 키 › 클라이언트 시크릿**: 코드 생성 후 **활성화 ON**, 저장.
7. **앱 › 플랫폼 키 › REST API 키** 값과 위 클라이언트 시크릿을 Supabase Kakao provider의 Client ID / Client Secret에 입력. Supabase 쪽 **"Allow users without an email"** 을 켠다(이메일을 거부한 교인도 가입 가능).
8. 운영 전까지는 콘솔에서 **팀원**으로 교회 담당자 계정을 추가해 둔다.

### 3. GitHub 저장소

1. 공개 저장소로 push. **Settings › Pages › Build and deployment › Source: GitHub Actions**.
2. **Settings › Secrets and variables › Actions** — 반드시 **저장소(Repository) 수준**에 만든다. 환경(Environment) 수준에 넣으면 다른 환경에서 도는 배포 잡이 읽지 못해 "변수가 비어 있습니다"로 실패한다.
   - Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`(프로젝트 생성 때 정한 **Postgres DB 비밀번호**. 액세스 토큰이 아니다 — 틀리면 `supabase db push` 가 비밀번호 프롬프트로 빠져 러너에서 멈춘다), `SUPABASE_PROJECT_REF`(비어 있으면 `db push --project-ref` 가 바로 실패한다)
3. **Settings › Environments**: `production` 생성(첫 배포 때 `github-pages` 도 자동 생성된다). 두 환경 모두 **Deployment branches 를 `main` 만 허용**으로 제한한다(워크플로도 main 외 ref 에서는 배포 잡을 건너뛰지만, 환경 설정이 두 번째 잠금이다). 승인자를 지정하면 main 에 push 할 때마다 마이그레이션 단계에서 승인을 기다리므로(그 뒤 Pages 배포도 멈춤) 운영 초기에는 비워 두는 편이 낫다.
4. main에 push하면 `Deploy` 워크플로가 테스트 → 마이그레이션 → 배포를 수행한다. 배포 경로(`/<repo>/` 또는 사용자 루트 사이트의 `/`)는 Pages 설정에서 자동으로 계산되므로 따로 적지 않는다.

### 4. 최초 관리자 지정

관리자가 될 분이 먼저 앱에서 카카오로 가입한다. 그 뒤 Supabase **SQL Editor**에서:

```sql
update public.people set role = 'admin' where phone = '01012345678' and deleted_at is null;
```

### 5. 운영 체크리스트

- `Keep alive` 워크플로가 2일마다 돌아 무료 플랜의 7일 일시정지를 막는다(스케줄 실행이 한 번 빠져도 여유가 있다). 저장소에 60일간 커밋이 없으면 GitHub가 스케줄을 끄므로 Actions 탭에서 다시 켠다.
- 일시정지되면 Supabase 대시보드에서 "Restore"를 누른다(1~2분).
- 백업(주 1회 pg_dump → 비공개 저장소)은 5단계 계획에서 추가한다.
- `src/config/church.ts`의 교회명·담당자 연락처(`privacyOfficer.name`, `phone` — 지금은 빈 문자열)를 실제 값으로 바꾼 뒤 배포한다. 처리방침의 담당자 연락처는 법적 필수 항목이다.
- `index.html`의 `<title>`도 같은 앱 이름으로 맞춘다 (TS 설정을 읽지 못하므로 수동 편집).
- 운영 Supabase 의 **Email provider 는 반드시 끈다**. 개발용 로그인 코드는 운영 번들에서 제거되지만 서버 쪽 차단이 진짜 경계다.
- Supabase **Redirect URLs** 에 GitHub Pages 주소(`https://<github-user>.github.io/<repo>/`)가 등록되어 있는지 확인한다.
- 3단계 배포 뒤 Supabase **Authentication › Sign In / Providers › Anonymous** 가 켜져 있는지 확인한다. pg_cron 은 마이그레이션이 켠다 — 콘솔에서 미리 켜지 말고, 특히 공식 문서의 `grant … on schema cron to postgres` 스니펫은 실행하지 않는다. 확인은 SQL Editor 에서 `select jobname, schedule, active from cron.job;`(3건) 과 `select * from cron.job_run_details order by start_time desc limit 10;` 로 한다(Integrations › Cron 화면은 대시보드 통합을 켰을 때만 보이고, 작업은 그와 무관하게 돈다).
- **자녀 삭제는 보호자 본인만** 가족 탭에서 한다. 관리자 화면에는 자녀를 지우는 길이 **없다** — `admin_reset_person` 은 미성년자를 거부하고(`minor_not_allowed`), 사람 상세에서도 자녀에게는 정정 구역이 아예 안 보인다. 보호자가 요청하면 가족 탭의 위치를 안내해 드린다. SQL 로 직접 고치지 않는다.
- **어른이 잘못 가입한 경우**의 정정은 **관리 › 사람 › 그 사람 › 사람 초기화** 를 쓴다(이름·번호를 지우고 카카오 연결을 끊되 발급·사용 기록은 남는다). 연결된 자녀가 있으면 거부되므로, 보호자가 먼저 자녀를 지워야 한다.
- 같은 사람이 두 줄로 들어갔으면(선발급 뒤 이름을 달리 적어 가입한 경우 등) **관리 › 사람 › 남길 사람 › 중복 사람 합치기** 로 합친다. 고른 쪽이 익명 처리되고 기록·자녀·계정·관리자 권한이 남길 쪽으로 옮겨진다. 되돌릴 수 없으니 확인 문구의 두 번호를 꼭 읽는다.
- 발급 실수 정정은 **관리 › 식사 › 현황** 에서 한다: 발급 취소(가족 남은 장수 안에서만 — 이미 쓴 장수가 있으면 먼저 "무효" 로 되돌린다), 담당자 "1장 대신 사용", 사용 "무효". 모두 기록이 남고 지워지지 않는다. SQL 로 직접 고치지 않는다.

### 6. 절대 운영에 실행하면 안 되는 명령

- `supabase db reset --linked` — 운영 DB를 비우고 테스트용 시드(가짜 사용자 생성 헬퍼)를 넣는다.
- `supabase db push --include-seed` — 시드를 운영에 적용한다. CI는 `supabase db push --project-ref <ref> --yes` 만 쓴다(`--include-seed` 없음).
- `supabase config push` — 로컬 `config.toml`(localhost 주소, 카카오 없음)로 운영 Auth 설정을 덮어쓴다.
- Supabase 공식 문서의 `grant usage on schema cron to postgres; grant all privileges on all tables in schema cron to postgres;` — supautils 가 이미 권한을 주며, 이 grant 가 남으면 이후 `create extension pg_cron` 이 2BP01 로 실패해 `db push` 가 깨진다.
