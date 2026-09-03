import { useRef, useState } from "react";
import { useTheme } from "../theme";
import { downloadFile } from "../api/client";
import { useUserRole } from "../lib/role";
import ActionResultBanner from "../components/ActionResultBanner";

export default function Settings() {
  const { theme, toggle } = useTheme();
  const { role } = useUserRole();
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      await downloadFile("/fiber/export", "fiber_network.xlsx");
      setMsg({ ok: true, text: "Export started. Check your downloads." });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const handleExportUsers = async (format: "xlsx" | "json") => {
    try {
      await downloadFile(`/subscribers/export?format=${format}`, `subscribers_export.${format}`);
      setMsg({ ok: true, text: "Export started. Check your downloads." });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("token");
      const res = await fetch("/api/fiber/import", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        let msg = "Import failed";
        try { const j = await res.json(); msg = j.detail || JSON.stringify(j); } catch {}
        throw new Error(msg);
      }
      const result = await res.json();
      setMsg({ ok: true, text: `Import complete. ${result.created || 0} created, ${result.updated || 0} updated, ${result.skipped || 0} skipped.` });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>

      {msg && <ActionResultBanner ok={msg.ok} message={msg.text} onDismiss={() => setMsg(null)} />}

      {/* Appearance */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Appearance</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-700 dark:text-slate-300">Theme</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Switch between light and dark mode</div>
          </div>
          <button onClick={toggle} className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" style={{ backgroundColor: theme === "dark" ? "#3b82f6" : "#cbd5e1" }}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${theme === "dark" ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </section>

      {/* Network Map */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Network Map</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-700 dark:text-slate-300">Customer Layer</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Show subscriber/user markers on the map by default</div>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Controlled via map checkbox</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-700 dark:text-slate-300">Base Map</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Default map tile layer</div>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Controlled via map selector</span>
          </div>
        </div>
      </section>

      {/* Data Management */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Data Management</h2>
        <div className="space-y-4">
          {/* Export Fiber Network */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-700 dark:text-slate-300">Export Fiber Network</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Download all cables, TJ boxes, splitters, and splices as Excel</div>
            </div>
            <button className="btn-primary text-xs py-1.5 px-3" onClick={handleExport}>Export</button>
          </div>

          {/* Export Subscribers */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-700 dark:text-slate-300">Export Subscribers</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Download all subscribers with address, PPPoE, MAC history, and router brand</div>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-xs py-1.5 px-3" onClick={() => handleExportUsers("xlsx")}>Excel</button>
                <button className="btn-primary text-xs py-1.5 px-3" onClick={() => handleExportUsers("json")}>JSON</button>
              </div>
            </div>
          </div>

          {/* Import */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-700 dark:text-slate-300">Import Fiber Network</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Upload Excel file to import/update fiber data</div>
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleImport(e.target.files[0]); }} />
                <button className="btn-primary text-xs py-1.5 px-3" onClick={() => fileRef.current?.click()} disabled={importing}>
                  {importing ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Account */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Account</h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-700 dark:text-slate-300">Role</div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 capitalize">{role || "—"}</span>
          </div>
        </div>
      </section>

      {/* System */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">System</h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-700 dark:text-slate-300">Scheduled Jobs</div>
            <a href="/schedule-jobs" className="text-xs text-blue-600 hover:underline dark:text-blue-400">Manage</a>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-700 dark:text-slate-300">Approvals</div>
            <a href="/approvals" className="text-xs text-blue-600 hover:underline dark:text-blue-400">View</a>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-700 dark:text-slate-300">Scan Logs</div>
            <a href="/scans" className="text-xs text-blue-600 hover:underline dark:text-blue-400">View</a>
          </div>
        </div>
      </section>
    </div>
  );
}
