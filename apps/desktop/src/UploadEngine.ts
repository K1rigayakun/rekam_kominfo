import * as tus from 'tus-js-client';
import { invoke } from '@tauri-apps/api/core';
import { getPendingOrUploading, updateQueueStatus, UploadQueueItem } from './Database';
import { getApiBase, getToken } from './store';

function getTusChunkSize(fileSize: number) {
  if (fileSize < 100 * 1024 * 1024) return 5 * 1024 * 1024;
  if (fileSize < 1024 * 1024 * 1024) return 10 * 1024 * 1024;
  return 25 * 1024 * 1024;
}

class UploadEngine {
  private isProcessing = false;
  private activeUploads = new Map<string, tus.Upload>();
  
  // Transient state for UI (speed and ETA)
  public uploadStats = new Map<string, { speedBytesPerSec: number, etaSeconds: number, lastBytes: number, lastTime: number }>();

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const items = await getPendingOrUploading();
      
      const parallelLimit = parseInt(localStorage.getItem('parallelUploads') || '4', 10);
      const batch = items.slice(0, parallelLimit);
      
      const promises = batch.map(item => this.startUpload(item));
      await Promise.allSettled(promises);
      
    } finally {
      this.isProcessing = false;
      // Re-trigger if queue is not empty
      this.checkQueueSoon();
    }
  }

  private checkQueueSoon() {
    setTimeout(() => {
      this.processQueue();
    }, 2000);
  }

  async startUpload(item: UploadQueueItem) {
    if (this.activeUploads.has(item.id)) return;

    try {
      await updateQueueStatus(item.id, 'UPLOADING');

      // Use asset:// protocol to bypass Tauri fs restrictions
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const assetUrl = convertFileSrc(item.file_path);
      
      const response = await fetch(assetUrl);
      if (!response.ok) throw new Error('File not found in staging');
      
      const blob = await response.blob();
      
      // Calculate SHA-256 using Rust for speed
      const sha256 = await invoke<string>('calculate_sha256', { filepath: item.file_path });
      const token = await getToken();
      const apiBase = await getApiBase();
      const authHeaders: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      // Check duplicate first
      const dupRes = await fetch(`${apiBase}/api/media/check-duplicate-batch`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          activity_id: item.activity_id,
          files: [{ id: item.id, checksum_sha256: sha256 }]
        })
      });
      
      if (!dupRes.ok) {
        throw new Error('Gagal mengecek duplikasi ke server');
      }

      const dupData = await dupRes.json();
      const duplicate = dupData.data?.results?.[item.id];

      if (duplicate?.exists_in_activity) {
        await this.finishUpload(item);
        return;
      }

      if (duplicate?.reusable) {
        const attachRes = await fetch(`${apiBase}/api/media/attach-duplicate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({
            activity_id: item.activity_id,
            section_id: item.section_id || null,
            checksum_sha256: sha256,
            filename: item.file_name,
            mime_type: blob.type || 'application/octet-stream'
          })
        });
        if (!attachRes.ok) {
          throw new Error('Gagal membuat metadata duplikat di server');
        }
        await this.finishUpload(item);
        return;
      }

      // Initialize TUS upload
      return new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(blob, {
          endpoint: `${apiBase}/api/upload/tus`,
          headers: authHeaders,
          chunkSize: getTusChunkSize(item.file_size),
          retryDelays: [0, 3000, 5000, 10000, 20000],
          metadata: {
            filename: item.file_name,
            filetype: blob.type || 'application/octet-stream',
            activity_id: item.activity_id,
            section_id: item.section_id || '',
            mime_type: blob.type || 'application/octet-stream',
            sha256_local: sha256,
            file_size: String(item.file_size),
            auto_naming: 'true'
          },
          onError: async (error) => {
            console.error('Failed to upload:', error);
            await updateQueueStatus(item.id, 'ERROR');
            this.activeUploads.delete(item.id);
            this.uploadStats.delete(item.id);
            reject(error);
          },
          onProgress: async (bytesUploaded) => {
            const now = Date.now();
            let stat = this.uploadStats.get(item.id);
            
            if (!stat) {
              stat = { speedBytesPerSec: 0, etaSeconds: 0, lastBytes: bytesUploaded, lastTime: now };
              this.uploadStats.set(item.id, stat);
            } else {
              const dt = (now - stat.lastTime) / 1000;
              if (dt >= 1) { // Calculate every 1 second
                const diff = bytesUploaded - stat.lastBytes;
                const speed = diff / dt;
                const remaining = item.file_size - bytesUploaded;
                const eta = speed > 0 ? remaining / speed : 0;
                
                this.uploadStats.set(item.id, {
                  speedBytesPerSec: speed,
                  etaSeconds: eta,
                  lastBytes: bytesUploaded,
                  lastTime: now
                });
              }
            }

            await updateQueueStatus(item.id, 'UPLOADING', bytesUploaded);
          },
          onSuccess: async () => {
            try {
              const verified = await this.verifyServerUpload(apiBase, authHeaders, item, sha256);
              if (!verified) {
                await updateQueueStatus(item.id, 'ERROR');
                reject(new Error('Server belum mengonfirmasi hash upload'));
                return;
              }
              await this.finishUpload(item);
              resolve();
            } catch (error) {
              await updateQueueStatus(item.id, 'ERROR');
              reject(error);
            }
          }
        });

        this.activeUploads.set(item.id, upload);
        upload.findPreviousUploads().then(previousUploads => {
          if (previousUploads.length) {
            upload.resumeFromPreviousUpload(previousUploads[0]);
          }
          upload.start();
        });
      });

    } catch (err) {
      console.error(`Upload error for ${item.id}:`, err);
      await updateQueueStatus(item.id, 'ERROR');
      this.activeUploads.delete(item.id);
    }
  }

  private async verifyServerUpload(apiBase: string, authHeaders: Record<string, string>, item: UploadQueueItem, sha256: string) {
    const query = new URLSearchParams({
      activity_id: item.activity_id,
      filename: item.file_name,
      sha256
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await fetch(`${apiBase}/api/media/verify-upload?${query.toString()}`, {
        headers: authHeaders
      });
      if (res.ok) {
        const data = await res.json();
        if (data.verified) return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  private async finishUpload(item: UploadQueueItem) {
    this.activeUploads.delete(item.id);
    this.uploadStats.delete(item.id);
    await updateQueueStatus(item.id, 'DONE');
    
    // Call Rust to delete staging file
    try {
      await invoke('delete_staging_file', { filepath: item.file_path });
    } catch (e) {
      console.warn('Failed to delete staging file:', e);
    }
    
    // Optional: Keep in DB for history or remove
    // await deleteQueueItem(item.id);
  }

  cancelUpload(id: string) {
    const upload = this.activeUploads.get(id);
    if (upload) {
      upload.abort();
      this.activeUploads.delete(id);
      updateQueueStatus(id, 'ERROR');
    }
  }

  async retryUpload(id: string) {
    if (this.activeUploads.has(id)) return;
    await updateQueueStatus(id, 'PENDING');
    this.checkQueueSoon();
  }
}

export const uploadEngine = new UploadEngine();
