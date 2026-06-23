import React, { useEffect, useState } from "react";
import { MapPin, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api } from "../lib/api";
import { useConfirm } from "../components/useConfirm";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import { MagneticButton } from "../components/MagneticButton";

export default function DistrictsPage() {
  const { user } = useAuthStore();
  const { confirm, ConfirmDialog } = useConfirm();
  const [districts, setDistricts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
  });

  const [saving, setSaving] = useState(false);

  async function fetchDistricts() {
    try {
      setLoading(true);
      const res = await api.get("/api/districts");
      setDistricts(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Gagal memuat kecamatan");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDistricts();
  }, []);

  const handleDelete = async (item: any) => {
    const isConfirmed = await confirm({
      title: "Hapus Kecamatan",
      message: `Apakah Anda yakin ingin menghapus kecamatan ${item.name}?`,
      confirmText: "Hapus",
      cancelText: "Batal",
      isDestructive: true
    });
    if (isConfirmed) {
      try {
        await api.delete(`/api/districts/${item.id}`);
        toast.success("Kecamatan berhasil dihapus");
        fetchDistricts();
      } catch (err: any) {
        toast.error(err.response?.data?.error || "Gagal menghapus kecamatan");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/districts/${editingId}`, formData);
        toast.success("Kecamatan berhasil diperbarui");
      } else {
        await api.post("/api/districts", formData);
        toast.success("Kecamatan berhasil dibuat");
      }
      setShowModal(false);
      fetchDistricts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menyimpan data");
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData({ name: "" });
    setShowModal(true);
  };

  const openEdit = (d: any) => {
    setEditingId(d.id);
    setFormData({
      name: d.name,
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
            <MapPin className="w-6 h-6 text-primary-600" />
            <AnimatedText text="Kecamatan" />
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Kelola daftar kecamatan sebagai identitas pengguna.
          </p>
        </div>
        {user?.role === "SUPER_ADMIN" && (
          <MagneticButton
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm shadow-primary-600/20 premium-transition"
          >
            <Plus className="w-4 h-4" />
            Kecamatan Baru
          </MagneticButton>
        )}
      </div>

      {error && (
        <p className="text-red-500 mb-4 bg-red-50 p-4 rounded-xl">{error}</p>
      )}

      <motion.div 
        initial="hidden" 
        animate="show" 
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { staggerChildren: 0.05 } }
        }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <AnimatePresence>
          {districts.map((d) => (
            <motion.div
              key={d.id}
              variants={{
                hidden: { opacity: 0, y: 10 },
                show: { opacity: 1, y: 0 }
              }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="p-2 bg-gray-50/80 backdrop-blur-xl border border-gray-200/60 rounded-[2rem] shadow-sm premium-transition group"
            >
              <div className="bg-white rounded-[1.5rem] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] border border-gray-100 h-full flex flex-col premium-transition group-hover:shadow-md">
                <div className="flex justify-between items-start mb-3">
                  <div className="w-10 h-10 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center">
                    <MapPin className="w-5 h-5" />
                  </div>
                  {user?.role === "SUPER_ADMIN" && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(d)}
                        className="text-gray-400 hover:text-blue-600 premium-transition w-8 h-8 rounded-full bg-gray-50 hover:bg-blue-50 flex items-center justify-center active:scale-95"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(d)}
                        className="text-gray-400 hover:text-red-600 premium-transition w-8 h-8 rounded-full bg-gray-50 hover:bg-red-50 flex items-center justify-center active:scale-95"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">{d.name}</h3>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {districts.length === 0 && (
          <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-gray-100 shadow-sm">
            <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Belum ada kecamatan yang terdaftar.</p>
          </div>
        )}
      </motion.div>

      {/* Modal Form */}
      <ConfirmDialog />
      <AnimatePresence>
      {showModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-white/20"
            >
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                {editingId ? "Edit Kecamatan" : "Kecamatan Baru"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                    Nama Kecamatan
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                    placeholder="Contoh: Kecamatan Medan Sunggal"
                  />
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
