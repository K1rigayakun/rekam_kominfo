import React, { useEffect, useState } from 'react';
import { User, Shield, Loader2, KeyRound, Clock, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { toast } from 'sonner';
import { AnimatedText } from '../components/AnimatedText';

export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    full_name: user?.full_name || '',
  });

  const [passwordData, setPasswordData] = useState({
    old_password: '',
    new_password: '',
    confirm_password: '',
  });

  useEffect(() => {
    async function refreshProfile() {
      try {
        const res = await api.get('/api/auth/me');
        updateUser(res.data.user);
        setFormData({ full_name: res.data.user.full_name });
      } catch {
        // Global interceptor handles invalid sessions.
      }
    }

    refreshProfile();
  }, [updateUser]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await api.put('/api/users/me', formData);
      updateUser(res.data.data);
      toast.success('Profil berhasil diperbarui');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Gagal memperbarui profil');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.new_password !== passwordData.confirm_password) {
      toast.error('Konfirmasi password tidak cocok');
      return;
    }

    setLoading(true);

    try {
      await api.put('/api/users/me/password', {
        old_password: passwordData.old_password,
        new_password: passwordData.new_password,
      });
      toast.success('Password berhasil diubah');
      setPasswordData({ old_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Gagal mengubah password');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto p-4 lg:p-8 space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <User className="w-6 h-6 text-primary-600" />
          <AnimatedText text="Profil Saya" />
        </h1>
        <p className="text-text-muted text-sm mt-1">Kelola informasi akun dan keamanan Anda.</p>
      </div>

      {/* Account Info Card — Doppelrand pattern */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="p-2 bg-gray-50/80 backdrop-blur-xl border border-gray-200/60 rounded-[2.5rem] shadow-sm"
      >
        <div className="bg-white rounded-[2rem] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-gray-400" />
            Informasi Dasar
          </h2>
          
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1.5 block tracking-wider uppercase">Email / Username</label>
              <input
                type="text"
                disabled
                value={user.email}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 outline-none cursor-not-allowed"
              />
              <p className="text-xs text-gray-400 mt-1">Email tidak dapat diubah. Hubungi admin jika perlu perubahan.</p>
            </div>
            
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1.5 block tracking-wider uppercase">Role Akses</label>
              <input
                type="text"
                disabled
                value={user.role}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 outline-none cursor-not-allowed font-semibold"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 mb-1.5 block tracking-wider uppercase">Nama Lengkap</label>
              <input
                type="text"
                required
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none premium-transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold premium-transition flex items-center gap-2 shadow-sm shadow-primary-600/20"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Simpan Perubahan
            </button>
          </form>
        </div>
      </motion.div>

      {/* Activity Stats Card */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="p-2 bg-gray-50/80 backdrop-blur-xl border border-gray-200/60 rounded-[2.5rem] shadow-sm"
      >
        <div className="bg-white rounded-[2rem] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-gray-400" />
            Statistik Aktivitas
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-gray-500 font-medium block">Login Terakhir</span>
                <span className="text-gray-900 font-bold text-sm">
                  {user.last_login_at ? new Date(user.last_login_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum pernah'}
                </span>
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-gray-500 font-medium block">Upload Terakhir</span>
                <span className="text-gray-900 font-bold text-sm">
                  {user.last_upload_at ? new Date(user.last_upload_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum ada'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Change Password Card */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="p-2 bg-gray-50/80 backdrop-blur-xl border border-gray-200/60 rounded-[2.5rem] shadow-sm"
      >
        <div className="bg-white rounded-[2rem] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-gray-400" />
            Ubah Password
          </h2>
          
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1.5 block tracking-wider uppercase">Password Saat Ini</label>
              <input
                type="password"
                required
                value={passwordData.old_password}
                onChange={(e) => setPasswordData({ ...passwordData, old_password: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none premium-transition"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 mb-1.5 block tracking-wider uppercase">Password Baru</label>
              <input
                type="password"
                required
                minLength={8}
                value={passwordData.new_password}
                onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none premium-transition"
              />
              <p className="text-xs text-gray-400 mt-1">Minimal 8 karakter.</p>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 mb-1.5 block tracking-wider uppercase">Konfirmasi Password Baru</label>
              <input
                type="password"
                required
                minLength={8}
                value={passwordData.confirm_password}
                onChange={(e) => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none premium-transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 bg-gray-900 hover:bg-gray-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold premium-transition flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Ganti Password
            </button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}
