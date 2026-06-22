import { useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  ShieldAlert,
  FileText,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { animate, stagger } from "animejs";
import { api } from "../lib/api";
import { AnimatedText } from "../components/AnimatedText";
import { MagneticButton } from "../components/MagneticButton";
import { toast } from "sonner";

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  async function fetchLogs() {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });
      if (actionFilter) {
        params.append("action", actionFilter);
      }

      const res = await api.get(`/api/audit?${params.toString()}`);
      setLogs(res.data.data);
      setTotalPages(res.data.pagination.total_pages);
    } catch {
      setError("Gagal memuat log aktivitas");
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
  }

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionFilter]);

  const actions = [
    "LOGIN",
    "LOGOUT",
    "CREATE",
    "UPDATE",
    "DELETE",
    "UPLOAD",
    "SHARE",
    "DOWNLOAD",
  ];

  const getActionColor = (action: string) => {
    switch (action) {
      case "DELETE":
        return "bg-red-100 text-red-700";
      case "CREATE":
        return "bg-green-100 text-green-700";
      case "UPDATE":
        return "bg-blue-100 text-blue-700";
      case "LOGIN":
        return "bg-purple-100 text-purple-700";
      case "UPLOAD":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const downloadAuditExport = async (format: "csv" | "pdf") => {
    try {
      const res = await api.get(`/api/export/audit/${format}`, { responseType: "blob" });
      const disposition = res.headers["content-disposition"] || "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] || `REKAM_Audit_Report.${format}`;
      const blobUrl = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      toast.error(err.response?.data?.error || `Gagal mengunduh ${format.toUpperCase()}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-6xl mx-auto p-4 lg:p-8"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-primary-600" />
            <AnimatedText text="Audit Log" />
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Pantau aktivitas pengguna dan perubahan pada sistem.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <MagneticButton
            onClick={() => downloadAuditExport("csv")}
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 shadow-sm premium-transition"
            title="Unduh Laporan CSV"
          >
            <FileText className="w-4 h-4" />
            Unduh CSV
          </MagneticButton>
          <MagneticButton
            onClick={() => downloadAuditExport("pdf")}
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 shadow-sm premium-transition"
            title="Unduh Laporan PDF"
          >
            <ShieldAlert className="w-4 h-4" /> {/* Or Download icon */}
            Unduh PDF
          </MagneticButton>
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-sm font-medium text-gray-700 outline-none border-none focus:ring-0 w-32"
            >
              <option value="">Semua Aksi</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-red-500 mb-4 bg-red-50 p-4 rounded-xl">{error}</p>
      )}

      <div className="p-2 bg-gray-50/80 backdrop-blur-xl border border-gray-200/60 rounded-[2.5rem] shadow-sm mb-12">
        <div className="bg-white rounded-[2rem] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto p-2">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50/50 text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 font-semibold rounded-tl-xl w-40">Waktu</th>
                  <th className="px-6 py-4 font-semibold">Pengguna</th>
                  <th className="px-6 py-4 font-semibold">Aksi</th>
                  <th className="px-6 py-4 font-semibold">Entitas</th>
                  <th className="px-6 py-4 font-semibold rounded-tr-xl">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50/50">
                <AnimatePresence>
                  {loading && logs.length === 0 ? (
                    <motion.tr exit={{ opacity: 0 }}>
                      <td colSpan={5} className="px-5 py-20 text-center">
                        <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                      </td>
                    </motion.tr>
                  ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="anime-row opacity-0 hover:bg-gray-50/80 transition-colors group"
                    >
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 font-medium">
                      {new Date(log.created_at).toLocaleString("id-ID")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {log.user_name || "System / Guest"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-bold ${getActionColor(log.action)}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900 capitalize">
                        {log.entity_type?.replace("_", " ")}
                      </div>
                      <div
                        className="text-xs text-text-muted truncate max-w-[200px]"
                        title={log.entity_id}
                      >
                        {log.entity_id}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-gray-500">
                      {log.ip_address || "-"}
                    </td>
                  </tr>
                ))
                )}
                {!loading && logs.length === 0 && (
                  <tr className="anime-row opacity-0">
                    <td
                      colSpan={5}
                      className="px-6 py-12 text-center text-gray-500"
                    >
                      Tidak ada catatan audit yang sesuai kriteria.
                    </td>
                  </tr>
                )}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-4 border-t border-gray-50 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Halaman {page} dari {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </motion.div>
  );
}
