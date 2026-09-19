import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import ActionResultBanner from "./ActionResultBanner";

interface BackupRecord {
  id: number;
  backup_id: string;
  created_at: string;
  status: string;
  trigger: string;
  app_version: string;
  total_files: number;
  total_records: number;
  total_size_bytes: number;
  checksum: string;
  local_status: string;
  cloud_status: string;
  file_details: { dataset: string; table: string; format: string; filename: string; size: number; records: number; checksum: string }[];
  error_message: string;
  restored_at: string | null;
}

interface BackupDataset {
  key: string;
  label: string;
  tables: string[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function BackupRestore() {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [datasets, setDatasets] = useState<BackupDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<string | null>(null);
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set());
  const [cloudSettings, setCloudSettings] = useState({
    r2_endpoint: "",
    r2_bucket_name: "",
    r2_access_key_id: "",
    r2_secret_access_key: "",
    backup_dir: "/app/backups",
    cloud_enabled: false,
  });
  const [editingCloud, setEditingCloud] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bList, dList, cSettings] = await Promise.all([
        api.get<BackupRecord[]>("/backup"),
        api.get<BackupDataset[]>("/backup/datasets"),
        api.get<any>("/backup/settings"),
      ]);
      setBackups(bList);
      setDatasets(dList);
      setCloudSettings(cSettings);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || "Failed to load backup data" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateBackup = async () => {
    setCreating(true);
    setMsg(null);
    try {
      const result = await api.post<any>("/backup", {});
      setMsg({
        ok: true,
        text: `Backup created: ${result.total_files} files, ${result.total_records} records (${formatBytes(result.total_size_bytes)})`,
      });
      loadData();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || "Backup failed" });
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (backupId: string) => {
    setRestoring(backupId);
    setMsg(null);
    setShowRestoreConfirm(null);
    try {
      const ds = selectedDatasets.size > 0 ? Array.from(selectedDatasets) : undefined;
      const params = ds ? `?${ds.map(d => `datasets=${d}`).join("&")}` : "";
      const result = await api.post<any>(`/backup/restore/${backupId}${params}`, {});
      setMsg({
        ok: true,
        text: `Restore completed: ${result.restored?.length || 0} tables restored`,
      });
      loadData();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || "Restore failed" });
    } finally {
      setRestoring(null);
      setSelectedDatasets(new Set());
    }
  };

  const handleDelete = async (backupId: string, cloud: boolean = false) => {
    setDeleting(backupId);
    setMsg(null);
    try {
      await api.delete(`/backup/${backupId}?cloud=${cloud}`);
      setMsg({ ok: true, text: "Backup deleted." });
      loadData();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.response?.data?.detail || "Delete failed" });
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = async (backupId: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/backup/download/${backupId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${backupId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Download failed" });
    }
  };

  const handleSaveCloudSettings = async () => {
    setCloudMsg(null);
    try {
      await api.post("/backup/settings", cloudSettings);
      setCloudMsg({ ok: true, text: "Cloud settings saved." });
      setEditingCloud(false);
      loadData();
    } catch (e: any) {
      setCloudMsg({ ok: false, text: e?.response?.data?.detail || "Failed to save" });
    }
  };

  const toggleDataset = (key: string) => {
    setSelectedDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12"><div className="text-sm text-slate-400">Loading backups...</div></div>;
  }

  return (
    <div className="space-y-4">
      {msg && <ActionResultBanner ok={msg.ok} message={msg.text} onDismiss={() => setMsg(null)} />}

      {/* Quick Actions */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Quick Backup</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Create a full backup of all application data</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreateBackup} disabled={creating} className="btn-primary px-4 py-2 text-sm">
              {creating ? (
                <span className="flex items-center gap-2"><Spinner /> Creating...</span>
              ) : "Create Backup"}
            </button>
          </div>
        </div>
      </section>

      {/* Cloud Storage */}
      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Cloud Storage (Cloudflare R2)</h2>
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${cloudSettings.cloud_enabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
            {cloudSettings.cloud_enabled ? "Connected" : "Disabled"}
          </span>
        </div>
        {editingCloud ? (
          <div className="space-y-3">
            <div>
              <label className="label">R2 Endpoint</label>
              <input value={cloudSettings.r2_endpoint} onChange={(e) => setCloudSettings({ ...cloudSettings, r2_endpoint: e.target.value })} className="input text-xs" placeholder="https://xxx.r2.cloudflarestorage.com" />
            </div>
            <div>
              <label className="label">Bucket Name</label>
              <input value={cloudSettings.r2_bucket_name} onChange={(e) => setCloudSettings({ ...cloudSettings, r2_bucket_name: e.target.value })} className="input text-xs" placeholder="my-bucket" />
            </div>
            <div>
              <label className="label">Access Key ID</label>
              <input value={cloudSettings.r2_access_key_id} onChange={(e) => setCloudSettings({ ...cloudSettings, r2_access_key_id: e.target.value })} className="input text-xs" placeholder="Access key..." />
            </div>
            <div>
              <label className="label">Secret Access Key</label>
              <input type="password" value={cloudSettings.r2_secret_access_key} onChange={(e) => setCloudSettings({ ...cloudSettings, r2_secret_access_key: e.target.value })} className="input text-xs" placeholder="Secret key..." />
            </div>
            {cloudMsg && (
              <div className={`rounded px-3 py-2 text-xs ${cloudMsg.ok ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                {cloudMsg.text}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleSaveCloudSettings} className="btn-primary px-3 py-1.5 text-xs">Save</button>
              <button onClick={() => { setEditingCloud(false); setCloudMsg(null); }} className="btn-secondary px-3 py-1.5 text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {cloudSettings.cloud_enabled ? `Bucket: ${cloudSettings.r2_bucket_name}` : "Configure R2 to enable cloud backup uploads"}
            </p>
            <button onClick={() => setEditingCloud(true)} className="btn-secondary px-3 py-1.5 text-xs">Configure</button>
          </div>
        )}
      </section>

      {/* Selective Restore */}
      {showRestoreConfirm && (
        <section className="card p-5 border-2 border-amber-400 dark:border-amber-500">
          <h2 className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-3">Restore Confirmation</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            This will <strong>overwrite current data</strong> with the backup. A safety backup will be created automatically before restore.
          </p>
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">Select datasets to restore (leave empty = restore all):</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {datasets.map((ds) => (
                <label key={ds.key} className={`flex items-center gap-2 rounded border px-3 py-2 text-xs cursor-pointer transition-colors ${selectedDatasets.has(ds.key) ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400" : "border-slate-200 dark:border-slate-700 hover:border-slate-300"}`}>
                  <input type="checkbox" checked={selectedDatasets.has(ds.key)} onChange={() => toggleDataset(ds.key)} className="rounded" />
                  <span className="text-slate-700 dark:text-slate-300">{ds.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleRestore(showRestoreConfirm)} disabled={restoring !== null} className="btn-primary px-4 py-1.5 text-xs">
              {restoring ? "Restoring..." : "Confirm Restore"}
            </button>
            <button onClick={() => { setShowRestoreConfirm(null); setSelectedDatasets(new Set()); }} className="btn-secondary px-4 py-1.5 text-xs">Cancel</button>
          </div>
        </section>
      )}

      {/* Backup History */}
      <section className="card p-5">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-4">Backup History</h2>
        {backups.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">No backups yet. Create your first backup above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Time</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Trigger</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Files</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Records</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Size</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Local</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Cloud</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.backup_id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatTime(b.created_at)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 capitalize">{b.trigger}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{b.total_files}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{b.total_records.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatBytes(b.total_size_bytes)}</td>
                    <td className="px-3 py-2"><CloudBadge status={b.local_status} /></td>
                    <td className="px-3 py-2"><CloudBadge status={b.cloud_status} /></td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => handleDownload(b.backup_id)} className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700" title="Download">
                          DL
                        </button>
                        <button onClick={() => setShowRestoreConfirm(b.backup_id)} disabled={restoring === b.backup_id} className="rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50" title="Restore">
                          {restoring === b.backup_id ? "..." : "Restore"}
                        </button>
                        <button onClick={() => handleDelete(b.backup_id)} disabled={deleting === b.backup_id} className="rounded bg-red-100 px-2 py-1 text-[11px] text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50" title="Delete">
                          {deleting === b.backup_id ? "..." : "Del"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Backup Details */}
      {selectedBackup && (() => {
        const b = backups.find(x => x.backup_id === selectedBackup);
        if (!b) return null;
        const byDataset = new Map<string, typeof b.file_details>();
        b.file_details.forEach(fd => {
          const arr = byDataset.get(fd.dataset) || [];
          arr.push(fd);
          byDataset.set(fd.dataset, arr);
        });
        return (
          <section className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Backup Details: {b.backup_id}</h2>
              <button onClick={() => setSelectedBackup(null)} className="text-xs text-slate-400 hover:text-slate-600">Close</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
              <div><span className="text-slate-500">Version:</span> <span className="text-slate-700 dark:text-slate-300">{b.app_version}</span></div>
              <div><span className="text-slate-500">Checksum:</span> <span className="font-mono text-slate-700 dark:text-slate-300">{b.checksum?.slice(0, 16)}...</span></div>
              <div><span className="text-slate-500">Restored:</span> <span className="text-slate-700 dark:text-slate-300">{formatTime(b.restored_at)}</span></div>
              <div><span className="text-slate-500">Error:</span> <span className="text-red-500">{b.error_message || "None"}</span></div>
            </div>
            {Array.from(byDataset.entries()).map(([ds, files]) => (
              <div key={ds} className="mb-3">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 capitalize">{ds.replace(/_/g, " ")}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex justify-between rounded bg-slate-50 px-3 py-1.5 text-[11px] dark:bg-slate-800">
                      <span className="text-slate-600 dark:text-slate-400">{f.table}</span>
                      <span className="text-slate-500">{f.format.toUpperCase()} — {f.records} recs — {formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })()}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    failed: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    pending: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}

function CloudBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "text-green-600 dark:text-green-400",
    pending: "text-amber-500",
    failed: "text-red-500",
    disabled: "text-slate-400",
    deleted: "text-slate-300 dark:text-slate-600",
  };
  const labels: Record<string, string> = {
    completed: "Synced",
    pending: "Uploading...",
    failed: "Failed",
    disabled: "Off",
    deleted: "Deleted",
  };
  return (
    <span className={`text-[11px] font-medium ${colors[status] || colors.disabled}`}>
      {labels[status] || status}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
