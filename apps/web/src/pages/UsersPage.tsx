import React, { useEffect, useState, useRef } from "react";
import { Users, Plus, Pencil, Loader2, Shield, Key, Search, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { animate, stagger } from "animejs";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { usePrompt } from "../components/usePrompt";
import { useConfirm } from "../components/useConfirm";
import { AnimatedText } from "../components/AnimatedText";
import { MagneticButton } from "../components/MagneticButton";

export default function UsersPage() {
  const { user } = useAuthStore();
  const prompt = usePrompt();
  const { confirm } = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const tableRef = useRef<HTMLTableElement>(null);
  const [search, setSearch] = useState("");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    full_name: "",
    password: "",
    role: "EDITOR",
    district_id: "",
  });

  const [districts, setDistricts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  async function fetchUsers() {
    try {
      setLoading(true);
      const res = await api.get("/api/users");
      setUsers(res.data.data || []);
    } catch {
      setError("Gagal memuat pengguna");
    } finally {
      setLoading(false);
      
      // Anime.js stagger for table rows
      setTimeout(() => {
        animate('.anime-row', {
          translateY: [20, 0],
          opacity: [0, 1],
          ease: 'outExpo',
          duration: 800,
          delay: stagger(50)
        });
      }, 50);
    }
  };

  async function fetchDistricts() {
    try {
      const res = await api.get("/api/districts");
      setDistricts(res.data.data);
    } catch (err) {
      console.error("Gagal memuat grup", err);
    }
  }

  useEffect(() => {
    fetchUsers();
    fetchDistricts();
  }, []);

  const filteredUsers = users.filter((u) => 
    (u.full_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        const payload: any = {
          full_name: formData.full_name,
          role: formData.role,
          district_id: formData.district_id || null,
        };
        await api.put(`/api/users/${editingId}`, payload);
        toast.success("Pengguna berhasil diperbarui");
      } else {
        const payload: any = {
          email: formData.email,
          full_name: formData.full_name,
          password: formData.password,
          role: formData.role,
          district_id: formData.district_id || null,
        };
        await api.post("/api/users", payload);
        toast.success("Pengguna berhasil dibuat");
      }
      setShowModal(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menyimpan data");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (userId: string) => {
    const newPassword = await prompt({
      title: "Reset Password",
      message: "Masukkan password baru untuk pengguna ini:",
      placeholder: "Password baru...",
      inputType: "password"
    });
    if (!newPassword) return;

    try {
      await api.put(`/api/users/${userId}/reset-password`, {
        new_password: newPassword,
      });
      toast.success("Password berhasil direset");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal reset password");
    }
  };

  const handleDeleteUser = async (u: any) => {
    if (u.role === "SUPER_ADMIN") return;
    const isConfirmed = await confirm({
      title: "Hapus Pengguna",
      message: `Apakah Anda yakin ingin menghapus pengguna ${u.full_name}? Tindakan ini tidak dapat dibatalkan.`,
      confirmText: "Hapus",
      cancelText: "Batal",
      isDestructive: true
    });
    
    if (isConfirmed) {
      try {
        await api.delete(`/api/users/${u.id}`);
        toast.success("Pengguna berhasil dihapus");
        fetchUsers();
      } catch (err: any) {
        toast.error(err.response?.data?.error || "Gagal menghapus pengguna");
      }
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData({
      email: "",
      full_name: "",
      password: "",
      role: "EDITOR",
      district_id: "",
    });
    setShowModal(true);
  };

  const openEdit = (u: any) => {
    setEditingId(u.id);
    setFormData({
      email: u.email,
      full_name: u.full_name,
      password: "",
      role: u.role,
      district_id: u.district_id || "",
    });
    setShowModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl mx-auto p-4 lg:p-8"
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-primary-600" />
            <AnimatedText text="Manajemen Pengguna" />
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Kelola akses, role, dan akun pengguna sistem REKAM
          </p>
        </div>
        {user?.role === "SUPER_ADMIN" && (
          <MagneticButton
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm shadow-primary-600/20 premium-transition"
          >
            <Plus className="w-4 h-4" />
            Tambah Pengguna
          </MagneticButton>
        )}
      </div>

      {error && (
        <p className="text-red-500 mb-4 bg-red-50 p-4 rounded-xl">{error}</p>
      )}

      <div className="p-2 bg-gray-50/80 backdrop-blur-xl border border-gray-200/60 rounded-[2.5rem] shadow-sm mb-12">
        <div className="bg-white rounded-[2rem] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Cari pengguna..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
        </div>
        <div className="overflow-x-auto p-2">
          <table ref={tableRef} className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50/50 text-gray-500 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-semibold rounded-tl-xl">Nama Lengkap & Email</th>
                <th className="px-6 py-4 font-semibold">Role</th>
                <th className="px-6 py-4 font-semibold">Kecamatan</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Terakhir Login</th>
                <th className="px-6 py-4 font-semibold text-right rounded-tr-xl">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50/50">
              {filteredUsers.map((u) => (
                <tr
                  key={u.id}
                  className="anime-row opacity-0 hover:bg-gray-50/80 transition-colors group"
                >
                  <td className="px-6 py-4">
                      <div className="font-semibold text-gray-900">{u.full_name}</div>
                      <div className="text-xs text-text-muted">{u.email}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${u.role === "SUPER_ADMIN" ? "bg-red-100 text-red-700" : u.role === "EDITOR" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
                        <Shield className="w-3 h-3" />
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-4">{u.district_name || "-"}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {u.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {user?.role === "SUPER_ADMIN" && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleResetPassword(u.id)} className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Reset Password">
                            <Key className="w-4 h-4" />
                          </button>
                          <button onClick={() => openEdit(u)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Pengguna">
                            <Pencil className="w-4 h-4" />
                          </button>
                          {u.role !== "SUPER_ADMIN" && (
                            <button onClick={() => handleDeleteUser(u)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Hapus Pengguna">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {filteredUsers.length === 0 && (
            <div className="px-5 py-8 text-center text-gray-500">
              Tidak ada pengguna ditemukan.
            </div>
          )}
        </div>
      </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editingId ? "Edit Pengguna" : "Pengguna Baru"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!editingId && (
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={formData.full_name}
                  onChange={(e) =>
                    setFormData({ ...formData, full_name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                />
              </div>
              {!editingId && (
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                    Password
                  </label>
                  <input
                    type="password"
                    required={!editingId}
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                  Role
                </label>
                <select
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none bg-white"
                >
                  <option value="EDITOR">EDITOR</option>
                  <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                  Kecamatan
                </label>
                <select
                  value={formData.district_id}
                  onChange={(e) =>
                    setFormData({ ...formData, district_id: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none bg-white"
                >
                  <option value="">Tidak ada kecamatan</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 premium-transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex justify-center items-center premium-transition"
                >
                  {saving ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Simpan"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
}
