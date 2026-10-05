// Earlier saves of the open drawing, kept by Doodlebay in its own data folder. Pick one to
// see it, then restore it; the drawing as it is now is kept as a version first.
import React, { useEffect, useRef, useState } from 'react';
import { exportToSvg } from '@excalidraw/excalidraw';

const when = t => {
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
};

function Preview({ file, time, theme }) {
  const box = useRef(null);
  const [note, setNote] = useState('Loading...');
  useEffect(() => {
    let live = true;
    setNote('Loading...');
    window.desk.readVersion(file, time)
      .then(text => {
        const data = JSON.parse(text);
        const elements = (data.elements || []).filter(e => !e.isDeleted);
        if (!elements.length) { if (live) { box.current?.replaceChildren(); setNote('Empty drawing'); } return; }
        return exportToSvg({ elements, files: data.files || null, appState: { exportBackground: false, exportWithDarkMode: theme === 'dark' } })
          .then(svg => { if (live && box.current) { box.current.replaceChildren(svg); setNote(''); } });
      })
      .catch(() => { if (live) setNote('This version could not be read'); });
    return () => { live = false; };
  }, [file, time, theme]);
  return (
    <div className="vh-preview">
      <div className="vh-svg" ref={box} />
      {note && <div className="vh-note">{note}</div>}
    </div>
  );
}

export default function VersionHistory({ file, theme, onClose, onRestore }) {
  const [times, setTimes] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.desk.listVersions(file).then(t => { setTimes(t); setPick(t[0] ?? null); }, () => setTimes([]));
  }, [file]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const restore = async () => {
    setBusy(true);
    try { await onRestore(pick); } finally { setBusy(false); }
  };

  return (
    <div className="vh-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vh" role="dialog" aria-label="Version history">
        <div className="vh-head">
          <span className="vh-title">Version history</span>
          <button className="row-btn vh-close" onClick={onClose} title="Close">×</button>
        </div>
        {times && !times.length ? (
          <div className="vh-empty">
            No earlier versions yet. Doodlebay keeps one every few minutes while you draw and one
            when you close the drawing: every version from the last day, then one a day for 30 days.
          </div>
        ) : (
          <div className="vh-body">
            <div className="vh-list">
              {(times || []).map(t => (
                <button key={t} className={`vh-item${t === pick ? ' on' : ''}`} onClick={() => setPick(t)}>{when(t)}</button>
              ))}
            </div>
            <div className="vh-side">
              {pick && <Preview file={file} time={pick} theme={theme} />}
              <div className="vh-actions">
                <span className="muted">The drawing as it is now is kept as a version too.</span>
                <button className="primary" disabled={!pick || busy} onClick={restore}>Restore this version</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
