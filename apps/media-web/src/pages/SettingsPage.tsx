import React, { useState } from "react";
import { Loader2, Settings, Lock, Globe, Save } from "lucide-react";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import { MagneticButton } from "../components/MagneticButton";

export default function SettingsPage() {
  const { user, updateUser } = useAuthStore();
  const [loading, setLoading] = useState(false);

  // Form State
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState(user?.media_website_url || "");

  const isOnline = user?.media_type === "ONLINE" || user?.media_type === "BOTH";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password && password.length < 8) {
      toast.error("Password baru minimal 8 karakter");
      return;
    }
    if (password && password !== confirmPassword) {
      toast.error("Konfirmasi password tidak cocok");
      return;
    }

    try {
      setLoading(true);
      const payload: any = {};
      if (password) {
        if (!oldPassword) {
          toast.error("Password lama wajib diisi untuk mengubah password");
          setLoading(false);
          return;
        }
        payload.password = password;
        payload.old_password = oldPassword;
      }
      if (isOnline) payload.media_website_url = websiteUrl;
      if (fullName && fullName !== user?.full_name) payload.full_name = fullName;

      // Jika tidak ada yang diubah
      if (Object.keys(payload).length === 0) {
        toast.info("Tidak ada perubahan yang disimpan");
        return;
      }

      await api.put("/api/auth/update-profile", payload);
      
      toast.success("Pengaturan berhasil disimpan");
      
      // Update local state if needed
      updateUser({
        ...user!,
        ...(payload.media_website_url !== undefined && { media_website_url: payload.media_website_url }),
        ...(payload.full_name !== undefined && { full_name: payload.full_name }),
      });

      setOldPassword("");
      setPassword("");
      setConfirmPassword("");

    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menyimpan pengaturan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight flex items-center gap-3">
            <Settings className="w-8 h-8 text-primary-600" />
            <AnimatedText text="Pengaturan Akun" />
          </h1>
          <p className="text-zinc-500 mt-1">
            Kelola profil instansi media dan keamanan akun Anda
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
        <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xl uppercase">
              {user?.media_agency_name?.charAt(0) || user?.full_name?.charAt(0) || "U"}
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">{user?.media_agency_name || "Instansi Media"}</h2>
              <p className="text-sm text-zinc-500">{user?.username}</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-8">
          
          {/* Section: Informasi Media */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-zinc-900 font-semibold border-b border-zinc-100 pb-2">
              <Globe className="w-5 h-5 text-primary-500" />
              <h3>Informasi Instansi Media</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Nama Instansi</label>
                <input
                  type="text"
                  disabled
                  value={user?.media_agency_name || "Belum punya instansi"}
                  className="w-full px-4 py-2 border border-zinc-200 rounded-xl bg-zinc-50 text-zinc-500 cursor-not-allowed"
                />
                <p className="text-xs text-zinc-500 mt-1">Nama instansi tidak dapat diubah sendiri. Hubungi admin Kominfo untuk mengubah nama.</p>
              </div>

              {isOnline && (
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Link / URL Media Utama</label>
                  <input
                    type="text"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="www.contoh.com"
                    className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white transition-all"
                  />
                  <p className="text-xs text-zinc-500 mt-1">Link utama website media Anda (contoh: www.kompas.com).</p>
                </div>
              )}
            </div>
          </div>

          {/* Section: Keamanan & Akun */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-zinc-900 font-semibold border-b border-zinc-100 pb-2">
              <Lock className="w-5 h-5 text-primary-500" />
              <h3>Keamanan & Akun</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Nama Pengguna (Akun)</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nama Lengkap"
                  className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white transition-all"
                />
                <p className="text-xs text-zinc-500 mt-1">Nama perwakilan Anda yang memegang akun ini.</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Password Lama</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Masukkan password saat ini"
                  className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white transition-all"
                />
                <p className="text-xs text-zinc-500 mt-1">Wajib diisi jika Anda ingin mengganti password baru.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Password Baru</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 8 karakter"
                  className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white transition-all"
                />
                <p className="text-xs text-zinc-500 mt-1">Kosongkan jika tidak ingin mengubah password.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Konfirmasi Password Baru</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ketik ulang password baru"
                  className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white transition-all"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <MagneticButton
              type="submit"
              disabled={loading || (!password && websiteUrl === user?.media_website_url && fullName === user?.full_name)}
              className="bg-primary-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Simpan Pengaturan
                </>
              )}
            </MagneticButton>
          </div>

        </form>
      </div>
    </div>
  );
}
