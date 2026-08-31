import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useUserRole } from "../lib/role";
import {
  ApprovalItem, PendingCount, ENTITY_TYPE_LABELS, ACTION_LABELS,
  STATUS_LABELS, PRIORITY_LABELS, canApprove,
} from "../api/types";

const statusColor: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  returned_for_correction: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  resubmitted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

const typeColor: Record<string, string> = {
  tj: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  tj_splitter: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  cable: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  user: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  user_location: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  splitter: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  splice_box: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  infrastructure: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  loop: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  cable_cut: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  other: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const priorityColor: Record<string, string> = {
  low: "text-slate-400",
  normal: "text-brand-600 dark:text-brand-400",
  high: "text-amber-600 dark:text-amber-400",
  urgent: "text-red-600 dark:text-red-400",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function NocApprovals() {
  const navigate = useNavigate();
  const { role } = useUserRole();
  const approveOk = canApprove(role);
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [pending, setPending] = useState<PendingCount | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (typeFilter) params.entity_type = typeFilter;
    api.get<ApprovalItem[]>("/approvals", params).then(setItems).catch(() => {});
    api.get<PendingCount>("/approvals/pending-count").then(setPending).catch(() => {});
    setLoading(false);
  }, [statusFilter, typeFilter]);

  useEffect(load, [load]);

  const types = [
    { key: "", label: "All" },
    { key: "tj", label: "TJ" },
    { key: "tj_splitter", label: "TJ + Splitter" },
    { key: "cable", label: "Cable" },
    { key: "user", label: "User" },
    { key: "user_location", label: "User Location" },
    { key: "splitter", label: "Splitter" },
    { key: "splice_box", label: "Splice Box" },
    { key: "infrastructure", label: "Infrastructure" },
    { key: "other", label: "Other" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">NOC Approval Queue</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {pending ? `${pending.total} pending item${pending.total !== 1 ? "s" : ""}` : "Loading..."}
          </p>
        </div>
      </div>

      {/* Pending count cards */}
      {pending && pending.total > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {types.filter(t => t.key && (pending.by_type[t.key] || 0) > 0).map(t => (
            <button
              key={t.key}
              onClick={() => { setStatusFilter("pending"); setTypeFilter(typeFilter === t.key ? "" : t.key); }}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                typeFilter === t.key && statusFilter === "pending"
                  ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/30"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
              }`}
            >
              <div className="text-lg font-bold text-slate-900 dark:text-white">{pending.by_type[t.key] || 0}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="resubmitted">Resubmitted</option>
          <option value="returned_for_correction">Returned</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          {types.map(t => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Submitted By</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">View</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">Loading...</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No approval requests found</td>
              </tr>
            )}
            {!loading && items.map(item => (
              <tr
                key={item.id}
                className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                onClick={() => navigate(`/approvals/${item.id}`)}
              >
                <td className="px-4 py-3 font-mono text-xs text-slate-500">#{item.id}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${typeColor[item.entity_type] || typeColor.other}`}>
                    {ENTITY_TYPE_LABELS[item.entity_type] || item.entity_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                  {ACTION_LABELS[item.action] || item.action}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {item.entity_label || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                  {item.submitted_by_name || `User #${item.requested_by}`}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  <div>{fmtDate(item.created_at)}</div>
                  <div>{fmtTime(item.created_at)}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[item.status] || ""}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium ${priorityColor[item.priority] || ""}`}>
                    {PRIORITY_LABELS[item.priority] || item.priority}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={e => { e.stopPropagation(); navigate(`/approvals/${item.id}`); }}
                    className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
