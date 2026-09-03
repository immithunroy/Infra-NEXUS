import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useUserRole } from "../lib/role";
import {
  ApprovalDetail as ApprovalDetailType, ENTITY_TYPE_LABELS, ACTION_LABELS,
  STATUS_LABELS, PRIORITY_LABELS, canApprove, canSubmit,
} from "../api/types";
import ActionResultBanner from "../components/ActionResultBanner";

const statusColor: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  returned_for_correction: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  resubmitted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Fields to display per entity type (order matters)
const ENTITY_FIELDS: Record<string, { key: string; label: string; format?: (v: unknown) => string }[]> = {
  tj: [
    { key: "name", label: "Name" },
    { key: "box_type", label: "Type" },
    { key: "tj_port", label: "Ports" },
    { key: "capacity", label: "Capacity" },
    { key: "tray_count", label: "Trays" },
    { key: "lat", label: "Latitude", format: v => typeof v === "number" ? v.toFixed(6) : String(v ?? "—") },
    { key: "lng", label: "Longitude", format: v => typeof v === "number" ? v.toFixed(6) : String(v ?? "—") },
    { key: "address", label: "Address" },
    { key: "notes", label: "Notes" },
  ],
  tj_splitter: [], // rendered specially
  cable: [
    { key: "link_name", label: "Link Name" },
    { key: "code", label: "Code" },
    { key: "core_count", label: "Core Count" },
    { key: "manufacturer", label: "Manufacturer" },
    { key: "manufacturing_year", label: "Year" },
    { key: "cable_type", label: "Cable Type" },
    { key: "route_type", label: "Route Type" },
    { key: "src_tj_id", label: "Source TJ ID" },
    { key: "dst_tj_id", label: "Destination TJ ID" },
    { key: "notes", label: "Notes" },
  ],
  user: [
    { key: "name", label: "Customer Name" },
    { key: "mobile", label: "Mobile" },
    { key: "username", label: "Username" },
    { key: "address", label: "Address" },
    { key: "package", label: "Package" },
    { key: "gps_lat", label: "Latitude" },
    { key: "gps_lng", label: "Longitude" },
    { key: "connection_info", label: "Connection Info" },
    { key: "router_info", label: "Router Info" },
    { key: "notes", label: "Notes" },
  ],
  user_location: [
    { key: "onu_id", label: "ONU ID" },
    { key: "username", label: "Username" },
    { key: "existing_lat", label: "Existing Lat" },
    { key: "existing_lng", label: "Existing Lng" },
    { key: "new_lat", label: "New Lat" },
    { key: "new_lng", label: "New Lng" },
    { key: "address", label: "Address" },
    { key: "notes", label: "Notes" },
  ],
  splitter: [
    { key: "name", label: "Name" },
    { key: "split_ratio", label: "Split Ratio", format: v => `1:${v}` },
    { key: "tj_box_id", label: "TJ Box ID" },
    { key: "input_core", label: "Input Core" },
    { key: "output_cores", label: "Output Cores" },
    { key: "lat", label: "Latitude" },
    { key: "lng", label: "Longitude" },
    { key: "notes", label: "Notes" },
  ],
  splice_box: [
    { key: "name", label: "Name" },
    { key: "box_type", label: "Type" },
    { key: "tj_port", label: "Ports" },
    { key: "capacity", label: "Capacity" },
    { key: "lat", label: "Latitude" },
    { key: "lng", label: "Longitude" },
    { key: "address", label: "Address" },
  ],
  infrastructure: [
    { key: "name", label: "Name" },
    { key: "infrastructure_type", label: "Infrastructure Type" },
    { key: "lat", label: "Latitude" },
    { key: "lng", label: "Longitude" },
    { key: "address", label: "Address" },
    { key: "notes", label: "Notes" },
  ],
  loop: [
    { key: "cable_id", label: "Cable ID" },
    { key: "segment_index", label: "Segment Index" },
    { key: "lat", label: "Latitude" },
    { key: "lng", label: "Longitude" },
    { key: "loop_length_m", label: "Loop Length (m)" },
    { key: "notes", label: "Notes" },
  ],
  cable_cut: [
    { key: "cable_id", label: "Cable ID" },
    { key: "lat", label: "Latitude" },
    { key: "lng", label: "Longitude" },
    { key: "status", label: "Status" },
    { key: "notes", label: "Notes" },
  ],
};

function PayloadSection({ label, data, fields }: { label: string; data: Record<string, unknown>; fields: { key: string; label: string; format?: (v: unknown) => string }[] }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</h3>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
        {fields.length > 0 ? (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fields.map(f => {
              const val = data[f.key];
              if (val === undefined || val === null || val === "") return null;
              const display = f.format ? f.format(val) : String(val);
              return (
                <div key={f.key} className="flex gap-2">
                  <dt className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">{f.label}:</dt>
                  <dd className="text-sm text-slate-800 dark:text-slate-100">{display}</dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <pre className="max-h-60 overflow-auto text-xs text-slate-600 dark:text-slate-300">{JSON.stringify(data, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function ComparisonView({ existing, submitted, fields }: { existing: Record<string, unknown>; submitted: Record<string, unknown>; fields: { key: string; label: string; format?: (v: unknown) => string }[] }) {
  if (!existing || Object.keys(existing).length === 0) return null;
  const changedFields = fields.filter(f => {
    const oldVal = existing[f.key];
    const newVal = submitted[f.key];
    return JSON.stringify(oldVal) !== JSON.stringify(newVal);
  });
  if (changedFields.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Changes</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs dark:border-slate-700 dark:bg-slate-800/60">
              <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Field</th>
              <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Existing</th>
              <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400">Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {changedFields.map(f => {
              const oldVal = existing[f.key];
              const newVal = submitted[f.key];
              const fmt = f.format || ((v: unknown) => String(v ?? "—"));
              return (
                <tr key={f.key}>
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">{f.label}</td>
                  <td className="px-3 py-2 text-slate-500 line-through dark:text-slate-400">{fmt(oldVal)}</td>
                  <td className="px-3 py-2 font-medium text-emerald-700 dark:text-emerald-300">{fmt(newVal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ApprovalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useUserRole();
  const approveOk = canApprove(role);
  const submitOk = canSubmit(role);

  const [item, setItem] = useState<ApprovalDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [resubmitPayload, setResubmitPayload] = useState("");
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showResubmitModal, setShowResubmitModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [viewerPhoto, setViewerPhoto] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const load = () => {
    if (!id) return;
    setLoading(true);
    api.get<ApprovalDetailType>(`/approvals/${id}`).then(d => {
      setItem(d);
      setResubmitPayload(JSON.stringify(d.payload, null, 2));
    }).catch(e => flash(String(e), false));
    setLoading(false);
  };

  useEffect(load, [id]);

  const approve = async () => {
    if (!id) return;
    try {
      await api.put(`/approvals/${id}/approve`, { review_note: reviewNote });
      flash("Approved and executed");
      setReviewNote("");
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Approve failed", false);
    }
  };

  const reject = async () => {
    if (!id) return;
    try {
      await api.put(`/approvals/${id}/reject`, { review_note: reviewNote });
      flash("Rejected");
      setReviewNote("");
      setShowRejectModal(false);
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Reject failed", false);
    }
  };

  const returnForCorrection = async () => {
    if (!id || !correctionNote.trim()) return;
    try {
      await api.put(`/approvals/${id}/return`, { correction_note: correctionNote });
      flash("Returned for correction");
      setCorrectionNote("");
      setShowReturnModal(false);
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Return failed", false);
    }
  };

  const resubmit = async () => {
    if (!id) return;
    try {
      const payload = JSON.parse(resubmitPayload);
      await api.put(`/approvals/${id}/resubmit`, { payload, correction_note: "" });
      flash("Resubmitted successfully");
      setShowResubmitModal(false);
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Resubmit failed", false);
    }
  };

  const deleteRequest = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api.del(`/approvals/${id}`);
      flash("Approval request deleted");
      setShowDeleteModal(false);
      navigate("/approvals");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Delete failed", false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading...</div>;
  if (!item) return <div className="p-8 text-center text-slate-400">Not found</div>;

  const fields = ENTITY_FIELDS[item.entity_type] || [];
  const isPending = item.status === "pending" || item.status === "resubmitted";
  const isReturned = item.status === "returned_for_correction";
  const isMySubmission = item.requested_by && submitOk;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {ENTITY_TYPE_LABELS[item.entity_type] || item.entity_type}
            </h1>
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[item.status] || ""}`}>
              {STATUS_LABELS[item.status] || item.status}
            </span>
            <span className={`text-xs font-medium ${item.priority === "urgent" ? "text-red-600" : item.priority === "high" ? "text-amber-600" : "text-slate-400"}`}>
              {PRIORITY_LABELS[item.priority] || item.priority}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {ACTION_LABELS[item.action] || item.action} &middot; {(item.payload?.name as string) || (item.payload?.link_name as string) || (item.payload?.username as string) || `#${item.entity_id || "new"}`}
          </p>
        </div>
        <button onClick={() => navigate("/approvals")} className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Back to Queue
        </button>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
        <span>Submitted by: <strong>{item.submitted_by_name || `User #${item.requested_by}`}</strong></span>
        <span>Date: {fmtDate(item.created_at)}</span>
        {item.reviewed_at && <span>Reviewed: {fmtDate(item.reviewed_at)}</span>}
        {item.resubmitted_at && <span>Resubmitted: {fmtDate(item.resubmitted_at)}</span>}
      </div>

      {/* Correction note (if returned) */}
      {isReturned && item.correction_note && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 dark:border-orange-700 dark:bg-orange-900/30">
          <div className="text-sm font-semibold text-orange-700 dark:text-orange-300">NOC Correction Note:</div>
          <div className="mt-1 text-sm text-orange-800 dark:text-orange-200">{item.correction_note}</div>
        </div>
      )}

      {/* Submitted data */}
      {item.entity_type === "tj_splitter" ? (
        <div className="space-y-4">
          <PayloadSection label="TJ Information" data={(item.payload.tj as Record<string, unknown>) || {}} fields={ENTITY_FIELDS.tj} />
          <PayloadSection label="Splitter Information" data={(item.payload.splitter as Record<string, unknown>) || {}} fields={ENTITY_FIELDS.splitter} />
        </div>
      ) : (
        <PayloadSection label="Submitted Information" data={item.payload} fields={fields} />
      )}

      {/* Comparison (for updates) */}
      {item.action === "update" && item.previous_data && fields.length > 0 && (
        <ComparisonView existing={item.previous_data} submitted={item.payload} fields={fields} />
      )}

      {/* GPS / Map */}
      {item.location && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Submission Location</h3>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Lat: {item.location.lat?.toFixed(6)}, Lng: {item.location.lng?.toFixed(6)}
            </div>
            <a
              href={`https://www.openstreetmap.org/?mlat=${item.location.lat}&mlon=${item.location.lng}#map=16/${item.location.lat}/${item.location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-brand-600 hover:underline dark:text-brand-400"
            >
              Open in Map →
            </a>
          </div>
        </div>
      )}

      {/* User Location comparison */}
      {item.entity_type === "user_location" && item.payload && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Location Comparison</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Existing Location</div>
              <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                {String(item.payload.existing_lat ?? "—")}, {String(item.payload.existing_lng ?? "—")}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-700 dark:bg-emerald-900/30">
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">New Submitted Location</div>
              <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-200">
                {String(item.payload.new_lat ?? "—")}, {String(item.payload.new_lng ?? "—")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photos */}
      {item.photos && item.photos.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Submitted Photos</h3>
          {item.photo_processing_status === "PROCESSING" && (
            <div className="mb-2 text-xs text-amber-600 dark:text-amber-400">
              Photo processing...
            </div>
          )}
          {item.photo_processing_status === "FAILED" && (
            <div className="mb-2 text-xs text-rose-600 dark:text-rose-400">
              Photo processing failed: {item.photo_processing_error || "Unknown error"}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {item.photos.map((photo, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setViewerPhoto(photo)}
                className="block cursor-zoom-in"
              >
                <img
                  src={`/api/approvals/photos/${photo}`}
                  alt={`Photo ${i + 1}`}
                  className="h-24 w-24 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Review note (if reviewed) */}
      {item.review_note && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Review Note</div>
          <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">{item.review_note}</div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        {/* NOC actions (approve/reject/return/delete) */}
        {approveOk && isPending && (
          <>
            <button
              onClick={approve}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Approve
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700"
            >
              Reject
            </button>
            <button
              onClick={() => setShowReturnModal(true)}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              Return for Correction
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Delete
            </button>
          </>
        )}

        {/* Employee resubmit action */}
        {isMySubmission && isReturned && (
          <button
            onClick={() => setShowResubmitModal(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Resubmit
          </button>
        )}
      </div>

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Reject Submission</h3>
            <textarea
              value={reviewNote}
              onChange={e => setReviewNote(e.target.value)}
              placeholder="Rejection reason (optional)"
              className="mt-3 w-full rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              rows={3}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowRejectModal(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={reject} className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* Return for correction modal */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Return for Correction</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Describe what needs to be corrected:</p>
            <textarea
              value={correctionNote}
              onChange={e => setCorrectionNote(e.target.value)}
              placeholder="Correction instructions (required)"
              className="mt-3 w-full rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              rows={4}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowReturnModal(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button
                onClick={returnForCorrection}
                disabled={!correctionNote.trim()}
                className="rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resubmit modal */}
      {showResubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Resubmit Corrected Data</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Edit the payload and resubmit:</p>
            <textarea
              value={resubmitPayload}
              onChange={e => setResubmitPayload(e.target.value)}
              className="mt-3 w-full rounded-lg border border-slate-200 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              rows={12}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowResubmitModal(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={resubmit} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Resubmit</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Approval Request?</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              This will permanently remove this pending approval request. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={deleteRequest}
                disabled={deleting}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo viewer modal */}
      {viewerPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewerPhoto(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            {/* Close button */}
            <button
              onClick={() => setViewerPhoto(null)}
              className="absolute -top-3 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg font-bold text-slate-700 shadow-md hover:bg-slate-100"
            >
              ✕
            </button>
            <img
              src={`/api/approvals/photos/${viewerPhoto}`}
              alt="Photo preview"
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
            />
          </div>
        </div>
      )}

      {/* Full payload (collapsible) */}
      <details className="rounded-lg border border-slate-200 dark:border-slate-700">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300">Raw Payload</summary>
        <pre className="max-h-80 overflow-auto border-t border-slate-200 p-4 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
          {JSON.stringify(item.payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
