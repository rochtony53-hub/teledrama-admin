const enc = new TextEncoder();
async function sign(s, k) {
  const key = await crypto.subtle.importKey('raw', enc.encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(s)))));
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' };
const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });
const TXT = ['title', 'original_title', 'tagline', 'genre', 'synopsis', 'poster', 'cast_list', 'tags', 'status'], NUM = ['year', 'rating', 'featured'];
const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
let ready;
async function ensure(db) {
  if (ready) return;
  for (const c of ["dramas ADD COLUMN original_title TEXT DEFAULT ''", "dramas ADD COLUMN tagline TEXT DEFAULT ''", "dramas ADD COLUMN genre TEXT DEFAULT ''", "dramas ADD COLUMN year INTEGER DEFAULT 0", "dramas ADD COLUMN rating REAL DEFAULT 0", "dramas ADD COLUMN cast_list TEXT DEFAULT ''", "dramas ADD COLUMN tags TEXT DEFAULT ''", "dramas ADD COLUMN featured INTEGER DEFAULT 0", "dramas ADD COLUMN status TEXT DEFAULT 'ongoing'", "episodes ADD COLUMN duration INTEGER DEFAULT 0"]) {
    try { await db.prepare('ALTER TABLE ' + c).run(); } catch {}
  }
  ready = 1;
}

export async function onRequest({ request, env, params }) {
  const m = request.method, [a, b] = params.path || [];
  if (m === 'OPTIONS') return new Response(null, { headers: cors });
  const admin = async () => {
    const [e, s] = (request.headers.get('Authorization') || '').replace('Bearer ', '').split('.');
    return Number(e) > Date.now() && s === (await sign(e, env.SESSION_SECRET));
  };
  try {
    await ensure(env.DB);
    if (a === 'login' && m === 'POST') {
      const { password } = await request.json();
      if (password !== env.ADMIN_PASSWORD) return j({ error: 'Mot de passe incorrect' }, 401);
      const exp = String(Date.now() + 7 * 864e5);
      return j({ token: exp + '.' + (await sign(exp, env.SESSION_SECRET)) });
    }
    if (a === 'dramas' && m === 'GET') {
      const d = (await env.DB.prepare('SELECT * FROM dramas ORDER BY id DESC').all()).results;
      const e = (await env.DB.prepare('SELECT id,drama_id,num,title,duration,views FROM episodes ORDER BY drama_id,num').all()).results;
      const o = new URL(request.url).origin;
      return j(d.map(x => {
        const eps = e.filter(y => y.drama_id == x.id).map(y => ({ ...y, video: o + '/api/video/' + y.id }));
        return { ...x, originalTitle: x.original_title, cast: list(x.cast_list), tags: list(x.tags), featured: !!x.featured, views: eps.reduce((s, y) => s + y.views, 0), episodes: eps };
      }));
    }
    if (a === 'video' && m === 'GET') {
      const ep = await env.DB.prepare('SELECT file_id FROM episodes WHERE id=?').bind(b).first();
      if (!ep) return new Response('', { status: 404, headers: cors });
      const g = await (await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getFile?file_id=${ep.file_id}`)).json();
      if (!g.ok) return j({ error: g.description }, 502);
      const h = new Headers(), rg = request.headers.get('Range');
      if (rg) h.set('Range', rg);
      const v = await fetch(`https://api.telegram.org/file/bot${env.TG_TOKEN}/${g.result.file_path}`, { headers: h });
      const o = new Headers(v.headers);
      o.set('Content-Type', 'video/mp4'); o.set('Cache-Control', 'public,max-age=86400');
      Object.entries(cors).forEach(([k, x]) => o.set(k, x));
      return new Response(v.body, { status: v.status, headers: o });
    }
    if (a === 'view' && m === 'POST') {
      await env.DB.prepare('UPDATE episodes SET views=views+1 WHERE id=?').bind(b).run();
      return j({ ok: 1 });
    }
    if (!(await admin())) return j({ error: 'Accès refusé' }, 401);
    if (a === 'stats') {
      const rows = (await env.DB.prepare('SELECT d.title,COALESCE(SUM(e.views),0) v,COUNT(e.id) n FROM dramas d LEFT JOIN episodes e ON e.drama_id=d.id GROUP BY d.id ORDER BY v DESC').all()).results;
      return j({ total: rows.reduce((s, r) => s + r.v, 0), rows });
    }
    if (a === 'dramas' && m === 'POST') {
      const x = await request.json();
      if (!x.title) return j({ error: 'Le titre est obligatoire' }, 400);
      const K = [...TXT, ...NUM], v = [...TXT.map(k => x[k] || ''), ...NUM.map(k => Number(x[k]) || 0)];
      if (x.id) await env.DB.prepare(`UPDATE dramas SET ${K.map(k => k + '=?').join(',')} WHERE id=?`).bind(...v, x.id).run();
      else await env.DB.prepare(`INSERT INTO dramas(${K.join(',')}) VALUES(${K.map(() => '?').join(',')})`).bind(...v).run();
      return j({ ok: 1 });
    }
    if (a === 'dramas' && m === 'DELETE') {
      await env.DB.batch([env.DB.prepare('DELETE FROM episodes WHERE drama_id=?').bind(b), env.DB.prepare('DELETE FROM dramas WHERE id=?').bind(b)]);
      return j({ ok: 1 });
    }
    if (a === 'episodes' && m === 'POST') {
      const x = await request.json();
      await env.DB.prepare('UPDATE episodes SET num=?,title=? WHERE id=?').bind(Number(x.num) || 1, x.title || '', x.id).run();
      return j({ ok: 1 });
    }
    if (a === 'episodes' && m === 'DELETE') {
      await env.DB.prepare('DELETE FROM episodes WHERE id=?').bind(b).run();
      return j({ ok: 1 });
    }
    if (a === 'upload' && m === 'POST') {
      const f = await request.formData(), file = f.get('file');
      if (!file || !f.get('drama_id')) return j({ error: 'Vidéo ou drame manquant' }, 400);
      const t = new FormData();
      t.append('chat_id', env.TG_CHAT_ID); t.append('supports_streaming', 'true'); t.append('video', file, file.name || 'ep.mp4');
      const r = await (await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendVideo`, { method: 'POST', body: t })).json();
      if (!r.ok) return j({ error: 'Telegram : ' + r.description }, 502);
      const fid = (r.result.video || r.result.document).file_id;
      await env.DB.prepare('INSERT INTO episodes(drama_id,num,title,file_id,duration) VALUES(?,?,?,?,?)').bind(f.get('drama_id'), Number(f.get('num')) || 1, f.get('title') || '', fid, Number(f.get('duration')) || 0).run();
      return j({ ok: 1 });
    }
    return j({ error: 'Introuvable' }, 404);
  } catch (e) {
    return j({ error: String(e.message || e) }, 500);
  }
}
