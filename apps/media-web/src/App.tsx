import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { useAuthStore } from './stores/authStore';
import AppLayout from './components/AppLayout';
import { Toaster } from 'sonner';
import InteractiveBackground from './components/InteractiveBackground';

const LoginPage = lazy(() => import('./pages/Login'));
const MediaNewsCoveragesPage = lazy(() => import('./pages/MediaNewsCoveragesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MediaPortalLayout = lazy(() => import('./components/MediaPortalLayout'));

function RouteFallback() {
  return (
    <div className="min-h-[60dvh] flex items-center justify-center text-sm font-semibold text-slate-500">
      Memuat halaman...
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Terjadi kesalahan pada halaman.',
    };
  }

  componentDidCatch(error: unknown) {
    console.error('REKAM page error:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-[70dvh] flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 shadow-lg">
          <p className="text-sm font-semibold text-red-600 mb-2">Halaman gagal dimuat</p>
          <h1 className="text-xl font-bold text-zinc-900 mb-3">REKAM mendeteksi error tampilan.</h1>
          <p className="text-sm text-zinc-500 mb-5 break-words">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
          >
            Muat Ulang
          </button>
        </div>
      </div>
    );
  }
}

// Komponen untuk melindungi rute yang butuh autentikasi
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function RoleBasedLayout() {
  return <MediaPortalLayout />;
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
        <AppErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
        {/* Route publik */}
        <Route path="/login" element={<LoginPage />} />
        
        {/* Route yang butuh login — menggunakan RoleBasedLayout sebagai parent */}
        <Route
          element={
            <ProtectedRoute>
              <RoleBasedLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<MediaNewsCoveragesPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        
        {/* Route fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </AppErrorBoundary>
    </BrowserRouter>
    </>
  );
}

export default App;
