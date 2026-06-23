import { useEffect, useState } from "react";
import { Loader2, Newspaper, Download, FileText, X, Filter, Search, Eye } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { api, API_URL } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";
import { AnimatedText } from "../components/AnimatedText";
import DateFilterPopover from "../components/DateFilterPopover";

export default function AdminNewsCoveragesPage() {
  const { user, token } = useAuthStore();
  const [coverages, setCoverages] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedAgency, setSelectedAgency] = useState<string>("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [viewCoverage, setViewCoverage] = useState<any>(null);
  const [viewImage, setViewImage] = useState<string | null>(null);

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

  const fetchCoverages = async () => {
    try {
      setLoading(true);
      const res = await api.get("/api/news-coverages", {
        params: {
          media_agency_id: selectedAgency || undefined,
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

  const fetchDependencies = async () => {
    try {
      const agRes = await api.get("/api/media-agencies");
      setAgencies(agRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCoverages();
  }, [selectedAgency, dateFrom, dateTo]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCoverages();
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchDependencies();
  }, []);

  const handleDownloadCsv = () => {
    const url = new URL(`${API_URL}/api/export/news-coverages/csv`);
    if (selectedAgency) url.searchParams.set("media_agency_id", selectedAgency);
    if (search) url.searchParams.set("search", search);
    if (dateFrom) url.searchParams.set("dateFrom", dateFrom);
    if (dateTo) url.searchParams.set("dateTo", dateTo);
    if (token) url.searchParams.set("token", token);
    window.location.href = url.toString();
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

  if (user?.role !== "SUPER_ADMIN") {
    return <div className="p-8 text-center text-zinc-500">Akses ditolak. Hanya Super Admin yang dapat mengakses halaman ini.</div>;
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight flex items-center gap-3">
            <Newspaper className="w-8 h-8 text-primary-600" />
            <AnimatedText text="Berita Media" />
          </h1>
          <p className="text-zinc-500 mt-1">
            Daftar bukti tayang berita yang diunggah oleh instansi media
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-3">
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

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <select
              value={selectedAgency}
              onChange={(e) => setSelectedAgency(e.target.value)}
              className="w-full md:w-48 pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 appearance-none shadow-sm"
            >
              <option value="">Semua Instansi</option>
              {agencies.map((ag) => (
                <option key={ag.id} value={ag.id}>{ag.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleDownloadCsv}
            className="p-2.5 text-zinc-600 bg-white border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors shadow-sm flex items-center gap-2 font-medium text-sm"
            title="Download CSV"
          >
            <Download className="w-5 h-5" />
            <span className="hidden sm:inline">Export</span>
          </button>
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
              Belum ada berita yang ditemukan.
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
                      <FileText className="w-10 h-10 mb-2 opacity-50" />
                      <span className="text-xs font-medium">Tidak ada file</span>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    {user?.role === "SUPER_ADMIN" && (
                      <button
                        onClick={() => handleDelete(cov.id)}
                        className="p-1.5 bg-red-500/90 backdrop-blur-sm text-white rounded-lg hover:bg-red-600 shadow-sm"
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
                      onClick={(e) => e.stopPropagation()}
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
