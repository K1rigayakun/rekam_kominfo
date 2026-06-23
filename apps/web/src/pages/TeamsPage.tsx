import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Plus, Pencil, Trash2, Loader2, Search, Filter } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api } from "../lib/api";
import { useConfirm } from "../components/useConfirm";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import { MagneticButton } from "../components/MagneticButton";

export default function TeamsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { confirm, ConfirmDialog } = useConfirm();
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tags, setTags] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTag, setFilterTag] = useState("");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    tag_id: "",
  });

  const [saving, setSaving] = useState(false);

  async function fetchTeams() {
    try {
      setLoading(true);
      const res = await api.get("/api/teams");
      setTeams(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Gagal memuat tim liputan");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTeams();
    api.get("/api/tags").then(res => setTags(res.data.data)).catch(console.error);
  }, []);

  const handleDelete = async (item: any) => {
    const isConfirmed = await confirm({
      title: "Hapus Tim Liputan",
      message: `Apakah Anda yakin ingin menghapus tim liputan ${item.name}?`,
      confirmText: "Hapus",
      cancelText: "Batal",
      isDestructive: true
    });
    if (isConfirmed) {
      try {
        await api.delete(`/api/teams/${item.id}`);
        toast.success("Tim liputan berhasil dihapus");
        fetchTeams();
      } catch (err: any) {
        toast.error(err.response?.data?.error || "Gagal menghapus tim liputan");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        tag_id: formData.tag_id || null
      };

      if (editingId) {
        await api.put(`/api/teams/${editingId}`, payload);
        toast.success("Tim Liputan berhasil diperbarui");
      } else {
        await api.post("/api/teams", payload);
        toast.success("Tim Liputan berhasil dibuat");
      }
      setShowModal(false);
      fetchTeams();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menyimpan data");
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData({ name: "", description: "", tag_id: "" });
    setShowModal(true);
  };

  const openEdit = (t: any) => {
    setEditingId(t.id);
    setFormData({
      name: t.name,
      description: t.description || "",
      tag_id: t.tag_id || "",
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
            <AnimatedText text="Tim Liputan" />
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Kelola daftar tim peliput untuk acara.
          </p>
        </div>
        {user?.role === "SUPER_ADMIN" && (
          <MagneticButton
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm shadow-primary-600/20 premium-transition"
          >
            <Plus className="w-4 h-4" />
            Tim Baru
          </MagneticButton>
        )}
      </div>

      {error && (
        <p className="text-red-500 mb-4 bg-red-50 p-4 rounded-xl">{error}</p>
      )}

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari nama tim..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none premium-transition"
          />
        </div>
        <div className="relative min-w-[200px]">
          <Filter className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none premium-transition appearance-none"
          >
            <option value="">Semua Tag</option>
            {tags.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
            <option value="none">Tanpa Tag</option>
          </select>
        </div>
      </div>

      <motion.div 
        initial="hidden" 
        animate="show" 
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { staggerChildren: 0.05 } }
        }}
        className="space-y-8"
      >
        {(() => {
          const filteredTeams = teams.filter(t => {
            const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesTag = filterTag ? (filterTag === 'none' ? !t.tag_id : t.tag_id === filterTag) : true;
            return matchesSearch && matchesTag;
          });

          if (filteredTeams.length === 0) {
            return (
              <div className="py-12 text-center bg-white rounded-2xl border border-gray-100 shadow-sm">
                <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">Belum ada tim yang terdaftar atau tidak ada yang cocok dengan pencarian.</p>
              </div>
            );
          }

          const groupedTeams = filteredTeams.reduce((acc: any, t: any) => {
            const tag = t.tag_name || "Tanpa tag";
            if (!acc[tag]) acc[tag] = [];
            acc[tag].push(t);
            return acc;
          }, {});

          return Object.entries(groupedTeams).map(([tag, tagTeams]: [string, any]) => (
            <div key={tag} className="space-y-4">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2 px-1">
                <span className="w-2 h-2 rounded-full bg-primary-500"></span>
                {tag}
                <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full ml-2">
                  {tagTeams.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence>
                  {tagTeams.map((t: any) => (
                    <motion.div
                      key={t.id}
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        show: { opacity: 1, y: 0 }
                      }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      onClick={() => navigate(`/teams/${t.id}`)}
                      className="p-2 bg-gray-50/80 backdrop-blur-xl border border-gray-200/60 rounded-[2rem] shadow-sm premium-transition group cursor-pointer"
                    >
                      <div className="bg-white rounded-[1.5rem] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] border border-gray-100 h-full flex flex-col premium-transition group-hover:shadow-md">
                        <div className="flex justify-between items-start mb-3">
                          <div className="w-10 h-10 bg-primary-50 text-primary-600 rounded-xl flex items-center justify-center">
                            <Users className="w-5 h-5" />
                          </div>
                          {user?.role === "SUPER_ADMIN" && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); openEdit(t); }}
                                className="text-gray-400 hover:text-blue-600 premium-transition w-8 h-8 rounded-full bg-gray-50 hover:bg-blue-50 flex items-center justify-center active:scale-95"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                                className="text-gray-400 hover:text-red-600 premium-transition w-8 h-8 rounded-full bg-gray-50 hover:bg-red-50 flex items-center justify-center active:scale-95"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">{t.name}</h3>
                        {t.description && (
                          <p className="text-sm text-gray-500 mb-3 flex-1 leading-relaxed">
                            {t.description}
                          </p>
                        )}
                        <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between">
                          <span
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700`}
                          >
                            {t.member_count} Anggota
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ));
        })()}
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
                {editingId ? "Edit Tim Liputan" : "Tim Baru"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                    Nama Tim
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                    placeholder="Contoh: Tim Liputan Utama"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                    Deskripsi (Opsional)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                    placeholder="Keterangan singkat tim"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
                    Tag Event
                  </label>
                  <select
                    value={formData.tag_id}
                    onChange={(e) => setFormData({ ...formData, tag_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                  >
                    <option value="">Pilih Tag (Opsional)</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
