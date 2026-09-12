import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme";
import { api, downloadFile } from "../api/client";
import { useUserRole } from "../lib/role";
import ActionResultBanner from "../components/ActionResultBanner";
import { setTimezone, fmtTimeInZone, getTimezone } from "../lib/time";

type Tab = "general" | "users" | "backup" | "google" | "communication";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "users", label: "User Settings" },
  { key: "backup", label: "Backup & Restore" },
  { key: "google", label: "Google Map API" },
  { key: "communication", label: "Communication" },
];

export default function Settings() {
  const { theme, toggle } = useTheme();
  const { role } = useUserRole();
  const [tab, setTab] = useState<Tab>("general");
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [gmapsKey, setGmapsKey] = useState("");
  const [gmapsOrig, setGmapsOrig] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const [timezone, setTimezoneVal] = useState("Asia/Dhaka");
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([]);
  const [tzMsg, setTzMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingTz, setSavingTz] = useState(false);

  useEffect(() => {
    api.get<any[]>("/settings").then((list) => {
      const found = list.find((s: any) => s.key === "google_maps_api_key");
      if (found) {
        setGmapsKey(found.value);
        setGmapsOrig(found.value);
      }
      const tzFound = list.find((s: any) => s.key === "timezone");
      if (tzFound) setTimezoneVal(tzFound.value);
    }).catch(() => {});
    api.get<{ timezones: string[]; default: string }>("/settings/timezone/options").then((data) => {
      setTimezoneOptions(data.timezones || []);
    }).catch(() => {});
  }, []);

  if (role !== "admin") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="text-red-500 text-lg font-semibold">Access Denied</div>
          <div className="text-sm text-slate-500">Settings are restricted to administrators.</div>
        </div>
      </div>
    );
  }

  const handleChangePassword = async () => {
    setPwMsg(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwMsg({ ok: false, text: "All fields are required." });
      return;
    }
    if (newPassword.length < 6) {
      setPwMsg({ ok: false, text: "New password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    if (currentPassword === newPassword) {
      setPwMsg({ ok: false, text: "New password must be different from current password." });
      return;
    }
    setChangingPassword(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword, confirmPassword });
      setPwMsg({ ok: true, text: "Password changed successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "Failed to change password";
      setPwMsg({ ok: false, text: detail });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSaveApiKey = async () => {
    setKeyMsg(null);
    setSavingKey(true);
    try {
      await api.put("/settings/google_maps_api_key", { value: gmapsKey });
      setGmapsOrig(gmapsKey);
      setKeyMsg({ ok: true, text: "Google Maps API key saved." });
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "Failed to save";
      setKeyMsg({ ok: false, text: detail });
    } finally {
      setSavingKey(false);
    }
  };

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
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage application preferences, user accounts, integrations, and data backups.
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <ActionResultBanner ok={msg.ok} message={msg.text} onDismiss={() => setMsg(null)} />}

      {/* ═══ GENERAL ═══ */}
      {tab === "general" && (
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Appearance</h2>
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

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Timezone</h2>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">Application Timezone</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">All timestamps are displayed in this timezone</div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={timezone}
                    onChange={(e) => setTimezoneVal(e.target.value)}
                    className="input py-1 text-xs"
                  >
                    {timezoneOptions.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                  <button
                    className="btn-primary px-3 py-1 text-xs"
                    onClick={async () => {
                      setSavingTz(true);
                      setTzMsg(null);
                      try {
                        await api.put("/settings/timezone", { value: timezone });
                        setTimezone(timezone);
                        setTzMsg({ ok: true, text: `Timezone changed to ${timezone}` });
                      } catch (e: any) {
                        setTzMsg({ ok: false, text: e?.response?.data?.detail || "Failed to save" });
                      } finally {
                        setSavingTz(false);
                      }
                    }}
                    disabled={savingTz}
                  >
                    {savingTz ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
              {tzMsg && (
                <div className={`rounded px-3 py-2 text-xs ${tzMsg.ok ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                  {tzMsg.text}
                </div>
              )}
              <div className="text-[11px] text-slate-400 dark:text-slate-500">
                Current time in <strong>{timezone}</strong>: {fmtTimeInZone(new Date(), timezone)}
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Network Map</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">Customer Layer</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Show subscriber markers on the map by default</div>
                </div>
                <span className="text-xs text-slate-400">Controlled via map checkbox</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">Base Map</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Default map tile layer</div>
                </div>
                <span className="text-xs text-slate-400">Controlled via map selector</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ═══ USER SETTINGS ═══ */}
      {tab === "users" && (
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Account</h2>
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-700 dark:text-slate-300">Role</div>
              <span className="text-xs font-medium capitalize text-slate-500 dark:text-slate-400">{role || "\u2014"}</span>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Change Password</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Current Password</label>
                <div className="flex">
                  <input type={showCurrent ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input flex-1" placeholder="Current password" />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="ml-2 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{showCurrent ? "Hide" : "Show"}</button>
                </div>
              </div>
              <div>
                <label className="label">New Password</label>
                <div className="flex">
                  <input type={showNew ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input flex-1" placeholder="New password" />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="ml-2 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{showNew ? "Hide" : "Show"}</button>
                </div>
              </div>
              <div>
                <label className="label">Confirm New Password</label>
                <div className="flex">
                  <input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input flex-1" placeholder="Confirm new password" />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="ml-2 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{showConfirm ? "Hide" : "Show"}</button>
                </div>
              </div>
              <div className="text-xs text-slate-400">Minimum 6 characters</div>
              {pwMsg && (
                <div className={`rounded px-3 py-2 text-xs ${pwMsg.ok ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                  {pwMsg.text}
                </div>
              )}
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={handleChangePassword} disabled={changingPassword}>
                {changingPassword ? "Changing..." : "Change Password"}
              </button>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">User Management</h2>
                <div className="text-xs text-slate-500 dark:text-slate-400">Manage employee accounts, roles, and permissions</div>
              </div>
              <a href="/users" className="text-xs text-blue-600 hover:underline dark:text-blue-400">Open Users &rarr;</a>
            </div>
          </section>
        </div>
      )}

      {/* ═══ BACKUP & RESTORE ═══ */}
      {tab === "backup" && (
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Export Data</h2>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">Export Fiber Network</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Download cables, TJ boxes, splitters, splices as Excel</div>
                </div>
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={handleExport}>Export</button>
              </div>
              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-slate-700 dark:text-slate-300">Export Subscribers</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">All subscribers with address, PPPoE, MAC history, router brand</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => handleExportUsers("xlsx")}>Excel</button>
                    <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => handleExportUsers("json")}>JSON</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Import Data</h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-slate-700 dark:text-slate-300">Import Fiber Network</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Upload Excel file to import or update fiber data</div>
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleImport(e.target.files[0]); }} />
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => fileRef.current?.click()} disabled={importing}>
                  {importing ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ═══ GOOGLE MAP API ═══ */}
      {tab === "google" && (
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Google Maps API Key</h2>
            <div className="space-y-3">
              <div>
                <label className="label">API Key</label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={gmapsKey}
                    onChange={(e) => setGmapsKey(e.target.value)}
                    className="input flex-1 font-mono text-xs"
                    placeholder="AIza..."
                  />
                  <button type="button" onClick={() => setShowKey(!showKey)} className="px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{showKey ? "Hide" : "Show"}</button>
                </div>
                <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  Required for Google Map page. Get one at{" "}
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Google Cloud Console</a>.
                  Enable <strong>Maps JavaScript API</strong> and <strong>Geocoding API</strong>.
                </div>
                {keyMsg && (
                  <div className={`mt-2 rounded px-3 py-2 text-xs ${keyMsg.ok ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                    {keyMsg.text}
                  </div>
                )}
                <button
                  className="btn-primary mt-3 px-3 py-1.5 text-xs"
                  onClick={handleSaveApiKey}
                  disabled={savingKey || gmapsKey === gmapsOrig}
                >
                  {savingKey ? "Saving..." : "Save Key"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ═══ COMMUNICATION ═══ */}
      {tab === "communication" && (
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Notifications</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">Mobile Push Notifications</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Send push notifications to employee mobile apps when leads are assigned</div>
                </div>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Coming Soon</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">SMS Notifications</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Send SMS to customers for lead follow-ups and connection updates</div>
                </div>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Coming Soon</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">Email Notifications</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Send email notifications for important system events</div>
                </div>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Coming Soon</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
