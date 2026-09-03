import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadPhoto, downloadFile } from "../api/client";
import type {
  FieldPhotoListResponse,
  FieldPhotoItem,
  FieldPhotoUploadResponse,
} from "../api/types";

interface Props {
  entityType: "tj" | "subscriber";
  entityId: string;
  photoTypes: readonly string[];
  photoLabels: Record<string, string>;
}

const ACCEPT = "image/jpeg,image/png,image/webp";

export default function PhotoGallery({ entityType, entityId, photoTypes, photoLabels }: Props) {
  const [data, setData] = useState<FieldPhotoListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [viewerPhoto, setViewerPhoto] = useState<FieldPhotoItem | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .get<FieldPhotoListResponse>(`/photos/${entityType}/${entityId}`)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  useEffect(load, [load]);

  const handleFile = async (photoType: string, file: File) => {
    setUploading(photoType);
    setError("");
    try {
      await uploadPhoto(entityType, entityId, photoType, file);
      load();
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (photoType: string) => {
    if (!confirm(`Delete ${photoLabels[photoType] || photoType} photo?`)) return;
    setError("");
    try {
      await api.del(`/photos/${entityType}/${entityId}/${photoType}`);
      load();
    } catch (e: any) {
      setError(e.message || "Delete failed");
    }
  };

  const handleDownload = async (photo: FieldPhotoItem) => {
    if (!photo.url) return;
    const ext = "jpg";
    await downloadFile(photo.url, `${entityId}_${photo.photo_type}.${ext}`);
  };

  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-slate-400">Loading photos...</div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Field Photos
        </h3>
        {data && (
          <span className="text-[10px] text-slate-400">
            {data.totalUploaded}/{data.total_required} uploaded
          </span>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Photo Grid — row on desktop, stack on mobile */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {photoTypes.map((pt) => {
          const photo = data?.photos.find((p) => p.photo_type === pt);
          const isUploaded = photo?.uploaded;
          const isUploading = uploading === pt;

          return (
            <div
              key={pt}
              className="relative overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
            >
              {/* Image or placeholder */}
              {isUploaded && photo?.url ? (
                <button
                  type="button"
                  className="block w-full cursor-zoom-in"
                  onClick={() => setViewerPhoto(photo)}
                >
                  <img
                    src={photo.url}
                    alt={photoLabels[pt] || pt}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ) : (
                <div className="flex aspect-square items-center justify-center bg-slate-100 dark:bg-slate-800">
                  <span className="text-xs text-slate-400">No photo</span>
                </div>
              )}

              {/* Label + actions */}
              <div className="p-2">
                <div className="mb-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  {photoLabels[pt] || pt}
                </div>

                {/* GPS badge */}
                {isUploaded && photo?.latitude != null && photo?.longitude != null && (
                  <div className="mb-1.5 text-[10px] text-slate-400">
                    {photo.latitude.toFixed(6)}, {photo.longitude.toFixed(6)}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-1.5">
                  {/* Upload / Replace */}
                  <input
                    ref={(el) => { fileRefs.current[pt] = el; }}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(pt, f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileRefs.current[pt]?.click()}
                    className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    {isUploading ? "Uploading..." : isUploaded ? "Replace" : "Upload"}
                  </button>

                  {/* Download */}
                  {isUploaded && (
                    <button
                      type="button"
                      onClick={() => handleDownload(photo)}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      ↓
                    </button>
                  )}

                  {/* Delete */}
                  {isUploaded && (
                    <button
                      type="button"
                      onClick={() => handleDelete(pt)}
                      className="rounded border border-red-200 bg-white px-2 py-1 text-[10px] text-red-500 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Photo viewer modal */}
      {viewerPhoto && viewerPhoto.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewerPhoto(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {/* Close */}
            <button
              onClick={() => setViewerPhoto(null)}
              className="absolute -top-3 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg font-bold text-slate-700 shadow-md hover:bg-slate-100"
            >
              ✕
            </button>

            <img
              src={viewerPhoto.url}
              alt={photoLabels[viewerPhoto.photo_type] || viewerPhoto.photo_type}
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
            />

            {/* Info bar */}
            <div className="mt-2 flex items-center justify-between rounded-lg bg-white/90 px-3 py-2 text-xs text-slate-600 backdrop-blur dark:bg-slate-900/90 dark:text-slate-300">
              <span className="font-medium">{photoLabels[viewerPhoto.photo_type] || viewerPhoto.photo_type}</span>
              <div className="flex gap-3">
                {viewerPhoto.captured_at && (
                  <span className="text-slate-400">
                    {new Date(viewerPhoto.captured_at).toLocaleString()}
                  </span>
                )}
                {viewerPhoto.latitude != null && (
                  <span className="text-slate-400">
                    GPS: {viewerPhoto.latitude.toFixed(6)}, {viewerPhoto.longitude?.toFixed(6)}
                  </span>
                )}
                {viewerPhoto.file_size && (
                  <span className="text-slate-400">
                    {(viewerPhoto.file_size / 1024).toFixed(0)} KB
                  </span>
                )}
              </div>
              <button
                onClick={() => handleDownload(viewerPhoto)}
                className="rounded bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-600"
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
