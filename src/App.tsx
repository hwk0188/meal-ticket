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
