import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CalendarBlank, Plus, MagnifyingGlass, Image as ImageIcon, MapPin, 
  CaretLeft, CaretRight, SpinnerGap, X, SquaresFour, List, Archive, Warning, Trash
} from '@phosphor-icons/react';
import DateFilterPopover from '../components/DateFilterPopover';
import { useAuthStore } from '../stores/authStore';
import { useConfirm } from '../components/useConfirm';

interface Team {
  id: string;
  name: string;
}

interface District {
  id: string;
  name: string;
}

interface Activity {
  id: string;
  title: string;
  event_date: string;
  location: string;
  team_name: string;
  district_name?: string | null;
  media_count: number;
  compromised_count: number;
  section_count: number;
  is_archived: boolean;
  created_by_name: string;
  created_at?: string | null;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { confirm, ConfirmDialog } = useConfirm();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterTeamId, setFilterTeamId] = useState('');
  const [filterDistrictId, setFilterDistrictId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newLocation, setNewLocation] = useState('');
  const [newTeamId, setNewTeamId] = useState('');
  const [newDistrictId, setNewDistrictId] = useState(user?.district_id || '');
  const [teams, setTeams] = useState<Team[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [creating, setCreating] = useState(false);

  async function fetchTeams() {
    try {
      const res = await api.get('/api/teams');
      setTeams(res.data.data);
    } catch (err) {
      console.error('Gagal memuat tim:', err);
    }
  }

  async function fetchDistricts() {
    try {
      const res = await api.get('/api/districts');
      setDistricts(res.data.data);
    } catch (err) {
      console.error('Gagal memuat kecamatan:', err);
    }
  }

  async function fetchActivities() {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
      });
      if (search) params.set('search', search);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (filterDay) params.set('filter_day', filterDay);
      if (filterMonth) params.set('filter_month', filterMonth);
      if (filterYear) params.set('filter_year', filterYear);
      if (filterTeamId) params.set('team_id', filterTeamId);
      if (filterDistrictId) params.set('district_id', filterDistrictId);
      if (showArchived) params.set('archived', 'true');
      const res = await api.get(`/api/activities?${params}`);
      setActivities(res.data.data);
      setTotalPages(res.data.pagination.total_pages);
    } catch (err) {
      console.error('Gagal memuat acara:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, [page, search, dateFrom, dateTo, filterDay, filterMonth, filterYear, filterTeamId, filterDistrictId, showArchived]);

  useEffect(() => {
    fetchTeams();
    fetchDistricts();
  }, []);

  useEffect(() => {
    if (!newDistrictId && user?.district_id) {
      setNewDistrictId(user.district_id);
    }
  }, [newDistrictId, user?.district_id]);

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post('/api/activities', {
        title: newTitle,
        event_date: newDate,
        location: newLocation || undefined,
        team_id: newTeamId || undefined,
        district_id: newDistrictId || undefined,
      });
      setShowCreateModal(false);
      setNewTitle('');
      setNewLocation('');
      setNewTeamId('');
      setNewDistrictId(user?.district_id || '');
      toast.success('Acara berhasil dibuat');
      navigate(`/activity/${res.data.data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal membuat acara');
    } finally {
      setCreating(false);
    }
  };

  // Archive / Unarchive an activity
  const handleArchive = async (actId: string, currentlyArchived: boolean) => {
    if (currentlyArchived) {
      // Unarchive — just PUT
      try {
        await api.put(`/api/activities/${actId}`, { is_archived: false });
        toast.success('Acara berhasil dipulihkan dari arsip');
        fetchActivities();
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Gagal memulihkan acara');
      }
    } else {
      // Archive — confirm first
      const ok = await confirm({
        title: 'Arsipkan Acara',
        message: 'Acara yang diarsipkan tidak akan muncul di daftar utama. Anda dapat memulihkannya nanti lewat filter "Arsip".',
        confirmText: 'Arsipkan',
        isDestructive: true,
      });
      if (!ok) return;
      try {
        await api.put(`/api/activities/${actId}`, { is_archived: true });
        toast.success('Acara berhasil diarsipkan');
        fetchActivities();
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Gagal mengarsipkan acara');
      }
    }
  };

  const handleHardDelete = async (actId: string) => {
    const ok = await confirm({
      title: 'Hapus Permanen Acara',
      message: 'Acara, seksi, media, lampiran, dan riwayat terkait akan dihapus permanen. Tindakan ini hanya untuk admin dan tidak bisa dibatalkan.',
      confirmText: 'Hapus Permanen',
      isDestructive: true,
    });
    if (!ok) return;

    try {
      await api.delete(`/api/activities/${actId}?hard=true`);
      toast.success('Acara berhasil dihapus permanen');
      fetchActivities();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus acara');
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 min-h-[100dvh]">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12"
      >
        <div>
          <div className="flex items-center gap-3 mb-2">
            <SquaresFour weight="duotone" className="w-8 h-8 text-zinc-900" />
            <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">Acara & Kegiatan</h1>
          </div>
          <p className="text-zinc-500 text-sm max-w-[40ch]">
            Kelola dokumentasi foto, video, lampiran, dan arsip kegiatan Kominfo per kecamatan.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-primary-600 text-white px-6 py-3 rounded-full font-semibold shadow-lg hover:shadow-xl hover:bg-primary-700 transition-all duration-300 hover:-translate-y-0.5"
        >
          <Plus weight="bold" className="w-5 h-5" />
          <span>Buat Acara Baru</span>
        </button>
      </motion.div>

      {/* Control Bar */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex flex-col md:flex-row gap-4 mb-8"
      >
        <div className="relative flex-1 max-w-xl">
          <MagnifyingGlass weight="bold" className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Cari nama acara, lokasi, atau deskripsi..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200/50 rounded-xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 transition-all outline-none shadow-sm"
          />
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap md:flex-nowrap items-center gap-3">
          <select
            value={filterTeamId}
            onChange={(e) => { setFilterTeamId(e.target.value); setPage(1); }}
            className="px-4 py-3 bg-white border border-slate-200/50 rounded-xl text-sm font-medium focus:ring-2 focus:ring-zinc-900/10 outline-none"
          >
            <option value="">Semua Tim</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <select
            value={filterDistrictId}
            onChange={(e) => { setFilterDistrictId(e.target.value); setPage(1); }}
            className="px-4 py-3 bg-white border border-slate-200/50 rounded-xl text-sm font-medium focus:ring-2 focus:ring-zinc-900/10 outline-none"
          >
            <option value="">Semua Kecamatan</option>
            {districts.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <button
            onClick={() => { setShowArchived(!showArchived); setPage(1); }}
            className={["px-4 py-3 border border-slate-200/50 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors",
              showArchived ? "bg-red-50 text-red-600 border-red-200" : "bg-white hover:bg-slate-50 text-slate-700"
            ].join(' ')}
          >
            <Archive weight={showArchived ? "fill" : "regular"} className="w-4 h-4" />
            <span>Arsip</span>
          </button>

          <DateFilterPopover 
            filterState={{ dateFrom, dateTo, filterDay, filterMonth, filterYear }}
            onChange={(newState) => {
              setDateFrom(newState.dateFrom || '');
              setDateTo(newState.dateTo || '');
              setFilterDay(newState.filterDay || '');
              setFilterMonth(newState.filterMonth || '');
              setFilterYear(newState.filterYear || '');
              setPage(1);
            }}
          />

          <div className="flex items-center bg-white border border-slate-200/50 rounded-xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={["p-2 rounded-lg transition-colors", viewMode === 'grid' ? 'bg-slate-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'].join(' ')}
            >
              <SquaresFour weight={viewMode === 'grid' ? "fill" : "regular"} className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={["p-2 rounded-lg transition-colors", viewMode === 'list' ? 'bg-slate-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'].join(' ')}
            >
              <List weight={viewMode === 'list' ? "fill" : "regular"} className="w-5 h-5" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-32">
          <SpinnerGap weight="bold" className="w-8 h-8 text-zinc-900 animate-spin" />
        </div>
      ) : activities.length > 0 ? (
        <>
          <motion.div 
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: {
                opacity: 1,
                transition: { staggerChildren: 0.05 }
              }
            }}
            className={viewMode === 'grid' 
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-12"
              : "flex flex-col gap-4 mb-12"
            }
          >
            <AnimatePresence>
              {activities.map((act) => (
                <motion.div
                  key={act.id}
                  layoutId={`card-${act.id}`}
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100 } }
                  }}
                  onClick={() => navigate(`/activity/${act.id}`)}
                  className={`bento-card group cursor-pointer overflow-hidden hover-lift flex ${viewMode === 'grid' ? 'flex-col' : 'flex-row items-center p-4 gap-6'}`}
                >
                  {viewMode === 'grid' ? (
                    // GRID VIEW LAYOUT
                    <>
                      <div className="p-6 flex-1 flex flex-col">
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="w-10 h-10 rounded-2xl bg-zinc-100 flex items-center justify-center group-hover:bg-zinc-900 group-hover:text-white transition-colors duration-300">
                            <CalendarBlank weight="duotone" className="w-5 h-5" />
                          </div>
                          <div className="flex items-center gap-2">
                            {act.is_archived && (
                              <span className="flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                                <Archive weight="bold" className="w-3 h-3" />
                                Arsip
                              </span>
                            )}
                            {act.compromised_count > 0 && (
                              <span className="flex items-center gap-1.5 text-xs font-semibold bg-red-50 text-red-600 px-2.5 py-1 rounded-full border border-red-100" title={`${act.compromised_count} file rusak`}>
                                <Warning weight="bold" className="w-3.5 h-3.5" />
                                {act.compromised_count}
                              </span>
                            )}
                            <span className="flex items-center gap-1.5 text-xs font-semibold bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-full group-hover:bg-zinc-200 transition-colors">
                              <ImageIcon weight="bold" className="w-3.5 h-3.5" />
                              {act.media_count}
                            </span>
                            {act.district_name && (
                              <span className="flex items-center gap-1.5 text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full border border-blue-100">
                                <MapPin weight="bold" className="w-3.5 h-3.5" />
                                {act.district_name}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <h3 className="text-lg font-bold text-zinc-900 tracking-tight leading-snug line-clamp-2 mb-2 group-hover:text-primary-600 transition-colors">
                          {act.title}
                        </h3>
                        
                        <div className="mt-auto pt-4 space-y-2">
                          {act.event_date && (
                            <div className="flex items-center gap-2 text-sm text-zinc-500">
                              <CalendarBlank className="w-4 h-4 text-zinc-400" />
                              <span>{new Date(act.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            </div>
                          )}
                          {act.location && (
                            <div className="flex items-center gap-2 text-sm text-zinc-500">
                              <MapPin className="w-4 h-4 text-zinc-400" />
                              <span className="truncate">{act.location}</span>
                            </div>
                          )}
                          {act.created_at && (
                            <div className="flex items-center gap-2 text-xs text-zinc-400 mt-2">
                              <span>Dibuat: {new Date(act.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          )}
                          {(user?.role === 'SUPER_ADMIN' || user?.role === 'EDITOR') && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleArchive(act.id, act.is_archived); }}
                                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                  act.is_archived
                                    ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                                    : 'text-zinc-500 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200'
                                }`}
                              >
                                <Archive weight="bold" className="w-3.5 h-3.5" />
                                {act.is_archived ? 'Pulihkan' : 'Arsipkan'}
                              </button>
                              {user?.role === 'SUPER_ADMIN' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleHardDelete(act.id); }}
                                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors"
                                >
                                  <Trash weight="bold" className="w-3.5 h-3.5" />
                                  Hapus
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="h-1 w-full bg-zinc-100 group-hover:bg-zinc-900 transition-colors duration-300" />
                    </>
                  ) : (
                    // LIST VIEW LAYOUT
                    <>
                      <div className="w-12 h-12 shrink-0 rounded-2xl bg-zinc-100 flex items-center justify-center group-hover:bg-zinc-900 group-hover:text-white transition-colors duration-300">
                        <CalendarBlank weight="duotone" className="w-6 h-6" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-bold text-zinc-900 tracking-tight truncate group-hover:text-primary-600 transition-colors">
                          {act.title}
                        </h3>
                        <div className="flex items-center gap-4 mt-1">
                          {act.event_date && (
                            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                              <CalendarBlank className="w-3.5 h-3.5" />
                              <span>{new Date(act.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            </div>
                          )}
                          {act.location && (
                            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                              <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                              <span className="truncate max-w-[120px]">{act.location}</span>
                            </div>
                          )}
                          {act.district_name && (
                            <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-lg">
                              <MapPin className="w-3.5 h-3.5" />
                              <span>{act.district_name}</span>
                            </div>
                          )}
                          {act.created_at && (
                            <div className="flex items-center gap-1.5 text-xs text-zinc-400 ml-2 border-l border-zinc-200 pl-3">
                              <span>Dibuat: {new Date(act.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-6">
                        {act.compromised_count > 0 && (
                          <div className="hidden md:flex items-center gap-1.5 text-sm font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100" title={`${act.compromised_count} file rusak`}>
                            <Warning weight="bold" className="w-4 h-4" />
                            <span>{act.compromised_count} Isu</span>
                          </div>
                        )}
                        {act.team_name && (
                          <div className="hidden md:flex items-center gap-1.5 text-sm font-medium text-zinc-500 bg-zinc-50 px-3 py-1.5 rounded-lg border border-zinc-100">
                            <Archive className="w-4 h-4" />
                            <span>{act.team_name}</span>
                          </div>
                        )}
                        <span className="flex items-center gap-1.5 text-xs font-semibold bg-zinc-100 text-zinc-600 px-3 py-1.5 rounded-lg group-hover:bg-zinc-200 transition-colors">
                          <ImageIcon weight="bold" className="w-4 h-4" />
                          {act.media_count} File
                        </span>
                        {(user?.role === 'SUPER_ADMIN' || user?.role === 'EDITOR') && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleArchive(act.id, act.is_archived); }}
                              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                act.is_archived
                                  ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                                  : 'text-zinc-500 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200'
                              }`}
                            >
                              <Archive weight="bold" className="w-3.5 h-3.5" />
                              {act.is_archived ? 'Pulihkan' : 'Arsipkan'}
                            </button>
                            {user?.role === 'SUPER_ADMIN' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleHardDelete(act.id); }}
                                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors"
                              >
                                <Trash weight="bold" className="w-3.5 h-3.5" />
                                Hapus
                              </button>
                            )}
                          </div>
                        )}
                        <div className="w-1 h-12 bg-zinc-100 group-hover:bg-zinc-900 transition-colors duration-300 rounded-full" />
                      </div>
                    </>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          {/* Pagination */}
          {totalPages > 1 && (
            <motion.div layout className="flex items-center justify-center gap-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="w-10 h-10 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed premium-transition"
              >
                <CaretLeft weight="bold" className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-zinc-500 font-mono">
                {String(page).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="w-10 h-10 flex items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed premium-transition"
              >
                <CaretRight weight="bold" className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </>
      ) : (
        /* Empty State */
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bento-card p-16 flex flex-col items-center justify-center text-center mt-8"
        >
          <div className="w-24 h-24 bg-zinc-50 rounded-[2rem] flex items-center justify-center mb-6 border border-zinc-100">
            <CalendarBlank weight="duotone" className="w-10 h-10 text-zinc-400" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 tracking-tight">Belum ada acara</h3>
          <p className="text-zinc-500 max-w-sm mt-3 mb-8 leading-relaxed">
            {search ? `Tidak ada acara yang cocok dengan "${search}".` : 'Mulai kumpulkan dan arsipkan dokumentasi media untuk acara pertama Anda.'}
          </p>
          {!search && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 px-6 py-3 rounded-full font-semibold transition-colors hover-tactile"
            >
              <Plus weight="bold" className="w-5 h-5" />
              <span>Buat Acara Pertama</span>
            </button>
          )}
        </motion.div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
              onClick={() => setShowCreateModal(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 200, damping: 25 }}
              className="relative bg-white rounded-[2.5rem] w-full max-w-lg p-8 shadow-2xl border border-slate-100"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">Buat Acara Baru</h2>
                <button 
                  onClick={() => setShowCreateModal(false)} 
                  className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X weight="bold" className="w-5 h-5" />
                </button>
              </div>
              
              <form onSubmit={handleCreateActivity} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="create-title" className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Judul Acara *</label>
                  <input
                    id="create-title"
                    type="text"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 outline-none transition-all"
                    placeholder="Contoh: Townhall Tahunan 2026"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label htmlFor="create-date" className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Tanggal</label>
                    <input
                      id="create-date"
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="create-location" className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Lokasi</label>
                    <input
                      id="create-location"
                      type="text"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 outline-none transition-all"
                      placeholder="Jakarta Selatan"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="create-team" className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Tim Liputan (Opsional)</label>
                  <select
                    id="create-team"
                    value={newTeamId}
                    onChange={(e) => setNewTeamId(e.target.value)}
                    className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 outline-none transition-all"
                  >
                    <option value="">Tidak Ada Tim</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="create-district" className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Kecamatan Kegiatan *</label>
                  <select
                    id="create-district"
                    required
                    value={newDistrictId}
                    onChange={(e) => setNewDistrictId(e.target.value)}
                    className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 outline-none transition-all"
                  >
                    <option value="">Pilih kecamatan</option>
                    {districts.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-400 ml-1">
                    Mengikuti lokasi kegiatan, bukan kecamatan akun pembuat.
                  </p>
                </div>
                <div className="flex gap-4 pt-6">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-3.5 px-4 bg-white border border-zinc-200 rounded-2xl font-semibold text-zinc-600 hover:bg-zinc-50 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 py-3.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center gap-2"
                  >
                    {creating ? <SpinnerGap weight="bold" className="w-5 h-5 animate-spin" /> : 'Buat Acara'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog />
    </div>
  );
}
