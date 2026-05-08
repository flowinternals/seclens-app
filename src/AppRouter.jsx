import { Navigate, Route, Routes } from 'react-router-dom'
import App from './App'
import { RequireAdmin, RequireAuth } from './components/auth/RouteGuards'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AdminPage from './pages/AdminPage'
import AdminRunsPage from './pages/AdminRunsPage'
import AdminRunDetailPage from './pages/AdminRunDetailPage'
import BillingPage from './pages/BillingPage'

export default function AppRouter() {
  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <App />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/account/billing"
          element={
            <RequireAuth>
              <BillingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/runs"
          element={
            <RequireAuth>
              <RequireAdmin>
                <AdminRunsPage />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/runs/:runId"
          element={
            <RequireAuth>
              <RequireAdmin>
                <AdminRunDetailPage />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}
