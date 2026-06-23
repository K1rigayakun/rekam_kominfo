import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { LogOut, Settings, Newspaper, UserCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useEffect } from 'react';

export default function MediaPortalLayout() {
  const { user, logout, updateUser } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // ignore
    } finally {
      logout();
      navigate('/login');
    }
  };

  useEffect(() => {
    const refreshSession = async () => {
      try {
        const res = await api.get('/api/auth/me');
        if (res.data.user) {
          updateUser(res.data.user);
        }
      } catch (err) {
        console.error('Failed to refresh session', err);
      }
    };
    refreshSession();
  }, [updateUser]);

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Top Navbar */}
      <header className="h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-1">
          <div className="w-8 h-8 rounded-lg shadow-sm overflow-hidden bg-white">
            <img src="/icon.png" alt="Rekam" className="w-full h-full object-cover" />
          </div>
          <img src="/logo.png" alt="REKAM" className="h-10 w-auto object-contain -ml-2 hidden sm:block" />
          <span className="font-bold text-zinc-400 hidden sm:block text-sm ml-2">| Portal Media</span>
        </div>
        
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              location.pathname === '/' ? 'bg-primary-50 text-primary-700' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <Newspaper className="w-4 h-4" />
            <span className="hidden sm:inline">Berita</span>
          </Link>

          <Link
            to="/settings"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              location.pathname === '/settings' ? 'bg-primary-50 text-primary-700' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">Pengaturan</span>
          </Link>

          <div className="h-4 w-px bg-zinc-200 hidden sm:block"></div>

          <div className="flex items-center gap-2 text-zinc-600 bg-zinc-100 px-3 py-1.5 rounded-full text-sm font-medium hidden md:flex">
            <UserCircle className="w-4 h-4" />
            <span>{user?.full_name}</span>
          </div>
          
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm font-semibold text-red-600 hover:text-red-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
