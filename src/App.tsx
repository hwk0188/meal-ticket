import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './features/auth/AuthProvider'
import { Gate, RequireAdmin, RequirePerson, RequireSession } from './features/auth/Gate'
import { OnboardingPage } from './features/onboarding/OnboardingPage'
import { AdminMealsPage } from './pages/admin/AdminMealsPage'
import { IssuePage } from './pages/admin/IssuePage'
import { HistoryPage } from './pages/HistoryPage'
import { PairPage } from './pages/PairPage'
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
            {/* 가드가 /pair 로 보내는데 라우트가 없으면 '*' → '/' → /pair … 무한 리다이렉트가 된다. */}
            <Route path="/pair" element={<RequireSession allowAnonymous><PairPage /></RequireSession>} />
            <Route path="/privacy" element={<PrivacyPage />} />
            {/* 가입을 마친 사람만. 하단 탭이 붙는다. 관리자 화면(식사·발급)은 Phase 2 에서 완성됐다. */}
            <Route element={<RequirePerson />}>
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/admin/meals" element={<RequireAdmin><AdminMealsPage /></RequireAdmin>} />
              <Route path="/admin/issue" element={<RequireAdmin><IssuePage /></RequireAdmin>} />
            </Route>
            {/* 모르는 주소는 홈 주소로 정리한다 (Gate 를 그대로 띄우면 주소가 그대로 남는다). */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
