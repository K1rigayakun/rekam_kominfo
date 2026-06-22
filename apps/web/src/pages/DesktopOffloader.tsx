import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { v4 as uuidv4 } from 'uuid';
import { HardDrive, UploadCloud, Loader2, Info, Search, CheckSquare, Square, Plus, Monitor, FolderOpen } from 'lucide-react';
import { enqueueFile, getQueue, type UploadQueueItem } from '../lib/desktop/Database';
import { uploadEngine } from '../lib/desktop/UploadEngine';
import { api } from '../lib/api';
import { toast } from 'sonner';
import MasterActivityModal from '../components/ActivityEditor/MasterActivityModal';

interface CameraDrive {
  name: string;
  mount_point: string;
  dcim_path: string;
  total_space: number;
  available_space: number;
}

interface DcimFile {
  file_path: string;
  file_name: string;
  file_size: number;
  modified_at: number;
}

export default function DesktopOffloader() {
  const [drives, setDrives] = useState<CameraDrive[]>([]);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [offloading, setOffloading] = useState(false);
  
  const [activityId, setActivityId] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [activitySections, setActivitySections] = useState<any[]>([]);
  const [useSections, setUseSections] = useState(false);
  const [activities, setActivities] = useState<{id: string, title: string}[]>([]);

  // Settings
  const [stagingDir, setStagingDir] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [parallelUploads, setParallelUploads] = useState(parseInt(localStorage.getItem('parallelUploads') || '4', 10));

  // Modal Event
  const [modalActivityId, setModalActivityId] = useState<string | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // File Selection
  const [scannedFiles, setScannedFiles] = useState<DcimFile[]>([]);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());
  const [fileSearch, setFileSearch] = useState("");
  const [fileSort, setFileSort] = useState<"date" | "name" | "size">("date");

  const scanDrives = async () => {
    setScanning(true);
    try {
      const detected = await invoke<CameraDrive[]>('scan_drives');
      setDrives(detected);
    } catch (e) {
      console.error(e);
      toast.error("Gagal memindai drive.");
    } finally {
      setScanning(false);
    }
  };

  const loadManualDrive = async () => {
    if (!manualPath) return;
    setScanning(true);
    try {
      const drive: CameraDrive = {
        name: "Manual Folder",
        mount_point: manualPath,
        dcim_path: manualPath,
        total_space: 0,
        available_space: 0
      };
      setDrives([{ ...drive }]);
    } catch (e) {
      console.error(e);
      toast.error("Gagal load folder manual.");
    } finally {
      setScanning(false);
    }
  };

  const loadQueue = async () => {
    const q = await getQueue();
    setQueue(q);
  };

  useEffect(() => {
    loadQueue();
    const interval = setInterval(async () => {
      loadQueue();
      await uploadEngine.processQueue();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchActivities = async () => {
    try {
      const res = await api.get('/api/activities');
      if (res.data.data) {
        setActivities(res.data.data);
      }
    } catch (e) {
      console.error('Failed to fetch activities', e);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, []);

  useEffect(() => {
    if (!activityId) {
      setActivitySections([]);
      setUseSections(false);
      setSelectedSectionId('');
      return;
    }
    const fetchActivityDetail = async () => {
      try {
        const res = await api.get(`/api/activities/${activityId}`);
        if (res.data.data) {
          setUseSections(res.data.data.use_sections);
          setActivitySections(res.data.data.sections || []);
        }
      } catch (e) {
        console.error('Failed to fetch activity details', e);
      }
    };
    fetchActivityDetail();
  }, [activityId]);

  const handleCreateActivityPopup = async () => {
    try {
      const res = await api.post('/api/activities', {
        title: `Acara Baru`,
        event_date: new Date().toISOString().split('T')[0],
      });
      await fetchActivities();
      setActivityId(res.data.data.id);
      setModalActivityId(res.data.data.id);
      setIsNewDraft(true);
      setIsModalOpen(true);
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Gagal membuat acara draft");
    }
  };

  const handleCreateSectionPopup = async () => {
    if (!activityId) return;
    const title = window.prompt('Masukkan nama judul baru:');
    if (!title || !title.trim()) return;
    try {
      const res = await api.post(`/api/activities/${activityId}/sections`, { title: title.trim() });
      const newSection = res.data.data;
      setActivitySections(prev => [...prev, newSection]);
      setSelectedSectionId(newSection.id);
      toast.success('Judul baru berhasil dibuat');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Gagal membuat judul baru');
    }
  };

  const handleScanDrive = async (drivePath: string) => {
    if (!activityId) {
      toast.error("Pilih acara terlebih dahulu sebelum load file.");
      return;
    }
    setScanning(true);
    try {
      const files = await invoke<DcimFile[]>('scan_dcim_files', { dcimPath: drivePath });
      setScannedFiles(files);
      setSelectedFilePaths(new Set(files.map(f => f.file_path)));
    } catch (e) {
      console.error(e);
      toast.error("Gagal membaca folder dcim.");
    } finally {
      setScanning(false);
    }
  };

  const toggleFileSelection = (filePath: string) => {
    const next = new Set(selectedFilePaths);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    setSelectedFilePaths(next);
  };

  const processSelectedFiles = async () => {
    if (!activityId) {
      toast.error('Pilih acara terlebih dahulu!');
      return;
    }
    if (selectedFilePaths.size === 0) {
      toast.error('Pilih minimal satu file untuk diunggah!');
      return;
    }
    setOffloading(true);
    try {
      const appData = await appDataDir();
      const stagingBase = stagingDir || await join(appData, 'staging');
      const stagingPath = await join(stagingBase, activityId);
      
      const filesToProcess = scannedFiles.filter(f => selectedFilePaths.has(f.file_path));
      let added = 0;
      for (const file of filesToProcess) {
        const fileId = uuidv4();
        const targetPath = await join(stagingPath, `${fileId}_${file.file_name}`);
        
        await invoke('copy_to_staging', { source: file.file_path, target: targetPath });
        
        await enqueueFile({
          id: fileId,
          activity_id: activityId,
          section_id: selectedSectionId || undefined,
          file_path: targetPath,
          file_name: file.file_name,
          file_size: file.file_size,
        });
        added++;
      }
      toast.success(`Berhasil menambahkan ${added} file ke antrean.`);
      uploadEngine.processQueue();
      setScannedFiles([]);
    } catch (e) {
      console.error(e);
      toast.error("Gagal memproses file.");
    } finally {
      setOffloading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredAndSortedFiles = scannedFiles
    .filter(f => f.file_name.toLowerCase().includes(fileSearch.toLowerCase()))
    .sort((a, b) => {
      if (fileSort === 'name') return a.file_name.localeCompare(b.file_name);
      if (fileSort === 'size') return b.file_size - a.file_size;
      return b.modified_at - a.modified_at; // date descending
    });

  const handlePickFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Pilih Folder Sumber Media'
      });
      if (selected && typeof selected === 'string') {
        setManualPath(selected);
        // Automatically load folder after selection
        handleScanDrive(selected);
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal membuka dialog folder');
    }
  };

  const handlePickStagingFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Pilih Folder Staging'
      });
      if (selected && typeof selected === 'string') {
        setStagingDir(selected);
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal membuka dialog folder');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col gap-6 relative">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Monitor className="w-7 h-7 text-primary-600" />
            Desktop Offloader
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Utilitas penyalinan & sinkronisasi media dari memori kamera.
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              value={manualPath} 
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="Atau ketik path/jalur folder manual..."
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-64"
            />
            <button 
              onClick={loadManualDrive}
              disabled={scanning || offloading || !manualPath}
              className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Load Path
            </button>
            <button 
              onClick={handlePickFolder}
              disabled={scanning || offloading}
              className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
            >
              <FolderOpen className="w-4 h-4" /> Cari Folder
            </button>
            <button 
              onClick={scanDrives}
              disabled={scanning || offloading}
              className="px-4 py-2 bg-primary-50 border border-primary-200 rounded-lg shadow-sm text-sm font-medium text-primary-700 hover:bg-primary-100 flex items-center gap-2 disabled:opacity-50"
            >
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
              Scan SD Card
            </button>
          </div>
        </div>
      </header>

      {/* Main Settings Panel */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-wrap md:flex-nowrap items-end gap-4 mb-6">
          <label className="block text-sm font-semibold text-gray-700 flex-1 min-w-[200px]">
            <div className="flex items-center justify-between mb-1">
              <span>Target Acara</span>
              <button type="button" onClick={handleCreateActivityPopup} className="text-xs text-primary-600 font-bold hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Buat Acara Baru
              </button>
            </div>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 focus:bg-white transition-colors outline-none">
              <option value="">-- Pilih acara dari server --</option>
              {activities.map(act => <option key={act.id} value={act.id}>{act.title}</option>)}
            </select>
          </label>

          {useSections && (
            <label className="block text-sm font-semibold text-gray-700 flex-1 min-w-[200px]">
              <div className="flex items-center justify-between mb-1">
                <span>Pilih Judul</span>
                <button type="button" onClick={handleCreateSectionPopup} className="text-xs text-primary-600 font-bold hover:underline flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Buat Judul Baru
                </button>
              </div>
              <select value={selectedSectionId} onChange={(e) => setSelectedSectionId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 focus:bg-white transition-colors outline-none">
                <option value="">-- Umum (Tanpa Judul) --</option>
                {activitySections.map((sec: any) => <option key={sec.id} value={sec.id}>{sec.title}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-50">
          <label className="block text-sm font-semibold text-gray-700">
            <div className="flex items-center gap-1 mb-1">
              Staging Path
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                <div className="absolute bottom-full mb-2 left-0 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 pointer-events-none">
                  Lokasi sementara di komputer ini untuk menyimpan salinan file sebelum berhasil diupload ke server. Default: AppData folder.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input value={stagingDir} onChange={(e) => setStagingDir(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg font-mono text-xs bg-gray-50 focus:bg-white" placeholder="Default AppData/staging" />
              <button 
                type="button"
                onClick={handlePickStagingFolder}
                className="px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap"
              >
                <FolderOpen className="w-3.5 h-3.5" /> Pilih Folder
              </button>
            </div>
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            <div className="flex items-center gap-1 mb-1">
              Paralel Upload
              <div className="group relative">
                <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                <div className="absolute bottom-full mb-2 right-0 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 pointer-events-none">
                  Jumlah maksimal file yang diupload secara bersamaan. Terlalu tinggi bisa memberatkan koneksi internet.
                </div>
              </div>
            </div>
            <select 
              value={parallelUploads} 
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setParallelUploads(val);
                localStorage.setItem('parallelUploads', e.target.value);
              }} 
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 focus:bg-white"
            >
              {[1, 2, 3, 4, 5, 6].map(n => (
                <option key={n} value={n}>{n} File Bersamaan</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col min-h-[400px]">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-blue-500" />
            Drive Terdeteksi
          </h2>
          
          {scannedFiles.length > 0 ? (
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-4 gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} placeholder="Cari file..." className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white" />
                </div>
                <select value={fileSort} onChange={(e: any) => setFileSort(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-gray-50">
                  <option value="date">Terbaru</option>
                  <option value="name">Nama</option>
                  <option value="size">Ukuran</option>
                </select>
              </div>
              <div className="flex items-center justify-between mb-2 text-sm">
                <button onClick={() => setSelectedFilePaths(new Set(scannedFiles.map(f => f.file_path)))} className="text-primary-600 hover:underline">Pilih Semua</button>
                <button onClick={() => setSelectedFilePaths(new Set())} className="text-gray-500 hover:underline">Batal Pilih</button>
                <span className="text-gray-500 font-medium">{selectedFilePaths.size} / {scannedFiles.length} File</span>
              </div>
              <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl max-h-[300px]">
                {filteredAndSortedFiles.map(file => (
                  <div key={file.file_path} onClick={() => toggleFileSelection(file.file_path)} className="flex items-center gap-3 p-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                    {selectedFilePaths.has(file.file_path) ? <CheckSquare className="w-5 h-5 text-primary-500" /> : <Square className="w-5 h-5 text-gray-300" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.file_name}</p>
                      <p className="text-xs text-gray-500">{new Date(file.modified_at * 1000).toLocaleString('id-ID')} • {formatSize(file.file_size)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setScannedFiles([])} className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200">Batal</button>
                <button onClick={processSelectedFiles} disabled={offloading || selectedFilePaths.size === 0} className="flex-1 px-4 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">
                  {offloading ? 'Menyalin...' : `Mulai Sinkronisasi (${selectedFilePaths.size} File)`}
                </button>
              </div>
            </div>
          ) : (
            <>
              {drives.length === 0 ? (
                <p className="text-gray-500 text-sm italic">Tidak ada SD Card kamera terdeteksi.</p>
              ) : (
                <div className="space-y-3">
                  {drives.map(drive => (
                    <div key={drive.mount_point} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-blue-50/30 transition-colors">
                      <div className="flex-1 min-w-0 pr-4">
                        <h3 className="font-semibold text-gray-900 truncate">{drive.name} ({drive.mount_point})</h3>
                        <p className="text-xs text-gray-500 truncate">{drive.dcim_path}</p>
                      </div>
                      <button 
                        onClick={() => handleScanDrive(drive.dcim_path)}
                        disabled={scanning}
                        className="px-4 py-2 bg-white border border-gray-200 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-50 shadow-sm whitespace-nowrap disabled:opacity-50"
                      >
                        {scanning ? 'Membaca...' : 'Lihat Isi Folder'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col min-h-[400px]">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-primary-500" />
            Antrean Upload
          </h2>
          {queue.length === 0 ? (
            <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-xl">
              <p className="text-gray-400 text-sm font-medium">Belum ada file di antrean.</p>
            </div>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto pr-2 max-h-[400px]">
              {queue.map(item => (
                <div key={item.id} className="p-3 border border-gray-100 rounded-xl bg-gray-50 flex flex-col gap-2 relative overflow-hidden group">
                  <div className="flex justify-between items-center relative z-10">
                    <span className="font-medium text-sm text-gray-900 truncate max-w-[200px]" title={item.file_name}>{item.file_name}</span>
                    <div className="flex items-center gap-2">
                      {item.status === 'UPLOADING' && uploadEngine.uploadStats.has(item.id) && (
                        <span className="text-xs text-gray-500 font-mono hidden md:inline">
                          {((uploadEngine.uploadStats.get(item.id)!.speedBytesPerSec) / 1024 / 1024).toFixed(1)} MB/s
                          {' • '}
                          ETA: {Math.ceil(uploadEngine.uploadStats.get(item.id)!.etaSeconds)}s
                        </span>
                      )}
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
                        item.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                        item.status === 'ERROR' ? 'bg-red-100 text-red-700' :
                        item.status === 'UPLOADING' ? 'bg-blue-100 text-blue-700' :
                        'bg-zinc-200 text-zinc-700'
                      }`}>
                        {item.status}
                      </span>
                      {item.status === 'ERROR' && (
                        <button 
                          onClick={() => uploadEngine.retryUpload(item.id)}
                          className="text-xs font-semibold bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-2 py-1 rounded-md transition-colors shadow-sm"
                        >
                          Coba Lagi
                        </button>
                      )}
                      {item.status === 'UPLOADING' && (
                        <button
                          onClick={() => uploadEngine.pauseUpload(item.id)}
                          className="text-xs font-semibold bg-white border border-gray-200 hover:bg-amber-50 text-amber-700 px-2 py-1 rounded-md transition-colors shadow-sm"
                        >
                          Pause
                        </button>
                      )}
                      {item.status === 'PAUSED' && (
                        <button
                          onClick={() => uploadEngine.resumeUpload(item.id)}
                          className="text-xs font-semibold bg-white border border-gray-200 hover:bg-blue-50 text-blue-700 px-2 py-1 rounded-md transition-colors shadow-sm"
                        >
                          Resume
                        </button>
                      )}
                      {item.status !== 'DONE' && (
                        <button
                          onClick={() => uploadEngine.cancelUpload(item.id)}
                          className="text-xs font-semibold bg-white border border-red-200 hover:bg-red-50 text-red-600 px-2 py-1 rounded-md transition-colors shadow-sm"
                        >
                          Batal
                        </button>
                      )}
                    </div>
                  </div>
                  {item.status === 'UPLOADING' && (
                    <div className="w-full bg-blue-100/50 rounded-full h-1.5 relative z-10">
                      <div 
                        className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" 
                        style={{ width: `${Math.max(5, (item.progress_bytes / item.file_size) * 100)}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Modal Overlay for New Activity */}
      <MasterActivityModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setIsNewDraft(false);
          fetchActivities();
        }}
        activityId={modalActivityId}
        isNewDraft={isNewDraft}
        onSaved={() => {
          setIsModalOpen(false);
          setIsNewDraft(false);
          fetchActivities();
        }}
      />

    </div>
  );
}
