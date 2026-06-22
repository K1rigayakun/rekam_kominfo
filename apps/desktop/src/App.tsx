import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { v4 as uuidv4 } from 'uuid';
import { Camera, HardDrive, UploadCloud, CheckCircle, Loader2, LogOut } from 'lucide-react';
import { enqueueFile, getQueue, UploadQueueItem } from './Database';
import { uploadEngine } from './UploadEngine';
import Login from './Login';
import { clearToken, getApiBase, getToken } from './store';

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
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [drives, setDrives] = useState<CameraDrive[]>([]);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [offloading, setOffloading] = useState(false);
  const [activityId, setActivityId] = useState('');
  const [activities, setActivities] = useState<{id: string, name: string}[]>([]);
  const [sections, setSections] = useState<{id: string, title: string}[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [stagingDir, setStagingDir] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [parallelUploads, setParallelUploads] = useState(parseInt(localStorage.getItem('parallelUploads') || '4', 10));
  const [apiBase, setApiBase] = useState("http://localhost:3000");

  const scanDrives = async () => {
    setScanning(true);
    try {
      const foundDrives = await invoke<CameraDrive[]>('detect_camera_drives');
      setDrives(foundDrives);
    } catch (e) {
      console.error(e);
    } finally {
      setScanning(false);
    }
  };

  const loadManualDrive = () => {
    if (!manualPath.trim()) return;
    setDrives([{
      name: 'Manual Folder',
      mount_point: manualPath,
      dcim_path: manualPath,
      total_space: 0,
      available_space: 0
    }]);
  };

  const loadQueue = async () => {
    const q = await getQueue();
    setQueue(q);
  };

  useEffect(() => {
    getApiBase().then(setApiBase).catch(() => {});
    checkAuth();
    loadQueue();
    const interval = setInterval(async () => {
      loadQueue();
      await uploadEngine.processQueue();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const checkAuth = async () => {
    try {
      const token = await getToken();
      if (token) {
        setIsLoggedIn(true);
      }
    } catch (err) {
      console.error('Failed to load token', err);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const handleLogout = async () => {
    await clearToken();
    setIsLoggedIn(false);
  };

  const authHeaders = (token: string) => ({ 'Authorization': `Bearer ${token}` });

  const handleOffload = async (drive: CameraDrive) => {
    if (!activityId) {
      setStatus("Pilih acara terlebih dahulu sebelum offload.");
      return;
    }
    
    setOffloading(true);
    try {
      const files = await invoke<DcimFile[]>('scan_dcim_files', { dcimPath: drive.dcim_path });
      const appData = await appDataDir();
      const stagingBase = stagingDir || await join(appData, 'staging');
      const stagingPath = await join(stagingBase, activityId);
      
      setStatus(`Menyalin ${files.length} file ke staging...`);
      
      for (const file of files) {
        const fileId = uuidv4();
        const targetPath = await join(stagingPath, `${fileId}_${file.file_name}`);
        
        await invoke('copy_to_staging', { source: file.file_path, target: targetPath });
        
        await enqueueFile({
          id: fileId,
          activity_id: activityId,
          section_id: sectionId || undefined,
          file_path: targetPath,
          file_name: file.file_name,
          file_size: file.file_size
        });
      }
      
      setStatus(`Berhasil menyalin ${files.length} file ke staging. Sinkronisasi dimulai.`);
      uploadEngine.processQueue();
      
    } catch (e) {
      console.error(e);
      setStatus(`Gagal melakukan offload: ${String(e)}`);
    } finally {
      setOffloading(false);
    }
  };

  const fetchActivities = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${apiBase}/api/activities`, {
        headers: authHeaders(token)
      });
      const data = await res.json();
      if (data.data) {
        setActivities(data.data);
      }
    } catch (e) {
      console.error('Failed to fetch activities', e);
    }
  };

  async function fetchActivityDetail(id: string) {
    setActivityId(id);
    const token = await getToken();
    if (!token || !id) return;
    try {
      const res = await fetch(`${apiBase}/api/activities/${id}`, { headers: authHeaders(token) });
      const data = await res.json();
      setSections(data.data.sections || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function createActivity(event: React.FormEvent) {
    event.preventDefault();
    const token = await getToken();
    if (!token || !newTitle.trim()) return;
    setBusy(true);

    const titles = newTitle.split('\n').map(t => t.trim()).filter(Boolean);
    if (titles.length === 0) {
      setBusy(false);
      return;
    }

    setStatus(`Membuat ${titles.length} acara baru...`);
    try {
      for (const title of titles) {
        const response = await fetch(`${apiBase}/api/activities`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(token),
          },
          body: JSON.stringify({
            title,
            event_date: newDate,
            use_sections: true,
          }),
        });
        if (!response.ok) throw new Error(`Gagal membuat acara: ${title}`);
      }
      await fetchActivities();
      setShowNewEvent(false);
      setNewTitle("");
      setStatus(`${titles.length} acara berhasil dibuat`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Gagal membuat acara");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn) {
      fetchActivities();
    }
  }, [isLoggedIn]);

  if (isCheckingAuth) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
    </div>;
  }

  if (!isLoggedIn) {
    return <Login onLoginSuccess={() => setIsLoggedIn(true)} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col gap-6">
      <header className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="flex items-center gap-3">
            <img src="/logo.png" alt="Rekam" className="h-8 w-auto object-contain" />
            <span className="text-2xl font-bold text-gray-900">Desktop Offloader</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Camera SD Card Offload Utility</p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              value={manualPath} 
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="Contoh: D:\Foto\Acara"
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-48"
            />
            <button 
              onClick={loadManualDrive}
              disabled={scanning || offloading || !manualPath}
              className="px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Load Folder
            </button>
            <button 
              onClick={scanDrives}
              disabled={scanning || offloading}
              className="px-4 py-2 bg-primary-50 border border-primary-200 rounded-lg shadow-sm text-sm font-medium text-primary-700 hover:bg-primary-100 flex items-center gap-2 disabled:opacity-50"
            >
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
              Scan SD Card
            </button>
            <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors ml-2">
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="flex gap-2 mb-4">
            <button type="button" disabled={busy} onClick={fetchActivities} className="text-sm underline">Refresh acara</button>
            <button type="button" disabled={busy} onClick={() => setShowNewEvent(!showNewEvent)} className="text-sm text-primary-600 font-bold">
              {showNewEvent ? "Batal" : "+ Buat Acara Baru"}
            </button>
        </div>
        {status && <p className="text-xs mb-2 text-gray-500">{status}</p>}
        {showNewEvent && (
          <form onSubmit={createActivity} className="mb-4 p-4 bg-gray-50 rounded-xl">
            <div className="flex gap-4 mb-2">
              <label className="flex-1 text-sm">
                Judul Acara (Pisahkan dengan baris baru untuk membuat banyak acara)
                <textarea className="w-full border p-1 rounded mt-1 min-h-[60px]" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus required placeholder="Contoh:&#10;Acara Pagi&#10;Acara Siang" />
              </label>
              <label className="w-40 text-sm">
                Tanggal
                <input className="w-full border p-1 rounded" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required />
              </label>
            </div>
            <button type="submit" disabled={busy} className="bg-primary-600 text-white text-sm px-4 py-1 rounded">Simpan Acara</button>
          </form>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block text-sm font-semibold text-gray-700">
            Acara
            <select value={activityId} onChange={(e) => fetchActivityDetail(e.target.value)} className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg">
              <option value="">Pilih acara</option>
              {activities.map(act => <option key={act.id} value={act.id}>{act.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            Seksi
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg">
              <option value="">Tanpa seksi</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            Staging Path
            <input value={stagingDir} onChange={(e) => setStagingDir(e.target.value)} className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg" placeholder="Default AppData" />
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            Paralel Upload
            <select 
              value={parallelUploads} 
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setParallelUploads(val);
                localStorage.setItem('parallelUploads', e.target.value);
              }} 
              className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg bg-white"
            >
              {[1, 2, 3, 4, 5, 6].map(n => (
                <option key={n} value={n}>{n} File Bersamaan</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-blue-500" />
            Drive Terdeteksi
          </h2>
          {drives.length === 0 ? (
            <p className="text-gray-500 text-sm italic">Tidak ada SD Card kamera terdeteksi.</p>
          ) : (
            <div className="space-y-3">
              {drives.map(drive => (
                <div key={drive.mount_point} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50">
                  <div className="flex-1 min-w-0 pr-4">
                    <h3 className="font-semibold text-gray-900 truncate">{drive.name} ({drive.mount_point})</h3>
                    <p className="text-xs text-gray-500 truncate">{drive.dcim_path}</p>
                  </div>
                  <button 
                    onClick={() => handleOffload(drive)}
                    disabled={offloading}
                    className="px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 whitespace-nowrap disabled:opacity-50"
                  >
                    {offloading ? 'Menyalin...' : 'Offload'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-primary-500" />
            Antrean Upload
          </h2>
          {queue.length === 0 ? (
            <p className="text-gray-500 text-sm italic">Antrean kosong.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
              {queue.map(item => (
                <div key={item.id} className="p-3 border border-gray-100 rounded-xl bg-gray-50 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm text-gray-900 truncate max-w-[200px]" title={item.file_name}>{item.file_name}</span>
                    <div className="flex items-center gap-2">
                      {item.status === 'UPLOADING' && uploadEngine.uploadStats.has(item.id) && (
                        <span className="text-xs text-gray-500 font-mono">
                          {((uploadEngine.uploadStats.get(item.id)!.speedBytesPerSec) / 1024 / 1024).toFixed(1)} MB/s
                          {' • '}
                          ETA: {Math.ceil(uploadEngine.uploadStats.get(item.id)!.etaSeconds)}s
                        </span>
                      )}
                      <span className={`text-xs font-semibold px-2 py-1 rounded-md ${
                        item.status === 'DONE' ? 'bg-green-100 text-green-700' :
                        item.status === 'ERROR' ? 'bg-red-100 text-red-700' :
                        item.status === 'UPLOADING' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-200 text-gray-700'
                      }`}>
                        {item.status}
                      </span>
                      {item.status === 'ERROR' && (
                        <button 
                          onClick={() => uploadEngine.retryUpload(item.id)}
                          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-1 rounded-md transition-colors"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                  {item.status === 'UPLOADING' && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
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
    </div>
  );
}

export default App;
