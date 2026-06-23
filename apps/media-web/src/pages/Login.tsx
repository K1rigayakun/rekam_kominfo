import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';
import { motion } from 'motion/react';
import { SpinnerGap, LockKey, EnvelopeSimple, Gear, User } from '@phosphor-icons/react';
import { getApiBase, setApiBase as saveApiBase } from '../lib/desktop/store';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [apiBase, setApiBaseInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  useEffect(() => {
    if (isTauri) {
      getApiBase().then(setApiBaseInput).catch(() => {});
    }
  }, [isTauri]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isTauri && apiBase) {
        // Normalisasi URL
        const normalizedApiBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
        const finalApiBase = normalizedApiBase.endsWith('/api') ? normalizedApiBase.slice(0, -4) : normalizedApiBase;
        
        await saveApiBase(finalApiBase);
        api.defaults.baseURL = finalApiBase;
      }
      const response = await api.post('/api/auth/login', { username, password });
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
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-1 shadow-lg shadow-primary-600/20 overflow-hidden bg-white border border-slate-100"
          >
            <img src="/icon.png" alt="Rekam Icon" className="w-full h-full object-cover" />
          </motion.div>
          <img src="/logo.png" alt="REKAM" className="h-24 w-auto object-contain" />
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
              Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="block w-full pl-11 pr-4 py-3 bg-slate-50/80 border border-slate-200/60 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none transition-all"
                placeholder="admin"
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

          {isTauri && (
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
              >
                <Gear className="w-4 h-4" />
                {showAdvanced ? 'Sembunyikan Pengaturan Server' : 'Pengaturan Server Lanjutan'}
              </button>

              {showAdvanced && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4 space-y-2"
                >
                  <label className="text-xs font-bold text-slate-500 mb-2 block tracking-wider uppercase">
                    Alamat Server API
                  </label>
                  <input
                    type="url"
                    value={apiBase}
                    onChange={(e) => setApiBaseInput(e.target.value)}
                    placeholder="https://rekam.example.go.id"
                    className="block w-full px-4 py-3 bg-slate-50/80 border border-slate-200/60 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none transition-all"
                    required={isTauri}
                  />
                  <p className="text-xs text-slate-400">
                    Isi domain server tanpa akhiran /api. Kosongkan jika menggunakan localhost.
                  </p>
                </motion.div>
              )}
            </div>
          )}

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
