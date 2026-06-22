import { toast } from 'sonner';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, API_URL } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { motion } from 'motion/react';
import * as tus from 'tus-js-client';
import {
  ArrowLeft, Calendar, MapPin, Users, Image, Film, CheckCircle,
  Plus, Pencil, Trash2, Upload, Share2, Paperclip, Loader2, X, Download, FileText, LayoutGrid, List, History,
} from 'lucide-react';
import { PencilSimple } from '@phosphor-icons/react';
import RichTextEditor from '../components/RichTextEditor';
import RichTextViewer from '../components/RichTextViewer';
import { DraggableSectionList } from '../components/dnd/DraggableSectionList';
import { DraggableFlatMediaList } from '../components/dnd/DraggableFlatMediaList';
import { useConfirm } from '../components/useConfirm';

interface Section {
  id: string;
  title: string;
  sort_order: number;
  media_count: number;
}

interface MediaFile {
  id: string;
  display_name: string;
  original_filename: string;
  media_type: 'IMAGE' | 'VIDEO';
  status: string;
  is_edited: boolean;
  sort_order: number;
  title?: string;
  description?: string;
  persons?: any[];
  teams?: any[];
}

interface Activity {
  id: string;
  title: string;
  description: string;
  description_json: any;
  event_date: string;
  location: string;
  district_id?: string | null;
  district_name?: string | null;
  use_sections: boolean;
  is_archived: boolean;
  team_name: string;
  created_by_name: string;
  created_at?: string;
  media_count?: number;
  sections: Section[];
  unsectioned_media: MediaFile[];
  attachments: any[];
}

async function sha256BrowserFile(file: File) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getTusChunkSize(fileSize: number) {
  if (fileSize < 100 * 1024 * 1024) return 5 * 1024 * 1024;
  if (fileSize < 1024 * 1024 * 1024) return 10 * 1024 * 1024;
  return 25 * 1024 * 1024;
}

async function runLimited<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) {
        await worker(item);
      }
    }
  });
  await Promise.all(runners);
}

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const { confirm, ConfirmDialog } = useConfirm();

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [sectionMedia, setSectionMedia] = useState<Record<string, MediaFile[]>>({});

  const [showSectionModal, setShowSectionModal] = useState(false);
  const [newSectionForm, setNewSectionForm] = useState({ title: '', description: '', description_json: null as any });
  const [creatingSection, setCreatingSection] = useState(false);
  const [editSectionForm, setEditSectionForm] = useState<{ id: string; title: string; description: string; description_json: any } | null>(null);
  const [savingSection, setSavingSection] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');

  const [selectedMediaForEdit, setSelectedMediaForEdit] = useState<any | null>(null);
  const [editMediaForm, setEditMediaForm] = useState({
    display_name: '',
    title: '',
    description: '',
    description_json: null as any,
    section_id: null as string | null,
    person_ids: [] as string[],
    team_ids: [] as string[]
  });
  const [filterUneditedOnly, setFilterUneditedOnly] = useState(false);
  const [galleryViewMode, setGalleryViewMode] = useState<'grid' | 'list'>('grid');
  const [savingMedia, setSavingMedia] = useState(false);
  const [personsList, setPersonsList] = useState<any[]>([]);
  const [teamsList, setTeamsList] = useState<any[]>([]);
  const [districtsList, setDistrictsList] = useState<any[]>([]);
  const [fetchingPersons, setFetchingPersons] = useState(false);
  const [fetchingTeams, setFetchingTeams] = useState(false);
  
  const [newPersonName, setNewPersonName] = useState('');
  const [creatingPerson, setCreatingPerson] = useState(false);

  // attachmentModalSection = null (hidden), 'flat' (no sections), or section_id
  const [attachmentModalSection, setAttachmentModalSection] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [fetchingAttachments, setFetchingAttachments] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null);
  const [editAttachmentName, setEditAttachmentName] = useState('');

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [filename: string]: number }>({});
  const [uploadingFilesCount, setUploadingFilesCount] = useState(0);

  const [showEditActivityModal, setShowEditActivityModal] = useState(false);
  const [editActivityForm, setEditActivityForm] = useState({ title: '', description: '', description_json: null as any, use_sections: true, district_id: '' });
  const [savingActivity, setSavingActivity] = useState(false);
  const [deletingActivity, setDeletingActivity] = useState(false);

  const [deleteSectionState, setDeleteSectionState] = useState<{ sectionId: string; action: 'MOVE_MEDIA_TO_UNSECTIONED' | 'DELETE_MEDIA' } | null>(null);
  const [useAutoNaming, setUseAutoNaming] = useState(false);

  const fetchActivity = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/api/activities/${id}`);
      setActivity(res.data.data);
      setEditActivityForm({
        title: res.data.data.title,
        description: res.data.data.description || '',
        description_json: res.data.data.description_json || null,
        use_sections: res.data.data.use_sections,
        district_id: res.data.data.district_id || ''
      });
      // Expand all sections by default initially
      if (res.data.data.sections) {
        setExpandedSections(new Set(res.data.data.sections.map((s: any) => s.id)));
        for (const s of res.data.data.sections) {
          fetchSectionMedia(s.id);
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Gagal memuat detail acara');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  useEffect(() => {
    async function fetchDistricts() {
      try {
        const res = await api.get('/api/districts');
        setDistrictsList(res.data.data);
      } catch (err) {
        console.error('Gagal mengambil data kecamatan:', err);
      }
    }

    fetchDistricts();
  }, []);

  const handleEditActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingActivity(true);
    try {
      await api.put(`/api/activities/${id}`, {
        title: editActivityForm.title,
        description: editActivityForm.description || null,
        description_json: editActivityForm.description_json || null,
        use_sections: editActivityForm.use_sections,
        district_id: editActivityForm.district_id || null,
      });
      setShowEditActivityModal(false);
      fetchActivity();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan perubahan');
    } finally {
      setSavingActivity(false);
    }
  };

  const handleDeleteActivity = async () => {
    if (user?.role !== 'SUPER_ADMIN') {
      toast.error('Hanya admin yang dapat menghapus acara permanen');
      return;
    }

    const isConfirmed = await confirm({
      title: 'Hapus Permanen Acara',
      message: 'Acara, seksi, media, lampiran, dan riwayat terkait akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.',
      confirmText: 'Hapus Permanen',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    
    setDeletingActivity(true);
    try {
      await api.delete(`/api/activities/${id}?hard=true`);
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus acara');
      setDeletingActivity(false);
    }
  };

  const downloadExportJob = async (jobId: string) => {
    const response = await api.get(`/api/export/download/${jobId}`, { responseType: 'blob' });
    const disposition = response.headers['content-disposition'] || '';
    const filenameMatch = /filename="([^"]+)"/.exec(disposition);
    const filename = filenameMatch?.[1] || `REKAM_export_${jobId}`;
    const blobUrl = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  };

  const pollExportJob = async (jobId: string, type: string) => {
    toast.success(`Memulai pembuatan ${type}. Memproses di latar belakang...`, { duration: 5000 });
    
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/api/export/jobs/${jobId}`);
        const job = res.data;
        
        if (job.status === 'COMPLETED') {
          clearInterval(interval);
          toast.success(`${type} berhasil dibuat! Mengunduh file...`);
          await downloadExportJob(jobId);
        } else if (job.status === 'FAILED') {
          clearInterval(interval);
          toast.error(`Gagal membuat ${type}: ${job.error_message || 'Kesalahan sistem'}`);
        }
      } catch {
        clearInterval(interval);
        toast.error(`Gagal mengecek status ${type}.`);
      }
    }, 3000);
  };

  const handleDownloadZip = async () => {
    try {
      const res = await api.get(`/api/export/activity/${id}/zip`);
      pollExportJob(res.data.job_id, 'ZIP');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memulai unduhan ZIP.');
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const res = await api.get(`/api/export/activity/${id}/pdf`);
      pollExportJob(res.data.job_id, 'PDF');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memulai unduhan PDF.');
    }
  };

  async function fetchSectionMedia(sectionId: string) {
    try {
      const res = await api.get(`/api/media?section_id=${sectionId}&limit=100`);
      setSectionMedia((prev) => ({ ...prev, [sectionId]: res.data.data }));
    } catch (err) {
      console.error(`Gagal memuat media untuk seksi ${sectionId}:`, err);
    }
  };

  const toggleSection = (sectionId: string) => {
    const next = new Set(expandedSections);
    if (next.has(sectionId)) {
      next.delete(sectionId);
    } else {
      next.add(sectionId);
      if (!sectionMedia[sectionId]) {
        fetchSectionMedia(sectionId);
      }
    }
    setExpandedSections(next);
  };

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionForm.title.trim()) return;
    setCreatingSection(true);
    try {
      await api.post(`/api/activities/${id}/sections`, { 
        title: newSectionForm.title,
        description: newSectionForm.description || null,
        description_json: newSectionForm.description_json || null
      });
      setShowSectionModal(false);
      setNewSectionForm({ title: '', description: '', description_json: null });
      fetchActivity(); // Refresh
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal membuat seksi');
    } finally {
      setCreatingSection(false);
    }
  };

  const handleEditSectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSectionForm || !editSectionForm.title.trim()) return;
    setSavingSection(true);
    try {
      await api.put(`/api/activities/${id}/sections/${editSectionForm.id}`, { 
        title: editSectionForm.title,
        description: editSectionForm.description || null,
        description_json: editSectionForm.description_json || null
      });
      setEditSectionForm(null);
      fetchActivity(); // Refresh
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan seksi');
    } finally {
      setSavingSection(false);
    }
  };

  const handleDeleteSection = (sectionId: string) => {
    setDeleteSectionState({ sectionId, action: 'MOVE_MEDIA_TO_UNSECTIONED' });
  };

  const confirmDeleteSection = async () => {
    if (!deleteSectionState) return;
    try {
      await api.delete(`/api/activities/${id}/sections/${deleteSectionState.sectionId}`, {
        data: { action: deleteSectionState.action }
      });
      fetchActivity();
      setDeleteSectionState(null);
      toast.success('Seksi berhasil dihapus');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus seksi');
    }
  };

  const handleUploadMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadFiles.length === 0) return;
    if (activity?.use_sections && !selectedSectionId) {
      toast.info('Pilih seksi terlebih dahulu');
      return;
    }

    setUploading(true);
    setUploadingFilesCount(uploadFiles.length);
    setUploadProgress({});
    
    const { token } = useAuthStore.getState();

    try {
      // 1. Calculate hashes sequentially so large videos do not all sit in memory at once.
      const fileHashes: Array<{ file: File; hashHex: string; queueId: string }> = [];
      for (const [index, file] of uploadFiles.entries()) {
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
        try {
          const hashHex = await sha256BrowserFile(file);
          fileHashes.push({ file, hashHex, queueId: `${file.name}-${file.size}-${file.lastModified}-${index}` });
        } catch (e) {
          console.warn('Gagal menghitung hash', e);
          fileHashes.push({ file, hashHex: '', queueId: `${file.name}-${file.size}-${file.lastModified}-${index}` });
        }
      }

      // 2. Batch check duplicates
      const hashesToCheck = fileHashes.filter(f => f.hashHex);
      let existingHashes: string[] = [];
      let duplicateResults: Record<string, any> = {};
      if (hashesToCheck.length > 0) {
        try {
          const dupRes = await api.post('/api/media/check-duplicate-batch', {
            activity_id: id,
            files: hashesToCheck.map((item) => ({
              id: item.queueId,
              checksum_sha256: item.hashHex,
            })),
          });
          existingHashes = dupRes.data.existing_hashes || [];
          duplicateResults = dupRes.data.data?.results || {};
        } catch (e) {
          console.warn('Gagal cek duplikat batch', e);
        }
      }

      // 3. Upload only missing files
      await runLimited(fileHashes, 3, async ({ file, hashHex, queueId }) => {
        if (hashHex && existingHashes.includes(hashHex)) {
          toast.info(`File ${file.name} sudah ada di sistem, dilewati.`);
          setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
          return;
        }

        const duplicate = duplicateResults[queueId];
        if (hashHex && duplicate?.reusable && !duplicate?.exists_in_activity) {
          await api.post('/api/media/attach-duplicate', {
            activity_id: id,
            section_id: selectedSectionId && selectedSectionId !== 'flat' ? selectedSectionId : null,
            checksum_sha256: hashHex,
            filename: file.name,
            mime_type: file.type || 'application/octet-stream',
          });
          toast.success(`File ${file.name} dipakai ulang tanpa upload ulang.`);
          setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
          return;
        }

        await new Promise<void>((resolve, reject) => {
          const upload = new tus.Upload(file, {
            endpoint: `${API_URL}/api/upload/tus/`,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            chunkSize: getTusChunkSize(file.size),
            headers: {
              Authorization: `Bearer ${token}`
            },
            metadata: {
              filename: file.name,
              filetype: file.type,
              activity_id: id || '',
              section_id: selectedSectionId && selectedSectionId !== 'flat' ? selectedSectionId : '',
              mime_type: file.type,
              sha256_local: hashHex,
              file_size: String(file.size),
              auto_naming: useAutoNaming ? 'true' : 'false'
            },
            onError: function(error) {
              console.error('Failed because: ' + error);
              reject(error);
            },
            onProgress: function(bytesUploaded, bytesTotal) {
              const percentage = (bytesUploaded / bytesTotal * 100).toFixed(0);
              setUploadProgress(prev => ({ ...prev, [file.name]: Number(percentage) }));
            },
            onSuccess: function() {
              resolve();
            }
          });

          upload.findPreviousUploads().then(function (previousUploads) {
            if (previousUploads.length) {
              upload.resumeFromPreviousUpload(previousUploads[0]);
            }
            upload.start();
          });
        });
      });

      setShowUploadModal(false);
      setUploadFiles([]);
      if (selectedSectionId) {
        fetchSectionMedia(selectedSectionId);
        fetchActivity(); // update counts
      }
    } catch (err: any) {
      toast.error('Gagal mengupload media: ' + (err.message || err));
    } finally {
      setUploading(false);
      setUploadingFilesCount(0);
      setUploadProgress({});
    }
  };

  const handleEditMediaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMediaForEdit) return;
    setSavingMedia(true);
    try {
      await api.put(`/api/media/${selectedMediaForEdit.id}`, {
        display_name: editMediaForm.display_name || undefined,
        title: editMediaForm.title || undefined,
        description: editMediaForm.description || undefined,
        description_json: editMediaForm.description_json || undefined,
        section_id: editMediaForm.section_id,
        person_ids: editMediaForm.person_ids,
        team_ids: editMediaForm.team_ids
      });
      setSelectedMediaForEdit(null);
      // Refresh list
      fetchActivity();
      if (selectedSectionId) fetchSectionMedia(selectedSectionId);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan media');
    } finally {
      setSavingMedia(false);
    }
  };

  const handleDeleteMedia = async () => {
    if (!selectedMediaForEdit) return;
    const isConfirmed = await confirm({
      title: 'Hapus Media',
      message: 'Hapus media ini secara permanen? File akan dihapus dari storage.',
      confirmText: 'Hapus Media',
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/api/media/${selectedMediaForEdit.id}`);
      setSelectedMediaForEdit(null);
      fetchActivity();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus media');
    }
  };

  async function fetchAttachments(sectionId: string) {
    setFetchingAttachments(true);
    try {
      const sectionQuery = sectionId === 'flat' ? '&section_id=null' : `&section_id=${sectionId}`;
      const res = await api.get(`/api/attachments?activity_id=${id}${sectionQuery}`);
      setAttachments(res.data.data);
    } catch (err: any) {
      console.error('Gagal mengambil lampiran:', err);
    } finally {
      setFetchingAttachments(false);
    }
  };

  const handleRenameAttachment = async (attachmentId: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      await api.put(`/api/attachments/${attachmentId}`, { display_name: newName });
      if (attachmentModalSection) {
        fetchAttachments(attachmentModalSection);
      }
      toast.success('Nama lampiran berhasil diubah');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mengubah nama lampiran');
    }
  };
  async function fetchTeams() {
    setFetchingTeams(true);
    try {
      const res = await api.get('/api/teams');
      setTeamsList(res.data.data);
    } catch (err) {
      console.error('Gagal mengambil data tim:', err);
    } finally {
      setFetchingTeams(false);
    }
  }

  async function fetchPersons() {
    setFetchingPersons(true);
    try {
      const res = await api.get('/api/persons');
      setPersonsList(res.data.data);
    } catch (err) {
      console.error('Gagal mengambil data person:', err);
    } finally {
      setFetchingPersons(false);
    }
  }

  const handleCreatePerson = async () => {
    if (!newPersonName.trim()) return;
    setCreatingPerson(true);
    try {
      const res = await api.post('/api/persons', { full_name: newPersonName });
      setPersonsList(prev => [...prev, res.data.data].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setEditMediaForm(prev => ({ ...prev, person_ids: [...prev.person_ids, res.data.data.id] }));
      setNewPersonName('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal membuat person baru');
    } finally {
      setCreatingPerson(false);
    }
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAttachment(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('activity_id', id || '');
    if (attachmentModalSection && attachmentModalSection !== 'flat') {
      formData.append('section_id', attachmentModalSection);
    }

    try {
      await api.post('/api/attachments/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (attachmentModalSection) fetchAttachments(attachmentModalSection);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mengunggah lampiran');
    } finally {
      setUploadingAttachment(false);
      // Reset input file
      e.target.value = '';
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    const isConfirmed = await confirm({
      title: 'Hapus Lampiran',
      message: 'Hapus lampiran ini secara permanen?',
      confirmText: 'Hapus Lampiran',
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/api/attachments/${attachmentId}`);
      if (attachmentModalSection) fetchAttachments(attachmentModalSection);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus lampiran');
    }
  };

  const handleDownloadAttachment = async (attachmentId: string, filename: string) => {
    try {
      const res = await api.get(`/api/attachments/${attachmentId}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch {
      toast.error('Gagal mengunduh lampiran');
    }
  };

  const handleDownloadIndividualMedia = async (mediaId: string, quality: 'original' | 'preview', filename: string) => {
    try {
      const res = await api.get(`/api/media/${mediaId}/download?quality=${quality}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${quality}_${filename}`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch {
      toast.error('Gagal mengunduh media');
    }
  };

  // ─── EFFECTS ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error || 'Acara tidak ditemukan'}</p>
        <button onClick={() => navigate('/')} className="text-primary-600 hover:underline">
          Kembali ke daftar acara
        </button>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-[100dvh] bg-slate-50 font-sans pb-20 lg:pb-0 text-slate-900"
    >
      <ConfirmDialog />
      <div className="max-w-5xl mx-auto pt-6 px-4 sm:px-6">
        {/* Back button + title */}
        <div className="flex items-start gap-4 mb-6">
        <button
          onClick={() => navigate('/')}
          className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl premium-transition mt-0.5"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{activity.title}</h1>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-text-muted">
            {activity.event_date && (
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {new Date(activity.event_date).toLocaleDateString('id-ID', { dateStyle: 'long' })}
              </span>
            )}
            {activity.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                {activity.location}
              </span>
            )}
            {activity.district_name && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-white rounded-full border border-slate-200 text-slate-600">
                <MapPin className="w-4 h-4" />
                {activity.district_name}
              </span>
            )}
            {activity.team_name && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-white/10 rounded-full backdrop-blur-sm text-sm text-text-muted">
                <Users className="w-4 h-4" />
                {activity.team_name}
              </div>
            )}
            {activity.created_at && (
              <span className="flex items-center gap-1.5 ml-2 border-l border-zinc-200 pl-3">
                <span className="text-zinc-400">Dibuat:</span>
                {new Date(activity.created_at).toLocaleDateString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button 
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm premium-transition"
        >
          <Upload className="w-4 h-4" />
          Upload Media
        </button>
        {activity.use_sections && (
          <button 
            onClick={() => setShowSectionModal(true)}
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 premium-transition"
          >
            <Plus className="w-4 h-4" />
            Tambah Judul
          </button>
        )}
        <button 
          onClick={handleDownloadZip}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 premium-transition"
        >
          <Download className="w-4 h-4" />
          Unduh ZIP
        </button>
        <button 
          onClick={handleDownloadPdf}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 premium-transition"
        >
          <FileText className="w-4 h-4" />
          Unduh PDF
        </button>
        <button 
          onClick={() => navigate(`/activity/${id}/sharing`)}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 premium-transition"
        >
          <Share2 className="w-4 h-4" />
          Bagikan / QR
        </button>
        <button 
          onClick={() => navigate(`/activity/${id}/versions`)}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 premium-transition ml-auto"
        >
          <History className="w-4 h-4" />
          Riwayat
        </button>
        <button 
          onClick={() => setShowEditActivityModal(true)}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 premium-transition"
        >
          <Pencil className="w-4 h-4" />
          Edit Acara
        </button>
        {user?.role === 'SUPER_ADMIN' && (
          <button 
            onClick={handleDeleteActivity}
            disabled={deletingActivity}
            className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-xl text-sm font-medium border border-red-100 premium-transition"
          >
            <Trash2 className="w-4 h-4" />
            Hapus Permanen
          </button>
        )}
      </div>

      {/* Deskripsi */}
      {(activity.description_json || activity.description) && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6 shadow-sm">
          {activity.description_json ? (
            <RichTextViewer content={activity.description_json} />
          ) : (
            <p className="text-gray-700 text-sm leading-relaxed">{activity.description}</p>
          )}
        </div>
      )}

      {/* Filter toolbar & View Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filterUneditedOnly}
            onChange={(e) => setFilterUneditedOnly(e.target.checked)}
            className="w-4 h-4 text-amber-500 rounded"
          />
          Tampilkan hanya yang belum diedit
        </label>
        
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setGalleryViewMode('grid')}
            className={`p-1.5 rounded-lg text-sm flex items-center gap-1.5 premium-transition ${galleryViewMode === 'grid' ? 'bg-white shadow-sm text-primary-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <LayoutGrid className="w-4 h-4" />
            Grid
          </button>
          <button
            onClick={() => setGalleryViewMode('list')}
            className={`p-1.5 rounded-lg text-sm flex items-center gap-1.5 premium-transition ${galleryViewMode === 'list' ? 'bg-white shadow-sm text-primary-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <List className="w-4 h-4" />
            List
          </button>
        </div>
      </div>

      {/* Sections + Media */}
      {activity.use_sections ? (
        activity.sections.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
            <p className="text-text-muted">Belum ada judul. Tambahkan judul pertama untuk mulai mengelola media.</p>
            <button 
              onClick={() => setShowSectionModal(true)}
              className="mt-4 flex items-center gap-2 bg-primary-50 text-primary-700 hover:bg-primary-100 px-4 py-2 rounded-xl mx-auto text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Tambah Judul
            </button>
          </div>
        ) : (
          <DraggableSectionList
            activityId={id!}
            sections={activity.sections}
            setSections={(newSections) => setActivity(prev => prev ? { ...prev, sections: newSections } : prev)}
            sectionMedia={sectionMedia}
            setSectionMedia={setSectionMedia}
            expandedSections={expandedSections}
            onToggleSection={toggleSection}
            onEditSection={(section) => {
              setEditSectionForm({ 
                id: section.id, 
                title: section.title, 
                description: section.description || '', 
                description_json: section.description_json || null 
              });
            }}
            onDeleteSection={handleDeleteSection}
            onAttachment={(sectionId) => {
              setAttachmentModalSection(sectionId);
              fetchAttachments(sectionId);
            }}
            onMediaClick={(media) => {
              setSelectedMediaForEdit(media);
              setEditMediaForm({
                display_name: media.display_name || media.original_filename || '',
                title: media.title || '',
                description: media.description || '',
                description_json: (media as any).description_json || null,
                section_id: media.section_id || null,
                person_ids: media.persons ? media.persons.map((p: any) => p.id) : [],
                team_ids: media.teams ? media.teams.map((t: any) => t.id) : []
              });
              fetchPersons();
              fetchTeams();
            }}
            filterUneditedOnly={filterUneditedOnly}
            viewMode={galleryViewMode}
          />
        )
      ) : (
        /* Flat mode — media tanpa section */
        <div>
          {activity.unsectioned_media.length > 0 ? (
            <DraggableFlatMediaList
              mediaList={activity.unsectioned_media}
              setMediaList={(newList) => setActivity(prev => prev ? { ...prev, unsectioned_media: newList } : prev)}
              onMediaClick={(media) => {
                setSelectedMediaForEdit(media);
                setEditMediaForm({
                  display_name: media.display_name || media.original_filename || '',
                  title: media.title || '',
                  description: media.description || '',
                  description_json: (media as any).description_json || null,
                  section_id: media.section_id || null,
                  person_ids: media.persons ? media.persons.map((p: any) => p.id) : [],
                  team_ids: media.teams ? media.teams.map((t: any) => t.id) : []
                });
                fetchPersons();
                fetchTeams();
              }}
              filterUneditedOnly={filterUneditedOnly}
              viewMode={galleryViewMode}
            />
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
              <p className="text-text-muted">Belum ada media. Upload media pertama Anda.</p>
              <button 
                onClick={() => setShowUploadModal(true)}
                className="mt-4 flex items-center gap-2 bg-primary-50 text-primary-700 hover:bg-primary-100 px-4 py-2 rounded-xl mx-auto text-sm font-medium transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload Media
              </button>
            </div>
          )}
        </div>
      )}

      {/* Attachments section untuk flat mode */}
      {!activity.use_sections && (
        <div className="mt-8 border-t border-gray-100 pt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Paperclip className="w-5 h-5 text-primary-600" />
              Lampiran Acara ({activity.attachments.length})
            </h3>
            <button 
              onClick={() => {
                setAttachmentModalSection('flat');
                fetchAttachments('flat');
              }}
              className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 premium-transition"
            >
              Kelola Lampiran
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">Lampirkan dokumen pelengkap untuk acara ini.</p>
          <div className="space-y-2">
            {activity.attachments.map((att: any) => (
              <div
                key={att.id}
                className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center justify-between hover:bg-gray-50 premium-transition cursor-pointer"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{att.display_name || att.original_filename}</p>
                  <p className="text-xs text-text-muted">{(att.file_size_bytes / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal Tambah Seksi */}
      {showSectionModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Tambah Judul Baru</h2>
            <form onSubmit={handleCreateSection} className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Nama Judul</label>
                <input
                  type="text"
                  required
                  placeholder="Misal: Pembukaan, Sambutan"
                  value={newSectionForm.title}
                  onChange={(e) => setNewSectionForm({ ...newSectionForm, title: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Deskripsi Judul (Opsional)</label>
                <RichTextEditor
                  content={newSectionForm.description_json}
                  onChange={(json, html) => setNewSectionForm({ ...newSectionForm, description_json: json, description: html })}
                  placeholder="Tulis deskripsi..."
                  minHeight="80px"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowSectionModal(false)}
                  className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 premium-transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creatingSection}
                  className="flex-1 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex justify-center items-center premium-transition"
                >
                  {creatingSection ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit Seksi */}
      {editSectionForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Edit Judul</h2>
            <form onSubmit={handleEditSectionSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Nama Judul</label>
                <input
                  type="text"
                  required
                  value={editSectionForm.title}
                  onChange={(e) => setEditSectionForm({ ...editSectionForm, title: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Deskripsi Judul</label>
                <RichTextEditor
                  content={editSectionForm.description_json}
                  onChange={(json, html) => setEditSectionForm({ ...editSectionForm, description_json: json, description: html })}
                  placeholder="Tulis deskripsi..."
                  minHeight="80px"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditSectionForm(null)}
                  className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 premium-transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingSection}
                  className="flex-1 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex justify-center items-center premium-transition"
                >
                  {savingSection ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Upload Media */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Upload Media</h2>
            <form onSubmit={handleUploadMedia}>
              {activity.use_sections && (
                <div className="mb-4">
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Pilih Judul</label>
                  <select
                    required
                    value={selectedSectionId}
                    onChange={(e) => setSelectedSectionId(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none bg-white"
                  >
                    <option value="" disabled>-- Pilih Judul --</option>
                    {activity.sections.map(s => (
                      <option key={s.id} value={s.id}>{s.title}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mb-6">
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">File Media</label>
                {!uploading && (
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                  />
                )}
                {uploadFiles.length > 0 && !uploading && (
                  <p className="text-xs text-text-muted mt-2">{uploadFiles.length} file dipilih</p>
                )}

                {!uploading && (
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="useAutoNaming"
                      checked={useAutoNaming}
                      onChange={(e) => setUseAutoNaming(e.target.checked)}
                      className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                    />
                    <label htmlFor="useAutoNaming" className="text-sm text-gray-700 cursor-pointer">
                      Terapkan penamaan otomatis ({activity.title} - Foto 01)
                    </label>
                  </div>
                )}

                {/* Progress UI */}
                {uploading && uploadFiles.length > 0 && (
                  <div className="mt-4 space-y-3 max-h-[300px] overflow-y-auto pr-2">
                    {uploadFiles.map(file => (
                      <div key={file.name} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                        <div className="flex justify-between items-center mb-1.5">
                          <p className="text-xs font-semibold text-gray-700 truncate mr-3">{file.name}</p>
                          <span className="text-xs font-bold text-primary-600">
                            {uploadProgress[file.name] || 0}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div 
                            className="bg-primary-500 h-2 rounded-full transition-all duration-300" 
                            style={{ width: `${uploadProgress[file.name] || 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 premium-transition disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={uploading || uploadFiles.length === 0}
                  className="flex-1 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex justify-center items-center premium-transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> 
                      <span>{uploadingFilesCount > 0 ? `Mengunggah...` : 'Menyelesaikan...'}</span>
                    </div>
                  ) : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal Edit Acara */}
      {showEditActivityModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Edit Acara</h2>
            <form onSubmit={handleEditActivitySubmit} className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Judul Acara</label>
                <input
                  type="text"
                  required
                  value={editActivityForm.title}
                  onChange={(e) => setEditActivityForm({ ...editActivityForm, title: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Deskripsi Acara</label>
                <RichTextEditor
                  content={editActivityForm.description_json}
                  onChange={(json, html) => setEditActivityForm({ ...editActivityForm, description_json: json, description: html })}
                  placeholder="Tulis deskripsi acara..."
                  minHeight="100px"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Kecamatan Kegiatan</label>
                <select
                  required
                  value={editActivityForm.district_id}
                  onChange={(e) => setEditActivityForm({ ...editActivityForm, district_id: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                >
                  <option value="">Pilih kecamatan</option>
                  {districtsList.map((district) => (
                    <option key={district.id} value={district.id}>{district.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Dipakai untuk filter Dashboard dan pengelompokan arsip per kecamatan.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="use_sections"
                  checked={editActivityForm.use_sections}
                  onChange={(e) => setEditActivityForm({ ...editActivityForm, use_sections: e.target.checked })}
                  className="w-4 h-4 text-primary-600 rounded"
                />
                <label htmlFor="use_sections" className="text-sm font-medium text-gray-700">
                  Gunakan pembagian judul
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditActivityModal(false)}
                  className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 premium-transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingActivity}
                  className="flex-1 py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex justify-center items-center premium-transition"
                >
                  {savingActivity ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit/Preview Media */}
      {selectedMediaForEdit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Detail Media</h2>
              <button 
                onClick={() => setSelectedMediaForEdit(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 bg-gray-50 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="aspect-video bg-gray-100 rounded-xl mb-4 flex items-center justify-center overflow-hidden">
              {/* Preview - In real implementation use actual image/video URL */}
              {selectedMediaForEdit.media_type === 'IMAGE' ? (
                <Image className="w-12 h-12 text-gray-300" />
              ) : (
                <Film className="w-12 h-12 text-gray-300" />
              )}
            </div>

            <div className="flex gap-2 mb-5">
              <button
                type="button"
                onClick={() => handleDownloadIndividualMedia(selectedMediaForEdit.id, 'original', selectedMediaForEdit.original_filename)}
                className="flex-1 py-2.5 px-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-medium flex items-center justify-center gap-2 premium-transition"
              >
                <Download className="w-4 h-4" /> Resolusi Asli
              </button>
              <button
                type="button"
                onClick={() => handleDownloadIndividualMedia(selectedMediaForEdit.id, 'preview', selectedMediaForEdit.original_filename)}
                className="flex-1 py-2.5 px-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-sm font-medium flex items-center justify-center gap-2 premium-transition"
              >
                <Download className="w-4 h-4" /> Versi Preview
              </button>
            </div>

            <form onSubmit={handleEditMediaSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Nama File</label>
                <input
                  type="text"
                  required
                  value={editMediaForm.display_name}
                  onChange={(e) => setEditMediaForm({ ...editMediaForm, display_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                />
              </div>
              
              {activity.use_sections && activity.sections && activity.sections.length > 0 && (
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Pindah ke Judul/Seksi</label>
                  <select
                    value={editMediaForm.section_id || ''}
                    onChange={(e) => setEditMediaForm({ ...editMediaForm, section_id: e.target.value || null })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none bg-white"
                  >
                    <option value="">-- Tanpa Seksi (Umum) --</option>
                    {activity.sections.map(sec => (
                      <option key={sec.id} value={sec.id}>{sec.title}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Judul Konten</label>
                <input
                  type="text"
                  value={editMediaForm.title}
                  onChange={(e) => setEditMediaForm({ ...editMediaForm, title: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 outline-none"
                  placeholder="Misal: Sambutan Walikota"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Deskripsi Media</label>
                <RichTextEditor
                  content={editMediaForm.description_json}
                  onChange={(json, html) => setEditMediaForm({ ...editMediaForm, description_json: json, description: html })}
                  placeholder="Tulis deskripsi media..."
                  minHeight="80px"
                />
              </div>
              
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Orang Terkait (Tag)</label>
                {fetchingPersons ? (
                  <div className="py-2 text-sm text-gray-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Memuat daftar orang...
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 max-h-40 overflow-y-auto space-y-2 mb-3">
                    {personsList.length === 0 ? (
                      <p className="text-xs text-gray-500 text-center py-2">Daftar orang kosong</p>
                    ) : (
                      personsList.map(person => (
                        <label key={person.id} className="flex items-center gap-2 text-sm text-gray-700 hover:bg-white p-1 rounded-lg cursor-pointer transition-colors">
                          <input 
                            type="checkbox"
                            checked={editMediaForm.person_ids.includes(person.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditMediaForm(prev => ({ ...prev, person_ids: [...prev.person_ids, person.id] }));
                              } else {
                                setEditMediaForm(prev => ({ ...prev, person_ids: prev.person_ids.filter(id => id !== person.id) }));
                              }
                            }}
                            className="w-4 h-4 text-primary-600 rounded"
                          />
                          <span className="font-medium">{person.full_name}</span>
                          {person.position && <span className="text-xs text-gray-500 ml-1">({person.position})</span>}
                        </label>
                      ))
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    placeholder="Tambah nama baru..."
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-primary-400"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreatePerson();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCreatePerson}
                    disabled={creatingPerson || !newPersonName.trim()}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {creatingPerson ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Tambah'}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Tim Terkait (Tag)</label>
                {fetchingTeams ? (
                  <div className="py-2 text-sm text-gray-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Memuat daftar tim...
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 max-h-32 overflow-y-auto space-y-2 mb-3">
                    {teamsList.length === 0 ? (
                      <p className="text-xs text-gray-500 text-center py-2">Daftar tim kosong</p>
                    ) : (
                      teamsList.map(team => (
                        <label key={team.id} className="flex items-center gap-2 text-sm text-gray-700 hover:bg-white p-1 rounded-lg cursor-pointer transition-colors">
                          <input 
                            type="checkbox"
                            checked={editMediaForm.team_ids.includes(team.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditMediaForm(prev => ({ ...prev, team_ids: [...prev.team_ids, team.id] }));
                              } else {
                                setEditMediaForm(prev => ({ ...prev, team_ids: prev.team_ids.filter(id => id !== team.id) }));
                              }
                            }}
                            className="w-4 h-4 text-primary-600 rounded"
                          />
                          <span className="font-medium">{team.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-between pt-4 items-center">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteMedia}
                    className="px-3 py-2.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Hapus
                  </button>

                  <div className="relative group/download">
                    <button
                      type="button"
                      className="px-3 py-2.5 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Unduh
                    </button>
                    <div className="absolute bottom-full left-0 mb-2 w-40 bg-white border border-gray-100 shadow-xl rounded-xl p-1.5 opacity-0 invisible group-hover/download:opacity-100 group-hover/download:visible transition-all duration-200 z-10">
                      <button
                        type="button"
                        onClick={() => handleDownloadIndividualMedia(selectedMediaForEdit!.id, 'original', selectedMediaForEdit!.original_filename)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                      >
                        Kualitas Asli
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadIndividualMedia(selectedMediaForEdit!.id, 'preview', selectedMediaForEdit!.original_filename)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                      >
                        Pratinjau (WebP)
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMediaForEdit(null)}
                    className="py-2.5 px-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 premium-transition"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={savingMedia}
                    className="py-2.5 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium flex justify-center items-center premium-transition"
                  >
                    {savingMedia ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Simpan'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Lampiran */}
      {attachmentModalSection && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Paperclip className="w-5 h-5 text-primary-600" />
                Lampiran {attachmentModalSection !== 'flat' ? 'Judul' : 'Acara'}
              </h2>
              <button 
                onClick={() => setAttachmentModalSection(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 bg-gray-50 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mb-4 border border-gray-100 rounded-2xl bg-gray-50/50 p-2">
              {fetchingAttachments ? (
                <div className="flex justify-center items-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : attachments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <Paperclip className="w-5 h-5 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900">Belum ada lampiran</p>
                  <p className="text-xs text-text-muted mt-1">Unggah dokumen seperti PDF atau Excel ke acara ini.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attachments.map(att => (
                    <div key={att.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
                        <Paperclip className="w-5 h-5 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingAttachmentId === att.id ? (
                          <div className="flex items-center gap-2 mt-0.5">
                            <input 
                              type="text" 
                              value={editAttachmentName} 
                              onChange={(e) => setEditAttachmentName(e.target.value)} 
                              className="w-full text-sm font-semibold text-gray-900 border border-primary-300 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary-500"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleRenameAttachment(att.id, editAttachmentName);
                                  setEditingAttachmentId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingAttachmentId(null);
                                }
                              }}
                            />
                            <button 
                              onClick={() => {
                                handleRenameAttachment(att.id, editAttachmentName);
                                setEditingAttachmentId(null);
                              }}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setEditingAttachmentId(null)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {att.display_name || att.original_filename}
                          </p>
                        )}
                        <p className="text-xs text-text-muted mt-0.5">
                          {(att.file_size_bytes / 1024 / 1024).toFixed(2)} MB • {att.uploaded_by_name || 'System'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button 
                          onClick={() => {
                            setEditingAttachmentId(att.id);
                            setEditAttachmentName(att.display_name || att.original_filename);
                          }}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Ubah Nama Lampiran"
                        >
                          <PencilSimple className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDownloadAttachment(att.id, att.display_name || att.original_filename)}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Unduh Lampiran"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteAttachment(att.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Hapus Lampiran"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 shrink-0">
              <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-gray-200 rounded-2xl hover:border-primary-400 hover:bg-primary-50 cursor-pointer transition-colors relative overflow-hidden">
                {uploadingAttachment ? (
                  <div className="flex flex-col items-center justify-center h-full w-full bg-white/80">
                    <Loader2 className="w-5 h-5 animate-spin text-primary-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600">Mengunggah...</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                      <Plus className="w-4 h-4" />
                      Pilih Dokumen
                    </div>
                    <p className="text-xs text-gray-400 mt-1">PDF, DOCX, XLSX (Max 50MB)</p>
                  </>
                )}
                <input 
                  type="file" 
                  className="hidden" 
                  onChange={handleUploadAttachment} 
                  disabled={uploadingAttachment}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Modal Hapus Seksi */}
      {deleteSectionState && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Hapus Judul/Seksi</h2>
            <p className="text-sm text-gray-600 mb-6">Apa yang ingin Anda lakukan dengan media di dalam seksi ini?</p>

            <div className="space-y-3 mb-6">
              <label className={`block p-4 rounded-xl border cursor-pointer premium-transition ${deleteSectionState.action === 'MOVE_MEDIA_TO_UNSECTIONED' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="deleteAction"
                    className="mt-1 w-4 h-4 text-primary-600"
                    checked={deleteSectionState.action === 'MOVE_MEDIA_TO_UNSECTIONED'}
                    onChange={() => setDeleteSectionState({ ...deleteSectionState, action: 'MOVE_MEDIA_TO_UNSECTIONED' })}
                  />
                  <div>
                    <span className="block font-semibold text-gray-900 text-sm mb-0.5">Pindahkan ke Luar Seksi</span>
                    <span className="block text-xs text-gray-500">Media akan tetap ada di acara ini, tetapi tidak akan dikelompokkan ke dalam judul apapun.</span>
                  </div>
                </div>
              </label>

              <label className={`block p-4 rounded-xl border cursor-pointer premium-transition ${deleteSectionState.action === 'DELETE_MEDIA' ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="deleteAction"
                    className="mt-1 w-4 h-4 text-red-600 focus:ring-red-500"
                    checked={deleteSectionState.action === 'DELETE_MEDIA'}
                    onChange={() => setDeleteSectionState({ ...deleteSectionState, action: 'DELETE_MEDIA' })}
                  />
                  <div>
                    <span className="block font-semibold text-red-700 text-sm mb-0.5">Hapus Semua Media (Permanen)</span>
                    <span className="block text-xs text-red-500">Semua media di dalam seksi ini akan dihapus secara permanen dari sistem.</span>
                  </div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteSectionState(null)}
                className="flex-1 py-2.5 px-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 premium-transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDeleteSection}
                className={`flex-1 py-2.5 px-4 rounded-xl font-medium flex justify-center items-center premium-transition text-white ${deleteSectionState.action === 'DELETE_MEDIA' ? 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-500/20' : 'bg-primary-600 hover:bg-primary-700 shadow-lg shadow-primary-500/20'}`}
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </motion.div>
  );
}
