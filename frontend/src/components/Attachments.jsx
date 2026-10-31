// Files attached to a record (expense receipt, bill photo, purchase invoice, patient document / photo).
// Upload from computer or phone camera; images show as thumbnails, PDFs as a file chip. Max 5 MB, JPEG/PNG/WebP/PDF.
import { useRef, useState } from 'react';
import { LuPaperclip, LuFileText, LuTrash2, LuCamera, LuDownload, LuStar, LuUserRound } from 'react-icons/lu';
import { api, qs, fileUrl } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { notify } from '../lib/toast.js';
import { dateTime } from '../lib/format.js';
import { Button, Skeleton, cx } from './ui.jsx';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default function Attachments({ entityType, entityId, canEdit = true, category, title = 'Files', compact = false, timezone, onChange, photoId = null, onMakePhoto = null }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi(() => api.get(`/attachments${qs({ entityType, entityId })}`), [entityType, entityId]);
  const onFiles = async (files) => {
    setBusy(true);
    let ok = 0;
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) { notify.error(`${f.name}: larger than 5 MB.`); continue; }
      try {
        await api.upload(`/attachments${qs({ entityType, entityId, fileName: f.name || 'photo.jpg', category })}`, f);
        ok += 1;
      } catch (e) { notify.error(`${f.name}: ${e.message}`); }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    if (ok) { notify.success(ok === 1 ? 'File uploaded.' : `${ok} files uploaded.`); reload(); onChange?.(); }
  };
  const remove = async (a) => {
    if (!window.confirm(`Remove ${a.fileName}?`)) return;
    try { await api.del(`/attachments/${a.id}`); notify.success('File removed.'); reload(); onChange?.(); } catch (e) { notify.error(e.message); }
  };
  if (error) return error.status === 403 ? null : <p className="text-sm text-red-600">{error.message}</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {title && <p className="flex items-center gap-2 font-semibold"><LuPaperclip aria-hidden /> {title}{data?.length ? <span className="text-xs font-normal text-muted">({data.length})</span> : null}</p>}
        {canEdit && (
          <div className="flex gap-2">
            <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => onFiles([...e.target.files])} aria-label="Choose files" />
            <Button size="sm" variant="outline" loading={busy} onClick={() => input.current?.click()}><LuCamera aria-hidden /> Add photo / PDF</Button>
          </div>
        )}
      </div>
      {loading ? <Skeleton className="h-20 w-full" /> : !data?.length ? <p className="text-sm text-muted">No files yet.</p> : (
        <ul className={cx('grid gap-3', compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
          {data.map((a) => (
            <li key={a.id} className="group overflow-hidden rounded-lg border border-line bg-white">
              <a href={fileUrl(a.id)} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] bg-ivory" title={a.fileName}>
                {a.contentType.startsWith('image/')
                  ? <img src={fileUrl(a.id)} alt={a.fileName} loading="lazy" className="h-full w-full object-cover" />
                  : <span className="grid h-full place-items-center text-forest-700"><LuFileText className="h-10 w-10" aria-hidden /></span>}
              </a>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <span className="min-w-0"><span className="block truncate text-xs font-medium">{a.fileName}</span>
                  <span className="block text-[10px] text-muted">{kb(a.size)} · {dateTime(a.createdAt, timezone)}</span></span>
                <span className="flex shrink-0">
                  {onMakePhoto && canEdit && a.contentType.startsWith('image/') && (Number(photoId) === Number(a.id)
                    ? <span className="rounded p-1 text-gold-600" title="Profile photo"><LuStar aria-label="Profile photo" /></span>
                    : <button type="button" className="rounded p-1 text-forest-700 hover:bg-forest-50" title="Use as profile photo" onClick={() => onMakePhoto(a)} aria-label={`Use ${a.fileName} as profile photo`}><LuUserRound aria-hidden /></button>)}
                  <a href={fileUrl(a.id, true)} className="rounded p-1 text-forest-700 hover:bg-forest-50" aria-label={`Download ${a.fileName}`}><LuDownload aria-hidden /></a>
                  {canEdit && <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => remove(a)} aria-label={`Remove ${a.fileName}`}><LuTrash2 aria-hidden /></button>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
