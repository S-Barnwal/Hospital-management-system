// Backups: download a full JSON export of this hospital's data. Works even when the subscription has expired.
import { useState } from 'react';
import { LuDownload, LuDatabaseBackup, LuShieldCheck } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify } from '../../lib/toast.js';
import { dateTime } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, PageHeader } from '../../components/ui.jsx';

const BASE = (import.meta.env?.VITE_API_BASE_URL || '') + '/api/v1';
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function download(retry = true) {
  const res = await fetch(`${BASE}/backups/export`, { credentials: 'include', headers: { 'X-Requested-With': 'fetch' } });
  if (res.status === 401 && retry) {
    const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' } });
    if (r.ok) return download(false);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error?.message || `Backup failed (${res.status}).`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'hospital-backup.json';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export default function Backups() {
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const { data, loading, error, reload } = useApi(() => api.get('/backups'), []);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const name = await download(); notify.success(`Backup downloaded: ${name}`); reload(); } catch (e) { notify.error(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Backups" subtitle="Download a complete copy of your hospital’s data whenever you want."
        actions={<Button onClick={run} loading={busy}><LuDownload aria-hidden /> Download backup now</Button>} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Alert tone="info" title="What is included">
          Patients, appointments, staff, OPD, admissions, bills and payments, lab orders and results, pharmacy stock, expenses, settings and audit log — only <strong>your</strong> hospital’s records, as one JSON file.
        </Alert>
        <Alert tone="success" title="Safe to keep">
          This download is your own copy — for records, audits or moving to another system. Passwords and login tokens are never included, and every download is logged below.
        </Alert>
      </div>
      <Card>
        <p className="flex items-center gap-2 border-b border-line px-5 py-3 font-semibold"><LuShieldCheck aria-hidden /> Download history</p>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuDatabaseBackup} title="No backups downloaded yet" />}
          columns={[
            { key: 'createdAt', label: 'Date', render: (b) => dateTime(b.createdAt, tz) },
            { key: 'createdBy', label: 'By', render: (b) => b.createdBy || '—' },
            { key: 'tableCount', label: 'Tables', className: 'text-right' },
            { key: 'totalRows', label: 'Records', className: 'text-right' },
            { key: 'sizeBytes', label: 'Size', className: 'text-right', render: (b) => (b.status === 'completed' ? size(Number(b.sizeBytes)) : '—') },
            { key: 'status', label: 'Status', render: (b) => <Badge tone={b.status === 'completed' ? 'green' : 'red'}>{b.status}</Badge> },
          ]} />
      </Card>
      <p className="mt-3 text-xs text-muted">Keep backup files safe — they contain patient information. To restore data from a file, contact platform support.</p>
    </>
  );
}
