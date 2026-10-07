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
