import React, { useEffect, useState, useRef } from "react";
import { Plus, Loader2, Newspaper, Download, FileText, X, Filter } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api, API_URL } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import { MagneticButton } from "../components/MagneticButton";

export default function NewsCoveragesPage() {
  const { user, token } = useAuthStore();
  const [coverages, setCoverages] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedAgency, setSelectedAgency] = useState<string>("");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Bulk Upload State
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [fileDetails, setFileDetails] = useState<Record<string, { title: string; news_url: string; publish_date: string; activity_id: string; media_agency_id: string }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchCoverages = async () => {
    try {
      setLoading(true);
      const res = await api.get("/api/news-coverages", {
        params: {
          media_agency_id: selectedAgency || undefined,
        }
      });
      setCoverages(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Gagal memuat berita media");
    } finally {
      setLoading(false);
    }
  };

  const fetchDependencies = async () => {
    try {
      if (user?.role !== "MEDIA") {
        const agRes = await api.get("/api/media-agencies");
        setAgencies(agRes.data);
      }
      const acRes = await api.get("/api/activities");
      setActivities(acRes.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCoverages();
  }, [selectedAgency]);

  useEffect(() => {
    fetchDependencies();
  }, []);

  const handleDownloadCsv = () => {
    const url = new URL(`${API_URL}/api/export/news-coverages/csv`);
    if (selectedAgency) url.searchParams.set("media_agency_id", selectedAgency);
    if (token) url.searchParams.set("token", token);
    window.location.href = url.toString();
  };

  const openModal = () => {
    setFiles([]);
    setFilePreviews({});
    setFileDetails({});
    setShowModal(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...newFiles]);

      newFiles.forEach((file) => {
        // Generate preview URL
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            setFilePreviews((prev) => ({ ...prev, [file.name]: e.target?.result as string }));
          };
          reader.readAsDataURL(file);
        }
        
        // Initialize details
        setFileDetails((prev) => ({
          ...prev,
          [file.name]: {
            title: file.name.split('.')[0],
            news_url: "",
            publish_date: new Date().toISOString().split('T')[0],
            activity_id: "",
            media_agency_id: user?.media_agency_id || "",
          }
        }));
      });
    }
  };

  const removeFile = (fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== fileName));
    setFilePreviews((prev) => {
      const newPrev = { ...prev };
      delete newPrev[fileName];
      return newPrev;
    });
    setFileDetails((prev) => {
      const newPrev = { ...prev };
      delete newPrev[fileName];
      return newPrev;
    });
  };

  const updateFileDetail = (fileName: string, field: string, value: string) => {
    setFileDetails((prev) => ({
      ...prev,
      [fileName]: {
        ...prev[fileName],
        [field]: value
      }
    }));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    // Validate
    for (const file of files) {
      const details = fileDetails[file.name];
      if (!details.activity_id) {
        toast.error(`Pilih acara untuk file: ${file.name}`);
        return;
      }
      if (!details.title) {
        toast.error(`Judul wajib diisi untuk file: ${file.name}`);
        return;
      }
      if (user?.role !== 'MEDIA' && !details.media_agency_id) {
        toast.error(`Pilih instansi media untuk file: ${file.name}`);
        return;
      }
    }

    setUploading(true);
    let successCount = 0;

    for (const file of files) {
      const details = fileDetails[file.name];
      const formData = new FormData();
      formData.append("file", file);
      formData.append("activity_id", details.activity_id);
      formData.append("title", details.title);
      formData.append("publish_date", details.publish_date);
      if (details.news_url) formData.append("news_url", details.news_url);
      if (user?.role !== 'MEDIA') formData.append("media_agency_id", details.media_agency_id);

      try {
        await api.post("/api/news-coverages/upload", formData, {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        });
        successCount++;
      } catch (err: any) {
        toast.error(`Gagal upload ${file.name}: ${err.response?.data?.error || err.message}`);
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toast.success(`${successCount} bukti tayang berhasil diunggah`);
      setShowModal(false);
      fetchCoverages();
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
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          {user?.role !== "MEDIA" && (
            <div className="relative flex-1 md:flex-none">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <select
                value={selectedAgency}
                onChange={(e) => setSelectedAgency(e.target.value)}
                className="w-full md:w-48 pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 appearance-none"
              >
                <option value="">Semua Media</option>
                {agencies.map((ag) => (
                  <option key={ag.id} value={ag.id}>{ag.name}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleDownloadCsv}
            className="p-2.5 text-zinc-600 bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors shadow-sm"
            title="Download CSV"
          >
            <Download className="w-5 h-5" />
          </button>

          <MagneticButton
            onClick={openModal}
            className="bg-zinc-900 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-zinc-800 transition-colors shadow-sm whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            <span>Upload Berita</span>
          </MagneticButton>
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
              Belum ada berita yang diunggah.
            </div>
          ) : (
            coverages.map((cov) => (
              <div key={cov.id} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col group relative">
                <div className="aspect-video bg-zinc-100 relative">
                  {cov.file_type.startsWith("image/") ? (
                    <img 
                      src={`${API_URL}/api/news-coverages/${cov.id}/download?token=${token}`} 
                      alt={cov.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400">
                      <FileText className="w-10 h-10 mb-2" />
                      <span className="text-xs uppercase font-medium">{cov.file_type.split('/')[1] || "File"}</span>
                    </div>
                  )}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={`${API_URL}/api/news-coverages/${cov.id}/download?token=${token}`}
                      download={cov.original_filename}
                      className="p-1.5 bg-white/90 backdrop-blur-sm text-zinc-700 rounded-lg hover:text-primary-600 shadow-sm"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    {(user?.role === "SUPER_ADMIN" || cov.uploaded_by === user?.id || user?.media_agency_id === cov.media_agency_id) && (
                      <button
                        onClick={() => handleDelete(cov.id)}
                        className="p-1.5 bg-white/90 backdrop-blur-sm text-red-600 rounded-lg hover:bg-red-50 shadow-sm"
                        title="Hapus"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
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
                  {cov.news_url && (
                    <a 
                      href={cov.news_url.startsWith('http') ? cov.news_url : `https://${cov.news_url}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:underline text-sm font-medium mt-auto"
                    >
                      Kunjungi Link
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Bulk Upload Modal */}
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
              className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between shrink-0">
                <h2 className="text-xl font-bold text-zinc-900">
                  Bulk Upload Bukti Tayang Berita
                </h2>
                <button
                  onClick={() => !uploading && setShowModal(false)}
                  className="p-2 text-zinc-400 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 flex-1 overflow-y-auto bg-zinc-50/50">
                <div className="mb-6">
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                  />
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-zinc-300 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-50 hover:border-primary-400 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center mb-3">
                      <Plus className="w-6 h-6" />
                    </div>
                    <p className="font-medium text-zinc-900">Pilih file untuk diunggah</p>
                    <p className="text-sm text-zinc-500 mt-1">Format: JPG, PNG, WebP, PDF. Max 50MB/file.</p>
                  </div>
                </div>

                {files.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="font-semibold text-zinc-900">File yang dipilih ({files.length})</h3>
                    {files.map((file) => (
                      <div key={file.name} className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-col md:flex-row gap-4 shadow-sm relative">
                        <button
                          onClick={() => removeFile(file.name)}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 transition-colors z-10"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        
                        {/* Preview Visual */}
                        <div className="w-full md:w-32 h-32 shrink-0 bg-zinc-100 rounded-lg overflow-hidden flex items-center justify-center border border-zinc-200">
                          {filePreviews[file.name] ? (
                            <img src={filePreviews[file.name]} alt="Preview" className="w-full h-full object-cover" />
                          ) : (
                            <div className="text-zinc-400 flex flex-col items-center">
                              <FileText className="w-8 h-8 mb-1" />
                              <span className="text-[10px] font-bold uppercase">{file.name.split('.').pop()}</span>
                            </div>
                          )}
                        </div>

                        {/* Detail Form */}
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-semibold text-zinc-700 mb-1">Judul Berita</label>
                            <input
                              type="text"
                              value={fileDetails[file.name]?.title || ""}
                              onChange={(e) => updateFileDetail(file.name, "title", e.target.value)}
                              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-zinc-700 mb-1">Pilih Acara</label>
                            <select
                              value={fileDetails[file.name]?.activity_id || ""}
                              onChange={(e) => updateFileDetail(file.name, "activity_id", e.target.value)}
                              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 bg-white"
                            >
                              <option value="">Pilih Acara...</option>
                              {activities.map(a => (
                                <option key={a.id} value={a.id}>{a.title}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-zinc-700 mb-1">Tanggal Rilis</label>
                            <input
                              type="date"
                              value={fileDetails[file.name]?.publish_date || ""}
                              onChange={(e) => updateFileDetail(file.name, "publish_date", e.target.value)}
                              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-zinc-700 mb-1">Link Berita (Opsional)</label>
                            <input
                              type="url"
                              value={fileDetails[file.name]?.news_url || ""}
                              onChange={(e) => updateFileDetail(file.name, "news_url", e.target.value)}
                              placeholder="https://..."
                              className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                            />
                          </div>

                          {user?.role !== 'MEDIA' && (
                            <div>
                              <label className="block text-xs font-semibold text-zinc-700 mb-1">Instansi Media</label>
                              <select
                                value={fileDetails[file.name]?.media_agency_id || ""}
                                onChange={(e) => updateFileDetail(file.name, "media_agency_id", e.target.value)}
                                className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 bg-white"
                              >
                                <option value="">Pilih Media...</option>
                                {agencies.map(ag => (
                                  <option key={ag.id} value={ag.id}>{ag.name}</option>
                                ))}
                              </select>
                            </div>
                          )}

                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                  onClick={handleUpload}
                  disabled={uploading || files.length === 0}
                  className="bg-zinc-900 text-white px-6 py-2 rounded-xl font-medium hover:bg-zinc-800 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Mengunggah...
                    </>
                  ) : (
                    `Upload ${files.length} File`
                  )}
                </MagneticButton>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
