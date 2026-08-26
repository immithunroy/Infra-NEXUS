import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { api, setToken } from "../api/client";
import { canManageUsers, ROLE_LABELS, UserOut } from "../api/types";
import { useTheme } from "../theme";
import GlobalSearch from "./GlobalSearch";

const links = [
  { to: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { to: "/devices", label: "Devices", icon: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" },
  { to: "/onus", label: "ONU / ONT", icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" },
  { to: "/bindings", label: "MAC Bindings", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { to: "/subscribers", label: "Subscribers", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" },
  { to: "/tickets", label: "Tickets & To-do", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { to: "/acs", label: "ACS · Routers", icon: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" },
  { to: "/live-downs", label: "Live Down Detection", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
  { to: "/network-map", label: "User Map", icon: "M1 6v12h22V6H1zm8 3v9M5 15l4-4m10 0l-4 4M9 9h6M9 9l-3 3m6-3l5 5m0-5l-5 5" },
  { to: "/fiber-map", label: "Fiber Map", icon: "M4 4h16v4H4zM4 12h10v4H4zM4 20h6v0H4zM14 12l6 8M20 12l-6 8" },
  { to: "/reports", label: "Reports", icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { to: "/scans", label: "Scan Logs", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { to: "/schedule-jobs", label: "Schedule Jobs", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState<UserOut | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const isMapPage = location.pathname === "/fiber-map" || location.pathname === "/network-map";

  useEffect(() => {
    api.get<UserOut>("/auth/me").then(setUser).catch(() => undefined);
  }, []);

  const logout = () => {
    setToken(null);
    navigate("/login");
  };

  const roleLabel = user ? ROLE_LABELS[user.role] || user.role : "";

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setNavOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white text-slate-600 transition-transform dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 lg:static lg:z-auto lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white">Infra NEXUS</div>
            <div className="text-[11px] text-slate-400 dark:text-slate-400">GPON / EPON monitoring</div>
          </div>
          <button
            type="button"
            className="ml-auto rounded-md p-1 text-slate-400 lg:hidden"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-3">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`
              }
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={link.icon} />
              </svg>
              {link.label}
            </NavLink>
          ))}
          {canManageUsers(user?.role) && (
            <NavLink
              to="/users"
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`
              }
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
              Users & Roles
            </NavLink>
          )}
        </nav>
        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
            <div className="font-medium text-slate-700 dark:text-slate-200">{user?.username || "…"}</div>
            <div className="text-slate-400 dark:text-slate-500">{roleLabel || "…"}</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85 sm:px-6">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={toggle}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>
            <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block dark:bg-slate-700" />
            <div className="hidden flex-col items-end sm:flex">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{user?.username || "…"}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">{roleLabel || "…"}</span>
            </div>
            <button
              onClick={logout}
              className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden md:inline">Sign out</span>
            </button>
          </div>
        </header>
        <main className={`flex-1 overflow-x-hidden ${isMapPage ? "" : "p-4 sm:p-6"}`}>
          <Outlet />
        </main>
        <footer className="border-t border-slate-200 bg-slate-50 px-6 py-4 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-500">
          <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between">
            <span>&copy; {new Date().getFullYear()} Infra NEXUS. All rights reserved.</span>
            <span>Developed by <a href="mailto:immithunroy@gmail.com" className="font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400">Mithun Chandra Roy</a></span>
          </div>
        </footer>
      </div>
    </div>
  );
}
