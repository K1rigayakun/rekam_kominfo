import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, MapPin, CalendarBlank, Users, Tag as TagIcon, Textbox } from '@phosphor-icons/react';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import RichTextEditor from '../RichTextEditor';
import SectionEditorModal from './SectionEditorModal';
import { useConfirm } from '../useConfirm';

interface Team { id: string; name: string; }
interface Tag { id: string; name: string; }

interface MasterActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  activityId: string | null;
  onSaved: () => void;
  isNewDraft?: boolean;
}

export default function MasterActivityModal({ isOpen, onClose, activityId, onSaved, isNewDraft = false }: MasterActivityModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();

  // Section Modal State
  const [isSectionModalOpen, setIsSectionModalOpen] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

  // Activity State
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [location, setLocation] = useState('');
  const [teamId, setTeamId] = useState('');
  const [tagId, setTagId] = useState('');
  const [descriptionJson, setDescriptionJson] = useState<any>(null);

  // Reference Data
  const [teams, setTeams] = useState<Team[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  
  // Sections Data
  const [sections, setSections] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchRefs();
      if (activityId) fetchActivity();
    }
  }, [isOpen, activityId]);

  async function fetchRefs() {
    try {
      const [resTeams, resTags] = await Promise.all([
        api.get('/api/teams'),
        api.get('/api/tags')
      ]);
      setTeams(resTeams.data.data);
      setTags(resTags.data.data);
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchActivity() {
    if (!activityId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/activities/${activityId}`);
      const act = res.data.data;
      setTitle(act.title || '');
      if (act.event_date) setEventDate(new Date(act.event_date).toISOString().split('T')[0]);
      setLocation(act.location || '');
      setTeamId(act.team_id || '');
      setTagId(act.tag_id || '');
      setDescriptionJson(act.description_json || null);

      // Fetch Sections
      const resSec = await api.get(`/api/activities/${activityId}/sections`);
      setSections(resSec.data.data || []);
    } catch (err) {
      toast.error('Gagal memuat detail acara');
    } finally {
      setLoading(false);
    }
  }

  const handleSave = async () => {
    if (!activityId) return;
    setSaving(true);
    try {
      await api.put(`/api/activities/${activityId}`, {
        title,
        event_date: eventDate,
        location,
        team_id: teamId || null,
        tag_id: tagId || null,
        description_json: descriptionJson,
      });
      toast.success('Acara berhasil disimpan');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan acara');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (isNewDraft && activityId) {
      if (sections.length > 0) {
        const confirmed = await confirm({
          title: 'Batalkan Pembuatan Acara?',
          message: 'Anda sudah menambahkan konten ke acara ini. Yakin ingin membatalkan dan menghapusnya?',
          confirmText: 'Ya, Hapus',
          cancelText: 'Kembali',
        });
        if (!confirmed) return;
      }
      try {
        await api.delete(`/api/activities/${activityId}`);
        toast.info('Acara draft dibatalkan');
      } catch (err) {
        console.error('Gagal menghapus draft', err);
      }
    }
    onClose();
  };

  return createPortal(
    <>
      <AnimatePresence>
        {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancel}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">
                {activityId ? 'Edit Acara' : 'Buat Acara Baru'}
              </h2>
              <button
                onClick={handleCancel}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-xl transition-colors"
              >
                <X weight="bold" className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {loading ? (
                <div className="flex justify-center py-12">Sedang memuat...</div>
              ) : (
                <>
                  {/* Basic Info */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">Nama Acara</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Contoh: Rapat Koordinasi Nasional"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                          <TagIcon className="w-4 h-4" /> Tag Acara
                        </label>
                        <select
                          value={tagId}
                          onChange={(e) => setTagId(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white outline-none"
                        >
                          <option value="">Pilih Tag...</option>
                          {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                          <Users className="w-4 h-4" /> Tim Terkait
                        </label>
                        <select
                          value={teamId}
                          onChange={(e) => setTeamId(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white outline-none"
                        >
                          <option value="">Pilih Tim...</option>
                          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                          <CalendarBlank className="w-4 h-4" /> Tanggal Acara
                        </label>
                        <input
                          type="date"
                          value={eventDate}
                          onChange={(e) => setEventDate(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                          <MapPin className="w-4 h-4" /> Lokasi
                        </label>
                        <input
                          type="text"
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          placeholder="Nama tempat / kota"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                        <Textbox className="w-4 h-4" /> Deskripsi Acara
                      </label>
                      <RichTextEditor
                        content={descriptionJson}
                        onChange={(json) => setDescriptionJson(json)}
                        placeholder="Tulis deskripsi acara..."
                      />
                    </div>
                  </div>

                  {/* Sections (Judul) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <h3 className="text-lg font-bold text-slate-800">Judul & Media</h3>
                      <button 
                        onClick={() => {
                          setEditingSectionId(null);
                          setIsSectionModalOpen(true);
                        }}
                        className="text-sm font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
                      >
                        <Plus weight="bold" /> Tambah Judul
                      </button>
                    </div>

                    {sections.length === 0 ? (
                      <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100 border-dashed">
                        <p className="text-slate-500 text-sm">Belum ada judul / seksi yang ditambahkan.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {sections.map(sec => (
                          <div 
                            key={sec.id} 
                            onClick={() => {
                              setEditingSectionId(sec.id);
                              setIsSectionModalOpen(true);
                            }}
                            className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm cursor-pointer hover:border-primary-300 transition-colors"
                          >
                            <h4 className="font-bold text-slate-800">{sec.title}</h4>
                            <p className="text-sm text-slate-500">{sec.media_count || 0} media</p>
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
                onClick={handleCancel}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-xl transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-sm shadow-primary-600/20 transition-all disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {activityId && (
      <SectionEditorModal
        isOpen={isSectionModalOpen}
        onClose={() => {
          setIsSectionModalOpen(false);
          setEditingSectionId(null);
        }}
        activityId={activityId}
        sectionId={editingSectionId}
        onSaved={fetchActivity}
      />
    )}
    
    <ConfirmDialog />
    </>,
    document.body
  );
}
