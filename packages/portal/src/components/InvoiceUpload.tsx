import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Upload, FileText, X, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Multi-file PDF upload modal. Drops files in, batch-POSTs to
 * /api/invoices/upload (one request per file). On success the parent
 * refreshes the queue.
 *
 * Visual style matches the rest of the design system: Ink primary CTA,
 * 6/8px radii, Pill components for per-file status, no emoji icons.
 */

interface Props {
  onClose: () => void;
  onUploadComplete: () => void;
}

type UploadState = 'pending' | 'uploading' | 'done' | 'error';

export default function InvoiceUpload({ onClose, onUploadComplete }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, UploadState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function acceptDropped(list: FileList | File[]): File[] {
    return Array.from(list).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    setFiles((prev) => [...prev, ...acceptDropped(e.dataTransfer.files)]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    setFiles((prev) => [...prev, ...acceptDropped(e.target.files!)]);
    // Reset the input so picking the same file again still triggers onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setUploading(true);

    const initial: Record<string, UploadState> = {};
    files.forEach((f) => (initial[f.name] = 'pending'));
    setProgress(initial);
    setErrors({});

    let anyDone = false;
    for (const file of files) {
      setProgress((prev) => ({ ...prev, [file.name]: 'uploading' }));
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const formData = new FormData();
        formData.append('file', file);

        const resp = await fetch('/api/invoices/upload', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        if (!resp.ok) throw new Error(await resp.text() || `HTTP ${resp.status}`);
        setProgress((prev) => ({ ...prev, [file.name]: 'done' }));
        anyDone = true;
      } catch (err) {
        setProgress((prev) => ({ ...prev, [file.name]: 'error' }));
        setErrors((prev) => ({
          ...prev,
          [file.name]: err instanceof Error ? err.message : 'Upload failed',
        }));
      }
    }

    setUploading(false);
    if (anyDone) {
      setTimeout(() => onUploadComplete(), 600);
    }
  }

  const allDone =
    files.length > 0 &&
    files.every((f) => progress[f.name] === 'done' || progress[f.name] === 'error');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      // NOTE: no backdrop click-to-close. A stray click outside the modal
      // would nuke an in-progress upload — too easy to lose work. Users
      // close via the X button or Cancel.
    >
      <div className="bg-white rounded-card shadow-2 max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <h2 className="text-base font-semibold text-ink">Upload invoices</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              PDF only. We OCR them as soon as they land.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="text-zinc-500 hover:text-ink p-1 -m-1 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'rounded-card border-2 border-dashed p-7 text-center cursor-pointer transition-colors',
              dragOver
                ? 'border-brand bg-brand-50'
                : 'border-line-2 bg-paper hover:bg-canvas hover:border-zinc-300'
            )}
          >
            <div className="inline-flex items-center justify-center h-9 w-9 rounded-control bg-white border border-line-2 mb-3">
              <Upload size={16} className="text-zinc-500" aria-hidden />
            </div>
            <p className="text-sm font-medium text-ink">Drop PDF invoices here</p>
            <p className="text-xs text-zinc-500 mt-0.5">or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Selected files */}
          {files.length > 0 && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {files.map((file, i) => {
                const state = progress[file.name];
                return (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-2.5 bg-paper border border-line rounded-control px-3 py-2"
                  >
                    <FileText size={14} className="text-zinc-500 shrink-0" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink truncate">{file.name}</div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                        {(file.size / 1024).toFixed(0)} KB
                        {state === 'error' && errors[file.name] && (
                          <span className="text-danger ml-2">· {errors[file.name]}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {state === 'uploading' && (
                        <Pill variant="ocr" pulse hideDot className="text-[10px]">
                          Uploading
                        </Pill>
                      )}
                      {state === 'done' && (
                        <Pill variant="submitted" hideDot className="text-[10px]">
                          <Check size={10} /> Done
                        </Pill>
                      )}
                      {state === 'error' && (
                        <Pill variant="rejected" hideDot className="text-[10px]">
                          <AlertTriangle size={10} /> Failed
                        </Pill>
                      )}
                      {!uploading && state !== 'done' && (
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="text-zinc-500 hover:text-danger p-0.5 -m-0.5"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-line flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            {allDone ? 'Close' : 'Cancel'}
          </Button>
          {!allDone && (
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
            >
              <Upload size={13} aria-hidden />
              {uploading
                ? 'Uploading…'
                : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
