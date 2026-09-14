export default function ApkDownload() {
  const handleDownload = () => {
    const token = localStorage.getItem("token");
    const link = document.createElement("a");
    link.href = "/api/app/download";
    if (token) {
      link.href += `?token=${token}`;
    }
    link.download = "InfraNexus.apk";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card mx-auto max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/30">
          <svg className="h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </div>
        <h1 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">Infra NEXUS Mobile</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          Employee mobile app for lead management, field updates, and real-time notifications.
        </p>
        <button
          onClick={handleDownload}
          className="btn-primary inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download APK
        </button>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Requires Android 8.0 or later
        </p>
      </div>
    </div>
  );
}
