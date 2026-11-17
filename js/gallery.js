/* Galería de fotos de heladeras.
 * - Sin configurar: guarda las fotos en este dispositivo (IndexedDB).
 * - Con Supabase configurado en js/config.js: galería compartida en la nube.
 */
window.Gallery = (() => {
  'use strict';
  const cfg = window.FREEZER_CONFIG || {};
  const shared = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  // ---------- local (IndexedDB) ----------
  let dbp;
  function db() {
    dbp = dbp || new Promise((res, rej) => {
      const r = indexedDB.open('freezercraft', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('photos', mode);
      const out = fn(t.objectStore('photos'));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  const urls = new Map();
  const local = {
    async list() {
      const all = await tx('readonly', s => s.getAll());
      return all.sort((a, b) => b.created - a.created).map(p => {
        if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.blob));
        return { id: p.id, url: urls.get(p.id), created: p.created, name: p.name || '', canDelete: true };
      });
    },
    async add(blob, name) {
      const id = 'h' + Date.now() + Math.random().toString(36).slice(2, 6);
      await tx('readwrite', s => s.put({ id, blob, name: name || '', created: Date.now() }));
      return id;
    },
    async remove(id) {
      await tx('readwrite', s => s.delete(id));
      if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    },
  };

  // ---------- compartida (Supabase Storage, sin librerías) ----------
  // El nombre de la foto viaja dentro del nombre del archivo (en base64url).
  const enc = t => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const dec = t => { try { return decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/')))); } catch { return ''; } };
  const base = (cfg.supabaseUrl || '').replace(/\/$/, '');
  const bucket = cfg.bucket || 'galeria';
  const headers = { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` };
  const cloud = {
    async list() {
      const r = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: '', limit: 200, offset: 0, sortBy: { column: 'created_at', order: 'desc' } }),
      });
      if (!r.ok) throw new Error('list ' + r.status);
      const files = await r.json();
      return files
        .filter(f => f.name && /\.(jpe?g|png)$/i.test(f.name))
        .map(f => ({
          id: f.name,
          url: `${base}/storage/v1/object/public/${bucket}/${encodeURIComponent(f.name)}`,
          created: Date.parse(f.created_at) || 0,
          name: (/--([A-Za-z0-9_-]+)\.jpe?g$/i.exec(f.name) || [])[1] ? dec(/--([A-Za-z0-9_-]+)\.jpe?g$/i.exec(f.name)[1]) : '',
          canDelete: false,
        }));
    },
    async add(blob, title) {
      const t = (title || '').trim().slice(0, 40);
      const name = `heladera-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${t ? '--' + enc(t) : ''}.jpg`;
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${name}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
        body: blob,
      });
      if (!r.ok) throw new Error('upload ' + r.status);
      return name;
    },
    async remove() { throw new Error('no se puede borrar de la galería compartida'); },
  };

  const impl = shared ? cloud : local;
  return { shared, list: () => impl.list(), add: (b, name) => impl.add(b, name), remove: id => impl.remove(id) };
})();
