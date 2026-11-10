const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ESTADOS = ['nuevo','interesado','cotizando','cliente','cita agendada','postventa','perdido'];
let sb, clientes = [], humanos = new Set(), citas = [], sel = null, filtro = 'all', mensajes = [];

const SB_URL = 'https://dxqpvzqqglknganyiaiq.supabase.co';
let enviarUrl = null, enviando = false;
function cfg(){ try { const c = JSON.parse(localStorage.getItem('crm-cfg')||'null'); return c && typeof c.key==='string' ? { url: SB_URL, key: c.key } : null; } catch { return null; } }

async function init(){
  const c = cfg();
  if(!c){ show('login'); return; }
  sb = supabase.createClient(c.url, c.key);
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ show('login'); $('#key').value=c.key; return; }
  const { data: ok } = await sb.rpc('is_crm_admin');
  if(ok !== true){ await sb.auth.signOut(); show('login'); $('#key').value=c.key; $('#loginErr').textContent='Tu cuenta no tiene acceso a este panel.'; return; }
  show('app'); await cargar(); suscribir();
}
function show(w){ $('#login').classList.toggle('hidden', w!=='login'); $('#app').classList.toggle('hidden', w!=='app'); }

$('#loginForm').addEventListener('submit', async e=>{
  e.preventDefault(); $('#loginErr').textContent='';
  const key=$('#key').value.trim();
  if(!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)){ $('#loginErr').textContent='La clave anon no tiene el formato correcto.'; return; }
  const test = supabase.createClient(SB_URL,key);
  const { error } = await test.auth.signInWithPassword({ email:$('#email').value.trim(), password:$('#pass').value });
  if(error){ $('#loginErr').textContent = 'No se pudo entrar: '+error.message; return; }
  const { data: ok } = await test.rpc('is_crm_admin');
  if(ok !== true){ await test.auth.signOut(); $('#loginErr').textContent='Tu cuenta no tiene acceso a este panel.'; return; }
  localStorage.setItem('crm-cfg', JSON.stringify({key}));
  location.reload();
});
$('#logout').onclick = async()=>{ await sb.auth.signOut(); location.reload(); };

async function cargar(){
  const [c,h,ci] = await Promise.all([
    sb.from('crm_clientes').select('*').order('ultimo_mensaje',{ascending:false}).limit(1000),
    sb.from('modo_humano').select('wa_id,activo'),
    sb.from('citas').select('wa_id,cliente,tipo_servicio,fecha,hora,estado,modelo_moto').gte('fecha', new Date().toISOString().slice(0,10)).order('fecha').limit(200)
  ]);
  const cf = await sb.from('crm_config').select('v').eq('k','enviar_url').maybeSingle();
  enviarUrl = cf.data && /^https:\/\/motohaus\.app\.n8n\.cloud\/webhook\//.test(cf.data.v) ? cf.data.v : null;
  clientes = c.data||[]; humanos = new Set((h.data||[]).filter(x=>x.activo).map(x=>x.wa_id)); citas = ci.data||[];
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const { count } = await sb.from('crm_mensajes').select('id',{count:'exact',head:true}).gte('created_at', hoy.toISOString());
  $('#kHoy').textContent = count ?? 0;
  pintarLista(); kpis();
}
function kpis(){
  $('#kClientes').textContent = clientes.length;
  $('#kSin').textContent = clientes.filter(c=>c.no_leidos>0).length;
  $('#kHum').textContent = humanos.size;
  $('#kCitas').textContent = citas.filter(c=>!/cancel/i.test(c.estado||'')).length;
}
const ini = c => (c.nombre||c.wa_id||'?').trim().slice(0,1).toUpperCase();
function hora(t){
  const d=new Date(t), n=new Date();
  if(d.toDateString()===n.toDateString()) return d.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'});
}
function pintarLista(){
  const q = $('#q').value.trim().toLowerCase();
  const arr = clientes.filter(c=>{
    if(filtro==='unread' && !(c.no_leidos>0)) return false;
    if(filtro==='human' && !humanos.has(c.wa_id)) return false;
    if(!q) return true;
    return [c.nombre,c.wa_id,c.ultimo_texto,(c.etiquetas||[]).join(' ')].join(' ').toLowerCase().includes(q);
  });
  $('#list').innerHTML = arr.map(c=>`
    <div class="row ${sel===c.wa_id?'on':''}" data-id="${esc(c.wa_id)}">
      <div class="av">${esc(ini(c))}</div>
      <div class="rb">
        <div class="r1"><b>${esc(c.nombre||'+'+c.wa_id)}</b><span>${esc(hora(c.ultimo_mensaje))}</span></div>
        <div class="r2"><i>${esc(c.ultimo_texto||'')}</i>${c.no_leidos>0?`<span class="badge">${c.no_leidos}</span>`:''}</div>
        <div style="margin-top:4px"><span class="chip">${esc(c.estado)}</span> ${humanos.has(c.wa_id)?'<span class="chip h">humano</span>':''}</div>
      </div>
    </div>`).join('') || '<div class="empty" style="padding:30px">Sin resultados</div>';
}
$('#list').addEventListener('click', e=>{ const r=e.target.closest('.row'); if(r) abrir(r.dataset.id); });
$('#q').addEventListener('input', pintarLista);
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on')); b.classList.add('on'); filtro=b.dataset.f; pintarLista(); });

async function abrir(id){
  sel = id; const c = clientes.find(x=>x.wa_id===id); if(!c) return;
  $('#main').classList.add('chat'); $('#back').style.display = innerWidth<=640?'inline-block':'none';
  $('#chatEmpty').classList.add('hidden'); $('#chatWrap').classList.remove('hidden');
  $('#cAv').textContent = ini(c); $('#cName').textContent = c.nombre||('+'+c.wa_id); $('#cPhone').textContent = '+'+c.wa_id;
  pintarHum();
  const r = await sb.from('crm_mensajes').select('*').eq('wa_id',id).order('created_at').limit(2000);
  mensajes = r.data||[]; pintarMsgs(); pintarSide(c);
  if(c.no_leidos>0){ c.no_leidos=0; await sb.from('crm_clientes').update({no_leidos:0}).eq('wa_id',id); kpis(); }
  pintarLista();
}
$('#back').onclick = ()=>{ $('#main').classList.remove('chat'); };
function pintarHum(){
  const on = humanos.has(sel);
  const b = $('#humBtn'); b.textContent = on ? 'Devolver al bot' : 'Tomar control (pausar bot)';
  b.className = 'btn sm' + (on ? '' : ' ghost');
}
$('#humBtn').onclick = async()=>{
  const on = !humanos.has(sel);
  const { error } = await sb.from('modo_humano').upsert({ wa_id: sel, activo: on, motivo: 'Panel CRM', updated_at: new Date().toISOString() });
  if(error){ alert('Error: '+error.message); return; }
  on ? humanos.add(sel) : humanos.delete(sel); pintarHum(); pintarLista(); kpis();
};
function pintarMsgs(){
  let ult='', h='';
  for(const m of mensajes){
    const d = new Date(m.created_at).toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'});
    if(d!==ult){ h += `<div class="day">${esc(d)}</div>`; ult=d; }
    const who = m.rol==='bot' ? 'Bot' : m.rol==='humano' ? 'Equipo' : '';
    h += `<div class="m ${esc(m.rol)}">${who?`<div class="who">${who}</div>`:''}${esc(m.texto)}<small>${esc(new Date(m.created_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}))}</small></div>`;
  }
  const ultCli = [...mensajes].reverse().find(m=>m.rol==='cliente');
  $('#warn24').classList.toggle('hidden', !(ultCli && Date.now()-new Date(ultCli.created_at) > 24*3600*1000));
  const box=$('#msgs'); box.innerHTML = h || '<div class="empty">Sin mensajes todavía</div>'; box.scrollTop = box.scrollHeight;
}
function pintarSide(c){
  const mine = citas.filter(x=>x.wa_id===c.wa_id);
  $('#side').innerHTML = `
    <h3>Estado del cliente</h3>
    <select id="sEstado">${ESTADOS.map(e=>`<option ${e===c.estado?'selected':''}>${e}</option>`).join('')}</select>
    <h3>Etiquetas</h3>
    <div class="tags" id="sTags">${(c.etiquetas||[]).map(t=>`<span class="tag" data-t="${esc(t)}" title="Quitar">${esc(t)} ✕</span>`).join('')}</div>
    <input id="sTagIn" placeholder="Nueva etiqueta + Enter">
    <h3>Notas internas</h3>
    <textarea id="sNotas" placeholder="Moto, preferencias, acuerdos…">${esc(c.notas||'')}</textarea>
    <div class="saved" id="sSaved"></div>
    <h3>Datos</h3>
    <div class="kv"><span>Teléfono</span><span>+${esc(c.wa_id)}</span></div>
    <div class="kv"><span>Primer contacto</span><span>${esc(new Date(c.primer_contacto).toLocaleDateString('es-CO'))}</span></div>
    <div class="kv"><span>Mensajes</span><span>${mensajes.length}</span></div>
    <h3>Citas próximas</h3>
    ${mine.map(x=>`<div class="cita"><b>${esc(x.tipo_servicio||'Cita')}</b><br>${esc(x.fecha)} ${esc((x.hora||'').slice(0,5))} · ${esc(x.estado||'')}${x.modelo_moto?'<br>'+esc(x.modelo_moto):''}</div>`).join('') || '<div style="color:var(--muted)">Sin citas</div>'}
  `;
  const guardar = async patch=>{
    Object.assign(c, patch);
    const { error } = await sb.from('crm_clientes').update(patch).eq('wa_id',c.wa_id);
    $('#sSaved').textContent = error ? 'Error: '+error.message : 'Guardado ✓'; setTimeout(()=>{ const s=$('#sSaved'); if(s) s.textContent=''; },1800);
    pintarLista();
  };
  $('#sEstado').onchange = e=>guardar({estado:e.target.value});
  $('#sNotas').onblur = e=>{ if(e.target.value!==(c.notas||'')) guardar({notas:e.target.value}); };
  $('#sTagIn').onkeydown = e=>{ if(e.key==='Enter' && e.target.value.trim()){ const t=e.target.value.trim(); const arr=[...new Set([...(c.etiquetas||[]),t])]; guardar({etiquetas:arr}).then(()=>pintarSide(c)); } };
  $('#sTags').onclick = e=>{ const t=e.target.closest('.tag'); if(!t) return; guardar({etiquetas:(c.etiquetas||[]).filter(x=>x!==t.dataset.t)}).then(()=>pintarSide(c)); };
}
function suscribir(){
  sb.channel('crm')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'crm_mensajes'}, async p=>{
      const m=p.new;
      $('#kHoy').textContent = (+$('#kHoy').textContent||0)+1;
      if(m.wa_id===sel){ if(!mensajes.some(x=>x.id===m.id)){ mensajes.push(m); pintarMsgs(); } }
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'crm_clientes'}, p=>{
      const c=p.new; if(!c||!c.wa_id) return;
      const i=clientes.findIndex(x=>x.wa_id===c.wa_id);
      if(c.wa_id===sel && c.no_leidos>0){ c.no_leidos=0; sb.from('crm_clientes').update({no_leidos:0}).eq('wa_id',sel); }
      if(i>=0) clientes[i]=Object.assign(clientes[i],c); else clientes.unshift(c);
      clientes.sort((a,b)=>new Date(b.ultimo_mensaje)-new Date(a.ultimo_mensaje));
      pintarLista(); kpis();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'modo_humano'}, p=>{
      const r=p.new; if(!r||!r.wa_id) return; r.activo?humanos.add(r.wa_id):humanos.delete(r.wa_id);
      pintarLista(); kpis(); if(r.wa_id===sel) pintarHum();
    })
    .subscribe();
}
async function enviar(){
  const txt = $('#txt'), err = $('#sendErr'), texto = txt.value.trim();
  err.textContent = '';
  if(!texto || enviando || !sel) return;
  if(!enviarUrl){ err.textContent = 'El envío no está configurado.'; return; }
  enviando = true; $('#send').disabled = true; $('#send').textContent = 'Enviando…';
  try{
    const { data:{ session } } = await sb.auth.getSession();
    if(!session) throw new Error('Sesión caducada. Vuelve a entrar.');
    const r = await fetch(enviarUrl, { method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token, 'x-apikey': cfg().key },
      body: JSON.stringify({ wa_id: sel, texto }) });
    const j = await r.json().catch(()=>({}));
    if(!r.ok || j.ok !== true) throw new Error(j.error || ('Error '+r.status));
    txt.value = ''; humanos.add(sel); pintarHum(); pintarLista(); kpis();
    setTimeout(async()=>{ if(!mensajes.some(m=>m.rol==='humano' && m.texto===texto && Date.now()-new Date(m.created_at)<60000)){ const x = await sb.from('crm_mensajes').select('*').eq('wa_id',sel).order('created_at').limit(2000); mensajes = x.data||mensajes; pintarMsgs(); } }, 2000);
  }catch(e){ err.textContent = e.message; }
  finally{ enviando = false; $('#send').disabled = false; $('#send').textContent = 'Enviar'; }
}
$('#send').onclick = enviar;
$('#txt').addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); enviar(); } });
$('#csv').onclick = ()=>{
  const q = v=>{ let s=String(v??''); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
  const rows = [['Teléfono','Nombre','Estado','Etiquetas','Notas','Primer contacto','Último mensaje'].map(q).join(',')]
    .concat(clientes.map(c=>[c.wa_id,c.nombre,c.estado,(c.etiquetas||[]).join('; '),c.notas,c.primer_contacto,c.ultimo_mensaje].map(q).join(',')));
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+rows.join('\n')],{type:'text/csv'})); a.download='clientes-motohaus.csv'; a.click();
};
init();
