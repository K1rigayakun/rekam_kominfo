import Database from '@tauri-apps/plugin-sql';

export interface UploadQueueItem {
  id: string;
  activity_id: string;
  section_id?: string;
  file_path: string;
  file_name: string;
  file_size: number;
  status: 'PENDING' | 'UPLOADING' | 'DONE' | 'ERROR' | 'PAUSED';
  progress_bytes: number;
  created_at: number;
}

let initPromise: Promise<Database> | null = null;

export const initDB = async (): Promise<Database> => {
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    const db = await Database.load('sqlite:rekam_queue.db');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS upload_queue (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        section_id TEXT,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        progress_bytes INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
    return db;
  })();
  
  return initPromise;
};

export const enqueueFile = async (item: Omit<UploadQueueItem, 'status' | 'progress_bytes' | 'created_at'>) => {
  const db = await initDB();
  const createdAt = Date.now();
  await db.execute(
    'INSERT INTO upload_queue (id, activity_id, section_id, file_path, file_name, file_size, status, progress_bytes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [item.id, item.activity_id, item.section_id || null, item.file_path, item.file_name, item.file_size, 'PENDING', 0, createdAt]
  );
};

export const getQueue = async (): Promise<UploadQueueItem[]> => {
  const db = await initDB();
  return await db.select('SELECT * FROM upload_queue ORDER BY created_at ASC');
};

export const getPendingOrUploading = async (): Promise<UploadQueueItem[]> => {
  const db = await initDB();
  return await db.select("SELECT * FROM upload_queue WHERE status IN ('PENDING', 'UPLOADING') ORDER BY created_at ASC");
};

export const updateQueueStatus = async (id: string, status: UploadQueueItem['status'], progress_bytes?: number) => {
  const db = await initDB();
  if (progress_bytes !== undefined) {
    await db.execute('UPDATE upload_queue SET status = $1, progress_bytes = $2 WHERE id = $3', [status, progress_bytes, id]);
  } else {
    await db.execute('UPDATE upload_queue SET status = $1 WHERE id = $2', [status, id]);
  }
};

export const deleteFromQueue = async (id: string) => {
  const db = await initDB();
  await db.execute('DELETE FROM upload_queue WHERE id = $1', [id]);
};

export const deleteQueueItem = async (id: string) => {
  const db = await initDB();
  await db.execute('DELETE FROM upload_queue WHERE id = $1', [id]);
};
