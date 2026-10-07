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
          'src/lib/supabase.ts',
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

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/020_people_schema.sql`**

```sql
begin;
select plan(25);

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
select is(public.normalize_phone('0082-010-9876-5432'), '01098765432', '0082 + 0 표기도 010 으로');
select is(public.normalize_phone(''), null, '빈 문자열은 null');
select is(public.is_valid_mobile(null), false, 'is_valid_mobile(null) 은 false');

-- 이름 정규화: 비교 키는 공백을 지우고 NFC 로 맞춘다 (iOS 가 보내는 NFD 자모 분해 대응)
select is(public.normalize_name(' 김 철수 '), '김철수', 'normalize_name 은 공백을 제거한다');
select is(public.normalize_name(normalize('김철수', NFD)), '김철수', 'normalize_name 은 NFC 로 맞춘다');
insert into public.people (name, phone) values (normalize('홍길동', NFD), '01077770001');
select is((select name from public.people where phone = '01077770001'), '홍길동', '트리거가 이름을 NFC 로 저장한다');

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

-- 기본 차단: auto_expose_new_tables=true 라서 새 테이블은 anon 전체 권한으로 태어난다. revoke 를 잊으면 여기서 잡힌다.
select table_privs_are('public','people','anon', '{}'::text[], 'anon은 people에 아무 권한이 없다');
select table_privs_are('public','people','authenticated','{SELECT}'::text[], 'authenticated는 people을 읽기만 할 수 있다 (열 단위 insert/update 는 table_privs_are 에 안 보임)');
select table_privs_are('public','families','anon','{}'::text[], 'anon은 families에 아무 권한이 없다');
select table_privs_are('public','families','authenticated','{SELECT}'::text[], 'authenticated는 families를 읽기만 할 수 있다');
select is((select relrowsecurity from pg_class where oid='public.people'::regclass), true, 'people에 RLS가 켜져 있다');
select is((select relrowsecurity from pg_class where oid='public.families'::regclass), true, 'families에 RLS가 켜져 있다');

-- auto_expose_new_tables=true 는 새 함수에도 anon=X 를 자동으로 붙인다. grant 에서 anon 을 빼는 것만으론
-- 지워지지 않으므로 revoke 가 필요하다. 1단계에는 anon RPC 가 하나도 없다.
-- 함수 이름을 열거하지 않으므로, 함수가 새로 늘어나도 revoke 를 잊으면 여기서 잡힌다.
select is(
  (select coalesce(array_agg(p.proname order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  '{}'::name[], 'public 스키마의 어떤 함수도 anon 에게 열려 있지 않다');

-- 계정 연결된 어른은 동의 필수
select tests.create_user('noconsent@test.local') as u \gset
select throws_ok(
  format($$ insert into public.people (name, auth_user_id) values ('동의없는어른', %L) $$, :'u'),
  '23514', null, '계정이 연결된 어른은 동의 없이 만들 수 없다');

-- 트리거 UPDATE 경로: 번호 재정규화(+82 010 형태 포함), updated_at 은 트리거가 덮어쓴다
insert into public.people (name, phone) values ('수정대상','010-1111-2222');
update public.people set phone = '+82 010-3333-4444', updated_at = '2000-01-01' where name='수정대상';
select results_eq(
  $$ select phone, updated_at > '2020-01-01'::timestamptz from public.people where name='수정대상' $$,
  $$ values ('01033334444'::text, true) $$,
  'update 시 번호를 다시 정규화하고 updated_at 을 트리거가 덮어쓴다');

select * from finish();
rollback;
```

`updated_at`은 `now()`(트랜잭션 시각)라서 한 트랜잭션 안에서는 "값이 커졌는지"를 검사할 수 없다. 대신 "수동으로 넣은 값을 트리거가 덮어쓰는지"를 검사한다.

- [x] **Step 2: 실패 확인**

```bash
npm run db:test
```
Expected: `020_people_schema.sql` FAIL — `relation "public.people" does not exist`.

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261007000001_people_and_families.sql`**

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
    -- 국제 표기: 국제접속부호(00) · 국가번호 82 · 선택적 0 을 떼고 국내 표기(0 접두)로 바꾼다
    when d ~ '^(00)?820?(1[0-9]{8,9})$' then '0' || regexp_replace(d, '^(00)?820?', '')
    else d
  end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')) as t(d)
$$;

-- 휴대폰 형식 검사 (제약과 함수가 같은 규칙을 쓴다)
create or replace function public.is_valid_mobile(p text)
returns boolean language sql immutable
as $$ select coalesce(p ~ '^01[0-9]{8,9}$', false) $$;

-- 이름 비교 키: 공백 제거 + NFC 정규화. iOS/macOS 는 한글을 NFD(자모 분해)로 보낼 수 있어
-- NFC 로 저장된 선발급 행과 문자열 비교가 어긋난다. 비교 전용이며 표시용 이름은 그대로 둔다.
create or replace function public.normalize_name(p text)
returns text language sql immutable
as $$ select nullif(normalize(regexp_replace(coalesce(p, ''), '\s', '', 'g'), NFC), '') $$;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  name text not null check (char_length(name) between 1 and 20),
  phone text check (phone is null or public.is_valid_mobile(phone)),
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
  -- 탈퇴·삭제된 사람은 계정 연결을 반드시 끊는다 (익명화). 끊지 않으면 그 계정은
  -- current_person_id() 가 null 이어서 가입 화면으로 가는데, auth_user_id unique 때문에 재가입도 영구히 막힌다.
  constraint people_deleted_is_anonymized
    check (deleted_at is null or auth_user_id is null),
  -- 계정이 연결된 어른은 본인 동의가 있어야 한다 (선발급자는 계정이 없으므로 예외)
  constraint people_adult_requires_consent
    check (is_minor or auth_user_id is null or consented_at is not null),
  -- 보호자는 본인일 수 없다 (보호자가 미성년자가 아니어야 한다는 규칙은 함수에서 검사)
  constraint people_guardian_not_self
    check (guardian_id is null or guardian_id <> id)
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
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.family_id is null then
    insert into public.families default values returning id into new.family_id;
  end if;
  -- 이름은 NFC 로 맞춰 저장한다 (비교는 public.normalize_name 이 공백까지 무시한다)
  new.name := normalize(btrim(new.name), NFC);
  new.phone := public.normalize_phone(new.phone);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- 주의: public.people 에는 ON CONFLICT DO NOTHING 을 쓰지 않는다.
-- BEFORE 트리거가 충돌 판정보다 먼저 돌아서, 행이 버려져도 families 행은 남는다.
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
set search_path = public, pg_temp
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
set search_path = public, pg_temp
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
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.people
     where auth_user_id = auth.uid() and role = 'admin' and deleted_at is null
  )
$$;

-- auto_expose_new_tables=true 는 ALTER DEFAULT PRIVILEGES 로 새 함수에 anon=X 를 자동으로 붙인다.
-- 그래서 grant 목록에서 anon 을 빼는 것만으로는 부족하고, anon 에서 명시적으로 revoke 해야 한다.
revoke execute on function public.current_person_id(), public.current_family_id(), public.is_admin() from public, anon;
grant execute on function public.current_person_id(), public.current_family_id(), public.is_admin() to authenticated, service_role;
-- normalize_phone 과 트리거 함수는 PostgREST RPC 로 노출할 이유가 없다
revoke execute on function public.normalize_phone(text), public.is_valid_mobile(text),
  public.normalize_name(text), public.people_before_write() from public, anon, authenticated;
-- CHECK 제약 안에서 호출되는 함수는 "쓰는 역할"에게 EXECUTE 가 있어야 한다 (트리거의 security definer 로는 대체되지 않음). 정리한다고 지우지 말 것.
grant execute on function public.normalize_phone(text), public.is_valid_mobile(text),
  public.normalize_name(text) to authenticated, service_role;

-- =========================================================
-- 기본 차단: RLS 켜고 API 역할 권한 회수. 정책과 세부 권한은 다음 마이그레이션(RLS)에서 부여한다.
-- =========================================================
alter table public.families enable row level security;
alter table public.people enable row level security;
revoke all on public.families from anon, authenticated;
revoke all on public.people from anon, authenticated;
```

- [x] **Step 4: 적용하고 통과 확인**

```bash
npm run db:reset
npm run db:test
```
Expected: `020_people_schema.sql .. ok`, 전체 `All tests successful.` (5 + 25 단언)

- [x] **Step 5: 커밋**

```bash
git add supabase
git commit -m "feat(db): families·people 테이블, 전화번호 정규화 트리거, 사용자 헬퍼 함수"
```

---

### Task 6: 마이그레이션 ② people · families RLS

**Files:**
- Create: `supabase/migrations/20261007000002_people_rls.sql`
- Test: `supabase/tests/database/030_people_rls.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/030_people_rls.sql`**

```sql
begin;
select plan(19);

-- 준비: 사용자 A(김철수), B(이영희, 다른 가족), 관리자(권사). uid 는 역할 전환 전에 \gset 으로 받아 둔다.
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

-- A 가족에 식구를 붙인다: 탈퇴한 구성원 · 살아 있는 형제 · 자녀 계정(익명 로그인)
select tests.clear_auth();
insert into public.people (name, family_id, deleted_at)
values ('탈퇴가족원', (select family_id from public.people where auth_user_id = :'a_uid'), now());
insert into public.people (name, family_id)
values ('가족형제', (select family_id from public.people where auth_user_id = :'a_uid'));
select tests.create_user() as kid_uid \gset
insert into public.people (name, family_id, auth_user_id, is_minor, guardian_id, guardian_consented_at)
values ('서연', (select family_id from public.people where auth_user_id = :'a_uid'), :'kid_uid', true,
        (select id from public.people where auth_user_id = :'a_uid'), now());
select tests.authenticate_as(:'a_uid');

-- 탈퇴한 구성원은 보이지 않는다 (정책의 deleted_at is null 절)
select is((select count(*) from public.people), 3::bigint, 'A는 살아 있는 가족 구성원만 본다 (탈퇴자 제외)');

-- 같은 가족이라도 남의 행은 고칠 수 없다 (people_update_self 의 USING 범위)
update public.people set name = '해킹' where name = '가족형제';
select is((select name from public.people where name in ('가족형제','해킹')), '가족형제', 'A는 같은 가족이라도 남의 이름을 바꿀 수 없다');

update public.people set name = '김철수A' where auth_user_id = auth.uid();
select is((select name from public.people where auth_user_id = auth.uid()), '김철수A', 'A는 자기 이름을 바꿀 수 있다');

select throws_ok(
  $$ update public.people set role = 'admin' where auth_user_id = auth.uid() $$,
  '42501', null, 'A는 role 열을 바꿀 수 없다 (열 권한 없음)'
);

select throws_ok(
  $$ insert into public.people (name, phone) values ('새사람', '01099990000') $$,
  '42501', null, 'A는 사람을 만들 수 없다'
);

-- 자녀 계정: 가족은 보이지만 자기 행도 고칠 수 없다 (is_minor = false 절)
select tests.authenticate_as(:'kid_uid');
select is((select count(*) from public.people), 3::bigint, '자녀 계정도 가족 구성원을 본다');
update public.people set name = '내가정한이름' where auth_user_id = (select auth.uid());
select is((select name from public.people where auth_user_id = (select auth.uid())), '서연', '자녀 계정은 자기 이름을 바꿀 수 없다 (조회만)');

-- 거부된 insert 가 트리거로 만든 가족 행을 남기지 않았는지 (문장 단위 롤백)
-- now() 는 트랜잭션 시각이라, 이 테스트 트랜잭션에서 만든 가족 행만 고른다.
select tests.clear_auth();
select is(
  (select count(*) from public.families f
    where f.created_at = now()
      and not exists (select 1 from public.people p where p.family_id = f.id)),
  0::bigint, '구성원 없는 가족 행이 남지 않는다 (거부된 insert 의 트리거 흔적 없음)');

-- 관리자로서
select tests.authenticate_as(:'admin_uid');
select set_eq(
  $$ select name from public.people $$,
  $$ values ('김철수A'::text),('이영희'),('권사'),('이순자'),('탈퇴가족원'),('가족형제'),('서연') $$,
  '관리자는 모든 사람을 본다 (탈퇴자·타가족·자녀 포함)');
select lives_ok(
  $$ insert into public.people (name, phone) values ('방문자', '01099990000') $$,
  '관리자는 선발급용 사람을 만들 수 있다'
);
select isnt_empty(
  $$ select id from public.families where id <> (select public.current_family_id()) $$,
  '관리자는 자기 가족이 아닌 가족 행도 본다');

select throws_ok(
  $$ delete from public.people where name = '이순자' $$,
  '42501', null, '관리자도 행을 지울 수 없다 (소프트 삭제만)'
);

-- 익명화(파기)된 행은 관리자도 되살릴 수 없다 (people_update_admin 의 deleted_at is null 절)
select tests.clear_auth();
update public.people set name = '탈퇴한 사용자', phone = null, auth_user_id = null where name = '탈퇴가족원';
select tests.authenticate_as(:'admin_uid');
update public.people set name = '복구시도' where name = '탈퇴한 사용자';
select is((select count(*) from public.people where name = '복구시도'), 0::bigint, '관리자도 익명화된 행은 고칠 수 없다');

-- 정책 구조를 고정한다: 정책이 늘거나 사라지면 여기서 잡힌다
select policies_are('public', 'people',
  array['people_select_family_or_admin','people_update_self','people_insert_admin','people_update_admin'],
  'people 정책은 정확히 4개');
select policies_are('public', 'families', array['families_select_own_or_admin'], 'families 정책은 정확히 1개');

-- 비로그인(anon)
select tests.clear_auth();
set local role anon;
select throws_ok($$ select count(*) from public.people $$, '42501', null, 'anon은 people을 읽을 수 없다');
reset role;

select * from finish();
rollback;
```

`\gset`은 psql 전용 문법이며 `supabase test db`(pg_prove → psql)에서 동작한다. uid 는 반드시 `authenticate_as` 호출 **전에** `\gset` 으로 받아 둔다(`authenticated` 역할은 `auth.users` 를 읽을 수 없다). `authenticate_as` 는 연속 호출이 가능하므로 사용자 전환 사이의 `clear_auth()` 는 "postgres 로 돌아가서 전체 데이터를 보고 싶을 때"만 필요하다.

- [x] **Step 2: 실패 확인**

```bash
npm run db:test
```
Expected: `030_people_rls.sql` FAIL — 앞 마이그레이션이 기본 차단 상태라 A의 첫 조회부터 `42501 permission denied`로 중단된다(정책·권한이 아직 없음).

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261007000002_people_rls.sql`**

```sql
-- RLS 활성화와 권한 회수는 앞 마이그레이션(테이블 생성)에서 이미 했다. 여기서는 필요한 권한과 정책만 부여한다.
grant select on public.families to authenticated;
grant select on public.people to authenticated;
-- 본인 수정은 이름·전화만, 관리자 선발급 입력도 이름·전화만 (나머지 열은 함수로만 바꾼다)
-- phone 은 인증된 값이 아니다 (SMS 인증 없음). 본인이 미사용 번호로 바꿀 수 있으며, 식별은 관리자 확인에 의존한다.
grant update (name, phone) on public.people to authenticated;
grant insert (name, phone) on public.people to authenticated;

-- 정책 안의 함수 호출은 (select …) 로 감싼다. 감싸지 않으면 행마다 함수를 다시 실행해
-- 2만 행 기준 253ms vs 1.7ms 차이가 난다 (InitPlan 으로 한 번만 평가됨). 이후 모든 테이블에 같은 규칙.
-- 쿼리 조건에서도 같다: where auth_user_id = auth.uid() 는 Seq Scan, (select auth.uid()) 는 Index Scan 을 탄다.
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

-- 자녀 계정은 조회만 (이름·번호는 보호자/관리자가 관리). 어른만 자기 이름·전화를 고친다.
create policy people_update_self on public.people
  for update to authenticated
  using (auth_user_id = (select auth.uid()) and deleted_at is null and is_minor = false)
  with check (auth_user_id = (select auth.uid()) and is_minor = false);

create policy people_insert_admin on public.people
  for insert to authenticated
  with check ((select public.is_admin()));

-- 익명화(파기)된 행은 관리자도 손대지 못한다. 되살리는 일은 4단계의 definer 함수만 한다.
create policy people_update_admin on public.people
  for update to authenticated
  using ((select public.is_admin()) and deleted_at is null)
  with check ((select public.is_admin()));
```

관리자도 직접 고칠 수 있는 열은 이름·전화뿐이다. 역할·가족·보호자·계정 연결 같은 열은 뒤 단계의 관리자 전용 함수(`merge_people`, `link_person`, `admin_reset_person` 등)로만 바꾼다. 설계 문서 7.4의 "관리자 update 전부"는 이 함수들을 포함한 의미다.

- [x] **Step 4: 적용하고 통과 확인**

```bash
npm run db:reset
npm run db:test
```
Expected: `030_people_rls.sql .. ok`, 전체 성공 (5 + 25 + 19 = 49 단언).

참고: `people_update_self`의 `and deleted_at is null`은 `people_deleted_is_anonymized` 제약 때문에 논리적으로 도달 불가한 방어 조항이다(탈퇴 행은 항상 `auth_user_id`가 NULL). 변이 테스트에서 살아남는 '동치 변이'이므로 테스트로 잡으려 하지 않는다.

- [x] **Step 5: 커밋**

```bash
git add supabase
git commit -m "feat(db): people·families RLS 정책 및 열 단위 권한"
```

---

### Task 7: 마이그레이션 ③ `claim_person` RPC

> **새 함수 체크리스트(이후 모든 마이그레이션 공통).** `auto_expose_new_tables = true`는 `ALTER DEFAULT PRIVILEGES`로 새 함수에 `anon=X`, `authenticated=X`를 자동으로 붙인다. 따라서 grant 목록에서 anon을 빼는 것만으로는 부족하고 **`revoke execute … from public, anon`을 명시**해야 한다(RPC를 anon에게 열 의도가 있는 `ping()`만 예외). SECURITY DEFINER 함수는 `set search_path = public, pg_temp`. 정책·쿼리의 `auth.uid()`/헬퍼 호출은 `(select …)`로 감싼다.

**Files:**
- Create: `supabase/migrations/20261007000003_claim_person.sql`
- Test: `supabase/tests/database/040_claim_person.sql`

- [x] **Step 1: 실패하는 테스트 작성 — `supabase/tests/database/040_claim_person.sql`**

```sql
begin;
select plan(29);

-- 권한 구조 고정: 새 함수에 anon 이 자동으로 붙지 않았는지 확인한다 (auto_expose_new_tables=true 대응)
select is(has_function_privilege('anon', 'public.claim_person(text,text,text)', 'EXECUTE'), false, 'anon은 claim_person 을 실행할 수 없다');

select tests.create_user('new@test.local') as new_uid \gset
select tests.create_user('pre@test.local') as pre_uid \gset
select tests.create_user('dup@test.local') as dup_uid \gset
select tests.create_user() as anon_uid \gset
select tests.create_user('space@test.local') as space_uid \gset
select tests.create_user('nfd@test.local') as nfd_uid \gset

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

-- 3) 선발급자가 같은 번호·같은 이름으로 가입 → 기존 사람에 연결 (새 사람·새 가족이 생기지 않아야 한다)
select count(*) as people_before from public.people \gset
select count(*) as families_before from public.families \gset
select tests.authenticate_as(:'pre_uid');
select lives_ok(
  $$ select public.claim_person('이순자', '01022220001', '2026-10-07') $$,
  '선발급된 번호·이름으로 가입하면 성공한다'
);
select tests.clear_auth();
select is(
  (select auth_user_id from public.people where phone = '01022220001'), :'pre_uid'::uuid,
  '기존 사람 행에 계정이 연결된다 (새 사람이 생기지 않음)'
);
select is((select count(*) from public.people), :'people_before'::bigint, '선발급 연결은 사람 수를 늘리지 않는다');
select is((select count(*) from public.families), :'families_before'::bigint, '선발급 연결은 가족 수를 늘리지 않는다');
select isnt((select consented_at from public.people where phone = '01022220001'), null, '선발급 연결에도 동의 시각이 기록된다');
select is((select consent_version from public.people where phone = '01022220001'), '2026-10-07', '선발급 연결에도 동의 버전이 기록된다');

-- 같은 사용자가 순차로 다시 호출하면 잠금 전 검사가 먼저 걸린다.
-- 멱등 분기(auth_user_id = v_uid → 그 행을 그대로 돌려준다)는 동시 요청에서만 닿으므로 pgTAP 로는 재현하지 않는다.
select tests.authenticate_as(:'pre_uid');
select throws_ok(
  $$ select public.claim_person('이순자', '01022220001', '2026-10-07') $$,
  'P0001', 'already_registered', '연결을 마친 계정의 순차 재시도는 already_registered (멱등 분기는 동시 요청 전용)'
);
select tests.clear_auth();

-- 4) 이미 연결된 번호로 다른 계정이 가입 → phone_taken. 이름이 다른 선발급 번호도 phone_taken (가로채기 방지)
insert into public.people (name, phone) values ('박영수', '01022220005');
-- 미성년자 행은 이름까지 맞아도 연결 대상이 아니다 (보호자·관리자가 관리한다)
insert into public.people (name, phone, is_minor, guardian_id, guardian_consented_at)
values ('아이', '01022220007', true, (select id from public.people where phone = '01022220001'), now());
select tests.authenticate_as(:'dup_uid');
select throws_ok(
  $$ select public.claim_person('가짜이름', '01022220005', '2026-10-07') $$,
  'P0001', 'phone_taken', '선발급 번호라도 이름이 다르면 연결하지 않는다'
);
select throws_ok(
  $$ select public.claim_person('가짜', '01022220001', '2026-10-07') $$,
  'P0001', 'phone_taken', '남이 쓰는 번호로는 가입할 수 없다'
);
-- 멱등 분기가 auth_user_id 로만 열리는지 고정한다: 이름까지 정확해도 남의 계정 행은 못 가져간다
select throws_ok(
  $$ select public.claim_person('이순자', '01022220001', '2026-10-07') $$,
  'P0001', 'phone_taken', '이름을 정확히 맞혀도 이미 연결된 남의 행은 가져갈 수 없다'
);
select throws_ok(
  $$ select public.claim_person('아이', '01022220007', '2026-10-07') $$,
  'P0001', 'phone_taken', '미성년자 행은 이름이 맞아도 연결하지 않는다'
);
select throws_ok(
  $$ select public.claim_person('가짜', '02-123-4567', '2026-10-07') $$,
  'P0001', 'invalid_phone', '휴대폰 형식이 아니면 거부한다'
);
select throws_ok(
  $$ select public.claim_person('', '01022220008', '2026-10-07') $$,
  'P0001', 'invalid_name', '이름이 비어 있으면 거부한다'
);
select throws_ok(
  $$ select public.claim_person(repeat('가', 21), '01022220008', '2026-10-07') $$,
  'P0001', 'invalid_name', '이름이 20자를 넘으면 거부한다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220008', '') $$,
  'P0001', 'consent_required', '동의 버전이 없으면 거부한다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220008', '   ') $$,
  'P0001', 'consent_required', '공백뿐인 동의 버전도 거부한다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220008', 'v1') $$,
  'P0001', 'consent_required', '날짜(YYYY-MM-DD) 형식이 아닌 동의 버전은 거부한다'
);
select tests.clear_auth();

-- 5) 이름 비교는 공백과 유니코드 합성 방식을 무시한다 (표시용 이름은 선발급 행 그대로 둔다)
insert into public.people (name, phone) values ('김 철수', '01022220011');
insert into public.people (name, phone) values ('박순희', '01022220012');
select tests.authenticate_as(:'space_uid');
select is(
  (select (public.claim_person('김철수', '01022220011', '2026-10-07')).name), '김 철수',
  '공백만 다른 이름으로 연결되고, 선발급 행의 표시용 이름은 그대로 남는다'
);
select tests.clear_auth();
-- iOS/macOS 가 보내는 NFD(자모 분해) 입력이 NFC 로 저장된 선발급 행과 맞아야 한다
select tests.authenticate_as(:'nfd_uid');
select lives_ok(
  $$ select public.claim_person(normalize('박순희', NFD), '01022220012', '2026-10-07') $$,
  'NFD 로 분해된 이름도 NFC 선발급 행에 연결된다'
);
select throws_ok(
  $$ select public.claim_person('김철수', '01022220013', '   ') $$,
  'P0001', 'already_registered', '가입을 마친 계정은 형식 검사보다 already_registered 가 먼저 나온다'
);
select tests.clear_auth();

-- 6) 익명 계정 → anonymous_cannot_claim
select tests.authenticate_as(:'anon_uid');
select throws_ok(
  $$ select public.claim_person('아이', '01022220009', '2026-10-07') $$,
  'P0001', 'anonymous_cannot_claim', '익명 계정은 어른 가입을 할 수 없다'
);
select tests.clear_auth();

-- 7) JWT 없이 authenticated 역할로 직접 호출. PostgREST 로는 42501 에서 먼저 막히지만 함수 가드도 고정한다.
select tests.clear_auth();
set local role authenticated;
select throws_ok(
  $$ select public.claim_person('김철수', '01022220010', '2026-10-07') $$,
  'P0001', 'not_authenticated', 'JWT 가 없으면 not_authenticated'
);
reset role;

select * from finish();
rollback;
```

- [x] **Step 2: 실패 확인**

```bash
npm run db:test
```
Expected: `040_claim_person.sql` FAIL — `function public.claim_person(...) does not exist`.

- [x] **Step 3: 마이그레이션 작성 — `supabase/migrations/20261007000003_claim_person.sql`**

```sql
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
```

- [x] **Step 4: 적용하고 통과 확인**

```bash
npm run db:reset
npm run db:test
```
Expected: 4개 파일 모두 `ok`, `All tests successful.` (5 + 25 + 19 + 29 = 78 단언)

- [x] **Step 5: DB 타입 생성**

```bash
mkdir -p src/lib
npm run db:types
head -5 src/lib/database.types.ts
```
Expected: `export type Json = ...`로 시작하는 파일. `people`, `families` 테이블과 `claim_person` 함수 타입이 포함된다.

- [x] **Step 6: 커밋**

```bash
git add supabase src/lib/database.types.ts package.json
git commit -m "feat(db): claim_person RPC (어른 가입·선발급 연결·동의 기록)"
```

---

### Task 8: 프론트 라이브러리 · 환경변수 검증 · Supabase 클라이언트 · 전화번호·오류 유틸

**Files:**
- Create: `src/lib/env.ts`, `src/lib/supabase.ts`, `src/lib/phone.ts`, `src/lib/errors.ts`
- Test: `src/lib/env.test.ts`, `src/lib/phone.test.ts`, `src/lib/errors.test.ts`

- [x] **Step 1: 런타임 의존성 설치**

```bash
npm install @supabase/supabase-js @tanstack/react-query react-router zod
```

- [x] **Step 2: 실패하는 테스트 — `src/lib/env.test.ts`**

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
    const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY } = valid
    expect(parseEnv({ VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY }).enableDevLogin).toBe(false)
  })

  it('개발 로그인 플래그가 이상한 값이면 false (fail closed)', () => {
    expect(parseEnv({ ...valid, VITE_ENABLE_DEV_LOGIN: '' }).enableDevLogin).toBe(false)
    expect(parseEnv({ ...valid, VITE_ENABLE_DEV_LOGIN: 'TRUE' }).enableDevLogin).toBe(false)
  })

  it('필수 값이 빠지면 어떤 키인지·왜 틀렸는지 알려주며 실패한다', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://x' })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://x' })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY: .+/)
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/lib/phone.test.ts`**

```ts
import { normalizePhone, isValidMobile, formatPhone, maskPhone } from './phone'

describe('phone', () => {
  it('숫자만 남긴다', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678')
    expect(normalizePhone(' 010 1234 5678 ')).toBe('01012345678')
  })

  it('국제 표기는 010 으로 바꾼다 (DB normalize_phone 과 동일 규칙)', () => {
    expect(normalizePhone('+82 10-9876-5432')).toBe('01098765432')
    expect(normalizePhone('+82 010-9876-5432')).toBe('01098765432')
    expect(normalizePhone('0082-10-123-4567')).toBe('0101234567')
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

  it('입력 중(형식 미완성)인 번호는 그대로 두고, 마스킹은 형식을 드러내지 않는다', () => {
    expect(formatPhone('010')).toBe('010')
    expect(maskPhone('010')).toBe('***')
  })
})
```

- [x] **Step 4: 실패하는 테스트 — `src/lib/errors.test.ts`**

```ts
import { messageOf, toUserMessage } from './errors'

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

  it('권한 거부(세션 만료·비로그인)는 로그인 안내', () => {
    expect(toUserMessage({ code: '42501', message: 'permission denied for function claim_person' })).toBe('로그인이 필요해요.')
    // 코드가 없어도 영문 문구로 알아본다 (코드 매핑의 예비 수단).
    expect(toUserMessage({ message: 'permission denied for table people' })).toBe('로그인이 필요해요.')
  })

  it('인증 오류는 영문 문구가 달라도 코드로 알아본다', () => {
    expect(toUserMessage({ code: 'PGRST301', message: 'JWT expired' })).toBe('로그인이 필요해요.')
    expect(
      toUserMessage({ code: '42501', message: 'new row violates row-level security policy for table "people"' }),
    ).toBe('로그인이 필요해요.')
  })
})

describe('messageOf', () => {
  it('객체의 message 문자열만 꺼낸다', () => {
    expect(messageOf({ message: 'already_registered' })).toBe('already_registered')
    expect(messageOf('str')).toBeUndefined()
  })
})
```

- [x] **Step 5: 실패 확인**

```bash
npm test
```
Expected: 세 파일 모두 FAIL — `Failed to resolve import "./env"` 등.

- [x] **Step 6: 구현 — `src/lib/env.ts`**

```ts
import { z } from 'zod'

// zod v4 기준. z.string().url() 은 v4 에서 deprecated 라 z.url() 을 쓴다.
// 개발 로그인 플래그는 catch 로 fail-closed: 비어 있거나 모르는 값('TRUE' 등)이면 꺼진 것으로 본다.
// (.env.example 은 운영에서 이 값을 비워 두라고 안내한다 — 그때 앱이 죽으면 안 된다.)
const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_ENABLE_DEV_LOGIN: z.enum(['true', 'false']).catch('false'),
})

export type Env = {
  supabaseUrl: string
  supabasePublishableKey: string
  enableDevLogin: boolean
}

/** 환경변수를 검증해 앱에서 쓰기 좋은 모양으로 바꾼다. 실패하면 어떤 키가 왜 틀렸는지 적어 준다. */
export function parseEnv(raw: Record<string, unknown>): Env {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const reasons = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    throw new Error(`환경변수가 올바르지 않습니다: ${reasons}`)
  }
  return {
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
    enableDevLogin: result.data.VITE_ENABLE_DEV_LOGIN === 'true',
  }
}

// 모듈을 처음 읽을 때 검증한다 (빠른 실패). 테스트에서는 vite.config.ts 의 test.env 가 값을 준다.
export const env: Env = parseEnv(import.meta.env)
```

- [x] **Step 7: 구현 — `src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env } from './env'

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    // GitHub Pages 는 <user>.github.io 한 오리진을 프로젝트들이 함께 쓴다.
    // 기본 키는 URL 에서 만들어지므로 프로젝트별로 고정 키를 준다.
    storageKey: 'meal-ticket-auth',
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
```

- [x] **Step 8: 구현 — `src/lib/phone.ts`**

```ts
const MOBILE = /^01[0-9]{8,9}$/

/** 숫자만 남기고, 국제 표기(+82 10…, +82 010…, 0082…)는 010 으로 바꾼다. DB 의 normalize_phone() 과 같은 규칙. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  const intl = /^(?:00)?820?(1[0-9]{8,9})$/.exec(digits)
  return intl ? `0${intl[1]}` : digits
}

/** DB 의 is_valid_mobile() 과 같은 규칙. 정규화된 숫자열을 넣는다. */
export function isValidMobile(digits: string): boolean {
  return MOBILE.test(digits)
}

/** 완성된 휴대폰 번호만 하이픈을 넣는다. 입력 중(형식 미완성)이면 그대로 돌려준다. */
export function formatPhone(digits: string): string {
  if (!isValidMobile(digits)) return digits
  return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`
}

/** 010-****-5678. 모르는 형식은 드러내지 않는다. */
export function maskPhone(digits: string | null | undefined): string {
  if (!digits) return ''
  if (!isValidMobile(digits)) return '***'
  const mid = digits.slice(3, -4)
  return `${digits.slice(0, 3)}-${'*'.repeat(mid.length)}-${digits.slice(-4)}`
}
```

- [x] **Step 9: 구현 — `src/lib/errors.ts`**

```ts
// DB(claim_person 등)는 오류 코드를 message 에 문자열로 담아 보낸다 ({code:'P0001', message:'phone_taken'}).
const MESSAGES = {
  phone_taken: '이미 등록된 번호예요. 권사님께 문의해 주세요.',
  invalid_phone: '휴대폰 번호를 확인해 주세요.',
  invalid_name: '이름을 확인해 주세요.',
  consent_required: '개인정보 동의가 필요해요.',
  already_registered: '이미 가입된 계정이에요.',
  anonymous_cannot_claim: '아이 계정은 보호자 연결로 시작해 주세요.',
  not_authenticated: '로그인이 필요해요.',
} as const satisfies Record<string, string>

/** MESSAGES 에 문구가 있는 오류 코드. 호출하는 쪽에서 오타를 막는 데 쓴다. */
export type RpcErrorCode = keyof typeof MESSAGES

// 세션 만료·비로그인. 42501 은 Postgres 권한/RLS, PGRST301·302 는 PostgREST 의 JWT 오류다.
// 영문 문구는 상황마다 다르므로(permission denied…, JWT expired, new row violates RLS…) 코드로 먼저 본다.
const AUTH_CODES = new Set(['42501', 'PGRST301', 'PGRST302'])
const PERMISSION_DENIED = /permission denied/i
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed/i

const FALLBACK = '잠시 후 다시 시도해 주세요.'
const NETWORK = '통신이 불안정해요. 잠시 후 다시 시도해 주세요.'

function fieldOf(err: unknown, key: 'message' | 'code'): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const value = (err as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** 오류 객체에서 message 문자열을 꺼낸다. Supabase RPC 는 message 에 코드 문자열(phone_taken 등)을 담는다. */
export function messageOf(err: unknown): string | undefined {
  return fieldOf(err, 'message')
}

/** 오류 객체에서 code 를 꺼낸다. 빈 문자열은 없는 것으로 본다. */
function codeOf(err: unknown): string | undefined {
  const code = fieldOf(err, 'code')
  return code === '' ? undefined : code
}

// 평범한 객체의 프로토타입 키(toString 등)에 걸리지 않도록 hasOwn 으로 본다.
function isRpcErrorCode(value: string): value is RpcErrorCode {
  return Object.hasOwn(MESSAGES, value)
}

/** 어떤 오류든 사용자에게 보여 줄 한국어 문구로 바꾼다. 모르는 오류는 일반 문구. */
export function toUserMessage(err: unknown): string {
  const message = messageOf(err)
  const code = codeOf(err)
  if (message && isRpcErrorCode(message)) return MESSAGES[message]
  if (code && AUTH_CODES.has(code)) return MESSAGES.not_authenticated
  if (!message) return FALLBACK
  if (PERMISSION_DENIED.test(message)) return MESSAGES.not_authenticated
  if (NETWORK_FAILURE.test(message)) return NETWORK
  return FALLBACK
}
```

- [x] **Step 10: 통과 확인**

```bash
npm test
```
Expected: env 4 · phone 6 · errors 6 · App 1 → `17 passed`.

- [x] **Step 11: 커밋**

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

- [x] **Step 1: UI 기본 컴포넌트 — `src/components/ui.tsx`**

```tsx
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'kakao' | 'ghost' }

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const base = 'w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed'
  const look = {
    primary: 'bg-blue-600 text-white active:bg-blue-700',
    kakao: 'bg-[#FEE500] text-[#191919]',
    ghost: 'bg-white text-gray-900 border border-gray-300',
  }[variant]
  // type 을 먼저 두어 기본값은 button 이 되고, 제출 버튼은 호출하는 쪽에서 덮어쓴다.
  // (HTML 기본값 submit 이면 폼 안의 모든 버튼이 뜻하지 않게 폼을 제출한다.)
  return <button type="button" className={`${base} ${look} ${className}`} {...rest} />
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }

export function TextField({ label, error, id, 'aria-describedby': describedBy, ...rest }: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? rest.name ?? autoId
  const errorId = `${inputId}-error`
  return (
    <div className="block">
      <label className="mb-1 block text-xs font-semibold text-gray-500" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-600"
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
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

export function Spinner({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center text-sm text-gray-500">
      {label}
    </div>
  )
}
```

- [x] **Step 2: 실패하는 테스트 — `src/features/auth/AuthProvider.test.tsx`**

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'

type GetSession = () => Promise<{
  data: { session: Session | null }
  error?: { message: string } | null
}>
type OnAuthStateChange = (
  callback: (event: string, session: Session | null) => void,
) => { data: { subscription: { unsubscribe: () => void } } }

const { getSession, onAuthStateChange, unsubscribe } = vi.hoisted(() => ({
  getSession: vi.fn<GetSession>(),
  onAuthStateChange: vi.fn<OnAuthStateChange>(),
  unsubscribe: vi.fn<() => void>(),
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

// 주소를 만지는 테스트가 다음 테스트로 새지 않게 되돌린다.
afterEach(() => {
  window.history.replaceState(null, '', '/')
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

  it('로그인 상태가 바뀌면 화면에 반영한다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())

    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_IN', { user: { id: 'u2' } } as Session))
    expect(screen.getByText('user:u2')).toBeInTheDocument()

    act(() => notify('SIGNED_OUT', null))
    expect(screen.getByText('no-session')).toBeInTheDocument()
  })

  it('세션 확인이 오류를 함께 돌려주면 기록하고 비로그인으로 둔다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // getSession 은 보통 reject 하지 않고 { data, error } 로 알려 준다. 조용히 넘기면 안 된다.
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'storage unavailable' } })

    render(<AuthProvider><Probe /></AuthProvider>)

    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(consoleError).toHaveBeenCalled()
  })

  it('세션 확인이 실패해도 멈추지 않고 비로그인으로 넘긴다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getSession.mockRejectedValue(new Error('network down'))

    render(<AuthProvider><Probe /></AuthProvider>)

    // 로딩에 갇히면 사용자는 아무것도 할 수 없다. 시작 화면까지는 내려 줘야 한다.
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(consoleError).toHaveBeenCalled()
  })

  it('구독이 먼저 알려 준 상태를 뒤늦은 세션 확인이 덮어쓰지 않는다', async () => {
    let settle: (value: { data: { session: Session | null } }) => void = () => {}
    getSession.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )

    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()

    // 다른 탭에서 로그아웃하면 구독이 먼저 알려 준다.
    const notify = onAuthStateChange.mock.calls[0][0]
    act(() => notify('SIGNED_OUT', null))
    expect(screen.getByText('no-session')).toBeInTheDocument()

    // 뒤늦게 도착한 옛 세션이 로그아웃을 되살리면 안 된다.
    await act(async () => {
      settle({ data: { session: { user: { id: 'u1' } } as Session } })
    })
    expect(screen.getByText('no-session')).toBeInTheDocument()
  })

  it('언마운트 시 구독을 해제한다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { unmount } = render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('OAuth 콜백 파라미터만 지우고 나머지 파라미터와 해시는 남긴다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    window.history.replaceState(null, '', '/?code=abc&state=xyz&utm_source=kakao#/')

    render(<AuthProvider><Probe /></AuthProvider>)

    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(window.location.search).toBe('?utm_source=kakao')
    expect(window.location.hash).toBe('#/')
  })

  it('실패한 콜백의 오류 파라미터도 지운다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    window.history.replaceState(null, '', '/?error=access_denied&error_description=denied#/')

    render(<AuthProvider><Probe /></AuthProvider>)

    await waitFor(() => expect(screen.getByText('no-session')).toBeInTheDocument())
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#/')
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/features/auth/Gate.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Gate, RequireSession } from './Gate'

// 훅을 통째로 가짜로 바꾸므로 실제 타입(Session, UseQueryResult) 전체를 만들 필요가 없다.
// Gate 가 읽는 필드만 담은 느슨한 타입으로 둔다.
type FakeAuth = { status: 'loading' | 'ready'; session?: { user: { id: string } } | null }
type FakePerson = { status: 'pending' | 'error' | 'success'; data?: { id: string; name: string } | null }

const { useAuth, usePerson } = vi.hoisted(() => ({
  useAuth: vi.fn<() => FakeAuth>(),
  usePerson: vi.fn<() => FakePerson>(),
}))
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

  it('사람을 불러오는 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/')
    expect(screen.getByRole('status')).toBeInTheDocument()
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

  it('사람 조회가 실패하면 안내 스피너', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'error', data: undefined })
    renderAt('/')
    expect(screen.getByRole('status')).toHaveTextContent('연결에 문제가 있어요')
  })

  it('RequireSession: 세션 확인 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'loading' })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/onboarding')
    expect(screen.queryByText('onboarding')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('RequireSession: 사람을 불러오는 중이면 스피너', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/onboarding')
    // 가입 여부를 모르는 채로 가입 화면을 깜빡이며 보여 주지 않는다.
    expect(screen.queryByText('onboarding')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('RequireSession: 세션이 없으면 /로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: null })
    usePerson.mockReturnValue({ status: 'pending', data: undefined })
    renderAt('/onboarding')
    expect(screen.getByText('start')).toBeInTheDocument()
  })

  it('RequireSession: 사람 조회가 실패하면 가입 화면을 열지 않는다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'error', data: undefined })
    renderAt('/onboarding')
    // 이미 가입한 사람일 수도 있다. 조회가 실패한 채로 가입을 진행시키면 안 된다.
    expect(screen.queryByText('onboarding')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('연결에 문제가 있어요')
  })

  it('RequireSession: 이미 가입했으면 /로 보낸다', () => {
    useAuth.mockReturnValue({ status: 'ready', session: { user: { id: 'u1' } } })
    usePerson.mockReturnValue({ status: 'success', data: { id: 'p1', name: '김철수' } })
    renderAt('/onboarding')
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})
```

- [x] **Step 4: 실패 확인**

```bash
npm test
```
Expected: 두 파일 FAIL — 모듈을 찾을 수 없음.

- [x] **Step 5: 구현 — `src/features/auth/AuthProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

export type AuthState = { status: 'loading' } | { status: 'ready'; session: Session | null }

const AuthContext = createContext<AuthState | null>(null)

// 콜백에만 쓰이는 파라미터. 이것만 골라 지우고 utm_source 같은 나머지는 건드리지 않는다.
const OAUTH_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state'] as const

/**
 * OAuth 콜백으로 붙은 파라미터를 주소에서 지운다 (해시 라우트와 다른 파라미터는 유지).
 * supabase-js 는 교환에 성공했을 때만 code 를 지우므로, 실패하거나 새로고침·공유된 콜백 URL 은
 * 매번 다시 실패한다. 세션 확인이 끝나면 성공·실패와 무관하게 지운다.
 */
function stripOAuthParams() {
  const params = new URLSearchParams(window.location.search)
  if (!OAUTH_PARAMS.some((key) => params.has(key))) return
  for (const key of OAUTH_PARAMS) params.delete(key)
  const query = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    // 구독이 먼저 알려 주면(다른 탭 로그아웃 등) 뒤늦게 끝난 getSession 의 옛 세션은 버린다.
    let settledByListener = false

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        // getSession 은 보통 reject 하지 않고 error 필드로 알려 준다. 조용히 넘기지 않는다.
        if (error) console.error('세션 확인 실패', error)
        if (!active || settledByListener) return
        setState({ status: 'ready', session: data.session })
        stripOAuthParams()
      })
      .catch((error: unknown) => {
        // 세션을 못 읽어도 로딩에 갇히면 사용자가 아무것도 할 수 없다.
        // 비로그인으로 보고 시작 화면까지는 내려 준다 (거기서 다시 로그인할 수 있다).
        console.error('세션 확인 실패', error)
        if (!active || settledByListener) return
        setState({ status: 'ready', session: null })
      })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      settledByListener = true
      setState({ status: 'ready', session })
      stripOAuthParams()
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

// Provider 와 그 훅을 한 파일에 두는 건 React 공식 권장 패턴이다.
// 대신 이 파일을 고치면 HMR 이 전체 새로고침으로 떨어진다 (그 정도는 감수한다).
// eslint-disable-next-line react/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 쓸 수 있습니다')
  return ctx
}
```

- [x] **Step 6: 구현 — `src/features/auth/usePerson.ts`**

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
      // enabled 가 막아 주지만, 키 없이 호출되면 조용히 null 을 돌려주는 대신 드러낸다.
      if (!userId) throw new Error('usePerson: userId 없이 조회할 수 없습니다')
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .eq('auth_user_id', userId)
        // 제약으로 이미 보장되지만(살아 있는 행만 auth_user_id 를 가진다) 이중 방어로 둔다.
        .is('deleted_at', null)
        .maybeSingle()
      // PostgREST 오류는 Error 가 아닌 평범한 객체다. message/code 를 보존해 Error 로 감싼다.
      if (error) throw Object.assign(new Error(error.message), { code: error.code, cause: error })
      return data
    },
  })
}
```

- [x] **Step 7: 구현 — `src/features/auth/Gate.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Spinner } from '../../components/ui'
import { HomePage } from '../../pages/HomePage'
import { StartPage } from '../../pages/StartPage'
import { useAuth } from './AuthProvider'
import { usePerson } from './usePerson'

const CONNECTION_ERROR = '연결에 문제가 있어요. 새로고침해 주세요'

/** `#/` : 비로그인 → 시작 화면, 로그인·미가입 → 가입, 가입 완료 → 홈 */
export function Gate() {
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const person = usePerson(userId)

  if (auth.status === 'loading') return <Spinner />
  if (!auth.session) return <StartPage />
  if (person.status === 'pending') return <Spinner />
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
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
  // 이미 가입한 사람일 수도 있다. 조회가 실패한 채로 가입을 진행시키지 않는다.
  if (person.status === 'error') return <Spinner label={CONNECTION_ERROR} />
  if (person.data) return <Navigate to="/" replace />
  return <>{children}</>
}
```

- [x] **Step 8: 페이지 스텁 4개**

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

- [x] **Step 9: `src/App.tsx`를 Provider + 라우터로 교체**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './features/auth/AuthProvider'
import { Gate, RequireSession } from './features/auth/Gate'
import { OnboardingPage } from './features/onboarding/OnboardingPage'
import { PrivacyPage } from './pages/PrivacyPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 },
    // 가입·발권 같은 쓰기는 자동 재시도하면 중복될 수 있다. 재시도는 사용자가 결정한다.
    mutations: { retry: 0 },
  },
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
            {/* 모르는 주소는 홈 주소로 정리한다 (Gate 를 그대로 띄우면 주소가 그대로 남는다). */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
```

- [x] **Step 9-1: `src/main.tsx` — 환경변수 오류 시 흰 화면 대신 안내 문구**

`src/lib/env.ts`는 모듈 평가 시점에 throw 하므로, 빌드에 환경변수가 빠지면 콘솔에만 오류가 남고 화면은 비어 있다. 진입점에서 잡아 보여 준다.

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// env.ts 가 import 시점에 throw 하면(환경변수 누락) 흰 화면 대신 안내를 띄운다.
// 주의: 이 파일에서 env.ts/supabase.ts 에 닿는 모듈을 정적 import 하면 이 보호가 무력화된다. 반드시 동적 import 로만.
import('./App')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((err: unknown) => {
    console.error(err)
    root.render(
      <main style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 18 }}>앱을 시작할 수 없어요</h1>
        <p style={{ color: '#555' }}>잠시 후 새로고침해 주세요. 계속되면 관리자에게 알려 주세요.</p>
        <button
          type="button"
          onClick={() => {
            window.location.reload()
          }}
        >
          새로고침
        </button>
      </main>,
    )
  })
```

- [x] **Step 10: `src/App.test.tsx`를 라우팅 스모크로 교체**

```tsx
import { render, screen } from '@testing-library/react'
import App from './App'

// 호출 기록을 검증하지 않으므로 vi.fn 대신 평범한 스텁으로 둔다.
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

// HashRouter 는 마운트 시점의 해시를 읽는다. 다음 테스트로 새지 않게 되돌린다.
afterEach(() => {
  window.location.hash = ''
})

describe('App', () => {
  it('비로그인 상태에서 시작 화면을 보여준다', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: '시작' })).toBeInTheDocument()
  })

  // 오래된 링크나 오타로 들어와도 빈 화면을 보여 주지 않고 홈 주소로 정리한다.
  it('모르는 주소는 홈으로 되돌린다', async () => {
    window.location.hash = '#/nope'
    render(<App />)
    expect(await screen.findByRole('heading', { name: '시작' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
  })

  // 개인정보 처리방침은 동의 화면과 카카오 심사에서 링크로 열리므로 로그인 없이 닿아야 한다.
  it('로그인 전에도 개인정보 처리방침을 볼 수 있다', async () => {
    window.location.hash = '#/privacy'
    render(<App />)
    expect(await screen.findByRole('heading', { name: '개인정보 처리방침' })).toBeInTheDocument()
  })
})
```

추가 테스트 파일(커버리지 80% 유지용): `src/components/ui.test.tsx`, `src/features/auth/usePerson.test.tsx`.

- [x] **Step 11: 통과 확인**

```bash
npm test
```
Expected: 모두 통과 (58 passed).

- [x] **Step 12: 커밋**

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

- [x] **Step 1: 교회 설정 — `src/config/church.ts`**

값은 교회에서 확인한 뒤 바꾼다. 처리방침 페이지와 가입 화면이 이 값을 읽는다.

```ts
// 교회마다 바뀌는 값만 모아 둔다. 처리방침 페이지와 가입 화면이 이 값을 읽는다.
// 값은 교회에서 확인한 뒤 바꾼다.
export const church = {
  /** 교회 공식 명칭 (교회 확인 필요) */
  name: 'OO교회',
  /** 카카오 동의 화면과 앱 상단에 보이는 이름 */
  appName: 'OO교회 식권',
  /** 개인정보 담당자 (교회 확인 필요) */
  privacyOfficer: { role: '식당 담당 권사', name: '', phone: '' },
  /** 동의 문구를 바꾸면 이 날짜도 바꾼다. people.consent_version 에 저장된다 (YYYY-MM-DD, DB 가 형식을 검사한다) */
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

- [x] **Step 2: 실패하는 테스트 — `src/features/auth/signIn.test.ts`**

```ts
import { devSignIn, redirectUrl, signInWithKakao, signOut } from './signIn'

// supabase 모듈을 통째로 가짜로 바꾸므로 실제 반환 타입 전체를 만들 필요가 없다.
// signIn 이 읽는 필드(error)와 넘기는 인자만 담은 느슨한 타입으로 둔다.
type AuthResult = { error: (Error & { code?: string }) | null }
type OAuthArgs = { provider: string; options: { redirectTo: string } }
type Credentials = { email: string; password: string }

// env 는 가짜 객체를 그대로 공유해 테스트마다 플래그만 바꾼다 (모듈을 다시 읽지 않아도 된다).
const { signInWithOAuth, signInWithPassword, signUp, authSignOut, env } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn<(args: OAuthArgs) => Promise<AuthResult>>(),
  signInWithPassword: vi.fn<(args: Credentials) => Promise<AuthResult>>(),
  signUp: vi.fn<(args: Credentials) => Promise<AuthResult>>(),
  authSignOut: vi.fn<() => Promise<AuthResult>>(),
  env: { enableDevLogin: true },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth, signInWithPassword, signUp, signOut: authSignOut } },
}))
vi.mock('../../lib/env', () => ({ env }))

describe('signIn', () => {
  beforeEach(() => {
    env.enableDevLogin = true
  })

  // GitHub Pages 프로젝트 사이트(/<repo>/)와 루트 배포(/) 둘 다 맞아야 한다.
  // BASE_URL 을 그대로 기대값에 넣으면 구현을 베낀 셈이라 아무것도 검증하지 못한다.
  it('redirectUrl은 하위 경로 배포에서 origin + 그 경로', () => {
    vi.stubEnv('BASE_URL', '/meal-ticket/')
    expect(redirectUrl()).toBe(`${window.location.origin}/meal-ticket/`)
  })

  it('redirectUrl은 루트 배포에서 origin + /', () => {
    vi.stubEnv('BASE_URL', '/')
    expect(redirectUrl()).toBe(`${window.location.origin}/`)
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

  it('개발 로그인: 가입도 실패하면 그 오류를 던진다', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') })
    signUp.mockResolvedValue({ error: new Error('User already registered') })
    await expect(devSignIn('x@test.local', 'wrongpass')).rejects.toThrow('User already registered')
  })

  it('개발 로그인: 플래그가 꺼져 있으면 supabase 를 건드리지 않고 거절한다', async () => {
    env.enableDevLogin = false
    // 화면 조건만으로는 번들에서 사라지지 않는다. 운영 빌드에서 플래그가 잘못 켜져도 여기서 막힌다.
    await expect(devSignIn('x@test.local', 'password123')).rejects.toThrow('dev_login_disabled')
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('개발 로그인: 운영 빌드(DEV=false)에서는 플래그가 켜져 있어도 거절한다', async () => {
    vi.stubEnv('DEV', false)
    // 환경변수 오설정만으로 개발 로그인이 되살아나지 않아야 한다.
    await expect(devSignIn('x@test.local', 'password123')).rejects.toThrow('dev_login_disabled')
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('개발 로그인: 자격 증명 오류가 아니면 가입을 시도하지 않고 그대로 던진다', async () => {
    // 통신 오류까지 가입으로 넘기면 원래 오류가 묻히고 뜻하지 않은 계정이 생긴다.
    signInWithPassword.mockResolvedValue({ error: new Error('Network request failed') })
    await expect(devSignIn('x@test.local', 'password123')).rejects.toThrow('Network request failed')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('개발 로그인: 영문 문구가 달라도 code 로 자격 증명 오류를 알아본다', async () => {
    const error = Object.assign(new Error('잘못된 로그인 정보'), { code: 'invalid_credentials' })
    signInWithPassword.mockResolvedValue({ error })
    signUp.mockResolvedValue({ error: null })
    await devSignIn('new@test.local', 'password123')
    expect(signUp).toHaveBeenCalledWith({ email: 'new@test.local', password: 'password123' })
  })

  it('로그아웃을 호출한다', async () => {
    authSignOut.mockResolvedValue({ error: null })
    await signOut()
    expect(authSignOut).toHaveBeenCalled()
  })

  it('로그아웃 오류는 그대로 던진다', async () => {
    authSignOut.mockResolvedValue({ error: new Error('signout_failed') })
    await expect(signOut()).rejects.toThrow('signout_failed')
  })
})
```

- [x] **Step 3: 실패하는 테스트 — `src/pages/StartPage.test.tsx`**

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { StartPage } from './StartPage'

// env 는 가짜 객체를 그대로 공유해 테스트마다 플래그만 바꾼다 (모듈을 다시 읽지 않아도 된다).
const { signInWithKakao, devSignIn, env } = vi.hoisted(() => ({
  signInWithKakao: vi.fn<() => Promise<void>>(),
  devSignIn: vi.fn<(email: string, password: string) => Promise<void>>(),
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
  })

  it('앱 이름과 카카오 버튼, 처리방침 링크를 보여준다', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'OO교회 식권' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '카카오로 시작하기' })).toBeInTheDocument()
    // 해시 라우팅·하위 경로 배포에 따라 접두사가 달라지므로 경로 조각만 본다.
    expect(screen.getByRole('link', { name: '개인정보 처리방침' })).toHaveAttribute(
      'href',
      expect.stringContaining('privacy'),
    )
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

  it('카카오로 이동하는 동안은 버튼을 잠그고 안내를 보여준다', async () => {
    signInWithKakao.mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: '카카오로 시작하기' })
    await userEvent.click(button)
    // 떠나는 데 수백 ms 가 걸린다. 그 사이 두 번째 OAuth 가 code_verifier 를 덮어쓰면
    // 돌아왔을 때 코드 교환이 실패한다. 그래서 성공 시엔 잠근 채 둔다.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('카카오 로그인 화면으로 이동하고 있어요'))
    expect(button).toBeDisabled()
  })

  it('로그인이 실패하면 버튼이 다시 살아난다', async () => {
    signInWithKakao.mockRejectedValue(new Error('oauth_failed'))
    renderPage()
    const button = screen.getByRole('button', { name: '카카오로 시작하기' })
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // 버튼이 굳어 버리면 사용자는 더 할 수 있는 일이 없다.
    expect(button).not.toBeDisabled()
  })

  it('다시 시도하면 이전 안내 문구를 지운다', async () => {
    signInWithKakao.mockRejectedValueOnce(new Error('oauth_failed')).mockResolvedValue(undefined)
    renderPage()
    const button = screen.getByRole('button', { name: '카카오로 시작하기' })

    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await userEvent.click(button)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('개발 로그인 플래그가 꺼져 있으면 이메일 폼이 없다', () => {
    renderPage()
    expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument()
  })

  it('개발 로그인 실패 시 안내 문구를 보여준다', async () => {
    env.enableDevLogin = true
    devSignIn.mockRejectedValue(new Error('dev_login_disabled'))
    renderPage()
    await userEvent.type(screen.getByLabelText('이메일'), 'dev@test.local')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: '개발용 로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('개발용 로그인은 사용할 수 없어요.')
  })

  it('개발 로그인 중에는 버튼을 잠그지만 카카오 안내는 띄우지 않는다', async () => {
    env.enableDevLogin = true
    let settle: () => void = () => {}
    devSignIn.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      }),
    )
    renderPage()
    await userEvent.type(screen.getByLabelText('이메일'), 'dev@test.local')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password123')
    const submit = screen.getByRole('button', { name: '개발용 로그인' })

    await userEvent.click(submit)
    expect(submit).toBeDisabled()
    // 개발 로그인은 페이지를 떠나지 않으므로 카카오 이동 안내가 떠서는 안 된다.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => {
      settle()
    })
    expect(submit).not.toBeDisabled()
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

- [x] **Step 4: 실패 확인**

```bash
npm test
```
Expected: 두 파일 FAIL.

- [x] **Step 5: 구현 — `src/features/auth/signIn.ts`**

```ts
import { env } from '../../lib/env'
import { supabase } from '../../lib/supabase'

// supabase-js 는 code 를 주지만 버전·배포에 따라 비어 있을 수 있어 영문 문구도 함께 본다.
const INVALID_CREDENTIALS = /invalid login credentials/i

function isInvalidCredentials(error: { code?: string; message: string }): boolean {
  return error.code === 'invalid_credentials' || INVALID_CREDENTIALS.test(error.message)
}

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

/** 로컬·테스트 전용. 아직 없는 계정이면 가입을 시도한다 (로컬은 이메일 확인이 꺼져 있어 바로 세션이 생긴다). */
export async function devSignIn(email: string, password: string): Promise<void> {
  // import.meta.env.DEV 는 운영 빌드에서 리터럴 false 로 치환되어 아래 전체가 번들에서 사라진다.
  // 환경변수 오설정으로는 되살릴 수 없다.
  if (!import.meta.env.DEV || !env.enableDevLogin) throw new Error('dev_login_disabled')

  const signedIn = await supabase.auth.signInWithPassword({ email, password })
  if (!signedIn.error) return
  // 통신 오류·속도 제한까지 가입으로 넘기면 원래 오류가 묻히고 뜻하지 않은 계정이 생긴다.
  if (!isInvalidCredentials(signedIn.error)) throw signedIn.error

  const signedUp = await supabase.auth.signUp({ email, password })
  if (signedUp.error) throw signedUp.error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
```

- [x] **Step 6: 구현 — `src/pages/StartPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button, TextField } from '../components/ui'
import { church } from '../config/church'
import { devSignIn, signInWithKakao } from '../features/auth/signIn'
import { env } from '../lib/env'
import { toUserMessage } from '../lib/errors'

/** 어느 버튼이 일하는 중인지. 카카오만 이동 안내를 띄우고, 성공해도 잠긴 채 둔다. */
type Pending = 'kakao' | 'dev'

export function StartPage() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const busy = pending !== null

  async function run(kind: Pending, action: () => Promise<void>, { unlockOnSuccess = true } = {}) {
    setPending(kind)
    setError(null)
    try {
      await action()
      // 카카오는 성공 시 window.location.assign 으로 떠나지만, 브라우저가 실제로 페이지를 내리기까지
      // 수백 ms 가 걸린다. 그 사이 버튼을 열면 두 번째 OAuth 가 code_verifier 를 덮어써 돌아왔을 때
      // 코드 교환이 실패한다. 그래서 성공 시엔 잠근 채 둔다.
      if (unlockOnSuccess) setPending(null)
    } catch (err) {
      setError(toUserMessage(err))
      setPending(null)
    }
  }

  function onDevSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    void run('dev', () => devSignIn(email, password))
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold">{church.appName}</h1>
        <p className="mt-2 text-sm text-gray-500">주일 식사를 더 간편하게</p>
      </div>

      <Button
        variant="kakao"
        disabled={busy}
        onClick={() => void run('kakao', signInWithKakao, { unlockOnSuccess: false })}
      >
        카카오로 시작하기
      </Button>

      {pending === 'kakao' && (
        <p role="status" className="text-center text-sm text-gray-600">
          카카오 로그인 화면으로 이동하고 있어요…
        </p>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}

      {/* import.meta.env.DEV 는 운영 빌드에서 리터럴 false 로 치환되어 이 폼 전체가 번들에서 사라진다. */}
      {import.meta.env.DEV && env.enableDevLogin && (
        <form onSubmit={onDevSubmit} className="mt-6">
          <fieldset className="rounded-xl border border-dashed border-gray-300 p-4">
            <legend className="px-1 text-xs font-semibold text-gray-500">개발용 로그인 (로컬 전용)</legend>
            <div className="flex flex-col gap-3">
              <TextField label="이메일" name="email" type="email" autoComplete="username" required />
              <TextField label="비밀번호" name="password" type="password" autoComplete="current-password" required minLength={6} />
              <Button variant="ghost" type="submit" disabled={busy}>
                개발용 로그인
              </Button>
            </div>
          </fieldset>
        </form>
      )}

      <Link to="/privacy" className="mt-8 text-center text-xs text-gray-600 underline">
        개인정보 처리방침
      </Link>
    </main>
  )
}
```

- [x] **Step 7: 통과 확인**

```bash
npm test
```
Expected: 모두 통과. `App.test.tsx`의 "시작" 제목 기대값이 깨지므로 `{ name: 'OO교회 식권' }`으로 수정한다. 또한 `App.test.tsx`는 `./lib/env`를 모킹하지 않으므로 `.env.local`이 있어야 한다(Task 3에서 작성). `.env.local`이 없으면 `vi.mock('./lib/env', () => ({ env: { enableDevLogin: false } }))`를 `App.test.tsx`에 추가한다.

- [x] **Step 7-1: 운영 빌드 고정값 — `.env.production` (커밋)**

Vite 는 `.env.local` 을 운영 빌드에도 읽는다. 로컬의 `VITE_ENABLE_DEV_LOGIN=true` 가 운영 번들에 박히지 않도록 `.env.[mode]` 로 덮어쓴다(`.gitignore` 에 `!.env.production` 추가).

```
# 운영 빌드 고정값. .env.local 보다 우선한다 (vite 는 .env.[mode] 를 .env.local 위에 둔다).
VITE_ENABLE_DEV_LOGIN=false
```

또한 `signIn.ts`/`StartPage.tsx` 의 개발 로그인 분기는 `import.meta.env.DEV` 로도 감싸서 운영 번들에서 코드 자체가 사라지게 한다(빌드 후 `grep -c 'current-password' dist/assets/App-*.js` → 0). 대가로 `npm run preview` 에서는 개발 로그인이 보이지 않는다.

- [x] **Step 8: 커밋**

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

- [x] **Step 1: 실패하는 테스트 — `src/features/onboarding/onboardingSchema.test.ts`**

```ts
import { validateOnboarding, type OnboardingInput } from './onboardingSchema'

// 결과 전체를 한 번에 비교한다. `if (!r.ok) expect(...)` 는 좁히기엔 편하지만
// 조건부 expect 라서 (vitest/no-conditional-expect) 검사가 아예 안 돌아도 테스트가 통과한다.
describe('validateOnboarding', () => {
  it('정상 입력은 번호를 정규화해 돌려준다', () => {
    const r = validateOnboarding({ name: ' 김철수 ', phone: '010-1234-5678', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678', consent: true } })
  })

  it('이름이 비면 이름 오류', () => {
    const r = validateOnboarding({ name: '  ', phone: '01012345678', consent: true })
    expect(r).toEqual({ ok: false, errors: { name: '이름을 입력해 주세요' } })
  })

  it('이름이 20자를 넘으면 오류', () => {
    const r = validateOnboarding({ name: '가'.repeat(21), phone: '01012345678', consent: true })
    expect(r).toEqual({ ok: false, errors: { name: '이름은 20자 이내로 입력해 주세요' } })
  })

  it('휴대폰 형식이 아니면 번호 오류', () => {
    const r = validateOnboarding({ name: '김철수', phone: '02-123-4567', consent: true })
    expect(r).toEqual({ ok: false, errors: { phone: '휴대폰 번호를 확인해 주세요' } })
  })

  it('+82 국제 표기도 010 으로 정규화한다', () => {
    const r = validateOnboarding({ name: '김철수', phone: '+82 10-1234-5678', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '김철수', phone: '01012345678', consent: true } })
  })

  it('동의하지 않으면 동의 오류', () => {
    const r = validateOnboarding({ name: '김철수', phone: '01012345678', consent: false })
    expect(r).toEqual({ ok: false, errors: { consent: '개인정보 동의가 필요해요' } })
  })

  it('조합형(NFD) 한글 이름도 완성형으로 세어 20자까지 받는다', () => {
    // NFD 는 '김' 한 자가 3자로 세어진다. 정규화하지 않으면 7자 이름이 21자로 걸린다.
    const nfd = '김김김김김김김'.normalize('NFD')
    expect(nfd.length).toBe(21)
    const r = validateOnboarding({ name: nfd, phone: '01012345678', consent: true })
    expect(r).toEqual({ ok: true, values: { name: '김김김김김김김', phone: '01012345678', consent: true } })
  })

  it('필드를 가리키지 않는 오류는 일반 문구로 바꾼다', () => {
    // 타입이 막아 주지만 경계에서 한 번 더 본다. 객체가 아니면 zod 는 경로 없는 오류를 돌려준다.
    const r = validateOnboarding(null as unknown as OnboardingInput)
    expect(r).toEqual({ ok: false, errors: { name: '입력 내용을 확인해 주세요' } })
  })

  it('여러 오류가 있으면 필드별로 첫 메시지만 담는다', () => {
    const r = validateOnboarding({ name: '', phone: 'abc', consent: false })
    expect(r).toEqual({
      ok: false,
      errors: {
        name: '이름을 입력해 주세요',
        phone: '휴대폰 번호를 확인해 주세요',
        consent: '개인정보 동의가 필요해요',
      },
    })
  })
})
```

- [x] **Step 2: 실패하는 테스트 — `src/features/onboarding/OnboardingPage.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { church } from '../../config/church'
import { personQueryKey } from '../auth/usePerson'
import { OnboardingPage } from './OnboardingPage'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args: Record<string, string>) => Promise<RpcResult>>(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }))
// 가입 화면은 로그인된 사람만 들어온다 (RequireSession). 돌려받은 사람 행을 그 사용자 키에 넣는다.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', session: { user: { id: 'u1' } } }),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<p>home</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

const submitButton = () => screen.getByRole('button', { name: '동의하고 시작하기' })

async function fillValid() {
  await userEvent.type(screen.getByLabelText('이름'), '김철수')
  await userEvent.type(screen.getByLabelText('휴대폰 번호'), '010-1234-5678')
  await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
}

async function submitBadPhone() {
  await userEvent.type(screen.getByLabelText('이름'), '김철수')
  await userEvent.type(screen.getByLabelText('휴대폰 번호'), '02-123-4567')
  await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
  await userEvent.click(submitButton())
}

describe('OnboardingPage', () => {
  it('고지 4요소와 처리방침 링크를 보여주고, 동의 전에는 버튼이 비활성이다', () => {
    renderPage()
    expect(screen.getByText(/이름, 휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByText(/식권 발급·사용 확인/)).toBeInTheDocument()
    expect(screen.getByText(/탈퇴 시까지/)).toBeInTheDocument()
    expect(screen.getByText(/동의하지 않으면/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '자세히' })
    expect(link).toHaveAttribute('href', expect.stringContaining('privacy'))
    // 같은 탭에서 열면 적어 둔 이름·번호가 사라진다.
    expect(link).toHaveAttribute('target', '_blank')
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText('동의에 체크하면 시작할 수 있어요')).toBeInTheDocument()
  })

  it('번호가 틀리면 오류를 보여주고 서버를 호출하지 않는다', async () => {
    renderPage()
    await submitBadPhone()
    expect(await screen.findByRole('alert')).toHaveTextContent('휴대폰 번호를 확인해 주세요')
    expect(screen.getByLabelText('휴대폰 번호')).toHaveAttribute('aria-invalid', 'true')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('잘못된 입력을 제출하면 첫 오류 필드로 포커스를 옮긴다', async () => {
    renderPage()
    await submitBadPhone()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // 이름은 정상이므로 건너뛰고 번호로 간다.
    expect(document.activeElement).toBe(screen.getByLabelText('휴대폰 번호'))
  })

  it('이름과 번호가 모두 비면 둘 다 알리고 이름으로 포커스를 옮긴다', async () => {
    renderPage()
    await userEvent.click(screen.getByLabelText(/개인정보 수집·이용 동의/))
    await userEvent.click(submitButton())
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(document.activeElement).toBe(screen.getByLabelText('이름'))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('입력을 고치기 시작하면 그 필드의 오류 표시가 사라진다', async () => {
    renderPage()
    await submitBadPhone()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '8')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('휴대폰 번호')).not.toHaveAttribute('aria-invalid')
  })

  it('성공하면 claim_person을 정규화된 값으로 호출하고, 돌려받은 행을 캐시에 넣고 홈으로 간다', async () => {
    const person = { id: 'p1', name: '김철수', phone: '01012345678' }
    rpc.mockResolvedValue({ data: person, error: null })
    const { client } = renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(rpc).toHaveBeenCalledWith('claim_person', {
      p_name: '김철수',
      p_phone: '01012345678',
      p_consent_version: church.consentVersion,
    })
    expect(await screen.findByText('home')).toBeInTheDocument()
    // 홈이 같은 행을 다시 조회하지 않게 한다.
    expect(client.getQueryData(personQueryKey('u1'))).toEqual(person)
  })

  it('서버 오류 코드를 사용자 문구로 보여주고 버튼을 다시 연다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'phone_taken' } })
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 등록된 번호예요. 권사님께 문의해 주세요.')
    expect(submitButton()).not.toBeDisabled()
    // 적어 둔 값은 그대로 남아 있어야 고쳐서 다시 낼 수 있다.
    expect(screen.getByLabelText('이름')).toHaveValue('김철수')
  })

  it('서버 안내도 번호를 고치기 시작하면 사라진다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'phone_taken' } })
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('휴대폰 번호'), '9')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('already_registered 는 실패가 아니라 이미 성공한 것이므로 홈으로 간다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'already_registered' } })
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('처리 중에는 버튼이 비활성이고 문구가 바뀐다', async () => {
    let settle: (v: { data: unknown; error: null }) => void = () => {}
    rpc.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    renderPage()
    await fillValid()
    await userEvent.click(submitButton())
    expect(screen.getByRole('button', { name: '처리 중…' })).toBeDisabled()
    settle({ data: { id: 'p1' }, error: null })
    expect(await screen.findByText('home')).toBeInTheDocument()
  })
})
```

- [x] **Step 3: 실패 확인**

```bash
npm test
```
Expected: 두 파일 FAIL.

`QueryClientProvider` + `MemoryRouter` 조합이 이 Task부터 여러 테스트에 반복되면, `src/test/renderWithProviders.tsx`(테스트마다 새 `QueryClient({ defaultOptions: { queries: { retry: false } } })` + `MemoryRouter`)로 뽑아 공용으로 쓴다. 테스트 코드 중복이 두 파일을 넘기 전에는 만들지 않는다.

- [x] **Step 4: 구현 — `src/features/onboarding/onboardingSchema.ts`**

```ts
import { z } from 'zod'
import { isValidMobile, normalizePhone } from '../../lib/phone'

// 가입 화면의 입력 규칙. 문구는 사용자에게 그대로 보이므로 DB 오류 코드와 따로 둔다.
export const onboardingSchema = z.object({
  // 한글은 조합형(NFD)으로도 들어온다 (iOS 자판·붙여넣기). 그때는 '김' 한 자가 3자로 세어져
  // 20자 제한에 억울하게 걸린다. 완성형(NFC)으로 맞춘 뒤 길이를 센다. DB 에 가는 값도 NFC 가 된다.
  name: z
    .string()
    .transform((s) => s.normalize('NFC'))
    .pipe(z.string().trim().min(1, '이름을 입력해 주세요').max(20, '이름은 20자 이내로 입력해 주세요')),
  // 하이픈·공백·국제 표기를 먼저 숫자열로 정리한 뒤 형식을 본다 (DB 의 normalize_phone 과 같은 규칙).
  phone: z.string().transform(normalizePhone).refine(isValidMobile, '휴대폰 번호를 확인해 주세요'),
  // z.literal(true) 로 쓰면 입력 타입까지 true 로 좁혀져 boolean 폼 상태를 넣을 수 없다. refine 으로 둔다.
  consent: z.boolean().refine((v) => v === true, '개인정보 동의가 필요해요'),
})

export type OnboardingInput = z.input<typeof onboardingSchema>
export type OnboardingValues = z.output<typeof onboardingSchema>
export type OnboardingErrors = Partial<Record<keyof OnboardingInput, string>>

/** 폼 입력을 검사해 정규화된 값 또는 필드별 첫 오류 문구를 돌려준다. */
export function validateOnboarding(
  input: OnboardingInput,
): { ok: true; values: OnboardingValues } | { ok: false; errors: OnboardingErrors } {
  const result = onboardingSchema.safeParse(input)
  if (result.success) return { ok: true, values: result.data }
  const errors: OnboardingErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof OnboardingInput | undefined
    if (!key) {
      // 입력이 객체가 아닐 때처럼 어느 필드인지 모르는 오류. 화면이 아무 말도 못 하는 편보다
      // 첫 칸에 일반 문구라도 띄우는 편이 낫다 (타입이 막아 주므로 사실상 닿지 않는다).
      errors.name ??= '입력 내용을 확인해 주세요'
      continue
    }
    // 한 필드에 여러 오류가 걸리면 첫 문구만 보여 준다 (화면에 한 줄씩만 둔다).
    if (!errors[key]) errors[key] = issue.message
  }
  return { ok: false, errors }
}
```

- [x] **Step 5: 구현 — `src/features/onboarding/OnboardingPage.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Checkbox, TextField } from '../../components/ui'
import { church } from '../../config/church'
import { messageOf, toUserMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { personQueryKey } from '../auth/usePerson'
import { validateOnboarding, type OnboardingErrors, type OnboardingValues } from './onboardingSchema'

// 오류가 여러 개면 이 순서로 첫 칸을 찾아 포커스를 옮긴다 (화면에 보이는 순서와 같게 둔다).
const FIELD_ORDER = ['name', 'phone', 'consent'] as const

async function claimPerson(values: OnboardingValues) {
  const { data, error } = await supabase.rpc('claim_person', {
    p_name: values.name,
    p_phone: values.phone,
    p_consent_version: church.consentVersion,
  })
  // PostgREST 오류는 Error 가 아닌 평범한 객체다 (usePerson 과 같은 방식으로 감싼다).
  // react-query 는 error 를 Error 로 타이핑하므로, 날것을 던지면 타입과 실제가 어긋난다.
  if (error) throw Object.assign(new Error(error.message), { code: error.code, cause: error })
  return data
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const auth = useAuth()
  const userId = auth.status === 'ready' ? auth.session?.user.id : undefined
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<OnboardingErrors>({})

  async function goHome() {
    // 돌려받은 행이 없을 때만 쓴다. Gate 가 사람 행을 다시 읽게 한다
    // (키 접두사 ['person'] 으로 모든 사용자 캐시를 무효화).
    await queryClient.invalidateQueries({ queryKey: ['person'] })
    navigate('/', { replace: true })
  }

  const mutation = useMutation({
    mutationFn: claimPerson,
    // claim_person 은 만든 사람 행을 그대로 돌려준다. 캐시에 넣어 두면 홈이 같은 행을 다시 묻지 않는다.
    onSuccess: (person) => {
      if (userId) queryClient.setQueryData(personQueryKey(userId), person)
      navigate('/', { replace: true })
    },
    // 더블 탭 등으로 먼저 간 요청이 이미 가입을 끝냈으면 서버는 already_registered 를 돌려준다.
    // 이것은 실패가 아니라 "이미 성공" 이므로 홈으로 보낸다 (행을 못 받았으니 Gate 가 다시 읽는다).
    onError: async (err) => {
      if (messageOf(err) === 'already_registered') await goHome()
    },
  })

  function clearError(key: keyof OnboardingErrors) {
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  /** 고치는 중에 지난 오류가 남아 있으면 혼란스럽다. 그 칸의 오류와 서버 안내를 함께 치운다. */
  function onEdit(key: 'name' | 'phone') {
    clearError(key)
    // 서버 안내는 방금 보낸 이름·번호에 대한 것이다. 입력이 바뀌면 더 이상 맞는 말이 아니다.
    if (mutation.isError) mutation.reset()
  }

  function focusFirstError(found: OnboardingErrors) {
    const first = FIELD_ORDER.find((key) => found[key])
    // TextField·Checkbox 의 id 를 name 과 같게 두었다. 폼 안에서만 찾는다.
    if (first) formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus()
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = validateOnboarding({ name, phone, consent })
    if (!result.ok) {
      setErrors(result.errors)
      // 어느 칸을 고쳐야 하는지 바로 알 수 있게 커서를 옮긴다 (화면을 읽어 주는 기기에도 알려진다).
      focusFirstError(result.errors)
      return
    }
    setErrors({})
    mutation.mutate(result.values)
  }

  const notice = church.consentNotice
  const serverError =
    mutation.isError && messageOf(mutation.error) !== 'already_registered' ? toUserMessage(mutation.error) : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-extrabold">처음 오셨네요</h1>
      <p className="text-sm text-gray-600">권사님이 식권을 발급할 때 쓰는 정보예요. 입금하신 이름과 같게 적어 주세요.</p>

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="이름"
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            onEdit('name')
          }}
          autoComplete="name"
          maxLength={20}
          required
          error={errors.name}
        />
        <TextField
          label="휴대폰 번호"
          name="phone"
          type="tel"
          // tel 은 + 가 있는 자판을 띄운다 (numeric 은 숫자만 나와 국제 표기를 적을 수 없다).
          inputMode="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            onEdit('phone')
          }}
          autoComplete="tel"
          placeholder="010-0000-0000"
          required
          error={errors.phone}
        />

        <section className="rounded-xl border border-blue-600 bg-white p-3 text-xs leading-relaxed">
          <div className="flex items-start justify-between gap-2">
            <Checkbox
              id="consent"
              name="consent"
              required
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked)
                clearError('consent')
              }}
            >
              <strong>[필수] 개인정보 수집·이용 동의</strong>
            </Checkbox>
            {/* 링크를 레이블 안에 두면 체크박스 이름에 '자세히' 가 섞인다. 밖에 두고 새 창으로 연다
                (같은 탭에서 열면 적어 둔 이름·번호가 사라진다). */}
            <Link to="/privacy" target="_blank" rel="noreferrer" className="shrink-0 text-blue-600 underline">
              자세히
            </Link>
          </div>
          <dl className="mt-2 grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 pl-6 text-gray-600">
            <dt>항목</dt>
            <dd>{notice.items}</dd>
            <dt>목적</dt>
            <dd>{notice.purpose}</dd>
            <dt>보유</dt>
            <dd>{notice.retention}</dd>
            <dt>거부 시</dt>
            <dd>{notice.refusal}</dd>
          </dl>
          {/* 지금은 화면에서 닿지 않는다 (동의 전에는 제출 버튼이 잠겨 consent 오류가 생기지 않는다).
              규칙은 스키마가 갖고 있으니, 잠금 방식이 바뀌어도 문구가 비지 않도록 남겨 둔다. */}
          {errors.consent && (
            <p role="alert" className="mt-2 pl-6 text-red-600">
              {errors.consent}
            </p>
          )}
        </section>

        {serverError && <p role="alert" className="text-sm text-red-600">{serverError}</p>}

        <div>
          <Button
            type="submit"
            disabled={!consent || mutation.isPending}
            aria-describedby={consent ? undefined : 'submit-hint'}
          >
            {mutation.isPending ? '처리 중…' : '동의하고 시작하기'}
          </Button>
          {/* 버튼이 왜 눌리지 않는지 말해 준다. 잠긴 버튼만 보이면 사용자는 길을 잃는다. */}
          {!consent && (
            <p id="submit-hint" className="mt-2 text-center text-xs text-gray-600">
              동의에 체크하면 시작할 수 있어요
            </p>
          )}
        </div>
      </form>
    </main>
  )
}
```

- [x] **Step 6: 통과 확인**

```bash
npm test
```
Expected: 모두 통과.

- [x] **Step 7: 커밋**

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
        <p>데이터 저장과 로그인 처리를 위해 Supabase(데이터베이스·인증), 카카오(소셜 로그인)를 이용합니다. 카카오에서는 회원번호와 닉네임을 제공받으며, 프로필 사진과 카카오계정 이메일은 선택 동의 항목으로 거부할 수 있고 제공되더라도 로그인 계정 식별 외에 이용하지 않습니다.</p>
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HomePage person={person} />
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  it('이름과 가려진 번호, 식사 없음 카드를 보여준다', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '김철수 님' })).toBeInTheDocument()
    expect(screen.getByText('010-****-5678')).toBeInTheDocument()
    expect(screen.getByText('오늘은 식사가 없어요')).toBeInTheDocument()
  })

  it('로그아웃 버튼이 signOut을 부른다', async () => {
    signOut.mockResolvedValue(undefined)
    renderPage()
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
import { useQueryClient } from '@tanstack/react-query'
import type { Person } from '../features/auth/usePerson'
import { signOut } from '../features/auth/signIn'
import { maskPhone } from '../lib/phone'

export function HomePage({ person }: { person: Person }) {
  const queryClient = useQueryClient()

  // 로그아웃 뒤 캐시(['person', uid])가 gcTime 동안 남지 않도록 비운다 (공용 폰 대비).
  async function onSignOut() {
    await signOut()
    queryClient.clear()
  }

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
        onClick={() => void onSignOut()}
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

`baseURL`/`webServer.url`은 반드시 `localhost`로 둔다. Vite 개발 서버는 이 환경에서 IPv6(`[::1]:5173`)에만 바인딩되어 `127.0.0.1:5173`은 연결이 거부된다.

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
      - name: 배포 환경변수 확인 (빈 값이면 조용히 깨진 사이트가 배포되므로 여기서 실패시킨다)
        run: |
          test -n "${{ vars.VITE_SUPABASE_URL }}" || { echo "VITE_SUPABASE_URL 변수가 비어 있습니다"; exit 1; }
          test -n "${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}" || { echo "VITE_SUPABASE_PUBLISHABLE_KEY 변수가 비어 있습니다"; exit 1; }
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
- `src/config/church.ts`의 교회명·담당자 연락처(`privacyOfficer.name`, `phone` — 지금은 빈 문자열)를 실제 값으로 바꾼 뒤 배포한다. 처리방침의 담당자 연락처는 법적 필수 항목이다.
- `index.html`의 `<title>`도 같은 앱 이름으로 맞춘다 (TS 설정을 읽지 못하므로 수동 편집).
- `npm run preview`(운영 빌드 미리보기)에는 개발용 로그인이 없다. 로컬 확인은 `npm run dev` 로 한다.
- 운영 Supabase 의 **Email provider 는 반드시 끈다** (끄지 않으면 카카오 없이 이메일로 자가 가입이 가능해진다). 개발용 로그인 코드는 운영 번들에서 제거되지만 서버 쪽 차단이 진짜 경계다.
- Supabase **Redirect URLs** 에 GitHub Pages 주소(`https://<github-user>.github.io/<repo>/`)가 등록되어 있는지 확인한다.

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
