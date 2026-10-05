// The Trash at the bottom of the sidebar: drawings deleted from Doodlebay, kept in its own
// data folder for 30 days. Each can go back where it was or be deleted for good.
import React, { useCallback, useEffect, useState } from 'react';

const ago = t => {
  const days = Math.floor((Date.now() - t) / 86400000);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

export default function TrashSection({ changedAt, onError }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => window.desk.listTrash().then(setItems, () => setItems([])), []);
  useEffect(() => { load(); }, [load, changedAt]);
  if (!items.length) return null;

  const restore = async item => {
    try { await window.desk.restoreTrash(item.id); } catch (err) { onError(`Could not restore ${item.name}: ${err.message}`); }
    load();
  };
  const remove = async item => {
    if (!window.confirm(`Delete "${item.name.replace(/\.excalidraw$/i, '')}" for good? This cannot be undone.`)) return;
    try { await window.desk.removeTrash(item.id); } catch (err) { onError(`Could not delete ${item.name}: ${err.message}`); }
    load();
  };

  return (
    <div className="root trash">
      <div className="tree-row root-row" onClick={() => setOpen(!open)} title="Deleted drawings are kept here for 30 days">
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="tree-name">Trash</span>
        <span className="trash-count">{items.length}</span>
      </div>
      {open && items.map(item => (
        <div key={item.id} className="tree-row trash-row" style={{ paddingLeft: 24 }} title={`Was in ${item.from}, deleted ${ago(item.deletedAt)}`}>
          <span className="tree-name">{item.name.replace(/\.excalidraw$/i, '')}</span>
          <button className="row-btn" onClick={() => restore(item)} title="Put it back where it was">Restore</button>
          <button className="row-btn" onClick={() => remove(item)} title="Delete for good">×</button>
        </div>
      ))}
    </div>
  );
}
