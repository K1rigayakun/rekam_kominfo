import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type MediaCandidate = {
  path: string;
  filename: string;
  extension: string;
  size_bytes: number;
  modified_at: string | null;
};

type CameraSource = {
  root_path: string;
  label: string;
  files: MediaCandidate[];
};

type QueueItem = {
  id: string;
  local_path: string;
  original_name: string;
  activity_id: string | null;
  section_id: string | null;
  sha256_local: string;
  size_bytes: number;
  status: "QUEUED" | "UPLOADING" | "DONE" | "FAILED";
  progress_bytes: number;
  retry_count: number;
  error_msg: string | null;
  created_at: string;
};

type Activity = {
  id: string;
  title: string;
  event_date?: string;
  district_name?: string | null;
  sections?: Section[];
};

type Section = {
  id: string;
  title: string;
};

type LoginResponse = {
  token: string;
  user: {
    email: string;
    full_name: string;
    role: string;
  };
};

const API_KEY = "rekam.desktop.apiBase";
const TOKEN_KEY = "rekam.desktop.token";
const USER_KEY = "rekam.desktop.user";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && size >= 1024; i += 1) {
    size /= 1024;
    unit = units[i];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function App() {
  const [apiBase, setApiBase] = React.useState(() => localStorage.getItem(API_KEY) || "http://localhost:3000");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [token, setToken] = React.useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = React.useState(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as LoginResponse["user"] : null;
  });

  const [stagingDir, setStagingDir] = React.useState("");
  const [manualPath, setManualPath] = React.useState("");
  const [sources, setSources] = React.useState<CameraSource[]>([]);
  const [files, setFiles] = React.useState<MediaCandidate[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [activities, setActivities] = React.useState<Activity[]>([]);
  const [sections, setSections] = React.useState<Section[]>([]);
  const [activityId, setActivityId] = React.useState("");
  const [sectionId, setSectionId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const selectedActivity = activities.find((activity) => activity.id === activityId);

  async function refreshQueue() {
    const data = await invoke<QueueItem[]>("list_queue");
    setQueue(data);
  }

  React.useEffect(() => {
    invoke<string>("get_default_staging_dir").then(setStagingDir).catch(console.error);
    refreshQueue().catch(console.error);
  }, []);

  React.useEffect(() => {
    if (token) {
      fetchActivities().catch(console.error);
    }
  }, [token]);

  React.useEffect(() => {
    setSections(selectedActivity?.sections || []);
    setSectionId("");
  }, [activityId]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("Login ke backend...");
    try {
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Login gagal");
      const data = await response.json() as LoginResponse;
      localStorage.setItem(API_KEY, apiBase);
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setStatus(`Login berhasil sebagai ${data.user.full_name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Login gagal");
    } finally {
      setBusy(false);
    }
  }

  async function fetchActivities() {
    if (!token) return;
    setStatus("Memuat daftar acara...");
    const response = await fetch(`${apiBase}/api/activities?limit=100`, {
      headers: authHeaders(token),
    });
    if (!response.ok) throw new Error("Gagal memuat acara");
    const data = await response.json();
    setActivities(data.data || []);
    setStatus("Daftar acara siap");
  }

  async function fetchActivityDetail(nextActivityId: string) {
    setActivityId(nextActivityId);
    if (!nextActivityId || !token) return;
    const response = await fetch(`${apiBase}/api/activities/${nextActivityId}`, {
      headers: authHeaders(token),
    });
    if (!response.ok) throw new Error("Gagal memuat detail acara");
    const data = await response.json();
    setSections(data.data.sections || []);
  }

  async function scanCameraSources() {
    setBusy(true);
    setStatus("Memindai drive kamera atau SD card...");
    try {
      const result = await invoke<CameraSource[]>("scan_camera_sources");
      setSources(result);
      setFiles(result.flatMap((source) => source.files));
      setSelected(new Set(result.flatMap((source) => source.files.map((file) => file.path))));
      setStatus(result.length ? `${result.length} sumber ditemukan` : "Tidak ada drive kamera terdeteksi. Gunakan path manual.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan gagal");
    } finally {
      setBusy(false);
    }
  }

  async function loadManualPath() {
    if (!manualPath.trim()) return;
    setBusy(true);
    setStatus("Membaca folder manual...");
    try {
      const result = await invoke<MediaCandidate[]>("list_media_files", { rootPath: manualPath.trim() });
      setFiles(result);
      setSelected(new Set(result.map((file) => file.path)));
      setStatus(`${result.length} file media ditemukan`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Gagal membaca folder");
    } finally {
      setBusy(false);
    }
  }

  async function offloadSelected() {
    if (!activityId) {
      setStatus("Pilih acara target sebelum offload");
      return;
    }
    const sourcePaths = files.filter((file) => selected.has(file.path)).map((file) => file.path);
    if (!sourcePaths.length) {
      setStatus("Pilih minimal satu file");
      return;
    }

    setBusy(true);
    setStatus("Menyalin file ke staging lokal dan menghitung SHA-256...");
    try {
      await invoke("offload_files", {
        sourcePaths,
        stagingDir,
        activityId,
        sectionId: sectionId || null,
      });
      await refreshQueue();
      setStatus(`${sourcePaths.length} file masuk queue staging`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Offload gagal");
    } finally {
      setBusy(false);
    }
  }

  async function processQueue() {
    if (!token) {
      setStatus("Login dulu sebelum upload");
      return;
    }
    setBusy(true);
    setStatus("Upload queue berjalan. Jangan cabut jaringan sampai selesai.");
    try {
      const result = await invoke<string>("process_upload_queue", { apiBase, accessToken: token });
      await refreshQueue();
      setStatus(result);
    } catch (error) {
      await refreshQueue();
      setStatus(error instanceof Error ? error.message : "Upload queue gagal");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(path: string) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelected(next);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">REKAM Desktop Offload</p>
          <h1>Transfer kamera cepat, upload tetap berjalan di background.</h1>
          <p className="subcopy">
            File disalin dulu ke staging lokal, diverifikasi SHA-256, lalu diupload ke server REKAM melalui TUS resumable upload.
          </p>
        </div>
        <div className="status-panel">
          <span>Status</span>
          <strong>{status || "Siap"}</strong>
        </div>
      </section>

      <section className="grid">
        <form className="panel" onSubmit={login}>
          <h2>Koneksi server</h2>
          <label>
            Backend API
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
          </label>
          <div className="two-cols">
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@rekam.local" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          </div>
          <button disabled={busy} type="submit">Login</button>
          {user && <p className="hint">Login: {user.full_name} ({user.role})</p>}
        </form>

        <section className="panel">
          <h2>Target acara</h2>
          <div className="toolbar">
            <button type="button" disabled={!token || busy} onClick={fetchActivities}>Refresh acara</button>
          </div>
          <label>
            Acara
            <select value={activityId} onChange={(event) => fetchActivityDetail(event.target.value)}>
              <option value="">Pilih acara</option>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.title} {activity.district_name ? `- ${activity.district_name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seksi
            <select value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
              <option value="">Tanpa seksi / flat</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.title}</option>
              ))}
            </select>
          </label>
          <label>
            Staging path
            <input value={stagingDir} onChange={(event) => setStagingDir(event.target.value)} />
          </label>
        </section>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Sumber kamera</h2>
            <p className="hint">Scan otomatis mencari DCIM di removable drive. Path manual berguna untuk folder hasil copy kamera.</p>
          </div>
          <button type="button" disabled={busy} onClick={scanCameraSources}>Scan drive</button>
        </div>
        <div className="toolbar">
          <input value={manualPath} onChange={(event) => setManualPath(event.target.value)} placeholder="Contoh: E:\\DCIM atau D:\\Kamera\\Hari Ini" />
          <button type="button" disabled={busy} onClick={loadManualPath}>Baca path</button>
          <button type="button" disabled={busy || !files.length} onClick={() => setSelected(new Set(files.map((file) => file.path)))}>Pilih semua</button>
          <button type="button" disabled={busy || !files.length} onClick={() => setSelected(new Set())}>Kosongkan</button>
        </div>
        {sources.length > 0 && (
          <div className="chips">
            {sources.map((source) => (
              <span key={source.root_path}>{source.label}: {source.files.length} file</span>
            ))}
          </div>
        )}
        <div className="file-list">
          {files.map((file) => (
            <label className="file-row" key={file.path}>
              <input type="checkbox" checked={selected.has(file.path)} onChange={() => toggleSelected(file.path)} />
              <span>{file.filename}</span>
              <small>{formatBytes(file.size_bytes)}</small>
            </label>
          ))}
          {!files.length && <p className="empty">Belum ada file media yang dimuat.</p>}
        </div>
        <button className="primary" type="button" disabled={busy || !selected.size} onClick={offloadSelected}>
          Copy ke staging dan queue ({selected.size})
        </button>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Upload queue lokal</h2>
            <p className="hint">Queue disimpan di SQLite. File DONE yang sudah hash-match otomatis dihapus dari staging.</p>
          </div>
          <div className="toolbar compact">
            <button type="button" disabled={busy} onClick={refreshQueue}>Refresh queue</button>
            <button type="button" disabled={busy || !queue.length} onClick={processQueue}>Upload queue</button>
          </div>
        </div>
        <div className="queue-table">
          {queue.map((item) => (
            <div className="queue-row" key={item.id}>
              <div>
                <strong>{item.original_name}</strong>
                <small>{item.local_path}</small>
              </div>
              <span>{formatBytes(item.progress_bytes)} / {formatBytes(item.size_bytes)}</span>
              <b className={`status ${item.status.toLowerCase()}`}>{item.status}</b>
              {item.error_msg && <em>{item.error_msg}</em>}
            </div>
          ))}
          {!queue.length && <p className="empty">Queue masih kosong.</p>}
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
