import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { FiltersProvider } from './hooks/useFilters'
import { Layout } from './components/layout/Layout'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { Corretores } from './pages/Corretores'
import { OrigensRegioes } from './pages/OrigensRegioes'
import { CohortCiclo } from './pages/CohortCiclo'
import { LeadsPage } from './pages/LeadsPage'
import { HeatmapPage } from './pages/HeatmapPage'
import { Admin } from './pages/Admin'

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>Carregando...</div>
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return null

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <FiltersProvider>
            <Layout>
              <Routes>
                <Route index element={<Overview />} />
                <Route path="corretores" element={<Corretores />} />
                <Route path="origens" element={<OrigensRegioes />} />
                <Route path="cohort" element={<CohortCiclo />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="heatmap" element={<HeatmapPage />} />
                <Route path="admin" element={
                  <ProtectedRoute adminOnly>
                    <Admin />
                  </ProtectedRoute>
                } />
              </Routes>
            </Layout>
          </FiltersProvider>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
