import { Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { LogOut, Newspaper, UserCircle } from 'lucide-react';
import { api } from '../lib/api';

export default function MediaPortalLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

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

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Top Navbar */}
      <header className="h-16 bg-white border-b border-zinc-200 flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg shadow-sm overflow-hidden bg-white">
            <img src="/icon.png" alt="Rekam" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-lg tracking-tight text-zinc-900 hidden sm:block">REKAM - Portal Media</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-zinc-600 bg-zinc-100 px-3 py-1.5 rounded-full text-sm font-medium">
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
