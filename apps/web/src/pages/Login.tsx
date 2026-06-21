import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';
import { motion } from 'motion/react';
import { SpinnerGap, LockKey, EnvelopeSimple } from '@phosphor-icons/react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/auth/login', { email, password });
      login(response.data.token, response.data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Gagal masuk. Periksa kembali kredensial Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-transparent p-4 relative overflow-hidden">

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className="bg-white/95 backdrop-blur-2xl relative z-10 w-full max-w-md p-10 rounded-[2.5rem] shadow-2xl border border-white/40"
      >
        <div className="flex flex-col items-center mb-10">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring" }}
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-primary-600/20 overflow-hidden bg-white border border-slate-100"
          >
            <img src="/icon.png" alt="Rekam Icon" className="w-full h-full object-cover" />
          </motion.div>
          <img src="/logo.png" alt="REKAM" className="h-16 w-auto object-contain mt-2" />
          <p className="text-slate-500 mt-2 text-center text-sm font-semibold tracking-wide">
            Pusat Komando & Perpustakaan Media
          </p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm mb-6 border border-red-100"
          >
            {error}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <div>
            <label className="text-xs font-bold text-slate-500 mb-2 block tracking-wider uppercase">
              Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <EnvelopeSimple className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full pl-11 pr-4 py-3 bg-slate-50/80 border border-slate-200/60 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none transition-all"
                placeholder="admin@rekam.local"
              />
            </div>
            </div>
          </div>
          <div className="space-y-2">
            <div>
            <label className="text-xs font-bold text-slate-500 mb-2 block tracking-wider uppercase">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <LockKey className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full pl-11 pr-4 py-3 bg-slate-50/80 border border-slate-200/60 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>
            </div>
          </div>
          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            className={[
              "w-full py-4 px-4 bg-primary-600 text-white rounded-2xl font-semibold shadow-lg shadow-primary-600/30",
              "hover:bg-primary-700 hover:shadow-xl hover:shadow-primary-600/40 hover:-translate-y-0.5 transition-all duration-300",
              "flex justify-center items-center gap-2 mt-4",
              loading ? "opacity-80 cursor-not-allowed" : "",
            ].join(' ')}
          >
            {loading ? <SpinnerGap weight="bold" className="w-5 h-5 animate-spin" /> : 'Akses Portal'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
