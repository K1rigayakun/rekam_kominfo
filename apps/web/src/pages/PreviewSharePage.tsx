import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Download, AlertCircle, Loader2, Image as ImageIcon, Film, Calendar, MapPin, Grid, Layers } from 'lucide-react';

export default function PreviewSharePage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('previewShareData');
    if (raw) {
      try {
        setData(JSON.parse(raw));
      } catch (e) {
        console.error('Failed to parse preview data');
      }
    }
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    );
  }

  const pageTitle = data.title || data.activity_title;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-screen bg-gray-50 pb-20"
    >
      {/* Banner Peringatan Preview */}
      <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 text-center sticky top-0 z-50">
        <p className="text-yellow-800 text-sm font-medium flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Ini adalah pratinjau. Link belum dibuat dan halaman ini hanya simulasi tampilan publik.
        </p>
      </div>

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100 h-16 flex items-center px-4 lg:px-8 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-white shadow-sm flex items-center justify-center">
            <img src="/icon.png" alt="Rekam" className="w-full h-full object-cover" />
          </div>
          <img src="/logo.png" alt="REKAM" className="h-8 w-auto object-contain" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-8">
        <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100 mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">{pageTitle}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            {data.event_date && (
              <span className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                <Calendar className="w-4 h-4 text-primary-500" />
                {new Date(data.event_date).toLocaleDateString('id-ID', { dateStyle: 'long' })}
              </span>
            )}
            {data.location && (
              <span className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                <MapPin className="w-4 h-4 text-primary-500" />
                {data.location}
              </span>
            )}
          </div>

          {data.config?.description_mode === 'CUSTOM' && data.config?.custom_description && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{data.config.custom_description}</p>
            </div>
          )}

          {data.config?.share_attachments && data.attachments?.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-3 text-sm">Lampiran:</h3>
              <div className="flex flex-wrap gap-3">
                {data.attachments.map((att: any) => (
                  <div 
                    key={att.id}
                    className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-700 opacity-70 cursor-not-allowed"
                    title="Pratinjau tidak dapat mengunduh lampiran"
                  >
                    <Download className="w-4 h-4 text-primary-500" />
                    <span className="truncate max-w-[200px]">{att.display_name || att.original_filename}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-8">
          {data.sections?.map((section: any, idx: number) => (
            <div key={section.id || idx} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              {section.title && (
                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-gray-400" />
                  {section.title}
                </h2>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {section.media?.map((media: any) => (
                  <div key={media.id} className="group relative bg-gray-100 aspect-square rounded-2xl overflow-hidden border border-gray-200 hover:shadow-lg premium-transition">
                    <div className="flex items-center justify-center h-full">
                      {media.media_type === 'IMAGE' ? (
                        <ImageIcon className="w-10 h-10 text-gray-300" />
                      ) : (
                        <Film className="w-10 h-10 text-gray-300" />
                      )}
                    </div>
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4">
                      <p className="text-white text-xs text-center font-medium mb-4 line-clamp-2">
                        {media.display_name}
                      </p>
                    </div>
                  </div>
                ))}
                
                {(!section.media || section.media.length === 0) && (
                  <div className="col-span-full py-8 text-center text-gray-500 text-sm">
                    Tidak ada media di seksi ini.
                  </div>
                )}
              </div>
            </div>
          ))}

          {(!data.sections || data.sections.length === 0) && (
            <div className="bg-white rounded-3xl p-12 text-center shadow-sm border border-gray-100">
              <Grid className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Tidak ada media yang dipilih untuk dibagikan.</p>
            </div>
          )}
        </div>
      </main>
    </motion.div>
  );
}
