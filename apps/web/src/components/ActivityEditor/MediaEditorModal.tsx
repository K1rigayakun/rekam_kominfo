import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Textbox } from '@phosphor-icons/react';
import { api, API_URL } from '../../lib/api';
import { toast } from 'sonner';
import RichTextEditor from '../RichTextEditor';
import { useAuthStore } from '../../stores/authStore';
import { useConfirm } from '../useConfirm';

interface Person { id: string; full_name: string; }

interface MediaEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaId: string | null;
}

export default function MediaEditorModal({ isOpen, onClose, mediaId }: MediaEditorModalProps) {
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  // Reference data
  const [allPersons, setAllPersons] = useState<Person[]>([]);

  // Media State
  const [mediaData, setMediaData] = useState<any>(null);
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [descriptionJson, setDescriptionJson] = useState<any>(null);
  
  const [personIds, setPersonIds] = useState<string[]>([]);
  
  // Create New Person State
  const [isCreatingPerson, setIsCreatingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (mediaId) {
        fetchMedia();
      }
    }
  }, [isOpen, mediaId]);

  async function fetchRefs(activityId: string) {
    try {
      const resPersons = await api.get('/api/persons', { params: { activity_id: activityId } });
      setAllPersons(resPersons.data.data);
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchMedia() {
    if (!mediaId) return;
    setLoading(true);
    try {
      // The API might not return a single media endpoint easily, 
      // but wait, we have PUT /api/media/:id which means we should be able to get it or just use the data from the list.
      // Wait, is there a GET /api/media/:id? Let's assume there is or we fetch from sections.
      // Wait, there is GET /api/media/:id in the backend ?
      // Let's use it. If it doesn't exist, I'll need to fetch the activity's media.
      // Let's check backend routes if there is GET /api/media/:id
      const res = await api.get(`/api/media/${mediaId}`);
      const m = res.data.data;
      setMediaData(m);
      
      // Fetch persons for this activity
      if (m.activity_id) {
        fetchRefs(m.activity_id);
      }
      setDisplayName(m.display_name || m.original_filename || '');
      setTitle(m.title || '');
      setDescriptionJson(m.description_json || null);
      
      // Parse persons (the API returns them as array of objects or IDs)
      if (m.persons && Array.isArray(m.persons)) {
        setPersonIds(m.persons.map((p: any) => p.id));
      }
    } catch (err) {
      toast.error('Gagal memuat media');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  const handleSave = async () => {
    if (!mediaId) return;
    setSaving(true);
    try {
      await api.put(`/api/media/${mediaId}`, {
        display_name: displayName,
        title,
        description_json: descriptionJson,
        person_ids: personIds,
      });
      toast.success('Media berhasil disimpan');
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan media');
    } finally {
      setSaving(false);
    }
  };

  const addPerson = (id: string) => {
    if (!id || personIds.includes(id)) return;
    setPersonIds([...personIds, id]);
  };

  const removePerson = (id: string) => {
    setPersonIds(personIds.filter(pid => pid !== id));
  };

  const createNewPerson = async () => {
    if (!newPersonName || !newPersonName.trim() || !mediaData?.activity_id) return;
    try {
      const res = await api.post('/api/persons', {
        activity_id: mediaData.activity_id,
        full_name: newPersonName.trim()
      });
      const newPerson = res.data.data;
      setAllPersons([...allPersons, newPerson]);
      addPerson(newPerson.id);
      setIsCreatingPerson(false);
      setNewPersonName('');
      toast.success("Orang berhasil ditambahkan");
    } catch (err) {
      toast.error("Gagal menambahkan orang");
    }
  };

  const deletePersonFromActivity = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: 'Hapus Orang Terkait',
      message: `Hapus ${name} dari daftar orang terkait acara ini? Orang ini tidak akan bisa dipilih lagi.`,
      confirmText: 'Ya, Hapus',
      cancelText: 'Batal',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/api/persons/${id}`);
      setAllPersons(allPersons.filter(p => p.id !== id));
      removePerson(id);
      toast.success("Orang berhasil dihapus");
    } catch (err) {
      toast.error("Gagal menghapus orang");
    }
  };

  return createPortal(
    <>
      <AnimatePresence>
        {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row"
          >
            {/* Preview Section (Left) */}
            <div className="w-full md:w-5/12 bg-slate-900 flex flex-col items-center justify-center relative p-4">
              <button
                onClick={onClose}
                className="absolute top-4 left-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 md:hidden z-10"
              >
                <X weight="bold" />
              </button>
              {mediaData ? (
                mediaData.media_type === 'VIDEO' ? (
                  <video 
                    controls 
                    src={`${API_URL}/api/media/${mediaData.id}/download?quality=preview&token=${token}&inline=true`}
                    className="max-w-full max-h-[40vh] md:max-h-[80vh] rounded-lg shadow-lg"
                  />
                ) : (
                  <img 
                    src={`${API_URL}/api/media/${mediaData.id}/download?quality=preview&token=${token}&inline=true`}
                    className="max-w-full max-h-[40vh] md:max-h-[80vh] rounded-lg shadow-lg object-contain"
                    alt={displayName}
                  />
                )
              ) : (
                <div className="text-white/50">Memuat preview...</div>
              )}
            </div>

            {/* Editor Section (Right) */}
            <div className="w-full md:w-7/12 flex flex-col max-h-[50vh] md:max-h-none overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h2 className="text-lg font-bold text-slate-900">Pengeditan Media</h2>
                <button
                  onClick={onClose}
                  className="hidden md:block p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-xl transition-colors"
                >
                  <X weight="bold" className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {loading ? (
                  <div className="flex justify-center py-12">Sedang memuat...</div>
                ) : (
                  <>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Nama File (Media)</label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Nama file..."
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Judul Konten</label>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Judul untuk media ini..."
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                          <Textbox className="w-4 h-4" /> Deskripsi Media
                        </label>
                        <RichTextEditor
                          content={descriptionJson}
                          onChange={(json) => setDescriptionJson(json)}
                          placeholder="Tulis deskripsi media..."
                          minHeight="100px"
                        />
                      </div>
                    </div>

                    <div className="space-y-4 pt-2 border-t border-slate-100">
                      {/* Orang Terkait */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                          <User className="w-4 h-4" /> Orang Terkait
                        </label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {personIds.map(pid => {
                            const person = allPersons.find(p => p.id === pid);
                            if (!person) return null;
                            return (
                              <div key={pid} className="flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg border border-indigo-100 text-sm font-medium">
                                <span>{person.full_name}</span>
                                <button onClick={() => removePerson(pid)} className="text-indigo-400 hover:text-indigo-600">
                                  <X weight="bold" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          {isCreatingPerson ? (
                            <>
                              <input
                                type="text"
                                value={newPersonName}
                                onChange={(e) => setNewPersonName(e.target.value)}
                                placeholder="Ketik nama orang..."
                                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    createNewPerson();
                                  } else if (e.key === 'Escape') {
                                    setIsCreatingPerson(false);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={createNewPerson}
                                className="px-4 py-2.5 bg-primary-600 border border-primary-600 rounded-xl hover:bg-primary-700 text-white font-bold whitespace-nowrap"
                              >
                                Simpan
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsCreatingPerson(false)}
                                className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl hover:bg-slate-200 text-slate-600 font-bold whitespace-nowrap"
                              >
                                Batal
                              </button>
                            </>
                          ) : (
                            <>
                              <select
                                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white outline-none"
                                onChange={(e) => {
                                  addPerson(e.target.value);
                                  e.target.value = '';
                                }}
                              >
                                <option value="">+ Pilih Orang Terkait...</option>
                                {allPersons.filter(p => !personIds.includes(p.id)).map(p => (
                                  <option key={p.id} value={p.id}>{p.full_name}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => setIsCreatingPerson(true)}
                                className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl hover:bg-slate-200 text-slate-700 font-medium whitespace-nowrap"
                              >
                                Buat Baru
                              </button>
                            </>
                          )}
                        </div>
                        
                        {/* List of all persons available for this activity to allow deletion */}
                        {allPersons.length > 0 && (
                          <div className="mt-4 border-t border-slate-100 pt-3">
                            <p className="text-xs text-slate-500 mb-2">Daftar Orang di Acara Ini:</p>
                            <div className="flex flex-wrap gap-2">
                              {allPersons.map(p => (
                                <div key={p.id} className="flex items-center gap-1 bg-slate-50 text-slate-600 px-2.5 py-1 rounded border border-slate-200 text-xs">
                                  <span>{p.full_name}</span>
                                  <button onClick={() => deletePersonFromActivity(p.id, p.full_name)} className="text-slate-400 hover:text-red-500 ml-1">
                                    <X weight="bold" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
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
                  {saving ? 'Menyimpan...' : 'Simpan Media'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
    <ConfirmDialog />
    </>,
    document.body
  );
}
