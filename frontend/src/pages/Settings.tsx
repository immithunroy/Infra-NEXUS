import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme";
import { api, downloadFile } from "../api/client";
import { useUserRole } from "../lib/role";
import ActionResultBanner from "../components/ActionResultBanner";
import { setTimezone, fmtTimeInZone, getTimezone } from "../lib/time";

type Tab = "general" | "users" | "backup" | "google" | "communication";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: "general",
    label: "General",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    key: "users",
    label: "User Settings",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    key: "backup",
    label: "Backup & Restore",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
  {
    key: "google",
    label: "Google Map API",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
  },
  {
    key: "communication",
    label: "Communication",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
];

export default function Settings() {
  const { theme, toggle } = useTheme();
  const { role } = useUserRole();
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // API Keys state
  const [gmapsKey, setGmapsKey] = useState("");
  const [gmapsOrig, setGmapsOrig] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Timezone state
  const [timezone, setTimezoneVal] = useState("Asia/Dhaka");
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([]);
  const [tzMsg, setTzMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingTz, setSavingTz] = useState(false);

  useEffect(() => {
    api.get<any[]>("/settings").then((list) => {
      const found = list.find((s) => s.key === "google_maps_api_key");
      if (found) {
        setGmapsKey(found.value);
        setGmapsOrig(found.value);
      }
      const tzFound = list.find((s) => s.key === "timezone");
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
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>

      {msg && <ActionResultBanner ok={msg.ok} message={msg.text} onDismiss={() => setMsg(null)} />}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* ── Tab Navigation ─────────────────────────────────────── */}
        <nav className="w-full shrink-0 lg:w-56">
          <div className="flex flex-row gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900 lg:flex-col lg:overflow-visible">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {/* ── Tab Content ────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">

          {/* ═══ GENERAL SETTINGS ═══ */}
          {activeTab === "general" && (
            <div className="space-y-4">
              {/* Appearance */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
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

              {/* Timezone */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Timezone</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-700 dark:text-slate-300">Application Timezone</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">All timestamps are displayed in this timezone</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={timezone}
                        onChange={(e) => setTimezoneVal(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {timezoneOptions.map((tz) => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                      <button
                        className="btn-primary px-2 py-1 text-xs"
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

              {/* Network Map */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Network Map</h2>
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
            </div>
          )}

          {/* ═══ USER SETTINGS ═══ */}
          {activeTab === "users" && (
            <div className="space-y-4">
              {/* Account */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Account</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-700 dark:text-slate-300">Role</div>
                    <span className="text-xs font-medium capitalize text-slate-500 dark:text-slate-400">{role || "\u2014"}</span>
                  </div>
                </div>
              </section>

              {/* Change Password */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Change Password</h2>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Current Password</label>
                    <div className="flex">
                      <input type={showCurrent ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input flex-1" placeholder="Current password" />
                      <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="ml-2 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{showCurrent ? "Hide" : "Show"}</button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">New Password</label>
                    <div className="flex">
                      <input type={showNew ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input flex-1" placeholder="New password" />
                      <button type="button" onClick={() => setShowNew(!showNew)} className="ml-2 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{showNew ? "Hide" : "Show"}</button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Confirm New Password</label>
                    <div className="flex">
                      <input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input flex-1" placeholder="Confirm new password" />
                      <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="ml-2 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{showConfirm ? "Hide" : "Show"}</button>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Minimum 6 characters</div>
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

              {/* Manage Users Link */}
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">User Management</h2>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-700 dark:text-slate-300">Manage employee accounts, roles, and permissions</div>
                  <a href="/users" className="text-xs text-blue-600 hover:underline dark:text-blue-400">Open Users &rarr;</a>
                </div>
              </section>
            </div>
          )}

          {/* ═══ BACKUP & RESTORE ═══ */}
          {activeTab === "backup" && (
            <div className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Export Data</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-700 dark:text-slate-300">Export Fiber Network</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Download all cables, TJ boxes, splitters, and splices as Excel</div>
                    </div>
                    <button className="btn-primary px-3 py-1.5 text-xs" onClick={handleExport}>Export</button>
                  </div>
                  <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-slate-700 dark:text-slate-300">Export Subscribers</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">Download all subscribers with address, PPPoE, MAC history, and router brand</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => handleExportUsers("xlsx")}>Excel</button>
                        <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => handleExportUsers("json")}>JSON</button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Import Data</h2>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-700 dark:text-slate-300">Import Fiber Network</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Upload Excel file to import/update fiber data</div>
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
          {activeTab === "google" && (
            <div className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Google Maps API Key</h2>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">API Key</label>
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
                      className="btn-primary mt-2 px-3 py-1.5 text-xs"
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
          {activeTab === "communication" && (
            <div className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Notifications</h2>
                <div className="space-y-3">
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
      </div>
    </div>
  );
}
