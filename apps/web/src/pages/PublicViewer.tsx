import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { 
  Download, WarningCircle, SpinnerGap, Image as ImageIcon, 
  FilmStrip, CalendarBlank, MapPin, SquaresFour, Stack, Paperclip, MagnifyingGlass
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import RichTextViewer from '../components/RichTextViewer';

interface MediaItem {
  id: string;
  display_name: string;
  title?: string;
  description?: string;
  description_json?: any;
  media_type: 'IMAGE' | 'VIDEO';
  width: number;
  height: number;
  duration_seconds?: number;
  quality_variants?: Record<string, string>;
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

  async function fetchData() {
    try {
      setLoading(true);
      setError('');
      
      const infoRes = await api.get(`/api/public/${token}/info`);
      setInfo(infoRes.data.data);

      const mediaRes = await api.get(`/api/public/${token}/media`);
      
      if (mediaRes.data.data.config) {
        setInfo((prev) => prev ? { ...prev, config: mediaRes.data.data.config } : prev);
      }
      
      setSections(mediaRes.data.data.sections);

      try {
        const attachRes = await api.get(`/api/public/${token}/attachments`);
        setAttachments(attachRes.data.data || []);
      } catch (e) {
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
  }, [token]);

  const handleDownload = (mediaId: string, quality: 'preview' | 'original') => {
    const url = `${api.defaults.baseURL || ''}/api/public/${token}/download/${mediaId}?quality=${quality}`;
    window.open(url, '_blank');
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

  const handleDownloadAll = (quality: string = 'original') => {
    const url = `${api.defaults.baseURL || ''}/api/public/${token}/download-all/zip?quality=${quality}`;
    window.open(url, '_blank');
  };

  const pageTitle = info.title || info.activity_title;

  return (
    <div className="min-h-[100dvh] bg-zinc-50 pb-24">
      {/* Liquid Glass Header */}
      <header className="fixed top-0 inset-x-0 z-50 liquid-glass border-b border-white/20">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] overflow-hidden shadow-md bg-white flex items-center justify-center">
              <img src="/icon.png" alt="Rekam" className="w-full h-full object-cover" />
            </div>
            <img src="/logo.png" alt="REKAM" className="h-9 w-auto object-contain hidden sm:block" />
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
                      onClick={() => window.open(`${api.defaults.baseURL || ''}/api/public/${token}/attachments/${att.id}/download`, '_blank')}
                      className="flex items-center gap-3 bg-white hover:bg-zinc-50 border border-zinc-200 px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-700 premium-transition hover-lift shadow-sm"
                    >
                      <Download weight="bold" className="w-4 h-4 text-zinc-400" />
                      <span className="truncate max-w-[200px]">{att.display_name || att.original_filename}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Abstract geometric decoration */}
          <div className="absolute -right-20 -top-20 w-96 h-96 bg-zinc-50 rounded-full blur-3xl pointer-events-none opacity-50" />
        </motion.div>

        {/* Search Bar */}
        <div className="mb-8 relative max-w-xl mx-auto">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <MagnifyingGlass className="w-5 h-5 text-zinc-400" />
          </div>
          <input
            type="text"
            placeholder="Cari nama media atau acara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 bg-white border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm text-zinc-700"
          />
        </div>

        {/* Media Gallery */}
        <div className="space-y-16">
          {sections.map((section, idx) => {
            const filteredMedia = section.media.filter(m => 
              m.display_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
              (m.title && m.title.toLowerCase().includes(searchQuery.toLowerCase()))
            );

            if (searchQuery && filteredMedia.length === 0) return null;

            return (
            <motion.div 
              key={section.id || idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5 }}
            >
              {section.title && (
                <div className="mb-6">
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
                      {/* Placeholder */}
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 transition-transform duration-500 group-hover:scale-105">
                        {media.media_type === 'IMAGE' ? (
                          <ImageIcon weight="light" className="w-12 h-12 text-zinc-300" />
                        ) : (
                          <FilmStrip weight="light" className="w-12 h-12 text-zinc-300" />
                        )}
                      </div>

                      {/* Glass Overlay on Hover */}
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center p-4 md:p-6">
                        <p className="text-white text-xs md:text-sm text-center font-medium mb-4 md:mb-6 line-clamp-2 translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                          {media.display_name}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2 translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-75">
                          {(info.download_quality === 'PREVIEW' || info.download_quality === 'BOTH') && media.media_type === 'IMAGE' && (
                            <button 
                              onClick={() => handleDownload(media.id, 'preview')}
                              className="bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/10 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-xs font-semibold premium-transition flex items-center justify-center gap-1.5"
                            >
                              <Download weight="bold" className="w-3.5 h-3.5" /> Preview
                            </button>
                          )}
                          {(info.download_quality === 'ORIGINAL' || info.download_quality === 'BOTH') && (
                            <button 
                              onClick={() => handleDownload(media.id, 'original')}
                              className="bg-white text-zinc-900 hover:bg-zinc-100 px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-xs font-semibold premium-transition flex items-center justify-center gap-1.5 shadow-xl"
                            >
                              <Download weight="bold" className="w-3.5 h-3.5" /> Original
                            </button>
                          )}
                          {media.media_type === 'VIDEO' && (info.download_quality === 'PREVIEW' || info.download_quality === 'BOTH') && media.quality_variants && Object.keys(media.quality_variants).map(quality => (
                            <button 
                              key={quality}
                              onClick={() => handleDownload(media.id, quality as any)}
                              className="bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/10 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-xs font-semibold premium-transition flex items-center justify-center gap-1.5"
                            >
                              <Download weight="bold" className="w-3.5 h-3.5" /> {quality}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* Details below thumbnail */}
                    {(media.title || media.description_json) && (
                      <div className="mt-3 px-1">
                        {media.title && <h4 className="font-semibold text-zinc-800 text-sm mb-1 line-clamp-1">{media.title}</h4>}
                        {media.description_json && (
                          <div className="text-xs text-zinc-500 line-clamp-2">
                            <RichTextViewer content={media.description_json} />
                          </div>
                        )}
                      </div>
                    )}
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
    </div>
  );
}
