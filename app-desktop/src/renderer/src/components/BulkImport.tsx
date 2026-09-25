import { useState, useRef, useEffect } from 'react';
import { parseBulk, EXAMPLE_PASTE, type ImportRow } from '../lib/bulk-import';
import { useToast } from './Toast';

interface Props {
  existing: Array<{ name?: string; barcode?: string | null }>;
  onClose: () => void;
  onImported: () => void;
  darkMode?: boolean;
}

/**
 * Paste rows straight from a supplier list or spreadsheet. Rows are validated
 * before anything is written, and only the clean ones import — a bad line
 * never blocks the rest of the paste.
 */
export default function BulkImport({ existing, onClose, onImported, darkMode }: Props) {
  const toast = useToast();
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [headerDetected, setHeaderDetected] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ ok: number; failed: number } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTimeout(() => areaRef.current?.focus(), 50); }, []);

  useEffect(() => {
    if (!raw.trim()) { setRows([]); setHeaderDetected(false); return; }
    const r = parseBulk(raw, existing);
    setRows(r.rows);
    setHeaderDetected(r.headerDetected);
  }, [raw, existing]);

  const good = rows.filter((r) => r.errors.length === 0);
  const bad = rows.filter((r) => r.errors.length > 0);

  async function runImport() {
    if (!good.length) return;
    setImporting(true);
    let ok = 0, failed = 0;
    for (const r of good) {
      try {
        const res: any = await window.api?.products?.create?.({
          name: r.name,
          generic_name: r.generic_name || null,
          price: r.price,
          stock: r.stock,
          category: r.category || null,
          supplier: r.supplier || null,
          barcode: r.barcode || null,
          expiry: r.expiry || null,
        });
        if (res?.ok) ok++; else failed++;
      } catch { failed++; }
    }
    setImporting(false);
    setDone({ ok, failed });
    if (ok) toast.success(`Imported ${ok} product${ok > 1 ? 's' : ''}`);
    if (failed) toast.error(`${failed} could not be saved`);
    onImported();
  }

  const dm = darkMode;
  const tp = dm ? 'text-gray-100' : 'text-gray-900';
  const ts = dm ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col ${dm ? 'bg-gray-800' : 'bg-white'}`}>
        <div className={`p-5 border-b ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
          <h2 className={`text-lg font-bold ${tp}`}>Import products</h2>
          <p className={`text-sm mt-0.5 ${ts}`}>
            Copy rows from Excel or Google Sheets and paste below. Columns: name, generic, price, stock, category, supplier, barcode, expiry.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <textarea
              ref={areaRef}
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setDone(null); }}
              placeholder={EXAMPLE_PASTE}
              rows={7}
              spellCheck={false}
              className={`w-full px-3 py-2.5 rounded-xl border-2 font-mono text-xs focus:outline-none focus:border-blue-500 ${dm ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
            />
            {rows.length > 0 && (
              <div className="flex items-center gap-3 mt-2 text-xs">
                <span className={ts}>{headerDetected ? 'Header row detected' : 'No header — using column order'}</span>
                <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">{good.length} ready</span>
                {bad.length > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">{bad.length} skipped</span>}
              </div>
            )}
          </div>

          {rows.length > 0 && (
            <div className={`rounded-xl border overflow-hidden ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
              <table className="w-full text-xs">
                <thead className={dm ? 'bg-gray-700' : 'bg-gray-50'}>
                  <tr className={ts}>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Generic</th>
                    <th className="text-right px-3 py-2">Price</th>
                    <th className="text-right px-3 py-2">Stock</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r) => (
                    <tr key={r.line} className={`border-t ${dm ? 'border-gray-700' : 'border-gray-100'} ${r.errors.length ? (dm ? 'bg-red-900/20' : 'bg-red-50') : ''}`}>
                      <td className={`px-3 py-1.5 font-medium ${tp}`}>{r.name || <span className="text-red-500">(blank)</span>}</td>
                      <td className={`px-3 py-1.5 ${ts}`}>{r.generic_name || '—'}</td>
                      <td className={`px-3 py-1.5 text-right ${tp}`}>{r.price.toFixed(2)}</td>
                      <td className={`px-3 py-1.5 text-right ${tp}`}>{r.stock}</td>
                      <td className="px-3 py-1.5">
                        {r.errors.length
                          ? <span className="text-red-600">{r.errors.join('; ')}</span>
                          : <span className="text-green-600">ready</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && <p className={`px-3 py-2 text-xs ${ts}`}>…and {rows.length - 100} more rows</p>}
            </div>
          )}

          {done && (
            <div className={`p-3 rounded-xl text-sm ${done.failed ? 'bg-orange-50 text-orange-800 border border-orange-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
              Imported {done.ok}. {done.failed > 0 && `${done.failed} failed to save.`}
            </div>
          )}
        </div>

        <div className={`flex gap-3 p-5 border-t ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose}
            className={`flex-1 py-2.5 rounded-xl border font-medium ${dm ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
            {done ? 'Close' : 'Cancel (Esc)'}
          </button>
          <button onClick={runImport} disabled={importing || !good.length}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-40">
            {importing ? 'Importing…' : `Import ${good.length || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
