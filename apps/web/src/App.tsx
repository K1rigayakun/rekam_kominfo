import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuthStore } from './stores/authStore';
import AppLayout from './components/AppLayout';
import { Toaster } from 'sonner';
import InteractiveBackground from './components/InteractiveBackground';

const LoginPage = lazy(() => import('./pages/Login'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const ActivityDetailPage = lazy(() => import('./pages/ActivityDetail'));
const PublicViewerPage = lazy(() => import('./pages/PublicViewer'));
const PreviewSharePage = lazy(() => import('./pages/PreviewSharePage'));
const ShareActivityPage = lazy(() => import('./pages/ShareActivity'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const TeamsPage = lazy(() => import('./pages/TeamsPage'));
const DistrictsPage = lazy(() => import('./pages/DistrictsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ActivityVersionsPage = lazy(() => import('./pages/ActivityVersionsPage'));

function RouteFallback() {
  return (
    <div className="min-h-[60dvh] flex items-center justify-center text-sm font-semibold text-slate-500">
      Memuat halaman...
    </div>
  );
}

// Komponen untuk melindungi rute yang butuh autentikasi
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function App() {
  return (
    <>
      <Toaster
        position="top-center"
        richColors
        toastOptions={{
          style: {
            fontFamily: '"Satoshi", system-ui, sans-serif',
            borderRadius: '1rem',
            padding: '14px 18px',
            boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.4)',
            backdropFilter: 'blur(12px)',
            fontSize: '14px',
            fontWeight: '500',
          },
        }}
      />
      <InteractiveBackground />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
        {/* Route publik */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/p/:token" element={<PublicViewerPage />} />
        <Route path="/preview" element={
          <ProtectedRoute>
            <PreviewSharePage />
          </ProtectedRoute>
        } />
        
        {/* Route yang butuh login — menggunakan AppLayout sebagai parent */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="/activity/:id" element={<ActivityDetailPage />} />
          <Route path="/activity/:id/versions" element={<ActivityVersionsPage />} />
          <Route path="/activity/:id/sharing" element={<ShareActivityPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/districts" element={<DistrictsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        
        {/* Route fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </>
  );
}

export default App;
