import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  username: string;
  full_name: string;
  role: string;
  district_id?: string | null;
  district_name?: string | null;
  media_agency_id?: string | null;
  is_active?: boolean;
  last_login_at?: string;
  last_upload_at?: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      login: (token, user) => set({ token, user, isAuthenticated: true }),
      logout: () => set({ token: null, user: null, isAuthenticated: false }),
      updateUser: (user) => set((state) => ({ ...state, user })),
    }),
    {
      name: 'auth-storage', // disimpan di localStorage
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }), // Token memory-only
    }
  )
);
