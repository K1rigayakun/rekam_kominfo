import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ArrowLeft, History, Calendar, User } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { AnimatedText } from '../components/AnimatedText';
import { useConfirm } from '../components/useConfirm';

interface Version {
  id: string;
  version_number: number;
  created_at: string;
  created_by_name: string;
  snapshot: any;
}

export default function ActivityVersionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    async function fetchVersions() {
      try {
        const res = await api.get(`/api/activities/${id}/versions`);
        setVersions(res.data.data);
      } catch {
        toast.error('Gagal memuat riwayat versi');
      } finally {
        setLoading(false);
      }
    }
    fetchVersions();
  }, [id]);

  const handleRestore = async (versionId: string) => {
    const ok = await confirm({
      title: 'Pulihkan Versi',
      message: 'Data teks acara akan ditimpa dengan versi ini. Media tidak akan terpengaruh.',
      confirmText: 'Pulihkan',
    });
    if (!ok) return;

    setRestoringId(versionId);
    try {
      await api.post(`/api/activities/${id}/versions/${versionId}/restore`);
      toast.success('Acara berhasil dipulihkan ke versi tersebut');
      navigate(`/activity/${id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Gagal memulihkan versi');
    } finally {
      setRestoringId(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-500">Memuat riwayat versi...</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto p-4 lg:p-8 space-y-6"
    >
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(`/activity/${id}`)}
          className="p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <History className="w-7 h-7 text-primary-600" />
            <AnimatedText text="Riwayat Versi Acara" />
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Lihat riwayat perubahan yang pernah disimpan untuk acara ini</p>
        </div>
      </div>

      <div className="bg-white border border-zinc-100 rounded-2xl p-6 shadow-sm">
        <div className="relative border-l-2 border-zinc-100 ml-3 space-y-8 pb-4">
          {versions.map((v, i) => (
            <div key={v.id} className="relative pl-6">
              <div className="absolute w-3 h-3 bg-primary-500 rounded-full -left-[7px] top-2 border-2 border-white ring-4 ring-primary-50"></div>
              <div className="bg-zinc-50 border border-zinc-100 p-4 rounded-xl hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-zinc-900">Versi {v.version_number}</h3>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-zinc-600">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        {new Date(v.created_at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <User className="w-4 h-4" />
                        {v.created_by_name || 'Sistem'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {i === 0 ? (
                      <span className="bg-emerald-50 text-emerald-600 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">Saat Ini</span>
                    ) : (
                      <button
                        onClick={() => handleRestore(v.id)}
                        disabled={restoringId === v.id}
                        className="text-sm px-3 py-1.5 bg-white border border-zinc-200 hover:border-primary-500 hover:text-primary-600 text-zinc-600 rounded-lg font-medium transition-colors disabled:opacity-50"
                      >
                        {restoringId === v.id ? 'Memulihkan...' : 'Pulihkan Versi Ini'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {versions.length === 0 && (
            <div className="pl-6 text-zinc-500 text-sm italic">Belum ada riwayat versi tersimpan.</div>
          )}
        </div>
      </div>
      <ConfirmDialog />
    </motion.div>
  );
}
