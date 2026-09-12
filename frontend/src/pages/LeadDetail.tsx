import { useEffect, useState } from "react";
import { api } from "../api/client";
import {
  Lead,
  LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_PRIORITY_LABELS, LEAD_PRIORITY_COLORS,
  LEAD_SOURCE_LABELS,
} from "../api/types";
import { fmtTime } from "../lib/time";
import ActionResultBanner from "../components/ActionResultBanner";

function fmtCurrency(n: number | null): string {
  if (n == null) return "৳0";
  return `৳${n.toLocaleString("en-IN")}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start">
      <div className="w-44 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="flex-1 text-sm text-slate-800 dark:text-slate-100">{children}</div>
    </div>
  );
}

export default function LeadDetailPanel({
  leadId,
  onClose,
  onConverted,
}: {
  leadId: number;
  onClose: () => void;
  onConverted?: () => void;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 4000);
  };

  useEffect(() => {
    setLoading(true);
    api.get<Lead>(`/leads/${leadId}`).then(setLead).catch((e) => flash(String(e), false)).finally(() => setLoading(false));
  }, [leadId]);

  const handleConvert = async () => {
    if (!lead || !confirm(`Convert "${lead.customer_name}" to subscriber?`)) return;
    try {
      await api.post(`/leads/${lead.id}/convert`, {});
      flash("Lead converted to subscriber");
      const updated = await api.get<Lead>(`/leads/${lead.id}`);
      setLead(updated);
      onConverted?.();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Conversion failed", false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Lead Details</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">&times;</button>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-400">Loading lead...</div>
        ) : !lead ? (
          <div className="p-6 text-sm text-red-500">Lead not found.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{lead.customer_name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`badge ${LEAD_STATUS_COLORS[lead.status as keyof typeof LEAD_STATUS_COLORS] || ""}`}>
                    {LEAD_STATUS_LABELS[lead.status as keyof typeof LEAD_STATUS_LABELS] || lead.status}
                  </span>
                  <span className={`badge ${LEAD_PRIORITY_COLORS[lead.priority as keyof typeof LEAD_PRIORITY_COLORS] || ""}`}>
                    {LEAD_PRIORITY_LABELS[lead.priority as keyof typeof LEAD_PRIORITY_LABELS] || lead.priority}
                  </span>
                </div>
              </div>
              {lead.status !== "successful" && (
                <button className="btn-ghost text-xs text-emerald-600" onClick={handleConvert}>
                  Convert to Subscriber
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              <Row label="Mobile">
                <div>{lead.mobile_primary}</div>
                {lead.mobile_secondary && <div className="text-xs text-slate-400">{lead.mobile_secondary}</div>}
              </Row>
              <Row label="Road / Area">{lead.road_area || "—"}</Row>
              <Row label="Ward">{lead.ward || "—"}</Row>
              <Row label="Package">{lead.package_name || "—"}</Row>
              <Row label="Service Charge">{fmtCurrency(lead.service_charge)}</Row>
              <Row label="Lead Source">{LEAD_SOURCE_LABELS[lead.lead_source as keyof typeof LEAD_SOURCE_LABELS] || lead.lead_source}</Row>
              <Row label="Assigned To">{lead.assigned_to_name || "—"}</Row>
              <Row label="Expected Connection Date">{lead.expected_connection_date ? fmtTime(lead.expected_connection_date) : "—"}</Row>
              <Row label="Customer Address">{lead.customer_address || "—"}</Row>
              <Row label="Notes">{lead.notes || "—"}</Row>
              {(lead.latitude != null && lead.longitude != null) && (
                <Row label="Location">
                  <a
                    href={`https://www.google.com/maps?q=${lead.latitude},${lead.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {lead.latitude.toFixed(6)}, {lead.longitude.toFixed(6)}
                  </a>
                </Row>
              )}
              <Row label="Follow-up Date">{lead.follow_up_date ? fmtTime(lead.follow_up_date) : "—"}</Row>
              <Row label="Follow-up Notes">{lead.follow_up_notes || "—"}</Row>
              {lead.lost_reason && (
                <Row label="Lost Reason"><span className="text-red-600">{lead.lost_reason}</span></Row>
              )}
              {lead.converted_to_subscriber && (
                <Row label="Converted To"><span className="text-emerald-600">{lead.converted_to_subscriber}</span></Row>
              )}
              <Row label="Created By">{lead.created_by_name || "—"}</Row>
              <Row label="Created At">{fmtTime(lead.created_at)}</Row>
              <Row label="Updated At">{fmtTime(lead.updated_at)}</Row>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
