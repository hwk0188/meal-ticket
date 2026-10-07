# 1단계 · 기반 구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 교회 식권 앱의 뼈대를 세운다. 로컬 Supabase + Vite React 앱 + CI/CD가 돌아가고, 어른이 카카오(로컬은 이메일)로 로그인해 이름·전화번호·개인정보 동의를 등록하면 "오늘은 식사가 없어요" 홈까지 도달한다. 식권·가족·관리자 기능은 다음 단계.

**Architecture:** 정적 SPA(GitHub Pages) + Supabase(Postgres/Auth). 로직은 Postgres 함수(`claim_person`)와 RLS에 두고, 프론트는 supabase-js로 호출만 한다. 로컬 개발은 Docker 기반 Supabase CLI를 쓰고, DB 테스트는 pgTAP, 프론트 테스트는 Vitest + Testing Library, 종단 테스트는 Playwright로 한다.

**Tech Stack:** React 18 · Vite · TypeScript(strict) · Tailwind CSS v4 · react-router v7(HashRouter) · @supabase/supabase-js v2 · @tanstack/react-query v5 · zod · Supabase CLI(npm) · pgTAP · Vitest · Playwright · GitHub Actions

**Spec:** `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md` (2, 3, 6, 7.1~7.4의 people/families 부분, 8.2의 시작·가입 화면, 10, 11, 12, 13)

---

## 사전 조건

- macOS, Node 20.19 이상(Vite 8 최소 요건. CI는 Node 22를 쓴다), Docker Desktop 실행 중 (로컬 Supabase용).
- 실제 스캐폴딩 결과(Task 1 수행 시점): create-vite 9.2 → React 19 · Vite 8 · TypeScript 6 · **oxlint**(ESLint 아님). 이후 Task의 `npm run lint`는 oxlint를 가리킨다.
- 저장소 루트 `/Users/hong-wongi/Dev/sample/meal-ticket` 에 `docs/`와 `.gitignore`만 있는 상태(main 브랜치, 커밋 2개).
- 모든 명령은 저장소 루트에서 실행한다.

## 파일 구조 (이 단계에서 만드는 것)

```
.
├── .github/workflows/
│   ├── ci.yml                     # PR·workflow_call: DB 테스트 + 프론트 테스트 + E2E
│   ├── deploy.yml                 # main push: 테스트(ci.yml 호출) → DB 마이그레이션 → Pages 배포
│   └── keep-alive.yml             # 3일마다 ping (무료 플랜 일시정지 예방)
├── supabase/
│   ├── config.toml                # 로컬 Supabase 설정 (익명 로그인 ON, 이메일 확인 OFF)
│   ├── seeds/test_helpers.sql     # 테스트용 사용자 생성·인증 헬퍼 (로컬 전용)
│   ├── migrations/
│   │   ├── 20261007000001_people_and_families.sql   # families, people, 트리거, 사용자 헬퍼 함수
│   │   ├── 20261007000002_people_rls.sql            # 권한 회수·부여, RLS 정책
│   │   ├── 20261007000003_claim_person.sql          # claim_person RPC
│   │   └── 20261007000004_ping.sql                  # keep-alive용 ping()
│   └── tests/database/
│       ├── 010_helpers.sql        # 헬퍼 동작 확인
│       ├── 020_people_schema.sql  # 테이블·트리거·제약
│       ├── 030_people_rls.sql     # RLS
│       ├── 040_claim_person.sql   # claim_person
│       └── 050_ping.sql           # ping 권한
├── e2e/
│   └── onboarding.spec.ts         # 스모크: 개발 로그인 → 가입 → 홈
├── src/
│   ├── main.tsx                   # 진입점
│   ├── App.tsx                    # Provider + Router
│   ├── index.css                  # Tailwind
│   ├── config/church.ts           # 교회명·담당자·동의 버전 (교회 확인값)
│   ├── lib/env.ts                 # import.meta.env 검증(zod)
│   ├── lib/supabase.ts            # 클라이언트
│   ├── lib/database.types.ts      # supabase gen types 결과
│   ├── lib/phone.ts               # 전화번호 정규화·검증·표시
│   ├── lib/errors.ts              # DB 오류 코드 → 사용자 문구
│   ├── features/auth/
│   │   ├── AuthProvider.tsx       # 세션 컨텍스트
│   │   ├── usePerson.ts           # 현재 사용자의 people 행 조회
│   │   ├── signIn.ts              # 카카오·개발용 로그인·로그아웃
│   │   └── Gate.tsx               # 로그인/가입 상태에 따라 분기
│   ├── features/onboarding/
│   │   ├── onboardingSchema.ts    # 가입 폼 검증
│   │   └── OnboardingPage.tsx
│   ├── pages/
│   │   ├── StartPage.tsx
│   │   ├── HomePage.tsx
│   │   └── PrivacyPage.tsx
│   ├── components/ui.tsx          # Button, TextField, Checkbox
│   └── test/setup.ts              # Testing Library 설정
├── playwright.config.ts
├── vite.config.ts                 # vite + vitest 설정
├── .env.example
└── README.md                      # 운영 설정 안내
```

각 파일은 한 가지 책임만 가진다. 테스트 파일은 대상 파일 옆에 `*.test.ts(x)`로 둔다.

---

### Task 1: Vite + React + TypeScript + Tailwind 스캐폴딩

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Modify: `.gitignore`

- [x] **Step 1: Vite 템플릿을 임시 폴더에 생성해 루트로 옮긴다**

루트에 `docs/`가 있어 `create-vite`가 대화형 확인을 요구하므로 임시 폴더를 쓴다.

```bash
npm create vite@latest tmp-vite -- --template react-ts
rsync -a tmp-vite/ ./ && rm -rf tmp-vite
npm install
```

Expected: `package.json`, `vite.config.ts`, `src/App.tsx` 등이 루트에 생기고 `npm install`이 오류 없이 끝난다. 기존 `.gitignore`는 템플릿 것으로 덮였을 수 있으니 다음 단계에서 다시 쓴다.

- [x] **Step 2: `.gitignore`를 다시 작성한다**

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.env
.env.*
!.env.example
.superpowers/
supabase/.temp/
supabase/.branches/
.DS_Store
*.local
```

- [x] **Step 3: Tailwind v4와 Vite 플러그인, Node 타입을 설치한다**

```bash
npm install -D tailwindcss @tailwindcss/vite @types/node
```

`@types/node`는 `vite.config.ts`에서 `process.env`를 읽기 위해 필요하다. `tsconfig.node.json`의 `compilerOptions.types`에 `"node"`가 없으면 추가한다.

- [x] **Step 4: `src/index.css`를 Tailwind만 남기고 교체한다**

```css
@import "tailwindcss";

:root {
  color-scheme: light;
}

html, body, #root {
  min-height: 100%;
}

body {
  margin: 0;
  background: #f5f5f7;
  color: #1d1d1f;
  font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  -webkit-tap-highlight-color: transparent;
}
```

템플릿의 `src/App.css`, `src/assets/react.svg`, `public/vite.svg`는 삭제한다.

```bash
rm -f src/App.css src/assets/react.svg public/vite.svg
```

- [x] **Step 5: `vite.config.ts`를 교체한다 (base 경로를 환경변수로)**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 프로젝트 사이트는 /<repo>/ 아래에 배포되므로 CI에서 VITE_BASE_PATH=/<repo>/ 를 넣는다.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/lib/database.types.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
```

`vitest`는 Task 2에서 설치하므로 지금은 타입 오류가 나도 된다.

- [x] **Step 6: `src/main.tsx`와 `src/App.tsx`를 최소 형태로 교체한다**

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx`:
```tsx
export default function App() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <h1 className="text-2xl font-extrabold">교회 식권</h1>
    </main>
  )
}
```

`index.html`의 `<title>`을 `교회 식권`으로, `<html lang="en">`을 `<html lang="ko">`로 바꾸고, `<meta name="viewport" content="width=device-width, initial-scale=1.0">`가 있는지 확인한다.

- [x] **Step 7: 빌드와 개발 서버가 뜨는지 확인한다**

```bash
npm run build
```
Expected: `dist/index.html`이 생성되고 오류 없음.

```bash
npm run dev -- --open
```
Expected: 브라우저에 "교회 식권" 제목이 굵게 가운데 표시(Tailwind 적용 확인). Ctrl+C로 종료.

- [x] **Step 8: 커밋**

```bash
git add -A
git commit -m "chore: Vite + React + TypeScript + Tailwind v4 스캐폴딩"
```

---

### Task 2: Vitest + Testing Library 설정

**Files:**
- Create: `src/test/setup.ts`, `src/App.test.tsx`
- Modify: `package.json` (scripts)

- [x] **Step 1: 테스트 의존성 설치**

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/coverage-v8
```

- [x] **Step 2: `src/test/setup.ts` 작성**

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

- [x] **Step 3: `package.json`의 scripts를 다음으로 교체** (lint는 템플릿의 oxlint를 유지)

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "oxlint --deny-warnings",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [x] **Step 3-1: `vite.config.ts`에 Vitest 설정을 넣는다** (Task 1에서는 vitest가 없어 `test` 블록을 뺐다)

```ts
/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 프로젝트 사이트는 /<repo>/ 아래에 배포되므로 CI에서 VITE_BASE_PATH=/<repo>/ 를 넣는다.
// loadEnv 로 .env.local 과 셸 환경변수 둘 다 읽는다. 빈 값은 '/' 로 본다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // 테스트에서 import.meta.env 를 읽는 모듈(src/lib/env.ts)이 깨지지 않도록 기본값을 준다.
      // 테스트별로 바꿀 때는 vi.stubEnv 를 쓴다 (unstubEnvs 로 자동 복원).
      env: {
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        VITE_ENABLE_DEV_LOGIN: 'false',
      },
      clearMocks: true,
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        reportOnFailure: true,
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test/**',
          'src/main.tsx',
          'src/lib/database.types.ts',
        ],
        thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      },
    },
  }
})
```

`vitest/config`는 `loadEnv`를 다시 내보내지 않으므로 `import { loadEnv } from 'vite'`로 가져온다. `/// <reference types="vitest/config" />` 줄은 oxlint가 경고하므로 넣지 않는다(`vitest/config`의 `defineConfig`만으로 `test` 블록이 타입 검사된다). `.oxlintrc.json`의 `plugins`에 `"vitest"`를 추가해 `it.only`나 단언 없는 테스트가 lint에서 걸리게 한다.

참고: Vitest 4는 AI 에이전트 환경(`CLAUDECODE` 등 환경변수)에서 커버리지 표의 100% 파일 행을 숨긴다. 사람 터미널과 CI에서는 파일별 행이 정상 출력된다.

- [x] **Step 4: 실패하는 테스트 작성 — `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('앱 제목을 보여준다', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '교회 식권 앱' })).toBeInTheDocument()
  })
})
```

- [x] **Step 5: 실패 확인**

```bash
npm test
```
Expected: FAIL — `Unable to find an accessible element with the role "heading" and name "교회 식권 앱"` (현재 제목은 "교회 식권").

- [x] **Step 6: 제목을 테스트에 맞추고 통과 확인**

`src/App.tsx`의 `<h1>` 내용을 `교회 식권 앱`으로 바꾼다.

```bash
npm test
```
Expected: `1 passed`.

- [x] **Step 7: `tsconfig.app.json`에 vitest 전역 타입 추가**

`compilerOptions`의 `types`를 `["vite/client", "vitest/globals"]`로 바꾼다. **`vite/client`를 빼면 `import.meta.env`와 CSS side-effect import가 타입 오류가 나므로 반드시 둘 다 둔다.** jest-dom 매처 타입은 `src/test/setup.ts`의 `@testing-library/jest-dom/vitest` import가 확장한다. `npm run build`가 통과하는지 확인한다.

- [x] **Step 8: 커밋**

```bash
git add -A
git commit -m "test: Vitest + Testing Library 설정"
```

---

### Task 3: 로컬 Supabase 초기화

**Files:**
- Create: `supabase/config.toml`, `supabase/seeds/.gitkeep`, `.env.example`, `.env.local`(비추적)
- Modify: `package.json` (scripts)

- [x] **Step 1: Supabase CLI를 devDependency로 설치하고 초기화**

```bash
npm install -D supabase@2.120.0 --save-exact
npx supabase init
```
Expected: `supabase/config.toml` 생성. "Generate VS Code settings?" 질문은 `N`.

- [x] **Step 2: `supabase/config.toml`에서 다음 값을 찾아 수정한다** (나머지는 기본값 유지)

```toml
[api]
port = 54321

[db]
port = 54322

[db.seed]
enabled = true
sql_paths = ["./seeds/*.sql"]

[auth]
site_url = "http://localhost:5173"
additional_redirect_urls = ["http://localhost:5173", "http://localhost:5173/", "http://127.0.0.1:5173"]
enable_anonymous_sign_ins = true

[auth.email]
enable_signup = true
enable_confirmations = false

# 이 프로젝트가 쓰지 않는 서비스는 꺼서 start/reset 시간을 줄인다 (12 → 7 컨테이너)
[realtime]
enabled = false
[storage]
enabled = false
[edge_runtime]
enabled = false
[analytics]
enabled = false   # supabase logs / Studio Logs 도 꺼진다
```

`[api] auto_expose_new_tables = true`는 주석을 풀어 명시한다(클라우드 기본값과 동일. RLS 테스트가 운영과 같은 조건에서 돌아야 한다). `enable_anonymous_sign_ins`는 3단계 아이 계정용이며 1단계에서는 호출하지 않는다.

카카오 provider는 로컬에 설정하지 않는다. 로컬은 이메일 개발 로그인을 쓰고, 운영 Supabase 대시보드에서만 카카오를 켠다(Task 17의 README 참고).

- [x] **Step 3: 시드 폴더와 기동**

```bash
mkdir -p supabase/seeds && touch supabase/seeds/.gitkeep
npx supabase start
```
Expected(약 1~3분): `API URL: http://127.0.0.1:54321`, `anon key: ...` 등 출력.

- [x] **Step 4: `.env.example`과 `.env.local` 작성**

`.env.example`:
```bash
# Supabase 프로젝트 (로컬은 `npx supabase status -o env` 의 API_URL / PUBLISHABLE_KEY)
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=
# 로컬·테스트에서만 true. 운영 빌드에서는 비워 둔다.
VITE_ENABLE_DEV_LOGIN=true
# GitHub Pages 프로젝트 사이트 경로. 로컬은 /
VITE_BASE_PATH=/
```

`.env.local`은 실제 값으로 채운다:
```bash
npx supabase status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY)='
```
출력된 `PUBLISHABLE_KEY`(`sb_publishable_…`) 값을 `VITE_SUPABASE_PUBLISHABLE_KEY=`에 넣고 나머지는 `.env.example`과 같게 둔다. 레거시 `ANON_KEY`(JWT)는 2026년 말 폐기 예정이라 쓰지 않는다.

- [x] **Step 5: `package.json` scripts에 DB 명령 추가**

```json
"db:start": "supabase start",
"db:stop": "supabase stop",
"db:reset": "supabase db reset",
"db:test": "supabase test db",
"db:types": "mkdir -p src/lib && supabase gen types typescript --local > src/lib/database.types.ts.tmp && mv src/lib/database.types.ts.tmp src/lib/database.types.ts"
```

- [x] **Step 6: 커밋**

```bash
git add -A
git commit -m "chore: 로컬 Supabase 초기화 및 환경변수 예시"
```

---

### Task 4: DB 테스트 헬퍼 (시드) + 첫 pgTAP 테스트

**Files:**
- Create: `supabase/seeds/000_test_helpers.sql`, `supabase/tests/database/010_helpers.sql`

- [x] **Step 1: 헬퍼 시드 작성 — `supabase/seeds/000_test_helpers.sql`**

운영 DB에는 `db push`로 올라가지 않는다(시드는 로컬 전용).

```sql
-- 테스트 전용 헬퍼. 로컬 db reset 때만 적용된다 (db push 로는 올라가지 않는다).
-- 주의: set_config(…, true) 와 set local 은 트랜잭션 안에서만 유지된다.
-- pgTAP 파일처럼 begin … rollback 블록 안에서 호출해야 하며, psql autocommit 에서는 바로 풀린다.
create schema if not exists tests;

-- 가짜 auth 사용자 생성. 이메일이 null이면 익명 사용자.
create or replace function tests.create_user(p_email text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, case when p_email is null then null else now() end,
    case when p_email is null then '{"provider":"anonymous","providers":["anonymous"]}'::jsonb
         else '{"provider":"email","providers":["email"]}'::jsonb end,
    '{}'::jsonb, p_email is null, now(), now()
  );
  return v_id;
end
$$;

-- 이후 문장을 해당 사용자로 실행 (auth.uid() = p_user). 연속 호출 가능, 없는 사용자는 예외.
create or replace function tests.authenticate_as(p_user uuid)
returns void
language plpgsql
as $$
declare
  v_anon boolean;
  v_email text;
begin
  -- 이미 authenticated 역할이어도 재인증할 수 있도록 먼저 postgres 로 돌아간다 (auth.users 를 읽어야 함)
  execute 'reset role';
  select is_anonymous, email into v_anon, v_email from auth.users where id = p_user;
  if not found then
    raise exception 'tests.authenticate_as: auth 사용자가 없다 (%)', p_user;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', 'authenticated',
      'aud', 'authenticated',
      'email', v_email,
      'is_anonymous', v_anon
    )::text,
    true);
  execute 'set local role authenticated';
end
$$;

-- 다시 슈퍼유저(postgres)로
create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- 함수 EXECUTE 는 기본 PUBLIC 이지만 스키마 USAGE 는 따로 줘야 한다.
-- authenticated 로 전환된 뒤 clear_auth() 를 부르려면 필수. anon 은 Task 6 의 anon 테스트용.
grant usage on schema tests to authenticated, anon;
```

- [x] **Step 2: 실패하는 테스트 작성 — `supabase/tests/database/010_helpers.sql`**

```sql
begin;
select plan(5);

select has_function('tests', 'create_user',     array['text'], 'tests.create_user(text)가 있다');
select has_function('tests', 'authenticate_as', array['uuid'], 'tests.authenticate_as(uuid)가 있다');
select has_function('tests', 'clear_auth',      'tests.clear_auth()가 있다');

select tests.create_user('helper@test.local') as uid \gset

select tests.authenticate_as(:'uid');
select is(auth.uid(), :'uid'::uuid, 'authenticate_as 후 auth.uid()가 그 사용자다');

select tests.clear_auth();
select is(auth.uid(), null, 'clear_auth 후 auth.uid()는 null');

select * from finish();
rollback;
```

- [x] **Step 3: 실패 확인 (시드가 아직 적용되지 않음)**

```bash
npm run db:test
```
Expected: FAIL — `schema "tests" does not exist` 또는 헬퍼 개수 0.

- [x] **Step 4: 시드를 적용하고 통과 확인**

```bash
npm run db:reset
npm run db:test
```
Expected: `010_helpers.sql .. ok`, `All tests successful.` (5개 단언)

시드 폴더에 실제 파일이 생겼으므로 `git rm supabase/seeds/.gitkeep`.

`\gset`은 psql 전용 문법으로 쿼리 결과를 변수에 담는다. `supabase test db`(pg_prove → psql)에서 동작하며, 이후 테스트들도 역할 전환 **전에** uid 를 `\gset` 으로 받아 둔다(`authenticated` 역할은 `auth.users` 를 읽을 수 없다).

- [x] **Step 5: 커밋**

```bash
git add supabase
git commit -m "test: pgTAP 테스트 헬퍼(사용자 생성·인증) 추가"
```

---

### Task 5: 마이그레이션 ① families · people 테이블, 트리거, 헬퍼 함수

**Files:**
- Create: `supabase/migrations/20261007000001_people_and_families.sql`
- Test: `supabase/tests/database/020_people_schema.sql`

- [ ] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/020_people_schema.sql`**

```sql
begin;
select plan(11);

select has_table('public', 'families', 'families 테이블이 있다');
select has_table('public', 'people', 'people 테이블이 있다');

-- 1인 가족 자동 생성
insert into public.people (name, phone) values ('김철수', '010-1234-5678');
select isnt(
  (select family_id from public.people where name = '김철수'), null,
  '사람을 만들면 family_id가 자동으로 채워진다'
);
select is(
  (select count(*) from public.families where id = (select family_id from public.people where name = '김철수')),
  1::bigint, '그 가족 행이 실제로 존재한다'
);

-- 전화번호 정규화
select is(
  (select phone from public.people where name = '김철수'), '01012345678',
  '전화번호는 숫자만 남겨 저장한다'
);
select is(public.normalize_phone('+82 10-9876-5432'), '01098765432', '+82 국제 표기는 010 으로 바꾼다');
select is(public.normalize_phone(''), null, '빈 문자열은 null');

-- 잘못된 번호 거부 (check 위반 23514)
select throws_ok(
  $$ insert into public.people (name, phone) values ('홍길동', '02-123-4567') $$,
  '23514', null, '휴대폰 형식이 아니면 거부한다'
);

-- 번호 중복 거부, 단 탈퇴한 사람의 번호는 재사용 가능
select throws_ok(
  $$ insert into public.people (name, phone) values ('김철수2', '01012345678') $$,
  '23505', null, '같은 번호를 두 번 등록할 수 없다'
);
update public.people set deleted_at = now() where name = '김철수';
select lives_ok(
  $$ insert into public.people (name, phone) values ('김철수3', '01012345678') $$,
  '탈퇴한 사람의 번호는 다시 쓸 수 있다'
);

-- 미성년자는 보호자·보호자 동의 필수
select throws_ok(
  $$ insert into public.people (name, is_minor) values ('김민준', true) $$,
  '23514', null, '보호자 없는 미성년자는 거부한다'
);

select * from finish();
rollback;
```

- [ ] **Step 2: 실패 확인**

```bash
npm run db:test
```
Expected: `020_people_schema.sql` FAIL — `relation "public.people" does not exist`.

- [ ] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261007000001_people_and_families.sql`**

```sql
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
create index people_guardian_idx on public.people (guardian_id);
-- auth_user_id 는 unique 제약이 이미 인덱스를 만든다.

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
-- 테이블 생성과 같은 마이그레이션에 두어, 두 마이그레이션 사이에 열린 창이 생기지 않게 한다.
-- =========================================================
alter table public.families enable row level security;
alter table public.people enable row level security;
revoke all on public.families from anon, authenticated;
revoke all on public.people from anon, authenticated;
```

- [ ] **Step 4: 적용하고 통과 확인**

```bash
npm run db:reset
npm run db:test
```
Expected: `020_people_schema.sql .. ok`, 전체 `All tests successful.` (5 + 11 단언)

- [ ] **Step 5: 커밋**

```bash
git add supabase
git commit -m "feat(db): families·people 테이블, 전화번호 정규화 트리거, 사용자 헬퍼 함수"
```

---

### Task 6: 마이그레이션 ② people · families RLS

**Files:**
- Create: `supabase/migrations/20261007000002_people_rls.sql`
- Test: `supabase/tests/database/030_people_rls.sql`

- [ ] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/030_people_rls.sql`**

```sql
begin;
select plan(10);

-- 준비: 사용자 A(김철수), B(이영희, 다른 가족), 관리자(권사)
select tests.create_user('a@test.local') as a_uid \gset
select tests.create_user('b@test.local') as b_uid \gset
select tests.create_user('admin@test.local') as admin_uid \gset

insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
values ('김철수', '01011110001', :'a_uid', now(), 'v1'),
       ('이영희', '01011110002', :'b_uid', now(), 'v1'),
       ('권사',   '01011110009', :'admin_uid', now(), 'v1');
update public.people set role = 'admin' where auth_user_id = :'admin_uid';
-- 선발급자(계정 없음)
insert into public.people (name, phone) values ('이순자', '01011110003');

-- A 로서
select tests.authenticate_as(:'a_uid');
select is((select count(*) from public.people), 1::bigint, 'A는 자기 가족(자기 자신)만 본다');
select is((select name from public.people), '김철수', '보이는 사람은 본인이다');
select is((select count(*) from public.families), 1::bigint, 'A는 자기 가족 행만 본다');

update public.people set name = '김철수A' where auth_user_id = :'a_uid';
select is((select name from public.people where auth_user_id = :'a_uid'), '김철수A', 'A는 자기 이름을 바꿀 수 있다');

select throws_ok(
  $$ update public.people set role = 'admin' where auth_user_id = auth.uid() $$,
  '42501', null, 'A는 role 열을 바꿀 수 없다 (열 권한 없음)'
);

select throws_ok(
  $$ insert into public.people (name, phone) values ('새사람', '01099990000') $$,
  '42501', null, 'A는 사람을 만들 수 없다'
);

-- 관리자로서
select tests.clear_auth();
select tests.authenticate_as(:'admin_uid');
select is((select count(*) from public.people), 4::bigint, '관리자는 모든 사람을 본다');
select lives_ok(
  $$ insert into public.people (name, phone) values ('방문자', '01099990000') $$,
  '관리자는 선발급용 사람을 만들 수 있다'
);
select is((select count(*) from public.families), 5::bigint, '관리자는 모든 가족을 본다');

-- 비로그인(anon)
select tests.clear_auth();
set local role anon;
select throws_ok($$ select count(*) from public.people $$, '42501', null, 'anon은 people을 읽을 수 없다');
reset role;

select * from finish();
rollback;
```

`\gset`은 psql 전용 문법이며 `supabase test db`(pg_prove → psql)에서 동작한다. uid 는 반드시 `authenticate_as` 호출 **전에** `\gset` 으로 받아 둔다(`authenticated` 역할은 `auth.users` 를 읽을 수 없다). `authenticate_as` 는 연속 호출이 가능하므로 사용자 전환 사이의 `clear_auth()` 는 "postgres 로 돌아가서 전체 데이터를 보고 싶을 때"만 필요하다.

- [ ] **Step 2: 실패 확인**

```bash
npm run db:test
```
Expected: `030_people_rls.sql` FAIL — 앞 마이그레이션이 기본 차단 상태라 A의 첫 조회부터 `42501 permission denied`로 중단된다(정책·권한이 아직 없음).

- [ ] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261007000002_people_rls.sql`**

```sql
-- RLS 활성화와 권한 회수는 앞 마이그레이션(테이블 생성)에서 이미 했다. 여기서는 필요한 권한과 정책만 부여한다.
grant select on public.families to authenticated;
grant select on public.people to authenticated;
-- 본인 수정은 이름·전화만, 관리자 선발급 입력도 이름·전화만 (나머지는 함수로)
grant update (name, phone) on public.people to authenticated;
grant insert (name, phone) on public.people to authenticated;

-- families
create policy families_select_own_or_admin on public.families
  for select to authenticated
  using (id = public.current_family_id() or public.is_admin());

-- people
create policy people_select_family_or_admin on public.people
  for select to authenticated
  using (
    (family_id = public.current_family_id() and deleted_at is null)
    or public.is_admin()
  );

create policy people_update_self on public.people
  for update to authenticated
  using (auth_user_id = auth.uid() and deleted_at is null)
  with check (auth_user_id = auth.uid());

create policy people_insert_admin on public.people
  for insert to authenticated
  with check (public.is_admin());

create policy people_update_admin on public.people
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
```

관리자도 직접 고칠 수 있는 열은 이름·전화뿐이다. 역할·가족·보호자·계정 연결 같은 열은 뒤 단계의 관리자 전용 함수(`merge_people`, `link_person`, `admin_reset_person` 등)로만 바꾼다. 설계 문서 7.4의 "관리자 update 전부"는 이 함수들을 포함한 의미다.

- [ ] **Step 4: 적용하고 통과 확인**

```bash
npm run db:reset
npm run db:test
```
Expected: `030_people_rls.sql .. ok`, 전체 성공.

- [ ] **Step 5: 커밋**

```bash
git add supabase
git commit -m "feat(db): people·families RLS 정책 및 열 단위 권한"
```

---

### Task 7: 마이그레이션 ③ `claim_person` RPC

**Files:**
- Create: `supabase/migrations/20261007000003_claim_person.sql`
- Test: `supabase/tests/database/040_claim_person.sql`

- [ ] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/040_claim_person.sql`**

```sql
begin;
select plan(11);

select tests.create_user('new@test.local') as new_uid \gset
select tests.create_user('pre@test.local') as pre_uid \gset
select tests.create_user('dup@test.local') as dup_uid \gset
select tests.create_user() as anon_uid \gset

-- 선발급자(관리자가 미리 만든 사람)
insert into public.people (name, phone) values ('이순자', '01022220001');

-- 1) 새 사용자 가입
select tests.authenticate_as(:'new_uid');
select lives_ok(
  $$ select public.claim_person('김철수', '010-2222-0002', '2026-10-07') $$,
  '새 사용자는 가입할 수 있다'
);
select tests.clear_auth();
select is((select phone from public.people where auth_user_id = :'new_uid'), '01022220002', '번호가 정규화되어 저장된다');
select isnt((select consented_at from public.people where auth_user_id = :'new_uid'), null, '동의 시각이 기록된다');
select is((select consent_version from public.people where auth_user_id = :'new_uid'), '2026-10-07', '동의 버전이 기록된다');
select isnt((select family_id from public.people where auth_user_id = :'new_uid'), null, '1인 가족이 생긴다');

-- 2) 같은 계정이 또 가입 → already_registered
select tests.authenticate_as(:'new_uid');
select throws_ok(
  $$ select public.claim_person('김철수', '010-2222-0002', '2026-10-07') $$,
  'P0001', 'already_registered', '이미 가입한 계정은 다시 가입할 수 없다'
);
select tests.clear_auth();

-- 3) 선발급자가 같은 번호로 가입 → 기존 사람에 연결
select tests.authenticate_as(:'pre_uid');
select lives_ok(
  $$ select public.claim_person('이순자', '01022220001', '2026-10-07') $$,
  '선발급된 번호로 가입하면 성공한다'
);
select tests.clear_auth();
select is(
  (select auth_user_id from public.people where phone = '01022220001'), :'pre_uid'::uuid,
  '기존 사람 행에 계정이 연결된다 (새 사람이 생기지 않음)'
);

-- 4) 이미 연결된 번호로 다른 계정이 가입 → phone_taken
select tests.authenticate_as(:'dup_uid');
select throws_ok(
  $$ select public.claim_person('가짜', '01022220001', '2026-10-07') $$,
  'P0001', 'phone_taken', '남이 쓰는 번호로는 가입할 수 없다'
);
select throws_ok(
  $$ select public.claim_person('가짜', '02-123-4567', '2026-10-07') $$,
  'P0001', 'invalid_phone', '휴대폰 형식이 아니면 거부한다'
);
select tests.clear_auth();

-- 5) 익명 계정 → anonymous_cannot_claim
select tests.authenticate_as(:'anon_uid');
select throws_ok(
  $$ select public.claim_person('아이', '01022220009', '2026-10-07') $$,
  'P0001', 'anonymous_cannot_claim', '익명 계정은 어른 가입을 할 수 없다'
);
select tests.clear_auth();

select * from finish();
rollback;
```

- [ ] **Step 2: 실패 확인**

```bash
npm run db:test
```
Expected: `040_claim_person.sql` FAIL — `function public.claim_person(...) does not exist`.

- [ ] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261007000003_claim_person.sql`**

```sql
-- 어른 가입: 카카오(또는 이메일) 로그인 직후 이름·번호·동의를 받아 사람 행을 만들거나 선발급 행에 연결한다.
-- 오류는 message에 코드 문자열을 담는다. 프론트가 사용자 문구로 바꾼다.
create or replace function public.claim_person(
  p_name text,
  p_phone text,
  p_consent_version text
)
returns public.people
language plpgsql
security definer
set search_path = public
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

  if exists (select 1 from public.people where auth_user_id = v_uid and deleted_at is null) then
    raise exception 'already_registered';
  end if;

  -- 같은 번호의 사람이 있으면 (선발급) 연결, 이미 다른 계정이면 거부
  select * into v_person
    from public.people
   where phone = v_phone and deleted_at is null
   for update;

  if found then
    if v_person.auth_user_id is not null then
      raise exception 'phone_taken';
    end if;
    update public.people
       set auth_user_id = v_uid,
           name = v_name,
           consented_at = now(),
           consent_version = p_consent_version
     where id = v_person.id
     returning * into v_person;
  else
    insert into public.people (name, phone, auth_user_id, consented_at, consent_version)
    values (v_name, v_phone, v_uid, now(), p_consent_version)
    returning * into v_person;
  end if;

  return v_person;
end
$$;

revoke execute on function public.claim_person(text, text, text) from public, anon;
grant execute on function public.claim_person(text, text, text) to authenticated;
```

- [ ] **Step 4: 적용하고 통과 확인**

```bash
npm run db:reset
npm run db:test
```
Expected: 4개 파일 모두 `ok`, `All tests successful.`

- [ ] **Step 5: DB 타입 생성**

```bash
mkdir -p src/lib
npm run db:types
head -5 src/lib/database.types.ts
```
Expected: `export type Json = ...`로 시작하는 파일. `people`, `families` 테이블과 `claim_person` 함수 타입이 포함된다.

- [ ] **Step 6: 커밋**

```bash
git add supabase src/lib/database.types.ts package.json
git commit -m "feat(db): claim_person RPC (어른 가입·선발급 연결·동의 기록)"
```

---

### Task 8: 프론트 라이브러리 · 환경변수 검증 · Supabase 클라이언트 · 전화번호·오류 유틸

**Files:**
- Create: `src/lib/env.ts`, `src/lib/supabase.ts`, `src/lib/phone.ts`, `src/lib/errors.ts`
- Test: `src/lib/env.test.ts`, `src/lib/phone.test.ts`, `src/lib/errors.test.ts`

- [ ] **Step 1: 런타임 의존성 설치**

```bash
npm install @supabase/supabase-js @tanstack/react-query react-router zod
```

- [ ] **Step 2: 실패하는 테스트 — `src/lib/env.test.ts`**

```ts
import { parseEnv } from './env'

const valid = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  VITE_ENABLE_DEV_LOGIN: 'true',
}

describe('parseEnv', () => {
  it('올바른 값을 구조화해 돌려준다', () => {
    expect(parseEnv(valid)).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabasePublishableKey: 'sb_publishable_x',
      enableDevLogin: true,
    })
  })

  it('개발 로그인 플래그가 없으면 false', () => {
    const { VITE_ENABLE_DEV_LOGIN: _omit, ...rest } = valid
    expect(parseEnv(rest).enableDevLogin).toBe(false)
  })

  it('필수 값이 빠지면 어떤 키인지 알려주며 실패한다', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://x' })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })
})
```

- [ ] **Step 3: 실패하는 테스트 — `src/lib/phone.test.ts`**

```ts
import { normalizePhone, isValidMobile, formatPhone, maskPhone } from './phone'

describe('phone', () => {
  it('숫자만 남긴다', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678')
    expect(normalizePhone(' 010 1234 5678 ')).toBe('01012345678')
  })

  it('+82 국제 표기는 010 으로 바꾼다 (DB normalize_phone 과 동일 규칙)', () => {
    expect(normalizePhone('+82 10-9876-5432')).toBe('01098765432')
    expect(normalizePhone('+82-10-123-4567')).toBe('0101234567')
  })

  it('휴대폰 번호 형식을 검사한다', () => {
    expect(isValidMobile('01012345678')).toBe(true)
    expect(isValidMobile('0101234567')).toBe(true)
    expect(isValidMobile('0212345678')).toBe(false)
    expect(isValidMobile('010123')).toBe(false)
  })

  it('하이픈을 넣어 표시한다', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678')
    expect(formatPhone('0101234567')).toBe('010-123-4567')
    expect(formatPhone('')).toBe('')
  })

  it('가운데를 가린다', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678')
    expect(maskPhone('0101234567')).toBe('010-***-4567')
    expect(maskPhone(null)).toBe('')
  })
})
```

- [ ] **Step 4: 실패하는 테스트 — `src/lib/errors.test.ts`**

```ts
import { toUserMessage } from './errors'

describe('toUserMessage', () => {
  it('DB 오류 코드를 사용자 문구로 바꾼다', () => {
    expect(toUserMessage({ message: 'phone_taken' })).toBe('이미 등록된 번호예요. 권사님께 문의해 주세요.')
    expect(toUserMessage(new Error('invalid_phone'))).toBe('휴대폰 번호를 확인해 주세요.')
  })

  it('모르는 오류는 일반 문구', () => {
    expect(toUserMessage(new Error('something odd'))).toBe('잠시 후 다시 시도해 주세요.')
    expect(toUserMessage(undefined)).toBe('잠시 후 다시 시도해 주세요.')
  })

  it('네트워크 오류는 통신 문구', () => {
    expect(toUserMessage(new TypeError('Failed to fetch'))).toBe('통신이 불안정해요. 잠시 후 다시 시도해 주세요.')
  })
})
```

- [ ] **Step 5: 실패 확인**

```bash
npm test
```
Expected: 세 파일 모두 FAIL — `Failed to resolve import "./env"` 등.

- [ ] **Step 6: 구현 — `src/lib/env.ts`**

```ts
import { z } from 'zod'

const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_ENABLE_DEV_LOGIN: z.enum(['true', 'false']).default('false'),
})

export type Env = {
  supabaseUrl: string
  supabasePublishableKey: string
  enableDevLogin: boolean
}

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const keys = result.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`환경변수가 올바르지 않습니다: ${keys}`)
  }
  return {
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
    enableDevLogin: result.data.VITE_ENABLE_DEV_LOGIN === 'true',
  }
}

export const env: Env = parseEnv(import.meta.env as Record<string, unknown>)
```

- [ ] **Step 7: 구현 — `src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env } from './env'

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
```

- [ ] **Step 8: 구현 — `src/lib/phone.ts`**

```ts
const MOBILE = /^01[0-9]{8,9}$/

/** 숫자만 남기고, +82 국제 표기는 010 으로 바꾼다. DB 의 normalize_phone() 과 같은 규칙. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  const intl = /^82(1[0-9]{8,9})$/.exec(digits)
  return intl ? `0${intl[1]}` : digits
}

export function isValidMobile(digits: string): boolean {
  return MOBILE.test(digits)
}

/** 01012345678 → 010-1234-5678, 0101234567 → 010-123-4567 */
export function formatPhone(digits: string): string {
  if (!digits) return ''
  const head = digits.slice(0, 3)
  const tail = digits.slice(-4)
  const mid = digits.slice(3, -4)
  return [head, mid, tail].filter(Boolean).join('-')
}

/** 010-****-5678 */
export function maskPhone(digits: string | null | undefined): string {
  if (!digits) return ''
  const formatted = formatPhone(digits)
  const [head, mid, tail] = formatted.split('-')
  return [head, '*'.repeat(mid.length), tail].join('-')
}
```

- [ ] **Step 9: 구현 — `src/lib/errors.ts`**

```ts
const MESSAGES: Record<string, string> = {
  phone_taken: '이미 등록된 번호예요. 권사님께 문의해 주세요.',
  invalid_phone: '휴대폰 번호를 확인해 주세요.',
  invalid_name: '이름을 확인해 주세요.',
  consent_required: '개인정보 동의가 필요해요.',
  already_registered: '이미 가입된 계정이에요.',
  anonymous_cannot_claim: '아이 계정은 보호자 연결로 시작해 주세요.',
  not_authenticated: '로그인이 필요해요.',
}

const FALLBACK = '잠시 후 다시 시도해 주세요.'
const NETWORK = '통신이 불안정해요. 잠시 후 다시 시도해 주세요.'

function messageOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const m = (err as { message?: unknown }).message
  return typeof m === 'string' ? m : undefined
}

export function toUserMessage(err: unknown): string {
  const message = messageOf(err)
  if (!message) return FALLBACK
  if (message in MESSAGES) return MESSAGES[message]
  if (/failed to fetch|networkerror|load failed/i.test(message)) return NETWORK
  return FALLBACK
}
```

- [ ] **Step 10: 통과 확인**

```bash
npm test
```
Expected: env 3 · phone 5 · errors 3 · App 1 → `12 passed`.

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "feat: 환경변수 검증, Supabase 클라이언트, 전화번호·오류 문구 유틸"
```

---

### Task 9: 세션 컨텍스트 · 사람 조회 · 라우팅 뼈대 · UI 기본 컴포넌트

**Files:**
- Create: `src/components/ui.tsx`, `src/features/auth/AuthProvider.tsx`, `src/features/auth/usePerson.ts`, `src/features/auth/Gate.tsx`, `src/pages/StartPage.tsx`(스텁), `src/pages/HomePage.tsx`(스텁), `src/pages/PrivacyPage.tsx`(스텁), `src/features/onboarding/OnboardingPage.tsx`(스텁)
- Modify: `src/App.tsx`, `src/App.test.tsx`
- Test: `src/features/auth/AuthProvider.test.tsx`, `src/features/auth/Gate.test.tsx`

- [ ] **Step 1: UI 기본 컴포넌트 — `src/components/ui.tsx`**

```tsx
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'kakao' | 'ghost' }

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const base = 'w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed'
  const look = {
    primary: 'bg-blue-600 text-white active:bg-blue-700',
    kakao: 'bg-[#FEE500] text-[#191919]',
    ghost: 'bg-white text-gray-900 border border-gray-300',
  }[variant]
  return <button className={`${base} ${look} ${className}`} {...rest} />
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }

export function TextField({ label, error, id, ...rest }: TextFieldProps) {
  const inputId = id ?? rest.name
  return (
    <label className="block" htmlFor={inputId}>
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      <input
        id={inputId}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-600"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...rest}
      />
      {error && (
        <span id={`${inputId}-error`} role="alert" className="mt-1 block text-xs text-red-600">
          {error}
        </span>
      )}
    </label>
  )
}

type CheckboxProps = InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }

export function Checkbox({ children, ...rest }: CheckboxProps) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-blue-600" {...rest} />
      <span>{children}</span>
    </label>
  )
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center text-sm text-gray-500">
      {label}…
    </div>
  )
}
```

- [ ] **Step 2: 실패하는 테스트 — `src/features/auth/AuthProvider.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'

const { getSession, onAuthStateChange, unsubscribe } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession, onAuthStateChange } },
}))

function Probe() {
  const auth = useAuth()
  if (auth.status === 'loading') return <p>loading</p>
  return <p>{auth.session ? `user:${auth.session.user.id}` : 'no-session'}</p>
}

beforeEach(() => {
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
})

describe('AuthProvider', () => {
  it('처음엔 loading, 세션이 없으면 no-session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
  })

  it('세션이 있으면 사용자 id를 노출한다', async () => {
    const session = { user: { id: 'u1' } } as Session
    getSession.mockResolvedValue({ data: { session } })
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('user:u1')).toBeInTheDocument())
  })

  it('언마운트 시 구독을 해제한다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { unmount } = render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 실패하는 테스트 — `src/features/auth/Gate.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Gate, RequireSession } from './Gate'

const { useAuth, usePerson } = vi.hoisted(() => ({ useAuth: vi.fn(), usePerson: vi.fn() }))
vi.mock('./AuthProvider', () => ({ useAuth }))
vi.mock('./usePerson', () => ({ usePerson }))
vi.mock('../../pages/StartPage', () => ({ StartPage: () => <p>start</p> }))
vi.mock('../../pages/HomePage', () => ({ HomePage: () => <p>home</p> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Gate />} />
        <Route path="/onboarding" element={<RequireSession><p>onboarding</p></RequireSession>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Gate', () => {
  it('세션 확인 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'loading' })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('세션이 없으면 시작 화면', () => {
    useAuth.mockReturnValue({ status: 'ready', session: null })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/')
    expect(screen.getByText('start')).toBeInTheDocument()
  })

  it('세션은 있고 사람이 없으면 가입 화면으로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: null })
    renderAt('/')
    expect(screen.getByText('onboarding')).toBeInTheDocument()
  })

  it('사람이 있으면 홈', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수' } })
    renderAt('/')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('RequireSession: 세션이 없으면 /로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: null })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/onboarding')
    expect(screen.getByText('start')).toBeInTheDocument()
  })

  it('RequireSession: 이미 가입했으면 /로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수' } })
    renderAt('/onboarding')
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: 실패 확인**

```bash
npm test
```
Expected: 두 파일 FAIL — 모듈을 찾을 수 없음.

- [ ] **Step 5: 구현 — `src/features/auth/AuthProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

export type AuthState = { status: 'loading' } | { status: 'ready'; session: Session | null }

const AuthContext = createContext<AuthState | null>(null)

/** OAuth 콜백으로 붙은 ?code= 를 주소에서 지운다 (해시 라우트는 유지). */
function stripOAuthCode() {
  if (typeof window === 'undefined') return
  if (!window.location.search.includes('code=')) return
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ status: 'ready', session: data.session })
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ status: 'ready', session })
      if (session) stripOAuthCode()
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 쓸 수 있습니다')
  return ctx
}
```

- [ ] **Step 6: 구현 — `src/features/auth/usePerson.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import type { Database } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'

export type Person = Database['public']['Tables']['people']['Row']

export const personQueryKey = (userId: string | undefined) => ['person', userId] as const

/** 로그인한 계정에 연결된 사람 행. 없으면 null (가입 전). */
export function usePerson(userId: string | undefined) {
  return useQuery({
    queryKey: personQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Person | null> => {
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .eq('auth_user_id', userId!)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}
```

- [ ] **Step 7: 구현 — `src/features/auth/Gate.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Spinner } from '../../components/ui'
import { HomePage } from '../../pages/HomePage'
import { StartPage } from '../../pages/StartPage'
import { useAuth } from './AuthProvider'
import { usePerson } from './usePerson'

/** `#/` : 비로그인 → 시작 화면, 로그인·미가입 → 가입, 가입 완료 → 홈 */
export function Gate() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <StartPage />
  if (person.status === 'pending') return <Spinner />
  if (person.status === 'error') return <Spinner label="연결에 문제가 있어요. 새로고침해 주세요" />
  if (!person.data) return <Navigate to="/onboarding" replace />
  return <HomePage person={person.data} />
}

/** 로그인은 했지만 아직 가입 전인 사람만 통과 (가입 화면용) */
export function RequireSession({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <Navigate to="/" replace />
  if (person.status === 'pending') return <Spinner />
  if (person.data) return <Navigate to="/" replace />
  return <>{children}</>
}
```

- [ ] **Step 8: 페이지 스텁 4개**

`src/pages/StartPage.tsx`:
```tsx
export function StartPage() {
  return <main className="p-6"><h1 className="text-2xl font-extrabold">시작</h1></main>
}
```

`src/pages/HomePage.tsx`:
```tsx
import type { Person } from '../features/auth/usePerson'

export function HomePage({ person }: { person: Person }) {
  return <main className="p-6"><h1 className="text-2xl font-extrabold">{person.name} 님</h1></main>
}
```

`src/pages/PrivacyPage.tsx`:
```tsx
export function PrivacyPage() {
  return <main className="p-6"><h1 className="text-2xl font-extrabold">개인정보 처리방침</h1></main>
}
```

`src/features/onboarding/OnboardingPage.tsx`:
```tsx
export function OnboardingPage() {
  return <main className="p-6"><h1 className="text-2xl font-extrabold">처음 오셨네요</h1></main>
}
```

- [ ] **Step 9: `src/App.tsx`를 Provider + 라우터로 교체**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './features/auth/AuthProvider'
import { Gate, RequireSession } from './features/auth/Gate'
import { OnboardingPage } from './features/onboarding/OnboardingPage'
import { PrivacyPage } from './pages/PrivacyPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Gate />} />
            <Route path="/onboarding" element={<RequireSession><OnboardingPage /></RequireSession>} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<Gate />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 10: `src/App.test.tsx`를 라우팅 스모크로 교체**

```tsx
import { render, screen } from '@testing-library/react'
import App from './App'

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

describe('App', () => {
  it('비로그인 상태에서 시작 화면을 보여준다', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: '시작' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 11: 통과 확인**

```bash
npm test
```
Expected: 모두 통과 (`20 passed`).

- [ ] **Step 12: 커밋**

```bash
git add -A
git commit -m "feat: 세션 컨텍스트, 사람 조회 훅, 해시 라우팅 뼈대와 UI 기본 컴포넌트"
```

---

### Task 10: 로그인 — 카카오 · 개발용 이메일 · 로그아웃, 시작 화면

**Files:**
- Create: `src/config/church.ts`, `src/features/auth/signIn.ts`
- Modify: `src/pages/StartPage.tsx`
- Test: `src/features/auth/signIn.test.ts`, `src/pages/StartPage.test.tsx`

- [ ] **Step 1: 교회 설정 — `src/config/church.ts`**

값은 교회에서 확인한 뒤 바꾼다. 처리방침 페이지와 가입 화면이 이 값을 읽는다.

```ts
export const church = {
  /** 교회 공식 명칭 (교회 확인 필요) */
  name: 'OO교회',
  /** 카카오 동의 화면과 앱 상단에 보이는 이름 */
  appName: 'OO교회 식권',
  /** 개인정보 담당자 (교회 확인 필요) */
  privacyOfficer: { role: '식당 담당 권사', name: '', phone: '' },
  /** 동의 문구를 바꾸면 이 날짜도 바꾼다. people.consent_version 에 저장된다 */
  consentVersion: '2026-10-07',
  /** 가입 화면과 처리방침에 공통으로 쓰는 고지 4요소 */
  consentNotice: {
    items: '이름, 휴대폰 번호',
    purpose: '식권 발급·사용 확인, 본인 식별',
    retention: '탈퇴 시까지 (탈퇴 후 이름·번호는 익명 처리)',
    refusal: '동의하지 않으면 서비스를 이용할 수 없습니다',
  },
} as const
```

- [ ] **Step 2: 실패하는 테스트 — `src/features/auth/signIn.test.ts`**

```ts
import { signInWithKakao, devSignIn, signOut, redirectUrl } from './signIn'

const { signInWithOAuth, signInWithPassword, signUp, authSignOut } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  authSignOut: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth, signInWithPassword, signUp, signOut: authSignOut } },
}))

describe('signIn', () => {
  it('redirectUrl은 origin + BASE_URL', () => {
    expect(redirectUrl()).toBe(`${window.location.origin}${import.meta.env.BASE_URL}`)
  })

  it('카카오 로그인은 kakao provider와 redirectTo를 넘긴다', async () => {
    signInWithOAuth.mockResolvedValue({ error: null })
    await signInWithKakao()
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'kakao',
      options: { redirectTo: redirectUrl() },
    })
  })

  it('카카오 로그인 오류는 그대로 던진다', async () => {
    signInWithOAuth.mockResolvedValue({ error: new Error('oauth_failed') })
    await expect(signInWithKakao()).rejects.toThrow('oauth_failed')
  })

  it('개발 로그인: 비밀번호 로그인 성공이면 끝', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    await devSignIn('a@test.local', 'password123')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('개발 로그인: 로그인 실패면 가입을 시도한다', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') })
    signUp.mockResolvedValue({ error: null })
    await devSignIn('new@test.local', 'password123')
    expect(signUp).toHaveBeenCalledWith({ email: 'new@test.local', password: 'password123' })
  })

  it('로그아웃을 호출한다', async () => {
    authSignOut.mockResolvedValue({ error: null })
    await signOut()
    expect(authSignOut).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 실패하는 테스트 — `src/pages/StartPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { StartPage } from './StartPage'

const { signInWithKakao, devSignIn, env } = vi.hoisted(() => ({
  signInWithKakao: vi.fn(),
  devSignIn: vi.fn(),
  env: { enableDevLogin: false },
}))
vi.mock('../features/auth/signIn', () => ({ signInWithKakao, devSignIn }))
vi.mock('../lib/env', () => ({ env }))

function renderPage() {
  return render(<MemoryRouter><StartPage /></MemoryRouter>)
}

describe('StartPage', () => {
  beforeEach(() => {
    env.enableDevLogin = false
    vi.clearAllMocks()
  })

  it('앱 이름과 카카오 버튼, 처리방침 링크를 보여준다', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'OO교회 식권' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '카카오로 시작하기' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '개인정보 처리방침' })).toHaveAttribute('href', '/privacy')
  })

  it('카카오 버튼을 누르면 로그인을 시작한다', async () => {
    signInWithKakao.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카카오로 시작하기' }))
    expect(signInWithKakao).toHaveBeenCalled()
  })

  it('로그인 실패 시 안내 문구를 보여준다', async () => {
    signInWithKakao.mockRejectedValue(new Error('oauth_failed'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '카카오로 시작하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해 주세요.')
  })

  it('개발 로그인 플래그가 꺼져 있으면 이메일 폼이 없다', () => {
    renderPage()
    expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument()
  })

  it('개발 로그인 플래그가 켜져 있으면 이메일·비밀번호로 로그인한다', async () => {
    env.enableDevLogin = true
    devSignIn.mockResolvedValue(undefined)
    renderPage()
    await userEvent.type(screen.getByLabelText('이메일'), 'dev@test.local')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: '개발용 로그인' }))
    expect(devSignIn).toHaveBeenCalledWith('dev@test.local', 'password123')
  })
})
```

- [ ] **Step 4: 실패 확인**

```bash
npm test
```
Expected: 두 파일 FAIL.

- [ ] **Step 5: 구현 — `src/features/auth/signIn.ts`**

```ts
import { supabase } from '../../lib/supabase'

/** OAuth 후 돌아올 주소. GitHub Pages면 https://<user>.github.io/<repo>/ */
export function redirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export async function signInWithKakao(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: redirectUrl() },
  })
  if (error) throw error
}

/** 로컬·테스트 전용. 로그인 실패 시 가입을 시도한다 (로컬은 이메일 확인이 꺼져 있어 바로 세션이 생긴다). */
export async function devSignIn(email: string, password: string): Promise<void> {
  const signedIn = await supabase.auth.signInWithPassword({ email, password })
  if (!signedIn.error) return
  const signedUp = await supabase.auth.signUp({ email, password })
  if (signedUp.error) throw signedUp.error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
```

- [ ] **Step 6: 구현 — `src/pages/StartPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, TextField } from '../components/ui'
import { church } from '../config/church'
import { devSignIn, signInWithKakao } from '../features/auth/signIn'
import { env } from '../lib/env'
import { toUserMessage } from '../lib/errors'

export function StartPage() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function onDevSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    void run(() => devSignIn(email, password))
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold">{church.appName}</h1>
        <p className="mt-2 text-sm text-gray-500">주일 식사를 더 간편하게</p>
      </div>

      <Button variant="kakao" disabled={busy} onClick={() => void run(signInWithKakao)}>
        카카오로 시작하기
      </Button>

      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}

      {env.enableDevLogin && (
        <form onSubmit={onDevSubmit} className="mt-6 flex flex-col gap-3 rounded-xl border border-dashed border-gray-300 p-4">
          <p className="text-xs font-semibold text-gray-500">개발용 로그인 (로컬 전용)</p>
          <TextField label="이메일" name="email" type="email" autoComplete="username" required />
          <TextField label="비밀번호" name="password" type="password" autoComplete="current-password" required minLength={6} />
          <Button variant="ghost" type="submit" disabled={busy}>
            개발용 로그인
          </Button>
        </form>
      )}

      <Link to="/privacy" className="mt-8 text-center text-xs text-gray-400 underline">
        개인정보 처리방침
      </Link>
    </main>
  )
}
```

- [ ] **Step 7: 통과 확인**

```bash
npm test
```
Expected: 모두 통과. `App.test.tsx`의 "시작" 제목 기대값이 깨지므로 `{ name: 'OO교회 식권' }`으로 수정한다. 또한 `App.test.tsx`는 `./lib/env`를 모킹하지 않으므로 `.env.local`이 있어야 한다(Task 3에서 작성). `.env.local`이 없으면 `vi.mock('./lib/env', () => ({ env: { enableDevLogin: false } }))`를 `App.test.tsx`에 추가한다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: 카카오·개발용 로그인과 시작 화면, 교회 설정 상수"
```

---

### Task 11: 가입 화면 — 이름·휴대폰 번호·개인정보 동의 → `claim_person`

**Files:**
- Create: `src/features/onboarding/onboardingSchema.ts`
- Modify: `src/features/onboarding/OnboardingPage.tsx`
- Test: `src/features/onboarding/onboardingSchema.test.ts`, `src/features/onboarding/OnboardingPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 — `src/features/onboarding/onboardingSchema.test.ts`**

```ts
import { validateOnboarding } from './onboardingSchema'

describe('validateOnboarding', () => {
  it('정상 입력은 번호를 정규화해 돌려준다', () => {
    const r = validateOnboarding({ name: ' 김철수 ', phone: '010-1234-5678', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678', consent: true } })
  })

  it('이름이 비면 이름 오류', () => {
    const r = validateOnboarding({ name: '  ', phone: '01012345678', consent: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.name).toBe('이름을 입력해 주세요')
  })

  it('이름이 20자를 넘으면 오류', () => {
    const r = validateOnboarding({ name: '가'.repeat(21), phone: '01012345678', consent: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.name).toBe('이름은 20자 이내로 입력해 주세요')
  })

  it('휴대폰 형식이 아니면 번호 오류', () => {
    const r = validateOnboarding({ name: '김철수', phone: '02-123-4567', consent: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.phone).toBe('휴대폰 번호를 확인해 주세요')
  })

  it('동의하지 않으면 동의 오류', () => {
    const r = validateOnboarding({ name: '김철수', phone: '01012345678', consent: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.consent).toBe('개인정보 동의가 필요해요')
  })
})
```

- [ ] **Step 2: 실패하는 테스트 — `src/features/onboarding/OnboardingPage.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { OnboardingPage } from './OnboardingPage'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillValid() {
  await userEvent.type(screen.getByLabelText('이름'), '김철수')
  await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-1234-5678')
  await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
}

describe('OnboardingPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('고지 4요소와 처리방침 링크를 보여주고, 동의 전에는 버튼이 비활성이다', () => {
    renderPage()
    expect(screen.getByText(/이름, 휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByText(/식권 발급·사용 확인/)).toBeInTheDocument()
    expect(screen.getByText(/탈퇴 시까지/)).toBeInTheDocument()
    expect(screen.getByText(/동의하지 않으면/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '자세히' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('button', { name: '동의하고 시작하기' })).toBeDisabled()
  })

  it('번호가 틀리면 오류를 보여주고 서버를 호출하지 않는다', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('이름'), '김철수')
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123-4567')
    await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('성공하면 claim_person을 정규화된 값으로 호출하고 홈으로 간다', async () => {
    rpc.mockResolvedValue({ data: { id: 'p1' }, error: null })
    renderPage()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
    expect(rpc).toHaveBeenCalledWith('claim_person', {
      p_name: '김철수',
      p_phone: '01012345678',
      p_consent_version: '2026-10-07',
    })
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('서버 오류 코드를 사용자 문구로 보여준다', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'phone_taken' } })
    renderPage()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 등록된 번호예요. 권사님께 문의해 주세요.')
  })
})
```

- [ ] **Step 3: 실패 확인**

```bash
npm test
```
Expected: 두 파일 FAIL.

`QueryClientProvider` + `MemoryRouter` 조합이 이 Task부터 여러 테스트에 반복되면, `src/test/renderWithProviders.tsx`(테스트마다 새 `QueryClient({ defaultOptions: { queries: { retry: false } } })` + `MemoryRouter`)로 뽑아 공용으로 쓴다. 테스트 코드 중복이 두 파일을 넘기 전에는 만들지 않는다.

- [ ] **Step 4: 구현 — `src/features/onboarding/onboardingSchema.ts`**

```ts
import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'

export const onboardingSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요').max(20, '이름은 20자 이내로 입력해 주세요'),
  phone: z.string().transform(normalizePhone).refine(isValidMobile, '휴대폰 번호를 확인해 주세요'),
  consent: z.boolean().refine((v) => v === true, '개인정보 동의가 필요해요'),
})

export type OnboardingInput = z.input<typeof onboardingSchema>
export type OnboardingValues = z.output<typeof onboardingSchema>
export type OnboardingErrors = Partial<Record<keyof OnboardingInput, string>>

export function validateOnboarding(
  input: OnboardingInput,
): { ok: true; values: OnboardingValues } | { ok: false; errors: OnboardingErrors } {
  const result = onboardingSchema.safeParse(input)
  if (result.success) return { ok: true, values: result.data }
  const errors: OnboardingErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof OnboardingInput | undefined
    if (key && !errors[key]) errors[key] = issue.message
  }
  return { ok: false, errors }
}
```

- [ ] **Step 5: 구현 — `src/features/onboarding/OnboardingPage.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Checkbox, TextField } from '../../components/ui'
import { church } from '../../config/church'
import { toUserMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { validateOnboarding, type OnboardingErrors, type OnboardingValues } from './onboardingSchema'

async function claimPerson(values: OnboardingValues) {
  const { data, error } = await supabase.rpc('claim_person', {
    p_name: values.name,
    p_phone: values.phone,
    p_consent_version: church.consentVersion,
  })
  if (error) throw error
  return data
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<OnboardingErrors>({})

  const mutation = useMutation({
    mutationFn: claimPerson,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['person'] })
      navigate('/', { replace: true })
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateOnboarding({ name, phone, consent })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    mutation.mutate(result.values)
  }

  const notice = church.consentNotice
  const serverError = mutation.isError ? toUserMessage(mutation.error) : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">처음 오셨네요</h1>
      <p className="text-sm text-gray-500">권사님이 식권을 발급할 때 쓰는 정보예요. 입금하신 이름과 같게 적어 주세요.</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="이름"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={20}
          error={errors.name}
        />
        <TextField
          label="휴대폰 번호"
          name="phone"
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          placeholder="010-0000-0000"
          error={errors.phone}
        />

        <section className="rounded-xl border border-blue-600 bg-white p-3 text-xs leading-relaxed">
          <Checkbox name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)}>
            <b>[필수] 개인정보 수집·이용 동의</b>{' '}
            <Link to="/privacy" className="text-blue-600 underline">자세히</Link>
          </Checkbox>
          <dl className="mt-2 grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 pl-6 text-gray-500">
            <dt>항목</dt><dd>{notice.items}</dd>
            <dt>목적</dt><dd>{notice.purpose}</dd>
            <dt>보유</dt><dd>{notice.retention}</dd>
            <dt>거부 시</dt><dd>{notice.refusal}</dd>
          </dl>
          {errors.consent && <p role="alert" className="mt-2 pl-6 text-red-600">{errors.consent}</p>}
        </section>

        {serverError && <p role="alert" className="text-sm text-red-600">{serverError}</p>}

        <Button type="submit" disabled={!consent || mutation.isPending}>
          {mutation.isPending ? '처리 중…' : '동의하고 시작하기'}
        </Button>
      </form>
    </main>
  )
}
```

- [ ] **Step 6: 통과 확인**

```bash
npm test
```
Expected: 모두 통과.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 가입 화면 (이름·번호 검증, 개인정보 동의, claim_person 호출)"
```

---

### Task 12: 개인정보 처리방침 페이지

**Files:**
- Modify: `src/pages/PrivacyPage.tsx`
- Test: `src/pages/PrivacyPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 — `src/pages/PrivacyPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  it('교회명, 고지 4요소, 시행일, 돌아가기 링크를 보여준다', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '개인정보 처리방침' })).toBeInTheDocument()
    expect(screen.getAllByText(/OO교회/).length).toBeGreaterThan(0)
    expect(screen.getByText(/이름, 휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByText(/식권 발급·사용 확인/)).toBeInTheDocument()
    expect(screen.getByText(/탈퇴 시까지/)).toBeInTheDocument()
    expect(screen.getByText(/동의하지 않으면/)).toBeInTheDocument()
    expect(screen.getByText(/시행일: 2026-10-07/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '돌아가기' })).toHaveAttribute('href', '/')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npm test
```
Expected: FAIL — 고지 문구 없음.

- [ ] **Step 3: 구현 — `src/pages/PrivacyPage.tsx`**

```tsx
import { Link } from 'react-router'
import { church } from '../config/church'

export function PrivacyPage() {
  const n = church.consentNotice
  const officer = church.privacyOfficer
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-extrabold">개인정보 처리방침</h1>
      <p>
        {church.name}(이하 "교회")은 식권 서비스 운영을 위해 아래와 같이 개인정보를 처리합니다.
      </p>

      <section>
        <h2 className="mb-1 font-bold">1. 수집 항목</h2>
        <p>{n.items}. 만 14세 미만 자녀는 보호자가 입력한 이름만 처리하며, 보호자(법정대리인)의 동의를 받습니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">2. 수집·이용 목적</h2>
        <p>{n.purpose}</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">3. 보유 및 이용 기간</h2>
        <p>{n.retention}. 발급·사용 기록은 사람을 알아볼 수 없게 처리한 뒤 회계 통계 목적으로만 보관합니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">4. 동의 거부 권리</h2>
        <p>동의를 거부할 수 있습니다. 다만 {n.refusal}.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">5. 처리 위탁</h2>
        <p>데이터 저장과 로그인 처리를 위해 Supabase(데이터베이스·인증), 카카오(소셜 로그인)를 이용합니다. 카카오에서는 회원번호와 닉네임만 제공받습니다.</p>
      </section>
      <section>
        <h2 className="mb-1 font-bold">6. 개인정보 담당자</h2>
        <p>
          {officer.role}
          {officer.name && ` ${officer.name}`}
          {officer.phone && ` · ${officer.phone}`}
        </p>
      </section>
      <p className="text-xs text-gray-500">시행일: {church.consentVersion}</p>

      <Link to="/" className="mt-4 text-center text-blue-600 underline">돌아가기</Link>
    </main>
  )
}
```

- [ ] **Step 4: 통과 확인**

```bash
npm test
```
Expected: 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 개인정보 처리방침 페이지"
```

---

### Task 13: 홈 화면 기초 — 인사 · "오늘은 식사가 없어요" · 로그아웃

식권 목록은 2단계에서 들어온다. 여기서는 가입 후 도착하는 화면의 틀과 로그아웃만 만든다.

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Test: `src/pages/HomePage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 — `src/pages/HomePage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Person } from '../features/auth/usePerson'
import { HomePage } from './HomePage'

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('../features/auth/signIn', () => ({ signOut }))

const person = {
  id: 'p1', family_id: 'f1', name: '김철수', phone: '01012345678', auth_user_id: 'u1',
  role: 'member', is_minor: false, guardian_id: null, consented_at: '2026-10-07T00:00:00Z',
  consent_version: '2026-10-07', guardian_consented_at: null, deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
} satisfies Person

describe('HomePage', () => {
  it('이름과 가려진 번호, 식사 없음 카드를 보여준다', () => {
    render(<HomePage person={person} />)
    expect(screen.getByRole('heading', { name: '김철수 님' })).toBeInTheDocument()
    expect(screen.getByText('010-****-5678')).toBeInTheDocument()
    expect(screen.getByText('오늘은 식사가 없어요')).toBeInTheDocument()
  })

  it('로그아웃 버튼이 signOut을 부른다', async () => {
    signOut.mockResolvedValue(undefined)
    render(<HomePage person={person} />)
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npm test
```
Expected: FAIL — 번호·카드·버튼 없음.

- [ ] **Step 3: 구현 — `src/pages/HomePage.tsx`**

```tsx
import type { Person } from '../features/auth/usePerson'
import { signOut } from '../features/auth/signIn'
import { maskPhone } from '../lib/phone'

export function HomePage({ person }: { person: Person }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-extrabold">{person.name} 님</h1>
        <span className="text-xs text-gray-500">{maskPhone(person.phone)}</span>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500">
        <div className="mb-2 text-3xl" aria-hidden>🍚</div>
        <p className="text-sm">오늘은 식사가 없어요</p>
      </section>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => void signOut()}
        className="self-center text-xs text-gray-400 underline"
      >
        로그아웃
      </button>
    </main>
  )
}
```

- [ ] **Step 4: 통과 확인 + 커버리지**

```bash
npm run test:coverage
```
Expected: 모두 통과, 커버리지 임계치(라인 80%) 충족. 미달이면 어떤 파일이 낮은지 출력을 보고 그 파일의 테스트를 보강한다.

- [ ] **Step 5: 브라우저에서 전체 흐름 수동 확인**

```bash
npm run dev
```
`http://localhost:5173` → 개발용 로그인(아무 이메일·비밀번호 6자 이상) → "처음 오셨네요" → 이름·번호·동의 → "김철수 님 / 오늘은 식사가 없어요" → 새로고침해도 홈 유지 → 로그아웃하면 시작 화면.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 홈 화면 기초 (인사, 식사 없음 카드, 로그아웃)"
```

---

### Task 14: Playwright 스모크 E2E — 개발 로그인 → 가입 → 홈

**Files:**
- Create: `playwright.config.ts`, `e2e/onboarding.spec.ts`
- Modify: `package.json` (scripts), `tsconfig.app.json`(e2e 제외 확인)

- [ ] **Step 1: 설치**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: `playwright.config.ts` 작성**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
```

`devices['Pixel 7']`은 Chromium 기반 모바일 뷰포트다(WebKit 설치 불필요).

- [ ] **Step 3: 스모크 테스트 — `e2e/onboarding.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

test('개발 로그인 → 가입 → 홈 → 새로고침 유지', async ({ page }) => {
  const stamp = Date.now().toString().slice(-8) // 8자리 → 010 + 8자리 = 11자리 번호
  const email = `e2e-${stamp}@test.local`
  const phone = `010${stamp}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'OO교회 식권' })).toBeVisible()

  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill('password123')
  await page.getByRole('button', { name: '개발용 로그인' }).click()

  await expect(page.getByRole('heading', { name: '처음 오셨네요' })).toBeVisible()
  await expect(page.getByRole('button', { name: '동의하고 시작하기' })).toBeDisabled()

  await page.getByLabel('이름').fill('김철수')
  await page.getByLabel('휴대폰 번호').fill(phone)
  await page.getByLabel(/개인정보 수집·이용 동의/).check()
  await page.getByRole('button', { name: '동의하고 시작하기' }).click()

  await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()
  await expect(page.getByText('오늘은 식사가 없어요')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '김철수 님' })).toBeVisible()

  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page.getByRole('button', { name: '카카오로 시작하기' })).toBeVisible()
})
```

- [ ] **Step 4: scripts 추가 후 실행 (로컬 Supabase가 떠 있어야 한다)**

`package.json` scripts에 추가:
```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

```bash
npm run e2e
```
Expected: `1 passed`. 실패하면 `npx playwright show-report`로 스크린샷을 본다.

- [ ] **Step 5: e2e 파일도 타입 검사에 포함시킨다**

`tsconfig.app.json`의 `include`는 `["src"]` 그대로 둔다(앱 번들에 e2e가 섞이면 안 된다). 대신 `tsconfig.node.json`의 `include`를 `["vite.config.ts", "playwright.config.ts", "e2e/**/*.ts"]`로 바꿔 `tsc -b`가 Playwright 설정과 테스트도 검사하게 한다. `npm run build`가 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "test: Playwright 스모크 E2E (개발 로그인 → 가입 → 홈)"
```

---

### Task 15: GitHub Actions — CI · 배포 · keep-alive

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/workflows/keep-alive.yml`
- Create: `supabase/migrations/20261007000004_ping.sql`
- Test: `supabase/tests/database/050_ping.sql`

- [ ] **Step 1: 실패하는 테스트 — `supabase/tests/database/050_ping.sql`**

```sql
begin;
select plan(2);

set local role anon;
select is(public.ping(), 1, 'anon도 ping을 호출할 수 있다 (keep-alive용)');
reset role;

select is(
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'ping' and grantee = 'anon'),
  1::bigint, 'ping 실행 권한이 anon에게 있다'
);

select * from finish();
rollback;
```

- [ ] **Step 2: 실패 확인**

```bash
npm run db:test
```
Expected: `050_ping.sql` FAIL — `function public.ping() does not exist`.

- [ ] **Step 3: 마이그레이션 — `supabase/migrations/20261007000004_ping.sql`**

```sql
-- keep-alive 용. 무료 플랜의 7일 미사용 일시정지를 막기 위해 GitHub Actions가 3일마다 호출한다.
create or replace function public.ping()
returns integer
language sql
stable
as $$ select 1 $$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
```

```bash
npm run db:reset && npm run db:test
```
Expected: 5개 파일 모두 `ok`.

- [ ] **Step 4: `.github/workflows/ci.yml`**

PR과 `workflow_call`(배포 워크플로가 호출)에서 돈다.

```yaml
name: CI

on:
  pull_request:
  workflow_call:

jobs:
  test:
    name: DB · 단위 · E2E 테스트
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: 로컬 Supabase 기동
        run: npx supabase start -x studio,postgres-meta,mailpit

      - name: 로컬 환경변수 작성
        run: |
          eval "$(npx supabase status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY)=')"
          {
            echo "VITE_SUPABASE_URL=$API_URL"
            echo "VITE_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY"
            echo "VITE_ENABLE_DEV_LOGIN=true"
            echo "VITE_BASE_PATH=/"
          } > .env.local

      - name: DB 테스트 (pgTAP)
        run: npx supabase test db

      - name: 린트
        run: npm run lint

      - name: 단위·컴포넌트 테스트 + 커버리지
        run: npm run test:coverage

      - name: 빌드 (타입 검사 포함)
        run: npm run build

      - name: Playwright 브라우저 설치
        run: npx playwright install chromium --with-deps

      - name: E2E
        run: npm run e2e

      - name: E2E 리포트 보관 (실패 시)
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7

      - name: 로컬 Supabase 종료
        if: always()
        run: npx supabase stop --no-backup
```

- [ ] **Step 5: `.github/workflows/deploy.yml`**

main에 push되면 테스트 → DB 마이그레이션 → Pages 배포 순서로 돈다.

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  test:
    uses: ./.github/workflows/ci.yml

  migrate:
    name: 운영 DB 마이그레이션
    needs: test
    runs-on: ubuntu-latest
    environment: production
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: 프로젝트 연결
        run: npx supabase link --project-ref "${{ secrets.SUPABASE_PROJECT_REF }}" -p "$SUPABASE_DB_PASSWORD"
      - name: 마이그레이션 적용
        run: npx supabase db push -p "$SUPABASE_DB_PASSWORD"

  deploy:
    name: GitHub Pages 배포
    needs: migrate
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: 빌드
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}
          VITE_ENABLE_DEV_LOGIN: 'false'
          VITE_BASE_PATH: /${{ github.event.repository.name }}/
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: `.github/workflows/keep-alive.yml`**

설계 문서는 keep-alive를 5단계에 두었지만, 운영 DB가 생기는 순간부터 일시정지 위험이 있으므로 여기서 함께 넣는다.

```yaml
name: Keep alive

on:
  schedule:
    - cron: '17 3 */3 * *'   # 3일마다 03:17 UTC
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Supabase ping
        run: |
          curl -fsS -X POST "${{ vars.VITE_SUPABASE_URL }}/rest/v1/rpc/ping" \
            -H "apikey: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}" \
            -H "Authorization: Bearer ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{}'
```

GitHub는 저장소에 60일간 커밋이 없으면 schedule 워크플로를 자동으로 끈다. README의 운영 체크리스트에 적는다.

- [ ] **Step 7: 워크플로 문법 확인**

```bash
npx --yes @action-validator/cli .github/workflows/ci.yml .github/workflows/deploy.yml .github/workflows/keep-alive.yml 2>/dev/null || echo "validator 미설치 — GitHub에 push 후 Actions 탭에서 문법 오류 확인"
```

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "ci: 테스트·배포·keep-alive 워크플로와 ping 함수"
```

---

### Task 16: README — 로컬 개발과 운영 설정 안내

**Files:**
- Create: `README.md`

- [ ] **Step 1: `README.md` 작성**

````markdown
# 교회 식권

교회 주일 식사 식권의 발급·사용·관리를 모바일 웹에서 처리하는 서비스.
설계: `docs/superpowers/specs/2026-10-07-church-meal-ticket-design.md`

## 로컬 개발

필요: Node 20.19 이상(`.nvmrc` 참고. CI는 Node 22), Docker Desktop.

```bash
npm install
npm run db:start           # 로컬 Supabase (처음 1~3분)
npx supabase status -o env # API_URL, PUBLISHABLE_KEY 확인 → .env.local 에 기입 (.env.example 참고)
npm run dev                # http://localhost:5173
```

로컬은 카카오 대신 **개발용 이메일 로그인**을 쓴다(`VITE_ENABLE_DEV_LOGIN=true`).

| 명령 | 설명 |
|---|---|
| `npm test` / `npm run test:coverage` | 단위·컴포넌트 테스트 |
| `npm run db:test` | DB 함수·RLS 테스트 (pgTAP) |
| `npm run e2e` | Playwright (로컬 Supabase 필요) |
| `npm run db:reset` | 마이그레이션·시드 재적용 |
| `npm run db:types` | DB 타입 재생성 (`src/lib/database.types.ts`) |
| `npx supabase migration new <이름>` | 새 마이그레이션 파일 |

## 운영 설정 (최초 1회)

### 1. Supabase 프로젝트 (Free)

1. https://supabase.com 에서 프로젝트 생성 (리전: Northeast Asia (Seoul)). DB 비밀번호를 안전한 곳에 보관.
2. **Authentication › URL Configuration**
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: 같은 주소 추가.
3. **Authentication › Sign In / Providers**
   - Email: 운영에서는 **끄기** (개발용 로그인은 운영 빌드에 없다).
   - Anonymous sign-ins: **켜기** (3단계 아이 계정용. 미리 켜 두어도 무방).
   - Kakao: **켜기**. 아래 카카오 콘솔에서 받은 REST API 키를 Client ID에, Client Secret 코드를 Secret에 입력. **"Allow users without an email"을 켠다.**
   - Kakao 설정 화면에 표시되는 Callback URL(`https://<ref>.supabase.co/auth/v1/callback`)을 복사해 둔다.
4. **Project Settings › API Keys**: Project URL과 **Publishable key**(`sb_publishable_…`)를 복사해 둔다. 레거시 anon JWT는 쓰지 않는다.
5. **Project Settings › General**: Reference ID(`<ref>`)를 복사해 둔다.
6. **Account › Access Tokens**에서 CI용 토큰을 하나 만든다.

### 2. 카카오 개발자 콘솔

1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가. 앱 이름 `OO교회 식권`, 회사명 교회명. (비즈 앱 전환 불필요)
2. **앱 설정 › 플랫폼 › Web**: 사이트 도메인 `https://<github-user>.github.io`.
3. **제품 설정 › 카카오 로그인**: 활성화 ON. Redirect URI에 Supabase Callback URL 등록.
4. **제품 설정 › 카카오 로그인 › 동의항목**: 닉네임(profile_nickname)만 "필수 동의". 프로필 사진·이메일은 설정하지 않는다.
5. **제품 설정 › 카카오 로그인 › 보안**: Client Secret 코드 생성, 상태 "사용함".
6. **앱 설정 › 앱 키**의 REST API 키와 위 Client Secret을 Supabase Kakao provider에 입력.
7. 운영 전까지는 콘솔에서 **팀원**으로 교회 담당자 계정을 추가해 둔다.

### 3. GitHub 저장소

1. 공개 저장소로 push. **Settings › Pages › Build and deployment › Source: GitHub Actions**.
2. **Settings › Secrets and variables › Actions**
   - Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
3. **Settings › Environments**: `production` 생성(선택: 승인자 지정).
4. main에 push하면 `Deploy` 워크플로가 테스트 → 마이그레이션 → 배포를 수행한다.

### 4. 최초 관리자 지정

관리자가 될 분이 먼저 앱에서 카카오로 가입한다. 그 뒤 Supabase **SQL Editor**에서:

```sql
update public.people set role = 'admin' where phone = '01012345678' and deleted_at is null;
```

### 5. 운영 체크리스트

- `Keep alive` 워크플로가 3일마다 돌아 무료 플랜 일시정지를 막는다. 저장소에 60일간 커밋이 없으면 GitHub가 스케줄을 끄므로 Actions 탭에서 다시 켠다.
- 일시정지되면 Supabase 대시보드에서 "Restore"를 누른다(1~2분).
- 백업(주 1회 pg_dump → 비공개 저장소)은 5단계 계획에서 추가한다.
- `src/config/church.ts`의 교회명·담당자 연락처를 실제 값으로 바꾼 뒤 배포한다.

### 6. 절대 운영에 실행하면 안 되는 명령

- `supabase db reset --linked` — 운영 DB를 비우고 테스트용 시드(가짜 사용자 생성 헬퍼)를 넣는다.
- `supabase db push --include-seed` — 시드를 운영에 적용한다. CI는 `--include-seed` 없이 `db push`만 쓴다.
- `supabase config push` — 로컬 `config.toml`(localhost 주소, 카카오 없음)로 운영 Auth 설정을 덮어쓴다.
````

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: 로컬 개발·운영 설정 README"
```

---

## 완료 기준

- `npm run db:test`, `npm run test:coverage`(80% 이상), `npm run build`, `npm run e2e`가 모두 통과한다.
- 브라우저에서 개발 로그인 → 가입(동의) → 홈 → 새로고침 유지 → 로그아웃이 된다.
- GitHub에 push하면 CI가 초록불이고, Pages 주소에서 카카오 로그인 → 가입 → 홈이 된다(운영 설정 완료 후).
- 다음 계획(2단계 · 식권 핵심)은 meals/issuances/usages 스키마와 `use_ticket`, 관리자 식사·발급, 교인 홈 식권 목록을 다룬다.
