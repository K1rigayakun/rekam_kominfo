import React, { useEffect, useState, useRef } from "react";
import { Loader2, Plus, X, FileText, ImageIcon, Download, Trash2, Search, Newspaper, Pencil, Eye } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api, API_URL } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import DateFilterPopover from "../components/DateFilterPopover";
import { MagneticButton } from "../components/MagneticButton";

export default function MediaNewsCoveragesPage() {
  const { user, token } = useAuthStore();
  const [coverages, setCoverages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const handleDownloadAll = (coverage: any) => {
    if (!coverage || !coverage.files) return;
    coverage.files.forEach((f: any, idx: number) => {
      const link = document.createElement('a');
      link.href = `${API_URL}/api/news-coverages/${coverage.id}/download?index=${idx}&token=${token}&download=1`;
      link.download = f.original_filename || `file-${idx+1}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form State
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [retainedFiles, setRetainedFiles] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    title: "",
    publish_date: new Date().toISOString().split('T')[0],
  });

  const [editingCoverage, setEditingCoverage] = useState<any>(null);
  const [viewCoverage, setViewCoverage] = useState<any>(null);
  const [viewImage, setViewImage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchCoverages = async () => {
    try {
      setLoading(true);
      const res = await api.get("/api/news-coverages", {
        params: {
          search: search || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }
      });
      setCoverages(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Gagal memuat berita media");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoverages();
  }, [dateFrom, dateTo]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCoverages();
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const openModal = (coverage?: any) => {
    if (coverage) {
      setEditingCoverage(coverage);
      setFormData({
        title: coverage.title || "",
        publish_date: coverage.publish_date ? new Date(coverage.publish_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      });
      setRetainedFiles(coverage.files || []);
    } else {
      setEditingCoverage(null);
      setFormData({
        title: "",
        publish_date: new Date().toISOString().split('T')[0],
      });
      setRetainedFiles([]);
    }
    setFiles([]);
    setFilePreviews([]);
    setShowModal(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...selectedFiles]);

      selectedFiles.forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            setFilePreviews((prev) => [...prev, e.target?.result as string]);
          };
          reader.readAsDataURL(file);
        } else {
          setFilePreviews((prev) => [...prev, ""]);
        }
      });
    }
  };

  const removeRetainedFile = (index: number) => {
    setRetainedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCoverage && files.length === 0) {
      toast.error("File gambar/bukti tayang wajib diunggah (minimal 1)");
      return;
    }
    if (editingCoverage && files.length === 0 && retainedFiles.length === 0) {
      toast.error("File gambar/bukti tayang wajib ada (minimal 1)");
      return;
    }
    if (!formData.title) {
      toast.error("Judul berita wajib diisi");
      return;
    }

    setUploading(true);
    const data = new FormData();
    files.forEach((f) => {
      data.append("file", f);
    });
    if (editingCoverage) {
      data.append("retained_files", JSON.stringify(retainedFiles));
    }
    data.append("title", formData.title);
    data.append("publish_date", formData.publish_date);

    try {
      if (editingCoverage) {
        await api.put(`/api/news-coverages/${editingCoverage.id}`, data, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        toast.success("Berita berhasil diperbarui");
      } else {
        await api.post("/api/news-coverages/upload", data, {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        });
        toast.success("Berita berhasil diunggah");
      }
      setShowModal(false);
      fetchCoverages();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menyimpan berita");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Yakin ingin menghapus berita ini?")) return;
    try {
      await api.delete(`/api/news-coverages/${id}`);
      toast.success("Berita dihapus");
      fetchCoverages();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Gagal menghapus berita");
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight flex items-center gap-3">
            <Newspaper className="w-8 h-8 text-primary-600" />
            <AnimatedText text="Berita Media" />
          </h1>
          <p className="text-zinc-500 mt-1">
            Daftar bukti tayang berita dari instansi media
          </p>
        </div>
        
        <div className="flex gap-3">
          <MagneticButton
            onClick={() => openModal()}
            className="bg-zinc-900 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-zinc-800 transition-colors shadow-sm whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            <span>Upload Berita</span>
          </MagneticButton>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
          <input
            type="text"
            placeholder="Cari judul berita..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all shadow-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateFilterPopover 
            filterState={{ dateFrom, dateTo }}
            onChange={(state) => {
              setDateFrom(state.dateFrom || "");
              setDateTo(state.dateTo || "");
            }}
          />
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {coverages.length === 0 ? (
            <div className="col-span-full p-12 text-center text-zinc-500 bg-white border border-zinc-200 rounded-2xl border-dashed">
              Belum ada berita yang diunggah. Klik 'Upload Berita' untuk menambahkan bukti tayang.
            </div>
          ) : (
            coverages.map((cov) => (
              <div key={cov.id} onClick={() => setViewCoverage(cov)} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col group relative cursor-pointer">
                <div className="aspect-video bg-zinc-100 relative group/slider overflow-hidden">
                  {cov.files && cov.files.length > 0 ? (
                    <div className="w-full h-full flex overflow-x-auto snap-x snap-mandatory hide-scrollbar">
                      {cov.files.map((f: any, idx: number) => (
                        <div key={idx} className="w-full h-full flex-none snap-center relative">
                          {f.file_type.startsWith("image/") ? (
                            <img 
                              src={`${API_URL}/api/news-coverages/${cov.id}/download?index=${idx}&token=${token}`} 
                              alt={`${cov.title} - ${idx+1}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 bg-zinc-100">
                              <FileText className="w-10 h-10 mb-2" />
                              <span className="text-xs uppercase font-medium">{f.file_type.split('/')[1] || "File"}</span>
                            </div>
                          )}
                          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <a
                              href={`${API_URL}/api/news-coverages/${cov.id}/download?index=${idx}&token=${token}&download=1`}
                              download={f.original_filename}
                              onClick={(e) => e.stopPropagation()}
                              className="p-1.5 bg-white/90 backdrop-blur-sm text-zinc-700 rounded-lg hover:text-primary-600 shadow-sm"
                              title={`Download file ${idx+1}`}
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400">
                      <ImageIcon className="w-10 h-10 mb-2 opacity-50" />
                      <span className="text-xs font-medium">Tidak ada file</span>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openModal(cov);
                      }}
                      className="p-1.5 bg-blue-500/90 backdrop-blur-sm text-white rounded-lg hover:bg-blue-600 shadow-sm"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(cov.id);
                      }}
                      className="p-1.5 bg-red-500/90 backdrop-blur-sm text-white rounded-lg hover:bg-red-600 shadow-sm"
                      title="Hapus"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 truncate">
                      {cov.media_agency_name}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(cov.publish_date).toLocaleDateString("id-ID")}
                    </span>
                  </div>
                  <h3 className="font-bold text-zinc-900 leading-tight mb-1 line-clamp-2" title={cov.title}>
                    {cov.title}
                  </h3>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Upload Form Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !uploading && setShowModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0">
                <h2 className="text-xl font-bold text-zinc-900">
                  {editingCoverage ? "Edit Bukti Tayang Berita" : "Upload Bukti Tayang Berita"}
                </h2>
                <button
                  onClick={() => !uploading && setShowModal(false)}
                  className="p-2 text-zinc-400 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 flex-1 overflow-y-auto bg-zinc-50/50">
                <form id="uploadForm" onSubmit={handleUpload} className="space-y-5">
                  
                  {/* Nama / Link Media (Readonly) */}
                  <div className="bg-primary-50/50 border border-primary-100 rounded-xl p-4 flex flex-col gap-1">
                    <label className="text-xs font-semibold text-primary-600 uppercase tracking-wider">
                      Instansi Media
                    </label>
                    <div className="font-semibold text-zinc-900">{user?.media_agency_name || "Tidak ada instansi"}</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-zinc-700 mb-1.5">
                        Judul Berita <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white transition-all"
                        placeholder="Masukkan judul berita"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-zinc-700 mb-1.5">
                        Tanggal Publish <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.publish_date}
                        onChange={(e) => setFormData({ ...formData, publish_date: e.target.value })}
                        className="w-full px-4 py-2 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white transition-all"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-zinc-700 mb-1.5">
                        Gambar Bukti Tayang (Screenshot/Foto) {!editingCoverage && <span className="text-red-500">*</span>}
                      </label>
                      {editingCoverage && (
                        <p className="text-xs text-amber-600 font-medium mb-2 bg-amber-50 p-2 rounded-lg border border-amber-100">
                          * Anda bisa menghapus foto lama dan menambahkan foto baru. Minimal 1 foto harus tersisa.
                        </p>
                      )}
                      
                      <div className="mt-1 flex flex-col justify-center px-6 pt-5 pb-6 border-2 border-zinc-300 border-dashed rounded-xl bg-white hover:bg-zinc-50 transition-colors relative group">
                        {(files.length > 0 || retainedFiles.length > 0) ? (
                          <div className="w-full space-y-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {retainedFiles.map((rf, idx) => (
                                <div key={`ret-${idx}`} className="relative aspect-square rounded-lg overflow-hidden border border-zinc-200 group/item">
                                  {rf.file_type?.startsWith('image/') ? (
                                    <img src={`${API_URL}/api/news-coverages/${editingCoverage.id}/download?index=${idx}&token=${token}`} alt="preview lama" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full bg-zinc-100 flex flex-col items-center justify-center text-zinc-400 p-2 text-center">
                                      <FileText className="w-8 h-8 mb-1" />
                                      <span className="text-[10px] font-medium truncate w-full">{rf.original_filename}</span>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeRetainedFile(idx)}
                                    className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover/item:opacity-100 transition-opacity shadow-sm hover:bg-red-600"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-[10px] text-white p-1 text-center font-medium">Lama</div>
                                </div>
                              ))}

                              {files.map((f, idx) => (
                                <div key={`new-${idx}`} className="relative aspect-square rounded-lg overflow-hidden border border-zinc-200 group/item">
                                  {filePreviews[idx] ? (
                                    <img src={filePreviews[idx]} alt="preview" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full bg-zinc-100 flex flex-col items-center justify-center text-zinc-400 p-2 text-center">
                                      <FileText className="w-8 h-8 mb-1" />
                                      <span className="text-[10px] font-medium truncate w-full">{f.name}</span>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeFile(idx)}
                                    className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover/item:opacity-100 transition-opacity shadow-sm hover:bg-red-600"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                  <div className="absolute bottom-0 left-0 right-0 bg-emerald-500/80 text-[10px] text-white p-1 text-center font-medium">Baru</div>
                                </div>
                              ))}
                            </div>
                            <label htmlFor="file-upload" className="w-full py-2 border border-dashed border-zinc-300 rounded-lg text-center text-sm font-medium text-primary-600 hover:bg-primary-50 cursor-pointer block transition-colors">
                              + Tambah File Lainnya
                              <input id="file-upload" name="file-upload" type="file" multiple className="sr-only" ref={fileInputRef} onChange={handleFileSelect} accept=".jpg,.jpeg,.png,.webp,.pdf" />
                            </label>
                          </div>
                        ) : (
                          <label htmlFor="file-upload" className="space-y-2 text-center w-full cursor-pointer block">
                            <div className="mx-auto h-12 w-12 text-zinc-400 flex items-center justify-center bg-zinc-100 rounded-full">
                              <ImageIcon className="h-6 w-6" aria-hidden="true" />
                            </div>
                            <div className="flex text-sm text-zinc-600 justify-center">
                              <span className="relative font-medium text-primary-600 hover:text-primary-500">
                                Pilih file
                              </span>
                              <input
                                id="file-upload"
                                name="file-upload"
                                type="file"
                                multiple
                                className="sr-only"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept=".jpg,.jpeg,.png,.webp,.pdf"
                              />
                              <p className="pl-1">atau drag and drop</p>
                            </div>
                            <p className="text-xs text-zinc-500">
                              PNG, JPG, WebP, PDF max 50MB (bisa pilih banyak file)
                            </p>
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                </form>
              </div>

              <div className="p-4 border-t border-zinc-100 bg-white shrink-0 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={uploading}
                  className="px-5 py-2 text-zinc-600 font-medium hover:bg-zinc-100 rounded-xl transition-colors disabled:opacity-50"
                >
                  Batal
                </button>
                <MagneticButton
                  type="submit"
                  form="uploadForm"
                  disabled={uploading || files.length === 0 || !formData.title}
                  className="bg-zinc-900 text-white px-6 py-2 rounded-xl font-medium hover:bg-zinc-800 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    "Simpan Bukti Tayang"
                  )}
                </MagneticButton>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Detail Modal */}
      <AnimatePresence>
        {viewCoverage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setViewCoverage(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-zinc-50/50">
                <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-emerald-500" />
                  Detail Berita
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownloadAll(viewCoverage)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-600 bg-zinc-200/50 hover:bg-zinc-200 hover:text-zinc-900 rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download Semua
                  </button>
                  <button
                    onClick={() => setViewCoverage(null)}
                    className="p-2 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <div className="p-6 flex-1 overflow-y-auto">
                <div className="space-y-6">
                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Judul Berita</label>
                    <p className="font-bold text-lg text-zinc-900 mt-1 leading-snug">{viewCoverage.title}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tanggal Publish</label>
                      <p className="font-medium text-zinc-800 mt-1">{new Date(viewCoverage.publish_date).toLocaleDateString("id-ID", { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Nama Media</label>
                      <p className="font-medium text-zinc-800 mt-1">
                        {viewCoverage.media_website_url ? (
                          <a href={viewCoverage.media_website_url.startsWith('http') ? viewCoverage.media_website_url : `https://${viewCoverage.media_website_url}`} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 hover:underline">
                            {viewCoverage.media_website_url.replace(/^https?:\/\//, '')}
                          </a>
                        ) : (
                          viewCoverage.media_agency_name ? viewCoverage.media_agency_name.replace(/\b\w/g, (l: string) => l.toUpperCase()) : ""
                        )}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">Foto / Bukti Tayang</label>
                    {viewCoverage.files && viewCoverage.files.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {viewCoverage.files.map((_: any, idx: number) => (
                          <div 
                            key={idx} 
                            className="aspect-square bg-zinc-100 rounded-xl overflow-hidden border border-zinc-200 relative group cursor-pointer"
                            onClick={() => setViewImage(`${API_URL}/api/news-coverages/${viewCoverage.id}/download?index=${idx}&token=${token}`)}
                          >
                            <img 
                              src={`${API_URL}/api/news-coverages/${viewCoverage.id}/download?index=${idx}&token=${token}`} 
                              alt="Bukti tayang" 
                              className="w-full h-full object-cover transition-transform group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-3">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewImage(`${API_URL}/api/news-coverages/${viewCoverage.id}/download?index=${idx}&token=${token}`);
                                }}
                                className="p-2 bg-white/20 hover:bg-white/40 rounded-full backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Lihat Full Size"
                              >
                                <Eye className="w-5 h-5" />
                              </button>
                              <a
                                href={`${API_URL}/api/news-coverages/${viewCoverage.id}/download?index=${idx}&token=${token}&download=1`}
                                download={_?.original_filename || `file-${idx+1}`}
                                onClick={(e) => e.stopPropagation()}
                                className="p-2 bg-white/20 hover:bg-white/40 rounded-full backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Download"
                              >
                                <Download className="w-5 h-5" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-zinc-500 italic bg-zinc-50 p-4 rounded-xl border border-zinc-100">Tidak ada foto terlampir.</div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lightbox / Full-size Image Viewer */}
      <AnimatePresence>
        {viewImage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <button
              onClick={() => setViewImage(null)}
              className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors z-10"
            >
              <X className="w-8 h-8" />
            </button>
            <motion.img
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              src={viewImage}
              alt="Full size"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
