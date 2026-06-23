import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Textbox, UploadSimple, Image as ImageIcon } from '@phosphor-icons/react';
import { api, API_URL } from '../../lib/api';
import { toast } from 'sonner';
import RichTextEditor from '../RichTextEditor';
import { useAuthStore } from '../../stores/authStore';
import MediaEditorModal from './MediaEditorModal';

interface SectionEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activityId: string;
  sectionId?: string | null;
  onSaved: () => void;
}

export default function SectionEditorModal({ isOpen, onClose, activityId, sectionId, onSaved }: SectionEditorModalProps) {
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Section State
  const [title, setTitle] = useState('');
  const [descriptionJson, setDescriptionJson] = useState<any>(null);
  const [mediaList, setMediaList] = useState<any[]>([]);

  // Internal ID for newly created sections before "Simpan" if needed
  // Actually, since we need to upload media, we MUST save the Section to the DB first.
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(sectionId || null);

  // Media Editor State
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (sectionId) {
        setCurrentSectionId(sectionId);
        fetchSection(sectionId);
        fetchMedia(sectionId);
      } else {
        // Reset state for new section
        setCurrentSectionId(null);
        setTitle('Judul Baru');
        setDescriptionJson(null);
        setMediaList([]);
        // Auto-create section so we can upload media immediately
        createDraftSection();
      }
    }
  }, [isOpen, sectionId]);

  async function createDraftSection() {
    try {
      const res = await api.post(`/api/activities/${activityId}/sections`, {
        title: 'Judul Baru',
      });
      setCurrentSectionId(res.data.data.id);
    } catch (err) {
      toast.error('Gagal membuat draft judul');
    }
  }

  async function fetchSection(id: string) {
    setLoading(true);
    try {
      const res = await api.get(`/api/activities/${activityId}/sections`);
      const sec = res.data.data.find((s: any) => s.id === id);
      if (sec) {
        setTitle(sec.title || '');
        setDescriptionJson(sec.description_json || null);
      } else {
        toast.error('Judul tidak ditemukan');
        onClose();
      }
    } catch (err) {
      toast.error('Gagal memuat judul');
    } finally {
      setLoading(false);
    }
  }

  async function fetchMedia(id: string) {
    try {
      const res = await api.get(`/api/media`, {
        params: { activity_id: activityId, section_id: id }
      });
      setMediaList(res.data.data || []);
    } catch (err) {
      console.error(err);
    }
  }

  const handleSave = async () => {
    if (!currentSectionId) return;
    setSaving(true);
    try {
      await api.put(`/api/activities/${activityId}/sections/${currentSectionId}`, {
        title,
        description_json: descriptionJson,
      });
      toast.success('Judul berhasil disimpan');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan judul');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !currentSectionId) return;
    const files = Array.from(e.target.files);
    
    // Add temporary visual placeholders if we wanted to
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('activity_id', activityId);
        if (currentSectionId) {
          formData.append('section_id', currentSectionId);
        }
        formData.append('file', file);
        
        await api.post('/api/media/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success(`Berhasil mengunggah ${file.name}`);
      } catch (err) {
        toast.error(`Gagal mengunggah ${file.name}`);
      }
    }
    
    // Refresh media list
    fetchMedia(currentSectionId);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return createPortal(
    <>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={handleSave} // Save on backdrop click to mimic "going back"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-3xl max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h2 className="text-lg font-bold text-slate-900">
                  Pengeditan Judul
                </h2>
                <button
                  onClick={handleSave}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-xl transition-colors"
                >
                  <X weight="bold" className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {loading ? (
                  <div className="flex justify-center py-12">Sedang memuat...</div>
                ) : (
                  <>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Nama Judul</label>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Judul seksi..."
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all font-bold text-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                          <Textbox className="w-4 h-4" /> Deskripsi Judul
                        </label>
                        <RichTextEditor
                          content={descriptionJson}
                          onChange={(json) => setDescriptionJson(json)}
                          placeholder="Tulis deskripsi untuk judul ini..."
                          minHeight="100px"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <h3 className="font-bold text-slate-800">Media</h3>
                        <div>
                          <input 
                            type="file" 
                            multiple 
                            accept="image/*,video/*" 
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                          />
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="text-sm font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
                          >
                            <UploadSimple weight="bold" /> Tambah Media
                          </button>
                        </div>
                      </div>

                      {mediaList.length === 0 ? (
                        <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100 border-dashed">
                          <p className="text-slate-500 text-sm">Belum ada media di judul ini.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                          {mediaList.map(media => (
                            <div 
                              key={media.id} 
                              onClick={() => setEditingMediaId(media.id)}
                              className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200 cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all"
                            >
                              {media.status === 'READY' || media.status === 'PROCESSING' ? (
                                <img 
                                  src={`${API_URL}/api/media/${media.id}/download?quality=preview&token=${token}&inline=true`}
                                  className="w-full h-full object-cover"
                                  alt={media.display_name}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon className="w-8 h-8 text-slate-400" />
                                </div>
                              )}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                                <p className="text-white text-xs font-medium truncate">{media.display_name || media.original_filename}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-sm shadow-primary-600/20 transition-all disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Judul'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <MediaEditorModal 
        isOpen={!!editingMediaId}
        onClose={() => {
          setEditingMediaId(null);
          if (currentSectionId) fetchMedia(currentSectionId);
        }}
        mediaId={editingMediaId}
      />
    </>,
    document.body
  );
}
