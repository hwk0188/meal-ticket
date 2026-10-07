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

## 운영 설정 (최초 1회)

### 1. Supabase 프로젝트 (Free)

1. https://supabase.com 에서 프로젝트 생성 (리전: **Northeast Asia (Seoul)** — 처리방침이 "국내(서울) 리전 보관"을 명시하므로 다른 리전을 고르면 안 된다). DB 비밀번호를 안전한 곳에 보관.
2. **Authentication › URL Configuration**
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: 같은 주소 추가.
3. **Authentication › Sign In / Providers**
   - Email: 운영에서는 **끄기** (개발용 로그인은 운영 빌드에 없다. 켜 두면 카카오 없이 이메일로 자가 가입이 가능해진다).
   - Anonymous sign-ins: **켜기** (3단계 아이 계정용. 미리 켜 두어도 무방).
   - Kakao: **켜기**. 아래 카카오 콘솔에서 받은 REST API 키를 Client ID에, Client Secret 코드를 Secret에 입력. **"Allow users without an email"을 켠다.**
   - Kakao 설정 화면에 표시되는 Callback URL(`https://<ref>.supabase.co/auth/v1/callback`)을 복사해 둔다.
4. **Project Settings › API Keys**: Project URL과 **Publishable key**(`sb_publishable_…`)를 복사해 둔다. 레거시 anon JWT는 쓰지 않는다.
5. **Project Settings › General**: Reference ID(`<ref>`)를 복사해 둔다.
6. **Account › Access Tokens**에서 CI용 토큰을 하나 만든다.

### 2. 카카오 개발자 콘솔

1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가. 앱 이름 `OO교회 식권`, 회사명 교회명.
2. **앱 설정 › 비즈니스**: **개인 개발자 비즈 앱 전환**(무료, 사업자번호 불필요). Supabase 가 카카오에 `account_email` scope 를 항상 요청하기 때문에, 이메일 동의항목을 등록할 수 있는 비즈 앱이어야 로그인이 된다(아니면 KOE205 오류).
3. **앱 설정 › 플랫폼 › Web**: 사이트 도메인 `https://<github-user>.github.io`.
4. **제품 설정 › 카카오 로그인**: 활성화 ON. OpenID Connect 는 OFF. Redirect URI에 Supabase Callback URL 등록.
5. **제품 설정 › 카카오 로그인 › 동의항목**: 닉네임(profile_nickname) 필수 동의, 프로필 사진(profile_image) **선택 동의**, 카카오계정 이메일(account_email) **선택 동의**. 교인이 선택 항목을 거부해도 로그인된다.
6. **제품 설정 › 카카오 로그인 › 보안**: Client Secret 코드 생성, 상태 "사용함".
7. **앱 설정 › 앱 키**의 REST API 키와 위 Client Secret을 Supabase Kakao provider에 입력. Supabase 쪽 **"Allow users without an email"** 을 켠다(이메일을 거부한 교인도 가입 가능).
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
- DB 함수를 프론트에서 호출하게 되면 `npm run db:types` 로 타입을 다시 생성해 커밋한다(`ping` 은 curl 로만 쓰므로 생략).
- `src/config/church.ts`의 교회명·담당자 연락처(`privacyOfficer.name`, `phone` — 지금은 빈 문자열)를 실제 값으로 바꾼 뒤 배포한다. 처리방침의 담당자 연락처는 법적 필수 항목이다.
- `index.html`의 `<title>`도 같은 앱 이름으로 맞춘다 (TS 설정을 읽지 못하므로 수동 편집).
- 운영 Supabase 의 **Email provider 는 반드시 끈다**. 개발용 로그인 코드는 운영 번들에서 제거되지만 서버 쪽 차단이 진짜 경계다.
- Supabase **Redirect URLs** 에 GitHub Pages 주소(`https://<github-user>.github.io/<repo>/`)가 등록되어 있는지 확인한다.

### 6. 절대 운영에 실행하면 안 되는 명령

- `supabase db reset --linked` — 운영 DB를 비우고 테스트용 시드(가짜 사용자 생성 헬퍼)를 넣는다.
- `supabase db push --include-seed` — 시드를 운영에 적용한다. CI는 `supabase db push --project-ref <ref> --yes` 만 쓴다(`--include-seed` 없음).
- `supabase config push` — 로컬 `config.toml`(localhost 주소, 카카오 없음)로 운영 Auth 설정을 덮어쓴다.
