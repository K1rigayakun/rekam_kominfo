import { useEffect, useState } from 'react';
import { getApiBase, setApiBase, setToken } from './store';

interface LoginProps {
  onLoginSuccess: (activityId: string) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [apiBase, setApiBaseInput] = useState('http://localhost:3000');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getApiBase().then(setApiBaseInput).catch(() => {});
  }, []);
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const normalizedApiBase = apiBase.replace(/\/+$/, '');
      const res = await fetch(`${normalizedApiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username, password })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      
      // Save JWT to Tauri Secure Store
      if (data.access_token) {
        await setToken(data.access_token);
        await setApiBase(normalizedApiBase);
      }
      
      onLoginSuccess('00000000-0000-0000-0000-000000000000'); 
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="Rekam" className="h-12 w-auto mb-3 object-contain" />
          <h2 className="text-xl font-bold text-gray-900 text-center">Desktop Offloader Login</h2>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Alamat Server REKAM</label>
            <input
              type="url"
              value={apiBase}
              onChange={(e) => setApiBaseInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-primary-500"
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 mt-2"
          >
            {loading ? 'Memproses...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
