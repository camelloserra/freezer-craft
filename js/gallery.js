/* Galería de fotos de heladeras.
 * - Con Supabase configurado en js/config.js: galería MUNDIAL con votos
 *   (tabla freezer_photos + carpeta "freezer"; ver backend/freezer-gallery.sql).
 * - Sin configurar: guarda las fotos en este dispositivo (IndexedDB), sin votos.
 *
 * El juego solo usa: shared, list({ top }), add(blob, name), vote(id), remove(id).
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
    async vote() { throw new Error('sin votos en modo local'); },
    async remove(id) {
      await tx('readwrite', s => s.delete(id));
      if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    },
  };

  // ---------- mundial (Supabase, sin librerías) ----------
  // La clave "publishable" va SOLO en el encabezado apikey (no en Authorization).
  const base = (cfg.supabaseUrl || '').replace(/\/$/, '');
  const bucket = cfg.bucket || 'freezer';
  const H = { apikey: cfg.supabaseAnonKey };
  const KEY_VOTES = 'freezercraft.votos.v1';   // qué fotos votó ESTE navegador
  const votedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY_VOTES) || '[]')); } catch { return new Set(); } };
  const saveVoted = s => { try { localStorage.setItem(KEY_VOTES, JSON.stringify([...s])); } catch { /* sin espacio: no pasa nada */ } };
  const imgUrl = path => `${base}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}`;

  const cloud = {
    async list({ top } = {}) {
      const order = top ? 'votes.desc,created_at.desc' : 'created_at.desc';
      const r = await fetch(`${base}/rest/v1/freezer_photos?select=id,created_at,name,img_path,votes&order=${order}&limit=${top || 200}`, { headers: H });
      if (!r.ok) throw new Error('list ' + r.status);
      const voted = votedSet();
      return (await r.json()).map(p => ({
        id: p.id, url: imgUrl(p.img_path), created: Date.parse(p.created_at) || 0,
        name: p.name || '', votes: p.votes, voted: voted.has(p.id), canDelete: false,
      }));
    },
    async add(blob, title) {
      const name = (title || '').trim().slice(0, 40);
      const path = `heladera-${Date.now()}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}.jpg`;
      const up = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: blob,
      });
      if (!up.ok) throw new Error('upload ' + up.status);
      const r = await fetch(`${base}/rest/v1/freezer_photos`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name, img_path: path }),
      });
      if (!r.ok) throw new Error('save ' + r.status);
      return path;
    },
    async vote(id) {
      const voted = votedSet();
      const delta = voted.has(id) ? -1 : 1;
      const r = await fetch(`${base}/rest/v1/rpc/freezer_vote`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_id: id, p_delta: delta }),
      });
      if (!r.ok) throw new Error('vote ' + r.status);
      const votes = Number(await r.json());
      if (delta > 0) voted.add(id); else voted.delete(id);
      saveVoted(voted);
      return { votes, voted: delta > 0 };
    },
    async remove() { throw new Error('no se puede borrar de la galería mundial'); },
  };

  const impl = shared ? cloud : local;
  return {
    shared,
    list: opts => impl.list(opts),
    add: (b, name) => impl.add(b, name),
    vote: id => impl.vote(id),
    remove: id => impl.remove(id),
  };
})();
