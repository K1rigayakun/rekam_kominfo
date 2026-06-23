import React, { useEffect, useState } from "react";
import { Plus, Pencil, Loader2, Globe, Building2, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api } from "../lib/api";
import { useConfirm } from "../components/useConfirm";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import { MagneticButton } from "../components/MagneticButton";

export default function MediaAgenciesPage() {
  const { user } = useAuthStore();
  const { confirm, ConfirmDialog } = useConfirm();
  const [agencies, setAgencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    website_url: "",
    media_type: "BOTH",
  });

  const [saving, setSaving] = useState(false);

  async function fetchAgencies() {
    try {
      setLoading(true);
      const res = await api.get("/api/media-agencies");
      setAgencies(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Gagal memuat instansi media");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAgencies();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    // Validasi
    const dataToSubmit = { ...formData };
    if (dataToSubmit.media_type !== "OFFLINE") {
      if (!dataToSubmit.website_url.startsWith("www.")) {
        toast.error("Link website wajib dimulai dengan 'www.'");
        setSaving(false);
        return;
      }
    } else {
      dataToSubmit.website_url = "";
    }

    try {
      if (editingId) {
        await api.put(`/api/media-agencies/${editingId}`, dataToSubmit);
        toast.success("Instansi media berhasil diperbarui");
      } else {
        await api.post("/api/media-agencies", dataToSubmit);
        toast.success("Instansi media berhasil dibuat");
      }
      setShowModal(false);
      fetchAgencies();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menyimpan data");
    } finally {
      setSaving(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData({ name: "", website_url: "", media_type: "BOTH" });
    setShowModal(true);
  };

  const openEditModal = (agency: any) => {
    setEditingId(agency.id);
    setFormData({
      name: agency.name,
      website_url: agency.website_url || "",
      media_type: agency.media_type,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirm({
      title: "Hapus Instansi Media",
      message: "Apakah Anda yakin ingin menghapus instansi media ini?",
      confirmText: "Hapus",
      cancelText: "Batal",
      isDestructive: true
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/api/media-agencies/${id}`);
      toast.success("Instansi media dihapus");
      fetchAgencies();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menghapus instansi media");
    }
  };

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="p-8 text-center text-zinc-500">Akses ditolak. Hanya Super Admin yang dapat mengakses halaman ini.</div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight flex items-center gap-3">
            <Building2 className="w-8 h-8 text-primary-600" />
            <AnimatedText text="Instansi Media" />
          </h1>
          <p className="text-zinc-500 mt-1">
            Kelola instansi media berita dan portal publikasi
          </p>
        </div>
        
        <MagneticButton
          onClick={openAddModal}
          className="bg-zinc-900 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-zinc-800 transition-colors shadow-sm"
        >
          <Plus className="w-5 h-5" />
          <span>Tambah Media</span>
        </MagneticButton>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-40">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 font-medium">
          {error}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200">
                  <th className="p-4 font-semibold text-zinc-600">Nama Media</th>
                  <th className="p-4 font-semibold text-zinc-600">Website</th>
                  <th className="p-4 font-semibold text-zinc-600">Jenis</th>
                  <th className="p-4 font-semibold text-zinc-600 w-24">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {agencies.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-zinc-500">
                      Belum ada data media.
                    </td>
                  </tr>
                ) : (
                  agencies.map((agency) => (
                    <tr
                      key={agency.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50 transition-colors"
                    >
                      <td className="p-4">
                        <div className="font-medium text-zinc-900 flex items-center gap-2">
                          {agency.name}
                        </div>
                      </td>
                      <td className="p-4">
                        {agency.website_url ? (
                          <a
                            href={agency.website_url.startsWith('http') ? agency.website_url : `https://${agency.website_url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:underline flex items-center gap-1 text-sm font-medium"
                          >
                            <Globe className="w-3.5 h-3.5" />
                            {agency.website_url}
                          </a>
                        ) : (
                          <span className="text-zinc-400 text-sm">-</span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-zinc-100 text-zinc-700">
                          {agency.media_type}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(agency)}
                            className="p-1.5 text-zinc-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                            title="Edit Media"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {user?.role === "SUPER_ADMIN" && (
                            <button
                              onClick={() => handleDelete(agency.id)}
                              className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Hapus Media"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Form */}
      <AnimatePresence>
        <ConfirmDialog />
      {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !saving && setShowModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden"
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-zinc-900 mb-6">
                  {editingId ? "Edit Instansi Media" : "Tambah Instansi Media"}
                </h2>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Nama Media <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                      placeholder="Contoh: Kompas"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Jenis Media <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={formData.media_type}
                      onChange={(e) => setFormData({ ...formData, media_type: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all bg-white"
                    >
                      <option value="BOTH">Online & Offline</option>
                      <option value="ONLINE">Online Saja</option>
                      <option value="OFFLINE">Offline Saja (Cetak)</option>
                    </select>
                  </div>

                  {formData.media_type !== "OFFLINE" && (
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">
                        URL Website <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.website_url}
                        onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                        placeholder="Contoh: www.kompas.com"
                      />
                    </div>
                  )}

                  <div className="pt-4 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      disabled={saving}
                      className="px-5 py-2.5 text-zinc-600 font-medium hover:bg-zinc-100 rounded-xl transition-colors disabled:opacity-50"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-zinc-900 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-zinc-800 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Menyimpan...
                        </>
                      ) : (
                        "Simpan"
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
