import * as tus from 'tus-js-client';
import { invoke } from '@tauri-apps/api/core';
import { getPendingOrUploading, updateQueueStatus, deleteQueueItem, getQueue, type UploadQueueItem } from './Database';
import { getApiBase } from './store';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../api';

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
      const pendingItems = items.filter(item => item.status === 'PENDING');
      
      const parallelLimit = parseInt(localStorage.getItem('parallelUploads') || '4', 10);
      const availableSlots = parallelLimit - this.activeUploads.size;
      
      if (availableSlots > 0 && pendingItems.length > 0) {
        const batch = pendingItems.slice(0, availableSlots);
        batch.forEach(item => {
          // Fire and forget (it manages its own state and calls checkQueueSoon when done)
          this.startUpload(item).catch(e => console.error(`Failed to start upload for ${item.id}`, e));
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private checkQueueSoon() {
    setTimeout(() => {
      this.processQueue();
    }, 2000);
  }

  async pauseUpload(id: string) {
    const upload = this.activeUploads.get(id);
    if (upload) {
      upload.abort();
      this.activeUploads.delete(id);
    }
    await updateQueueStatus(id, 'PAUSED');
  }

  async resumeUpload(id: string) {
    await updateQueueStatus(id, 'PENDING');
    this.checkQueueSoon();
  }

  async cancelUpload(id: string) {
    const upload = this.activeUploads.get(id);
    if (upload) {
      upload.abort();
      this.activeUploads.delete(id);
    }
    this.uploadStats.delete(id);
    
    // Get the file path before deleting from queue to remove it from disk
    try {
      const queue = await getQueue();
      const item = queue.find(q => q.id === id);
      if (item && item.file_path) {
        await invoke('delete_staging_file', { filepath: item.file_path }).catch(err => {
          console.warn(`Failed to delete file from disk: ${item.file_path}`, err);
        });
      }
    } catch (e) {
      console.warn('Could not read queue for deletion', e);
    }

    await deleteQueueItem(id);
    this.checkQueueSoon();
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
      const apiBase = await getApiBase();

      // Check duplicate first
      const dupRes = await api.post('/api/media/check-duplicate-batch', {
        activity_id: item.activity_id,
        files: [{ id: item.id, checksum_sha256: sha256 }]
      });

      const duplicate = dupRes.data.data?.results?.[item.id];

      if (duplicate?.exists_in_activity) {
        await this.finishUpload(item);
        return;
      }

      if (duplicate?.reusable) {
        await api.post('/api/media/attach-duplicate', {
          activity_id: item.activity_id,
          section_id: item.section_id || null,
          checksum_sha256: sha256,
          filename: item.file_name,
          mime_type: blob.type || 'application/octet-stream'
        });
        await this.finishUpload(item);
        return;
      }

      // get fresh token after API call in case it was refreshed
      const freshToken = useAuthStore.getState().token;
      const tusHeaders: Record<string, string> = freshToken ? { 'Authorization': `Bearer ${freshToken}` } : {};

      // Initialize TUS upload
      return new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(blob, {
          endpoint: `${apiBase}/api/upload/tus`,
          headers: tusHeaders,
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
            toast.error(`Upload failed: ${error.message || error}`, { duration: Number.POSITIVE_INFINITY });
            alert(`UPLOAD FAILED:\n\n${error.message || error}`);
            await updateQueueStatus(item.id, 'ERROR');
            this.activeUploads.delete(item.id);
            this.uploadStats.delete(item.id);
            this.checkQueueSoon();
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
              const verified = await this.verifyServerUpload(item, sha256);
              if (!verified) {
                await updateQueueStatus(item.id, 'ERROR');
                this.checkQueueSoon();
                reject(new Error('Server belum mengonfirmasi hash upload'));
                return;
              }
              await this.finishUpload(item);
              resolve();
            } catch (error) {
              await updateQueueStatus(item.id, 'ERROR');
              this.checkQueueSoon();
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

    } catch (err: any) {
      console.error(`Upload error for ${item.id}:`, err);
      toast.error(`Queue error: ${err.message || err}`, { duration: Number.POSITIVE_INFINITY });
      alert(`QUEUE ERROR:\n\n${err.message || err}`);
      await updateQueueStatus(item.id, 'ERROR');
      this.activeUploads.delete(item.id);
      this.checkQueueSoon();
    }
  }

  private async verifyServerUpload(item: UploadQueueItem, sha256: string) {
    const query = new URLSearchParams({
      activity_id: item.activity_id,
      filename: item.file_name,
      sha256
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const res = await api.get(`/api/media/verify-upload?${query.toString()}`);
        if (res.data.verified) return true;
      } catch (err) {
        console.warn('Verify upload check failed:', err);
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
    
    this.checkQueueSoon();
  }



  async retryUpload(id: string) {
    if (this.activeUploads.has(id)) return;
    await updateQueueStatus(id, 'PENDING');
    this.checkQueueSoon();
  }
}

export const uploadEngine = new UploadEngine();
