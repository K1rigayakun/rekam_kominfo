/* eslint-disable @typescript-eslint/no-explicit-any */
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { AxiosError } from 'axios';
import {
  ArrowLeft, Share2, Loader2, Copy, X, Trash2, Eye, Link as LinkIcon, BarChart2, Download, CheckCircle
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../stores/authStore';
import { WarningCircle } from '@phosphor-icons/react';
import { useConfirm } from '../components/useConfirm';
import { motion } from 'motion/react';

interface Activity {
  id: string;
  title: string;
  event_date: string;
  location: string;
  use_sections: boolean;
  sections: any[];
  unsectioned_media: any[];
}

export default function ShareActivityPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [activity, setActivity] = useState<Activity | null>(null);
  const [sectionMedia, setSectionMedia] = useState<Record<string, any[]>>({});
  
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Existing shares
  const [shares, setShares] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);

  const [shareConfig, setShareConfig] = useState({
    title: '',
    download_quality: 'BOTH',
    expires_at: '',
    share_attachments: true,
    description_mode: 'AUTO',
    custom_description: '',
  });
  
  const [selectedShareSections, setSelectedShareSections] = useState<Set<string>>(new Set());
  const [selectedShareMedia, setSelectedShareMedia] = useState<Set<string>>(new Set());
  
  const [creatingShare, setCreatingShare] = useState(false);
  const [shareResult, setShareResult] = useState<{ public_url: string; token: string } | null>(null);

  // Analytics State
  const [analyticsShareId, setAnalyticsShareId] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  async function fetchActivityAndShares() {
    try {
      setLoading(true);
      setError('');
      
      const res = await api.get(`/api/activities/${id}`);
      setActivity(res.data.data);

      const mediaRes = await api.get(`/api/media?activity_id=${id}&limit=1000`);
      
      const grouped: Record<string, any[]> = {};
      mediaRes.data.data.forEach((m: any) => {
        const sId = m.section_id || 'unsectioned';
        if (!grouped[sId]) grouped[sId] = [];
        grouped[sId].push(m);
      });
      setSectionMedia(grouped);

      try {
        const attRes = await api.get(`/api/attachments?activity_id=${id}`);
        setAttachments(attRes.data.data);
      } catch (err) {
        console.error('Failed to fetch attachments:', err);
      }

      fetchShares();

    } catch (err) {
      const e = err as AxiosError<{error: string}>;
      setError(e.response?.data?.error || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActivityAndShares();
  }, [id]);

  async function fetchShares() {
    try {
      setLoadingShares(true);
      const res = await api.get(`/api/sharing?activity_id=${id}`);
      setShares(res.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingShares(false);
    }
  }

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingShare(true);
    try {
      const items: Array<{ section_id?: string; media_id?: string; sort_order: number }> = [];
      let sortOrder = 0;

      if (activity?.use_sections) {
        activity.sections.forEach((s) => {
          if (selectedShareSections.has(s.id)) {
            items.push({ section_id: s.id, sort_order: sortOrder++ });
          }
        });
        Object.values(sectionMedia).flat().forEach((m) => {
          if (selectedShareMedia.has(m.id)) {
            items.push({ media_id: m.id, sort_order: sortOrder++ });
          }
        });
      } else if (activity?.unsectioned_media) {
        activity.unsectioned_media.forEach((m) => {
          if (selectedShareMedia.has(m.id)) {
            items.push({ media_id: m.id, sort_order: sortOrder++ });
          }
        });
      }

      if (items.length === 0 && !shareConfig.share_attachments) {
        toast.info('Pilih setidaknya satu media, judul, atau lampiran untuk dibagikan.');
        setCreatingShare(false);
        return;
      }

      const payload = {
        activity_id: id,
        title: shareConfig.title || activity?.title || '',
        download_quality: shareConfig.download_quality,
        expires_at: shareConfig.expires_at ? new Date(shareConfig.expires_at).toISOString() : undefined,
        items,
        config: {
          share_attachments: shareConfig.share_attachments,
          description_mode: shareConfig.description_mode,
          custom_description: shareConfig.custom_description,
        }
      };

      const res = await api.post('/api/sharing', payload);
      setShareResult(res.data);
      fetchShares(); // Refresh list of shares
    } catch (err) {
      const e = err as AxiosError<{error: string}>;
      toast.error(e.response?.data?.error || 'Gagal membuat link sharing');
    } finally {
      setCreatingShare(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Link berhasil disalin!');
  };

  const handleDeactivate = async (shareId: string) => {
    const isConfirmed = await confirm({
      title: 'Nonaktifkan Link',
      message: 'Apakah Anda yakin ingin menonaktifkan link ini? Pengunjung tidak akan bisa mengaksesnya lagi.',
      confirmText: 'Nonaktifkan',
    });
    if (!isConfirmed) return;
    try {
      await api.put(`/api/sharing/${shareId}/deactivate`);
      fetchShares();
    } catch (err) {
      const e = err as AxiosError<{error: string}>;
      toast.error(e.response?.data?.error || 'Gagal menonaktifkan link');
    }
  };

  const handleReactivate = async (shareId: string) => {
    try {
      await api.put(`/api/sharing/${shareId}/reactivate`);
      fetchShares();
      toast.success('Link berhasil diaktifkan kembali');
    } catch (err) {
      const e = err as AxiosError<{error: string}>;
      toast.error(e.response?.data?.error || 'Gagal mengaktifkan link');
    }
  };

  const handleOpenAnalytics = async (shareId: string) => {
    setAnalyticsShareId(shareId);
    setLoadingAnalytics(true);
    try {
      const res = await api.get(`/api/sharing/${shareId}/analytics`);
      setAnalyticsData(res.data.data);
    } catch (err) {
      const e = err as AxiosError<{error: string}>;
      toast.error(e.response?.data?.error || 'Gagal memuat analitik');
      setAnalyticsShareId(null);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const handlePreview = () => {
    const previewData = {
      title: shareConfig.title || activity?.title || '',
      activity_title: activity?.title || '',
      event_date: activity?.event_date,
      location: activity?.location,
      download_quality: shareConfig.download_quality,
      config: {
        share_attachments: shareConfig.share_attachments,
        description_mode: shareConfig.description_mode,
        custom_description: shareConfig.custom_description,
      },
      sections: activity?.sections?.filter(s => selectedShareSections.has(s.id)).map(s => ({
        id: s.id,
        title: s.title,
        media: sectionMedia[s.id]?.filter(m => selectedShareMedia.has(m.id)) || []
      })) || [],
      attachments: shareConfig.share_attachments ? attachments : [],
    };
    sessionStorage.setItem('previewShareData', JSON.stringify(previewData));
    window.open('/preview', '_blank');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error || !activity) {
    return <div className="text-red-500 text-center mt-10">{error}</div>;
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-[100dvh] bg-slate-50 font-sans pb-20 lg:pb-0 text-slate-900"
    >
      <ConfirmDialog />
      <div className="max-w-6xl mx-auto space-y-6 pt-6 px-4 sm:px-6">
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => navigate(`/activity/${id}`)}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-700" />
          </button>
          <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bagikan Acara</h1>
          <p className="text-sm text-gray-500 mt-1">{activity.title}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Form Create Share */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary-500" />
              Buat Link QR Baru
            </h2>

            {!isAdmin ? (
              <div className="text-center py-10 bg-gray-50 rounded-2xl border border-gray-200">
                <WarningCircle weight="duotone" className="w-12 h-12 text-amber-500 mx-auto mb-3" />
                <h3 className="text-gray-900 font-bold mb-1">Akses Dibatasi</h3>
                <p className="text-sm text-gray-500 max-w-sm mx-auto">
                  Hanya Administrator yang dapat membuat tautan bagikan atau QR Code baru.
                </p>
              </div>
            ) : !shareResult ? (
              <form onSubmit={handleCreateShare} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Judul Link (Opsional)</label>
                    <input
                      type="text"
                      value={shareConfig.title}
                      onChange={(e) => setShareConfig({ ...shareConfig, title: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                      placeholder="Contoh: Publikasi Eksternal"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Kualitas Unduhan</label>
                    <select
                      value={shareConfig.download_quality}
                      onChange={(e) => setShareConfig({ ...shareConfig, download_quality: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none bg-white"
                    >
                      <option value="BOTH">Bebas (Asli & Kompresi)</option>
                      <option value="ORIGINAL">Hanya Asli (Resolusi Tinggi)</option>
                      <option value="PREVIEW">Hanya Preview (Resolusi Rendah)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Kedaluwarsa (Opsional)</label>
                    <input
                      type="datetime-local"
                      value={shareConfig.expires_at}
                      onChange={(e) => setShareConfig({ ...shareConfig, expires_at: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Mode Deskripsi Acara</label>
                    <select
                      value={shareConfig.description_mode}
                      onChange={(e) => setShareConfig({ ...shareConfig, description_mode: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none bg-white"
                    >
                      <option value="AUTO">Gunakan Deskripsi Asli (Auto)</option>
                      <option value="CUSTOM">Tulis Deskripsi Khusus</option>
                      <option value="NONE">Sembunyikan Deskripsi</option>
                    </select>
                  </div>
                </div>

                {shareConfig.description_mode === 'CUSTOM' && (
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Deskripsi Khusus</label>
                    <textarea
                      value={shareConfig.custom_description}
                      onChange={(e) => setShareConfig({ ...shareConfig, custom_description: e.target.value })}
                      placeholder="Tulis deskripsi untuk halaman publik..."
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none resize-none"
                      rows={4}
                    />
                  </div>
                )}

                <div className="pt-4 border-t border-gray-100">
                  <h3 className="text-sm font-bold text-gray-900 mb-4">Pilih Konten yang Dibagikan</h3>
                  
                  <label className="flex items-center gap-3 mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={shareConfig.share_attachments}
                      onChange={(e) => setShareConfig({ ...shareConfig, share_attachments: e.target.checked })}
                      className="w-5 h-5 text-primary-600 rounded"
                    />
                    <div>
                      <span className="text-sm font-semibold text-gray-900 block">Sertakan File Lampiran</span>
                      <span className="text-xs text-gray-500 block">Bagikan PDF/dokumen acara ke publik</span>
                    </div>
                  </label>

                  <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 max-h-64 overflow-y-auto space-y-4">
                    {activity?.use_sections ? (
                      activity.sections.map(section => (
                        <div key={section.id} className="space-y-2">
                          <label className="flex items-center gap-2 font-bold text-gray-900 text-sm cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={selectedShareSections.has(section.id)}
                              onChange={(e) => {
                                const next = new Set(selectedShareSections);
                                const nextMedia = new Set(selectedShareMedia);
                                if (e.target.checked) {
                                  next.add(section.id);
                                  sectionMedia[section.id]?.forEach(m => nextMedia.add(m.id));
                                } else {
                                  next.delete(section.id);
                                  sectionMedia[section.id]?.forEach(m => nextMedia.delete(m.id));
                                }
                                setSelectedShareSections(next);
                                setSelectedShareMedia(nextMedia);
                              }}
                              className="w-4 h-4 text-primary-600 rounded"
                            />
                            {section.title}
                          </label>
                          <div className="pl-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {sectionMedia[section.id]?.map(media => (
                              <label key={media.id} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer p-1 hover:bg-gray-100 rounded">
                                <input 
                                  type="checkbox" 
                                  checked={selectedShareMedia.has(media.id)}
                                  onChange={(e) => {
                                    const next = new Set(selectedShareMedia);
                                    if (e.target.checked) next.add(media.id);
                                    else next.delete(media.id);
                                    setSelectedShareMedia(next);
                                  }}
                                  className="w-3.5 h-3.5 text-primary-500 rounded"
                                />
                                <span className="truncate">{media.display_name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {activity?.unsectioned_media.map(media => (
                          <label key={media.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer p-1 hover:bg-gray-100 rounded">
                            <input 
                              type="checkbox" 
                              checked={selectedShareMedia.has(media.id)}
                              onChange={(e) => {
                                const next = new Set(selectedShareMedia);
                                if (e.target.checked) next.add(media.id);
                                else next.delete(media.id);
                                setSelectedShareMedia(next);
                              }}
                              className="w-4 h-4 text-primary-600 rounded"
                            />
                            <span className="truncate">{media.display_name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={handlePreview}
                    className="flex-1 py-3 bg-white border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-800 rounded-xl font-bold premium-transition flex justify-center items-center gap-2"
                  >
                    <Eye className="w-5 h-5 text-gray-500" /> Preview
                  </button>
                  <button
                    type="submit"
                    disabled={creatingShare}
                    className="flex-1 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold flex justify-center items-center gap-2 premium-transition shadow-lg shadow-primary-500/30"
                  >
                    {creatingShare ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Buat Link QR'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center py-6 animate-in fade-in zoom-in duration-300">
                <div className="qr-container bg-white p-6 rounded-3xl border-4 border-gray-50 shadow-sm mb-6">
                  <QRCodeSVG 
                    value={shareResult.public_url} 
                    size={240}
                    bgColor={"#ffffff"}
                    fgColor={"#111827"}
                    level={"Q"}
                  />
                </div>
                <div className="w-full max-w-sm space-y-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1.5 block text-center">Link Publik</label>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        readOnly
                        value={shareResult.public_url}
                        className="flex-1 px-4 py-3 border-2 border-gray-100 rounded-xl bg-gray-50 text-gray-600 text-sm outline-none text-center font-medium"
                      />
                      <button
                        onClick={() => copyToClipboard(shareResult.public_url)}
                        className="p-3 bg-primary-50 hover:bg-primary-100 text-primary-600 rounded-xl premium-transition shrink-0"
                        title="Salin Link"
                      >
                        <Copy className="w-5 h-5" />
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        const svg = document.querySelector('.qr-container svg');
                        if (!svg) return;
                        const svgData = new XMLSerializer().serializeToString(svg);
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const img = new Image();
                        img.onload = () => {
                          canvas.width = img.width + 40;
                          canvas.height = img.height + 40;
                          if (ctx) {
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                            ctx.drawImage(img, 20, 20);
                            const pngFile = canvas.toDataURL('image/png');
                            const downloadLink = document.createElement('a');
                            downloadLink.download = `QR_${activity?.title?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'share'}.png`;
                            downloadLink.href = `${pngFile}`;
                            downloadLink.click();
                          }
                        };
                        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                      }}
                      className="w-full py-3 bg-white border border-primary-200 text-primary-600 hover:bg-primary-50 hover:border-primary-300 rounded-xl font-bold premium-transition flex justify-center items-center gap-2"
                    >
                      <Download className="w-5 h-5" /> Download QR Code (PNG)
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setShareResult(null);
                      setShareConfig({ ...shareConfig, title: '' });
                    }}
                    className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-bold premium-transition"
                  >
                    Buat Link Lain
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: List of existing shares */}
        <div className="space-y-4">
          <h3 className="font-bold text-gray-900 text-lg px-1">Link Tersedia</h3>
          
          {loadingShares ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : shares.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <LinkIcon className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-gray-500 text-sm">Belum ada link sharing yang dibuat untuk acara ini.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {shares.map(share => (
                <div key={share.id} className={`bg-white rounded-2xl p-4 shadow-sm border ${share.is_active ? 'border-gray-200' : 'border-red-100 bg-red-50/30'} relative group transition-all`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm line-clamp-1">
                        {share.title || 'Link Publik'}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${share.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {share.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(share.created_at).toLocaleDateString('id-ID')}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {isAdmin && !share.is_active && (
                        <button 
                          onClick={() => handleReactivate(share.id)}
                          className="p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600 rounded-lg transition-colors"
                          title="Aktifkan Link"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      {isAdmin && share.is_active && (
                        <button 
                          onClick={() => handleDeactivate(share.id)}
                          className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
                          title="Nonaktifkan Link"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {share.is_active && (
                    <div className="flex gap-2 mt-2">
                      <button 
                        onClick={() => {
                          const url = `${window.location.origin}/p/${share.token}`;
                          window.open(url, '_blank');
                        }}
                        className="flex-1 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" /> Buka
                      </button>
                      <button 
                        onClick={() => {
                          const url = `${window.location.origin}/p/${share.token}`;
                          copyToClipboard(url);
                        }}
                        className="py-2 px-3 bg-primary-50 hover:bg-primary-100 border border-primary-100 rounded-lg text-primary-700 transition-colors"
                        title="Copy Link"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      {isAdmin && (
                        <button 
                          onClick={() => handleOpenAnalytics(share.id)}
                          className="py-2 px-3 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg text-purple-700 transition-colors"
                          title="Lihat Analitik"
                        >
                          <BarChart2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Analytics Modal */}
      {analyticsShareId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <BarChart2 className="w-6 h-6 text-purple-500" />
                Analitik Tautan Publik
              </h2>
              <button 
                onClick={() => setAnalyticsShareId(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="p-6">
              {loadingAnalytics ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                </div>
              ) : analyticsData ? (
                <div className="space-y-6">
                  {/* Total Scan Summary */}
                  <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5 flex items-center justify-between">
                    <div>
                      <p className="text-purple-600 font-semibold text-sm">Total Pindaian QR / Kunjungan</p>
                      <h3 className="text-4xl font-bold text-purple-900 mt-1">{analyticsData.total_scans}</h3>
                    </div>
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm border border-purple-100">
                      <BarChart2 className="w-8 h-8 text-purple-500" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Daily Trend */}
                    <div className="border border-gray-200 rounded-2xl p-5">
                      <h4 className="font-bold text-gray-900 mb-4 text-sm">Tren 30 Hari Terakhir</h4>
                      {analyticsData.daily_trend.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-4">Belum ada data pindaian.</p>
                      ) : (
                        <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                          {analyticsData.daily_trend.map((trend: { date: string; count: number }, idx: number) => (
                            <div key={idx} className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">{new Date(trend.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                              <div className="flex items-center gap-2">
                                <div className="h-2 bg-purple-200 rounded-full w-24 overflow-hidden flex justify-end">
                                  <div 
                                    className="h-full bg-purple-500 rounded-full" 
                                    style={{ width: `${Math.min(100, (trend.count / analyticsData.total_scans) * 100)}%` }}
                                  />
                                </div>
                                <span className="text-sm font-bold text-gray-900 w-8 text-right">{trend.count}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Recent Scans */}
                    <div className="border border-gray-200 rounded-2xl p-5">
                      <h4 className="font-bold text-gray-900 mb-4 text-sm">10 Pindaian Terakhir</h4>
                      {analyticsData.recent_scans.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-4">Belum ada data pindaian.</p>
                      ) : (
                        <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                          {analyticsData.recent_scans.map((scan: { ip_address: string; scanned_at: string; user_agent: string }, idx: number) => (
                            <div key={idx} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                              <div className="flex justify-between items-start mb-1">
                                <span className="text-xs font-semibold text-gray-900">{scan.ip_address || 'IP Unknown'}</span>
                                <span className="text-[10px] text-gray-500">
                                  {new Date(scan.scanned_at).toLocaleString('id-ID', {
                                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                                  })}
                                </span>
                              </div>
                              <p className="text-[10px] text-gray-500 line-clamp-1" title={scan.user_agent}>
                                {scan.user_agent || 'Unknown Device'}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      </div>
    </motion.div>
  );
}
