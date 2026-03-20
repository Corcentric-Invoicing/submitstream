import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  onClose: () => void;
  onUploadComplete: () => void;
}

export default function InvoiceUpload({ onClose, onUploadComplete }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, 'pending' | 'uploading' | 'done' | 'error'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    setFiles(prev => [...prev, ...dropped]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const selected = Array.from(e.target.files).filter(f =>
        f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      setFiles(prev => [...prev, ...selected]);
    }
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setUploading(true);

    const newProgress: Record<string, 'pending' | 'uploading' | 'done' | 'error'> = {};
    const newErrors: Record<string, string> = {};
    files.forEach(f => { newProgress[f.name] = 'pending'; });
    setProgress(newProgress);

    for (const file of files) {
      setProgress(prev => ({ ...prev, [file.name]: 'uploading' }));

      try {
        // Upload via the Worker API endpoint
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;

        const formData = new FormData();
        formData.append('file', file);

        const resp = await fetch('/api/invoices/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: formData,
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(errBody || `HTTP ${resp.status}`);
        }

        setProgress(prev => ({ ...prev, [file.name]: 'done' }));
      } catch (err) {
        setProgress(prev => ({ ...prev, [file.name]: 'error' }));
        newErrors[file.name] = err instanceof Error ? err.message : 'Upload failed';
        setErrors(prev => ({ ...prev, [file.name]: newErrors[file.name] }));
      }
    }

    setUploading(false);

    // If any succeeded, refresh the invoice list
    const anyDone = Object.values(progress).some(s => s === 'done');
    if (anyDone) {
      setTimeout(() => onUploadComplete(), 500);
    }
  }

  const allDone = files.length > 0 && Object.values(progress).every(s => s === 'done' || s === 'error');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Upload Invoices</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
            }`}
          >
            <div className="text-4xl mb-2">📄</div>
            <p className="text-sm font-medium text-gray-700">Drop PDF invoices here</p>
            <p className="text-xs text-gray-500 mt-1">or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {files.map((file, i) => (
                <div key={`${file.name}-${i}`} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm">📄</span>
                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{(file.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {progress[file.name] === 'uploading' && (
                      <span className="text-xs text-blue-600">Uploading...</span>
                    )}
                    {progress[file.name] === 'done' && (
                      <span className="text-xs text-green-600">Done</span>
                    )}
                    {progress[file.name] === 'error' && (
                      <span className="text-xs text-red-600" title={errors[file.name]}>Failed</span>
                    )}
                    {!uploading && (
                      <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500 text-sm">&times;</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            {allDone ? 'Close' : 'Cancel'}
          </button>
          {!allDone && (
            <button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
