import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LandingPage } from '@platform/web-shared'
import { LoginPage } from './pages/LoginPage'
import { StartPage } from './pages/StartPage'
import { LanguageSelectPage } from './pages/LanguageSelectPage'
import { AssessPage } from './pages/AssessPage'
import { CompletePage } from './pages/CompletePage'
import { SystemCheckPage } from './pages/SystemCheckPage'
import { MobileProctorPage } from './pages/MobileProctorPage'
import { ConnectionBanner } from './components/ConnectionBanner'

export default function App() {
  return (
    <BrowserRouter>
      {/* ConnectionBanner sits above all routes - renders on every page when active */}
      <ConnectionBanner />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/start" element={<StartPage />} />
        <Route path="/system-check" element={<SystemCheckPage />} />
        <Route path="/mobile-proctor" element={<MobileProctorPage />} />
        <Route path="/language-select" element={<LanguageSelectPage />} />
        <Route path="/assess" element={<AssessPage />} />
        <Route path="/complete" element={<CompletePage />} />
        {/* Unknown paths land on the marketing home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
