import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  Calendar,
  Users,
  Building2,
  Shield,
  LogOut,
  Menu,
  X,
  Tag,
  Monitor,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';

const navItems = [
  { to: '/', label: 'Acara', icon: Calendar, roles: ['SUPER_ADMIN', 'EDITOR'] },
  { to: '/users', label: 'Pengguna', icon: Users, roles: ['SUPER_ADMIN'] },
  { to: '/teams', label: 'Tim Liputan', icon: Building2, roles: ['SUPER_ADMIN'] },
  { to: '/tags', label: 'Tag Event', icon: Tag, roles: ['SUPER_ADMIN'] },
  { to: '/districts', label: 'Kecamatan', icon: Building2, roles: ['SUPER_ADMIN'] },
  { to: '/audit', label: 'Audit Log', icon: Shield, roles: ['SUPER_ADMIN'] },
];

export default function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const currentNavItems = [...navItems];
  if (isTauri) {
    currentNavItems.push({ to: '/offloader', label: 'Alat Desktop', icon: Monitor, roles: ['SUPER_ADMIN', 'EDITOR', 'PHOTOGRAPHER'] });
  }

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Local session still has to be cleared if the server is unreachable.
    } finally {
      logout();
      navigate('/login');
    }
  };

  const filteredNav = currentNavItems.filter((item) =>
    item.roles.includes(user?.role || '')
  );

  return (
    <div className="min-h-screen bg-transparent flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-white border-r border-gray-100 flex flex-col premium-transition',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="h-20 flex items-center justify-between px-5 border-b border-gray-100">
          <div className="flex items-center gap-1">
            <div className="w-10 h-10 rounded-lg shadow-sm shadow-primary-500/20 overflow-hidden bg-white">
              <img src="/icon.png" alt="Rekam" className="w-full h-full object-cover" />
            </div>
            <img src="/logo.png" alt="REKAM" className="h-14 w-auto object-contain -ml-2" />
          </div>
          <button
            className="lg:hidden p-1 text-gray-400 hover:text-gray-600"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {filteredNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium premium-transition',
                  isActive
                    ? 'bg-primary-50 text-primary-700 shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                ].join(' ')
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User info & logout */}
        <div className="p-3 border-t border-gray-100 space-y-1">
          <NavLink
            to="/profile"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2 rounded-xl premium-transition',
                isActive
                  ? 'bg-primary-50 shadow-sm'
                  : 'hover:bg-gray-50',
              ].join(' ')
            }
          >
            <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm border border-primary-200 shrink-0">
              {user?.full_name?.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden flex-1 text-left">
              <p className="text-sm font-semibold text-gray-900 truncate">{user?.full_name}</p>
              <p className="text-xs text-text-muted truncate">{user?.role}</p>
            </div>
          </NavLink>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 premium-transition"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Main Header */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30">
          <button
            className="lg:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-4 ml-auto">
            <span className="text-sm font-medium text-gray-700 hidden sm:block">
              Halo, {user?.full_name}
            </span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 relative z-10 bg-white/50 backdrop-blur-[1px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
