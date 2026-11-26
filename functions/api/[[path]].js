const enc = new TextEncoder();
async function sign(s, k) {
  const key = await crypto.subtle.importKey('raw', enc.encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const b = await crypto.subtle.sign('HMAC', key, enc.encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(b)));
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' };
const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

export async function onRequest({ request, env, params }) {
  const m = request.method, [a, b] = params.path || [];
  if (m === 'OPTIONS') return new Response(null, { headers: cors });
  const admin = async () => {
    const [e, s] = (request.headers.get('Authorization') || '').replace('Bearer ', '').split('.');
    return Number(e) > Date.now() && s === (await sign(e, env.SESSION_SECRET));
  };
  try {
    if (a === 'login' && m === 'POST') {
      const { password } = await request.json();
      if (password !== env.ADMIN_PASSWORD) return j({ error: 'Teny miafina diso' }, 401);
      const exp = String(Date.now() + 7 * 864e5);
      return j({ token: exp + '.' + (await sign(exp, env.SESSION_SECRET)) });
    }
    if (a === 'dramas' && m === 'GET') {
      const d = (await env.DB.prepare('SELECT * FROM dramas ORDER BY id DESC').all()).results;
      const e = (await env.DB.prepare('SELECT id,drama_id,num,title,views FROM episodes ORDER BY drama_id,num').all()).results;
      const o = new URL(request.url).origin;
      return j(d.map(x => ({ ...x, episodes: e.filter(y => y.drama_id == x.id).map(y => ({ ...y, video: o + '/api/video/' + y.id })) })));
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
    if (!(await admin())) return j({ error: 'Tsy mahazo alalana' }, 401);
    if (a === 'stats') {
      const rows = (await env.DB.prepare('SELECT d.title,COALESCE(SUM(e.views),0) v,COUNT(e.id) n FROM dramas d LEFT JOIN episodes e ON e.drama_id=d.id GROUP BY d.id ORDER BY v DESC').all()).results;
      return j({ total: rows.reduce((s, r) => s + r.v, 0), rows });
    }
    if (a === 'dramas' && m === 'POST') {
      const x = await request.json();
      if (!x.title) return j({ error: 'Ilaina ny lohateny' }, 400);
      await env.DB.prepare('INSERT INTO dramas(title,synopsis,poster) VALUES(?,?,?)').bind(x.title, x.synopsis || '', x.poster || '').run();
      return j({ ok: 1 });
    }
    if (a === 'dramas' && m === 'DELETE') {
      await env.DB.batch([env.DB.prepare('DELETE FROM episodes WHERE drama_id=?').bind(b), env.DB.prepare('DELETE FROM dramas WHERE id=?').bind(b)]);
      return j({ ok: 1 });
    }
    if (a === 'episodes' && m === 'DELETE') {
      await env.DB.prepare('DELETE FROM episodes WHERE id=?').bind(b).run();
      return j({ ok: 1 });
    }
    if (a === 'upload' && m === 'POST') {
      const f = await request.formData(), file = f.get('file');
      if (!file || !f.get('drama_id')) return j({ error: 'Video na drama tsy hita' }, 400);
      const t = new FormData();
      t.append('chat_id', env.TG_CHAT_ID); t.append('video', file, file.name || 'ep.mp4');
      const r = await (await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendVideo`, { method: 'POST', body: t })).json();
      if (!r.ok) return j({ error: 'Telegram: ' + r.description }, 502);
      const fid = (r.result.video || r.result.document).file_id;
      await env.DB.prepare('INSERT INTO episodes(drama_id,num,title,file_id) VALUES(?,?,?,?)').bind(f.get('drama_id'), Number(f.get('num')) || 1, f.get('title') || '', fid).run();
      return j({ ok: 1 });
    }
    return j({ error: 'Tsy hita' }, 404);
  } catch (e) {
    return j({ error: String(e.message || e) }, 500);
  }
}
