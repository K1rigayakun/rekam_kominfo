import { useState, useEffect, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Download, WarningCircle, SpinnerGap, Image as ImageIcon, UploadSimple,
  FilmStrip, CalendarBlank, MapPin, SquaresFour, Stack, Paperclip, MagnifyingGlass, X
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, API_URL } from '../lib/api';
import RichTextViewer from '../components/RichTextViewer';
import Lightbox from '../components/Lightbox';

interface MediaItem {
  id: string;
  display_name: string;
  original_filename?: string;
  title?: string;
  description?: string;
  description_json?: any;
  media_type: 'IMAGE' | 'VIDEO';
  width: number;
  height: number;
  duration_seconds?: number;
  quality_variants?: Record<string, string>;
  persons?: { id: string; full_name: string }[];
}

interface SectionData {
  id: string;
  title: string;
  description_json?: any;
  media: MediaItem[];
}

interface PublicInfo {
  id: string;
  title: string;
  download_quality: 'PREVIEW' | 'ORIGINAL' | 'BOTH';
  activity_title: string;
  activity_description_json?: any;
  event_date: string;
  location: string;
  config?: {
    share_attachments?: boolean;
    allow_upload?: boolean;
    description_mode?: 'NONE' | 'AUTO' | 'CUSTOM';
    custom_description?: string;
  };
}

export default function PublicViewerPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [sections, setSections] = useState<SectionData[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPersonId, setFilterPersonId] = useState('');
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());

  const allMedia = sections.flatMap(s => s.media);
  
  const allPersons = Array.from(new Map(
    allMedia.flatMap(m => m.persons || []).map(p => [p.id, p])
  ).values());

  async function fetchData() {
    try {
      setLoading(true);
      setError('');
      
      const infoRes = await api.get(`/p/${token}/info`);
      setInfo(infoRes.data.data);

      const mediaRes = await api.get(`/p/${token}/media`);
      
      if (mediaRes.data.data.config) {
        setInfo((prev) => prev ? { ...prev, config: mediaRes.data.data.config } : prev);
      }
      
      setSections(mediaRes.data.data.sections);

      try {
        const attachRes = await api.get(`/p/${token}/attachments`);
        setAttachments(attachRes.data.data || []);
      } catch {
        console.warn('Attachments not available or not shared');
      }

    } catch (err: any) {
      if (err.response?.status === 404 || err.response?.status === 410) {
        setError(err.response.data.error || 'Tautan ini tidak lagi tersedia.');
      } else {
        setError('Terjadi kesalahan saat memuat halaman.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const downloadBlobResponse = (blob: Blob, fallbackFilename: string, disposition?: string) => {
    const filenameMatch = /filename="([^"]+)"/.exec(disposition || '');
    const filename = filenameMatch?.[1] || fallbackFilename;
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  };

  const handleDownload = async (mediaId: string, quality: string) => {
    try {
      const res = await api.get(`/p/${token}/download/${mediaId}?quality=${quality}`, { responseType: 'blob' });
      downloadBlobResponse(res.data, `REKAM_media_${mediaId}`, res.headers['content-disposition']);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mengunduh media');
    }
  };

  const handleAttachmentDownload = async (attachmentId: string) => {
    try {
      const res = await api.get(`/p/${token}/attachments/${attachmentId}/download`, { responseType: 'blob' });
      downloadBlobResponse(res.data, `REKAM_lampiran_${attachmentId}`, res.headers['content-disposition']);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mengunduh lampiran');
    }
  };

  const handlePublicUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    const toastId = toast.loading(`Mengupload ${files.length} file...`);
    let successCount = 0;
    let failedCount = 0;

    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        await api.post(`/p/${token}/upload`, formData);
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    event.target.value = '';
    setUploading(false);

    if (successCount > 0 && failedCount === 0) {
      toast.success('Upload berhasil dikirim dan sedang diproses.', { id: toastId });
    } else if (successCount > 0) {
      toast.warning(`${successCount} file terkirim, ${failedCount} file gagal.`, { id: toastId });
    } else {
      toast.error('Upload gagal. Periksa ukuran dan format file.', { id: toastId });
    }
  };

  const downloadPublicExportJob = async (jobId: string) => {
    const res = await api.get(`/p/${token}/export-jobs/${jobId}/download`, { responseType: 'blob' });
    downloadBlobResponse(res.data, `REKAM_export_${jobId}.zip`, res.headers['content-disposition']);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-zinc-50 flex items-center justify-center">
        <SpinnerGap weight="bold" className="w-10 h-10 text-zinc-900 animate-spin" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-[100dvh] bg-zinc-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-10 rounded-[2.5rem] shadow-xl max-w-md w-full text-center border border-zinc-200"
        >
          <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <WarningCircle weight="duotone" className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-3 tracking-tight">Tautan Tidak Tersedia</h1>
          <p className="text-zinc-500 text-sm mb-8 leading-relaxed">
            {error}
          </p>
          <button 
            onClick={() => navigate('/')}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white rounded-2xl py-4 font-semibold hover:-translate-y-0.5 transition-all duration-300"
          >
            Ke Beranda REKAM
          </button>
        </motion.div>
      </div>
    );
  }

  const handleDownloadBatch = async (quality: string = 'original') => {
    if (exportJobId || selectedMediaIds.size === 0) return;

    try {
      const toastId = toast.loading('Memproses kompresi ZIP batch, mohon tunggu...');
      const res = await api.post(`/p/${token}/download-batch/zip`, {
        quality,
        media_ids: Array.from(selectedMediaIds)
      });
      const jobId = res.data.job_id;
      setExportJobId(jobId);

      const poll = setInterval(async () => {
        try {
          const statusRes = await api.get(`/p/${token}/export-jobs/${jobId}`);
          if (statusRes.data.status === 'COMPLETED') {
            clearInterval(poll);
            setExportJobId(null);
            toast.success('ZIP batch siap diunduh!', { id: toastId });
            await downloadPublicExportJob(jobId);
            setSelectedMediaIds(new Set());
          } else if (statusRes.data.status === 'FAILED') {
            clearInterval(poll);
            setExportJobId(null);
            toast.error(`Gagal membuat ZIP batch: ${statusRes.data.error_message}`, { id: toastId });
          }
        } catch {
          clearInterval(poll);
          setExportJobId(null);
          toast.error('Terjadi kesalahan saat memproses ZIP batch', { id: toastId });
        }
      }, 3000);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memulai kompresi ZIP batch');
    }
  };

  const handleDownloadAll = async (quality: string = 'original') => {
    if (exportJobId) return; // Prevent multiple clicks

    try {
      const toastId = toast.loading('Memproses kompresi ZIP, mohon tunggu...');
      const res = await api.get(`/p/${token}/download-all/zip?quality=${quality}`);
      const jobId = res.data.job_id;
      setExportJobId(jobId);

      const poll = setInterval(async () => {
        try {
          const statusRes = await api.get(`/p/${token}/export-jobs/${jobId}`);
          if (statusRes.data.status === 'COMPLETED') {
            clearInterval(poll);
            setExportJobId(null);
            toast.success('ZIP siap diunduh!', { id: toastId });
            await downloadPublicExportJob(jobId);
          } else if (statusRes.data.status === 'FAILED') {
            clearInterval(poll);
            setExportJobId(null);
            toast.error(`Gagal membuat ZIP: ${statusRes.data.error_message}`, { id: toastId });
          }
        } catch {
          clearInterval(poll);
          setExportJobId(null);
          toast.error('Terjadi kesalahan saat memproses ZIP', { id: toastId });
        }
      }, 3000);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memulai ekspor ZIP');
    }
  };

  const pageTitle = info.title || info.activity_title;

  return (
    <div className="min-h-[100dvh] bg-zinc-50 pb-24">
      {/* Liquid Glass Header */}
      <header className="fixed top-0 inset-x-0 z-50 liquid-glass border-b border-white/20">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className="w-10 h-10 rounded-[14px] overflow-hidden shadow-md bg-white flex items-center justify-center">
              <img src="/icon.png" alt="Rekam" className="w-full h-full object-cover" />
            </div>
            <img src="/logo.png" alt="REKAM" className="h-14 w-auto object-contain -ml-2 hidden sm:block" />
          </div>
          
          <div className="flex items-center gap-3">
            {info.download_quality === 'PREVIEW' || info.download_quality === 'BOTH' ? (
              <button 
                onClick={() => handleDownloadAll('preview')}
                className="bg-white/80 hover:bg-white text-zinc-900 px-4 py-2 rounded-xl text-sm font-semibold premium-transition flex items-center gap-2 border border-zinc-200/50 shadow-sm"
              >
                <Download weight="bold" className="w-4 h-4" /> 
                <span className="hidden sm:inline">Download Semua (Preview)</span>
                <span className="sm:hidden">Preview</span>
              </button>
            ) : null}
            {info.download_quality === 'ORIGINAL' || info.download_quality === 'BOTH' ? (
              <button 
                onClick={() => handleDownloadAll('original')}
                className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-semibold premium-transition flex items-center gap-2 shadow-md shadow-primary-600/20"
              >
                <Download weight="bold" className="w-4 h-4" /> 
                <span className="hidden sm:inline">Download Semua (Original)</span>
                <span className="sm:hidden">Original</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-32">
        {/* Banner Info */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
          className="bento-card p-8 md:p-12 mb-12 relative overflow-hidden"
        >
          <div className="relative z-10">
            <h1 className="text-4xl md:text-5xl font-bold text-zinc-900 mb-6 tracking-tighter leading-none max-w-3xl">
              {pageTitle}
            </h1>
            
            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-600 mb-8">
              {info.event_date && (
                <span className="flex items-center gap-2 bg-zinc-100/80 px-4 py-2 rounded-full border border-zinc-200">
                  <CalendarBlank weight="bold" className="w-4 h-4 text-zinc-900" />
                  <span className="font-medium">{new Date(info.event_date).toLocaleDateString('id-ID', { dateStyle: 'long' })}</span>
                </span>
              )}
              {info.location && (
                <span className="flex items-center gap-2 bg-zinc-100/80 px-4 py-2 rounded-full border border-zinc-200">
                  <MapPin weight="bold" className="w-4 h-4 text-zinc-900" />
                  <span className="font-medium truncate max-w-[250px]">{info.location}</span>
                </span>
              )}
            </div>
            
            {info.config?.description_mode === 'CUSTOM' && info.config?.custom_description && (
              <div className="pt-8 border-t border-zinc-100 max-w-3xl">
                <p className="text-zinc-600 leading-relaxed whitespace-pre-wrap text-lg">
                  {info.config.custom_description}
                </p>
              </div>
            )}

            {(!info.config?.description_mode || info.config?.description_mode === 'AUTO') && info.activity_description_json && (
              <div className="pt-8 border-t border-zinc-100 max-w-3xl prose prose-zinc prose-sm">
                <RichTextViewer content={info.activity_description_json} />
              </div>
            )}
            
            {attachments.length > 0 && (
              <div className="mt-8 pt-8 border-t border-zinc-100">
                <h3 className="font-semibold text-zinc-900 mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
                  <Paperclip className="w-4 h-4" /> Lampiran
                </h3>
                <div className="flex flex-wrap gap-3">
                  {attachments.map(att => (
                    <button 
                      key={att.id}
                      onClick={() => handleAttachmentDownload(att.id)}
                      className="flex items-center gap-3 bg-white hover:bg-zinc-50 border border-zinc-200 px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-700 premium-transition hover-lift shadow-sm"
                    >
                      <Download weight="bold" className="w-4 h-4 text-zinc-400" />
                      <span className="truncate max-w-[200px]">{att.display_name || (att as any).original_filename}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Abstract geometric decoration */}
          <div className="absolute -right-20 -top-20 w-96 h-96 bg-zinc-50 rounded-full blur-3xl pointer-events-none opacity-50" />
        </motion.div>

        {info.config?.allow_upload && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 bento-card p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
            <div>
              <h2 className="text-base font-bold text-zinc-900">Upload Media</h2>
              <p className="text-sm text-zinc-500 mt-1">Kirim foto atau video untuk acara ini.</p>
            </div>
            <label className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold premium-transition cursor-pointer ${uploading ? 'bg-zinc-200 text-zinc-500 pointer-events-none' : 'bg-primary-600 text-white hover:bg-primary-700 shadow-md shadow-primary-600/20'}`}>
              {uploading ? <SpinnerGap weight="bold" className="w-4 h-4 animate-spin" /> : <UploadSimple weight="bold" className="w-4 h-4" />}
              {uploading ? 'Mengupload...' : 'Pilih File'}
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                disabled={uploading}
                onChange={handlePublicUpload}
                className="sr-only"
              />
            </label>
          </motion.div>
        )}

        {/* Search Bar & Filters */}
        <div className="mb-8 flex flex-col sm:flex-row gap-4 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <MagnifyingGlass className="w-5 h-5 text-zinc-400" />
            </div>
            <input
              type="text"
              placeholder="Pencarian judul atau nama file..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm text-zinc-700"
            />
          </div>
          {allPersons.length > 0 && (
            <select
              value={filterPersonId}
              onChange={(e) => setFilterPersonId(e.target.value)}
              className="px-4 py-3.5 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all shadow-sm text-zinc-700"
            >
              <option value="">Semua Orang Terkait</option>
              {allPersons.map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Media Gallery */}
        <div className="space-y-16">
          {sections.map((section, idx) => {
            const filteredMedia = section.media.filter(m => {
              const matchSearch = m.display_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                  (m.title && m.title.toLowerCase().includes(searchQuery.toLowerCase()));
              const matchPerson = filterPersonId === '' || (m.persons && m.persons.some(p => p.id === filterPersonId));
              return matchSearch && matchPerson;
            });

            if ((searchQuery || filterPersonId) && filteredMedia.length === 0) return null;

            return (
            <motion.div 
              key={section.id || idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5 }}
            >
              {section.title && (
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <Stack weight="duotone" className="w-6 h-6 text-zinc-400" />
                      <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">{section.title}</h2>
                    </div>
                    {section.description_json && (
                      <div className="pl-9 text-zinc-600">
                        <RichTextViewer content={section.description_json} />
                      </div>
                    )}
                  </div>
                  {filteredMedia.length > 0 && (
                    <button 
                      onClick={() => {
                        const newSet = new Set(selectedMediaIds);
                        const allSelected = filteredMedia.every(m => newSet.has(m.id));
                        if (allSelected) {
                          filteredMedia.forEach(m => newSet.delete(m.id));
                        } else {
                          filteredMedia.forEach(m => newSet.add(m.id));
                        }
                        setSelectedMediaIds(newSet);
                      }}
                      className="text-xs font-semibold text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition-colors border border-primary-100 shadow-sm"
                    >
                      {filteredMedia.every(m => selectedMediaIds.has(m.id)) ? 'Batal Pilih Semua' : 'Pilih Semua'}
                    </button>
                  )}
                </div>
              )}
              
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredMedia.map((media, mIdx) => (
                  <motion.div 
                    key={media.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: mIdx * 0.05 }}
                    className="group relative flex flex-col"
                  >
                    {/* Thumbnail Container */}
                    <div className="relative w-full aspect-square bg-zinc-100 rounded-2xl overflow-hidden border border-zinc-200 shadow-sm">
                      <div 
                        className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ opacity: selectedMediaIds.has(media.id) ? 1 : undefined }}
                      >
                        <input 
                          type="checkbox" 
                          checked={selectedMediaIds.has(media.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            const newSet = new Set(selectedMediaIds);
                            if (e.target.checked) newSet.add(media.id);
                            else newSet.delete(media.id);
                            setSelectedMediaIds(newSet);
                          }}
                          onClick={e => e.stopPropagation()}
                          className="w-5 h-5 rounded cursor-pointer border-zinc-300 text-primary-600 focus:ring-primary-500 shadow-sm bg-white"
                        />
                      </div>
                      {/* Real Image */}
                      <img 
                        src={`${API_URL}/p/${token}/download/${media.id}?quality=${media.media_type === 'VIDEO' ? 'thumbnail' : 'preview'}&inline=true`} 
                        alt={media.display_name}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                          // Fallback to placeholder if broken
                          (e.target as HTMLImageElement).style.display = 'none';
                          const nextSibling = (e.target as HTMLElement).nextElementSibling;
                          if (nextSibling) {
                            (nextSibling as HTMLElement).style.display = 'flex';
                          }
                        }}
                      />
                      {/* Placeholder (hidden by default unless error) */}
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 transition-transform duration-500 group-hover:scale-105" style={{ display: 'none' }}>
                        {media.media_type === 'IMAGE' ? (
                          <ImageIcon weight="light" className="w-12 h-12 text-zinc-300" />
                        ) : (
                          <FilmStrip weight="light" className="w-12 h-12 text-zinc-300" />
                        )}
                      </div>

                      {/* Glass Overlay on Hover */}
                      <div 
                        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center p-4 md:p-6 cursor-pointer"
                        onClick={() => {
                          setLightboxIndex(allMedia.findIndex(m => m.id === media.id));
                          setLightboxOpen(true);
                        }}
                      >
                        <p className="text-white text-xs md:text-sm text-center font-medium mb-4 md:mb-6 line-clamp-2 translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                          {media.display_name}
                        </p>
                        <div className="flex flex-col gap-2 translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-75 w-full max-w-[200px] px-4">
                          <select 
                            id={`quality-${media.id}`}
                            onClick={e => e.stopPropagation()}
                            className="bg-black/50 text-white text-xs border border-white/20 rounded-xl px-3 py-2 outline-none backdrop-blur-md focus:bg-zinc-800 w-full"
                            defaultValue={info.download_quality === 'PREVIEW' ? 'preview' : 'original'}
                          >
                            {(info.download_quality === 'PREVIEW' || info.download_quality === 'BOTH') && <option value="preview" className="bg-zinc-800 text-white">Preview</option>}
                            {media.media_type === 'VIDEO' && (info.download_quality === 'PREVIEW' || info.download_quality === 'BOTH') && media.quality_variants && Object.keys(media.quality_variants).map(q => (
                              <option key={q} value={q} className="bg-zinc-800 text-white">{q}</option>
                            ))}
                            {(info.download_quality === 'ORIGINAL' || info.download_quality === 'BOTH') && <option value="original" className="bg-zinc-800 text-white">Original</option>}
                          </select>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const sel = document.getElementById(`quality-${media.id}`) as HTMLSelectElement;
                              handleDownload(media.id, sel?.value || 'original');
                            }}
                            className="bg-white text-zinc-900 hover:bg-zinc-100 px-3 py-2 rounded-xl text-xs font-semibold premium-transition flex items-center justify-center gap-1.5 shadow-xl w-full"
                          >
                            <Download weight="bold" className="w-3.5 h-3.5" /> Download
                          </button>
                        </div>
                      </div>
                    </div>
                      {/* Details below thumbnail */}
                      <div className="mt-3 px-1">
                        <h4 className="font-semibold text-zinc-800 text-sm mb-1 line-clamp-1">
                          {media.title || media.display_name || media.original_filename}
                        </h4>
                        {media.description_json && (
                          <div className="text-xs text-zinc-500 line-clamp-2">
                            <RichTextViewer content={media.description_json} />
                          </div>
                        )}
                      </div>
                  </motion.div>
                ))}
                
                {filteredMedia.length === 0 && (
                  <div className="col-span-full py-16 text-center text-zinc-400 text-sm bg-zinc-50 border border-zinc-200 border-dashed rounded-3xl">
                    Koleksi kosong. Belum ada media di judul ini yang sesuai pencarian.
                  </div>
                )}
              </div>
            </motion.div>
            );
          })}

          {sections.length === 0 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bento-card p-16 text-center"
            >
              <SquaresFour weight="duotone" className="w-16 h-16 text-zinc-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Belum Ada Media</h3>
              <p className="text-zinc-500">Tidak ada media yang dibagikan dalam tautan ini.</p>
            </motion.div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {selectedMediaIds.size > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-zinc-900 text-white px-6 py-4 rounded-2xl shadow-2xl border border-zinc-800"
          >
            <div className="flex flex-col">
              <span className="text-sm font-bold">{selectedMediaIds.size} Terpilih</span>
              <span className="text-xs text-zinc-400">Siap diunduh zip</span>
            </div>
            
            <div className="w-px h-8 bg-zinc-700 mx-2" />

            {(info?.download_quality === 'PREVIEW' || info?.download_quality === 'BOTH') && (
              <button 
                onClick={() => handleDownloadBatch('preview')}
                disabled={!!exportJobId}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Preview
              </button>
            )}

            {(info?.download_quality === 'ORIGINAL' || info?.download_quality === 'BOTH') && (
              <button 
                onClick={() => handleDownloadBatch('original')}
                disabled={!!exportJobId}
                className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 shadow-md shadow-primary-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Original
              </button>
            )}

            <button 
              onClick={() => setSelectedMediaIds(new Set())}
              className="text-zinc-400 hover:text-white p-2 rounded-xl transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Lightbox 
        isOpen={lightboxOpen} 
        onClose={() => setLightboxOpen(false)} 
        mediaList={allMedia} 
        initialIndex={lightboxIndex}
        downloadUrlTemplate={(m) => `${API_URL}/p/${token}/download/${m.id}?quality=original`}
        previewUrlTemplate={(m) => `${API_URL}/p/${token}/download/${m.id}?quality=preview&inline=true`}
      />
    </div>
  );
}
