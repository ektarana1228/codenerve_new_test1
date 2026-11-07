import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { RequireAuth } from './components/RequireAuth'
import { LandingPage } from '@platform/web-shared'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { AssessmentsPage } from './pages/AssessmentsPage'
import { NewAssessmentPage } from './pages/NewAssessmentPage'
import { AssessmentDetailPage } from './pages/AssessmentDetailPage'
import { LibraryPage } from './pages/LibraryPage'
import { LeaderboardPage } from './pages/LeaderboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProctorEvidencePage } from './pages/ProctorEvidencePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/proctoring/:sessionId"
          element={<RequireAuth><ProctorEvidencePage /></RequireAuth>}
        />
        <Route
          path="/dashboard"
          element={<RequireAuth><DashboardPage /></RequireAuth>}
        />
        <Route
          path="/assessments/new"
          element={<RequireAuth><NewAssessmentPage /></RequireAuth>}
        />
        <Route
          path="/assessments/:id/leaderboard"
          element={<RequireAuth><LeaderboardPage /></RequireAuth>}
        />
        <Route
          path="/assessments/:id"
          element={<RequireAuth><AssessmentDetailPage /></RequireAuth>}
        />
        <Route
          path="/assessments"
          element={<RequireAuth><AssessmentsPage /></RequireAuth>}
        />
        <Route
          path="/library"
          element={<RequireAuth><LibraryPage /></RequireAuth>}
        />
        <Route
          path="/settings"
          element={<RequireAuth><SettingsPage /></RequireAuth>}
        />
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
