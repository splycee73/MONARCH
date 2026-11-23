const express = require("express");
const cookieSession = require("cookie-session");
const { PermissionFlagsBits } = require("discord.js");
const { getGuildConfig, saveGuildConfig } = require("../storage");

function createWebServer(client) {
  const app = express();
  const baseUrl = (process.env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, "");
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  app.set("trust proxy", 1);
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieSession({
    name: "monarch_session",
    keys: [process.env.SESSION_SECRET || "development-only-change-this-secret"],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true, sameSite: "lax", secure: baseUrl.startsWith("https://")
  }));

  function auth(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: "Inicia sesión con Discord." });
    next();
  }
  async function canManage(guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    return Boolean(member && (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)));
  }

  app.get("/auth/login", (req, res) => {
    if (!clientId || !clientSecret) return res.status(500).send("Configura CLIENT_ID y CLIENT_SECRET.");
    const state = require("node:crypto").randomBytes(24).toString("hex");
    req.session.oauthState = state;
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: baseUrl + "/auth/callback",
      response_type: "code", scope: "identify guilds", state
    });
    res.redirect("https://discord.com/oauth2/authorize?" + params);
  });
  app.get("/auth/callback", async (req, res) => {
    try {
      if (!req.query.code || !req.query.state || req.query.state !== req.session?.oauthState) return res.status(400).send("OAuth state inválido.");
      const body = new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code",
        code: req.query.code, redirect_uri: baseUrl + "/auth/callback"
      });
      const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body
      });
      const tokenText = await tokenResponse.text();
      if (!tokenResponse.ok) {
        console.error("Discord OAuth token error:", tokenResponse.status, tokenText.slice(0, 1000));
        throw new Error(`Discord OAuth falló (${tokenResponse.status})`);
      }
      const token = JSON.parse(tokenText);
      const userResponse = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: "Bearer " + token.access_token } });
      if (!userResponse.ok) throw new Error("No se pudo obtener el usuario.");
      const user = await userResponse.json();
      req.session.user = { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar };
      req.session.oauthState = null;
      res.redirect("/");
    } catch (error) { console.error("OAuth error:", error); res.status(500).send("Error iniciando sesión. Inténtalo de nuevo."); }
  });
  app.post("/auth/logout", (req, res) => { req.session = null; res.json({ ok: true }); });
  app.get("/api/me", auth, (req, res) => res.json({ user: req.session.user }));
  app.get("/api/guilds", auth, async (req, res) => {
    const results = await Promise.all([...client.guilds.cache.values()].map(async g => {
      if (!await canManage(g, req.session.user.id)) return null;
      return { id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), memberCount: g.memberCount };
    }));
    const guilds = results.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ guilds });
  });
  app.get("/api/guilds/:id/config", auth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild || !await canManage(guild, req.session.user.id)) return res.status(403).json({ error: "No tienes acceso a este servidor." });
    res.json({ config: getGuildConfig(guild.id), channels: guild.channels.cache.filter(c => c.isTextBased()).map(c => ({ id: c.id, name: c.name })) , roles: guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).map(r => ({ id: r.id, name: r.name })) });
  });
  app.put("/api/guilds/:id/config", auth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild || !await canManage(guild, req.session.user.id)) return res.status(403).json({ error: "No tienes acceso a este servidor." });
    const input = req.body || {};
    const current = getGuildConfig(guild.id);
    if (input.logs) {
      if (input.logs.channelId === null || guild.channels.cache.get(input.logs.channelId)?.isTextBased()) current.logs.channelId = input.logs.channelId;
      if (input.logs.events && typeof input.logs.events === "object") {
        for (const key of Object.keys(current.logs.events)) if (typeof input.logs.events[key] === "boolean") current.logs.events[key] = input.logs.events[key];
      }
    }
    if (input.welcome) {
      if (typeof input.welcome.enabled === "boolean") current.welcome.enabled = input.welcome.enabled;
      if (typeof input.welcome.message === "string") current.welcome.message = input.welcome.message.slice(0, 1500);
      if (typeof input.welcome.embed === "boolean") current.welcome.embed = input.welcome.embed;
      if (input.welcome.channelId === null || guild.channels.cache.get(input.welcome.channelId)?.isTextBased()) current.welcome.channelId = input.welcome.channelId;
    }
    if (input.goodbye) {
      if (typeof input.goodbye.enabled === "boolean") current.goodbye.enabled = input.goodbye.enabled;
      if (typeof input.goodbye.message === "string") current.goodbye.message = input.goodbye.message.slice(0, 1500);
      if (input.goodbye.channelId === null || guild.channels.cache.get(input.goodbye.channelId)?.isTextBased()) current.goodbye.channelId = input.goodbye.channelId;
    }
    if (input.prefixRoles && typeof input.prefixRoles === "object") {
      const safe = {};
      for (const [roleId, prefix] of Object.entries(input.prefixRoles)) {
        if (guild.roles.cache.has(roleId) && typeof prefix === "string" && prefix.length > 0 && prefix.length <= 8) safe[roleId] = prefix;
      }
      current.prefixRoles = safe;
    }
    saveGuildConfig(guild.id, current);
    res.json({ ok: true, config: current });
  });

  app.get("/", (req, res) => res.type("html").send(dashboardHtml));
  app.get("/health", (req, res) => res.json({ ok: true, bot: client.isReady(), uptime: process.uptime() }));
  return app;
}

const dashboardHtml = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MONARCH Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#090909;--panel:#121212;--line:#292929;--red:#d62828;--muted:#999}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f4f4f4;font:15px Inter,system-ui,sans-serif}button,input,select,textarea{font:inherit}button{background:var(--red);border:0;color:white;border-radius:9px;padding:11px 16px;cursor:pointer;font-weight:700}button.secondary{background:#252525}header{height:70px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 max(5vw,20px)}.brand{font-weight:900;letter-spacing:3px}.brand span{color:var(--red)}main{max-width:1100px;margin:40px auto;padding:0 20px}.hero{margin-bottom:28px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:15px}.server{cursor:pointer;transition:.2s}.server:hover{border-color:var(--red);transform:translateY(-2px)}h1{font-size:30px;margin:0 0 8px}h2{font-size:18px;margin:0 0 16px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.field{display:grid;gap:7px;margin:12px 0}input,select,textarea{width:100%;background:#090909;color:white;border:1px solid var(--line);padding:11px;border-radius:8px}textarea{min-height:90px}label{color:#ccc;font-size:13px}.switch{display:flex;align-items:center;gap:9px;margin:10px 0}.switch input{width:auto}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.tabs button{background:#222}.tabs button.active{background:var(--red)}.hidden{display:none}.server-icon{width:42px;height:42px;border-radius:12px;background:#292929;object-fit:cover}.event-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px}.event{background:#0b0b0b;border:1px solid var(--line);border-radius:8px;padding:9px}.status{color:#7be0a2}.error{color:#ff7777}@media(max-width:600px){main{margin:25px auto}h1{font-size:24px}}
</style></head><body>
<header><div class="brand">MON<span>ARCH</span></div><div id="userArea"><a href="/auth/login"><button>Entrar con Discord</button></a></div></header>
<main><section id="home"><div class="hero"><h1>Panel de control</h1><p class="muted">Administra tus servidores y configura MONARCH desde un solo lugar.</p></div><div id="guilds" class="grid"><div class="card">Conecta tu cuenta de Discord para comenzar.</div></div></section>
<section id="settings" class="hidden"><div class="row"><button class="secondary" onclick="showHome()">← Servidores</button><div><h1 id="guildName">Servidor</h1><p class="muted">Configuración de MONARCH</p></div></div>
<div class="tabs"><button class="active" data-tab="logs">Logs</button><button data-tab="welcome">Bienvenidas</button><button data-tab="goodbye">Despedidas</button><button data-tab="prefix">Prefijos</button></div>
<div id="tab-logs" class="card"><h2>Registro de eventos</h2><div class="field"><label>Canal de logs</label><select id="logsChannel"></select></div><div id="events" class="event-grid"></div><button onclick="save()">Guardar logs</button></div>
<div id="tab-welcome" class="card hidden"><h2>Bienvenidas</h2><label class="switch"><input id="welcomeEnabled" type="checkbox"> Activar bienvenidas</label><div class="field"><label>Canal</label><select id="welcomeChannel"></select></div><div class="field"><label>Mensaje</label><textarea id="welcomeMessage"></textarea></div><label class="switch"><input id="welcomeEmbed" type="checkbox"> Mostrar en embed</label><button onclick="save()">Guardar bienvenidas</button><p class="muted">Variables: {user}, {username}, {server}, {membercount}</p></div>
<div id="tab-goodbye" class="card hidden"><h2>Despedidas</h2><label class="switch"><input id="goodbyeEnabled" type="checkbox"> Activar despedidas</label><div class="field"><label>Canal</label><select id="goodbyeChannel"></select></div><div class="field"><label>Mensaje</label><textarea id="goodbyeMessage"></textarea></div><button onclick="save()">Guardar despedidas</button><p class="muted">Variables: {username}, {server}</p></div>
<div id="tab-prefix" class="card hidden"><h2>Prefijos por rol</h2><div class="field"><label>Rol</label><select id="prefixRole"></select></div><div class="field"><label>Prefijo</label><input id="prefixValue" maxlength="8" placeholder="👑"></div><button onclick="addPrefix()">Añadir / actualizar</button><div id="prefixList" style="margin-top:18px"></div><button class="secondary" onclick="save()">Guardar prefijos</button></div>
<p id="notice" class="muted"></p></section></main>
<script>
let current=null, config=null, channels=[], roles=[];
const eventNames={messageDelete:"Mensajes eliminados",messageUpdate:"Mensajes editados",memberJoin:"Miembros que entran",memberLeave:"Miembros que salen",memberUpdate:"Cambios de miembros y roles",roleCreate:"Roles creados",roleDelete:"Roles eliminados",roleUpdate:"Roles modificados",channelCreate:"Canales creados",channelDelete:"Canales eliminados",channelUpdate:"Canales modificados",voiceStateUpdate:"Actividad de voz",guildUpdate:"Cambios del servidor",moderation:"Auditoría y moderación"};
function notice(t){document.getElementById("notice").textContent=t}
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||"Error");return d}
function showHome(){document.getElementById("home").classList.remove("hidden");document.getElementById("settings").classList.add("hidden")}
async function openGuild(id,name){current=id;document.getElementById("guildName").textContent=name;const d=await api("/api/guilds/"+id+"/config");config=d.config;channels=d.channels;roles=d.roles;fillSelect("logsChannel",channels,config.logs.channelId);fillSelect("welcomeChannel",channels,config.welcome.channelId);fillSelect("goodbyeChannel",channels,config.goodbye.channelId);fillSelect("prefixRole",roles,null);document.getElementById("welcomeEnabled").checked=config.welcome.enabled;document.getElementById("welcomeMessage").value=config.welcome.message;document.getElementById("welcomeEmbed").checked=config.welcome.embed;document.getElementById("goodbyeEnabled").checked=config.goodbye.enabled;document.getElementById("goodbyeMessage").value=config.goodbye.message;renderEvents();renderPrefixes();document.getElementById("home").classList.add("hidden");document.getElementById("settings").classList.remove("hidden");}
function fillSelect(id,items,selected){const el=document.getElementById(id);el.innerHTML='<option value="">— Sin seleccionar —</option>'+items.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join("");el.value=selected||""}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderEvents(){document.getElementById("events").innerHTML=Object.entries(eventNames).map(([k,v])=>'<label class="event"><input type="checkbox" data-event="'+k+'" '+(config.logs.events[k]?'checked':'')+'> '+v+'</label>').join("")}
function renderPrefixes(){document.getElementById("prefixList").innerHTML=Object.entries(config.prefixRoles||{}).map(([id,p])=>{const role=roles.find(r=>r.id===id);return '<div class="row" style="justify-content:space-between;padding:8px;border-bottom:1px solid #292929"><span>'+esc(role?.name||id)+' → <b>'+esc(p)+'</b></span><button class="secondary" onclick="removePrefix(\''+id+'\')">Quitar</button></div>'}).join("")||'<p class="muted">No hay prefijos configurados.</p>'}
function addPrefix(){const id=document.getElementById("prefixRole").value,p=document.getElementById("prefixValue").value.trim();if(!id||!p)return notice("Selecciona un rol y escribe un prefijo.");config.prefixRoles[id]=p;renderPrefixes();notice("Prefijo añadido. Guarda los cambios.")}
function removePrefix(id){delete config.prefixRoles[id];renderPrefixes()}
async function save(){try{config.logs.channelId=document.getElementById("logsChannel").value||null;document.querySelectorAll("[data-event]").forEach(e=>config.logs.events[e.dataset.event]=e.checked);config.welcome={enabled:document.getElementById("welcomeEnabled").checked,channelId:document.getElementById("welcomeChannel").value||null,message:document.getElementById("welcomeMessage").value,embed:document.getElementById("welcomeEmbed").checked};config.goodbye={enabled:document.getElementById("goodbyeEnabled").checked,channelId:document.getElementById("goodbyeChannel").value||null,message:document.getElementById("goodbyeMessage").value};await api("/api/guilds/"+current+"/config",{method:"PUT",body:JSON.stringify(config)});notice("Cambios guardados correctamente.");}catch(e){notice(e.message)}}
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));["logs","welcome","goodbye","prefix"].forEach(t=>document.getElementById("tab-"+t).classList.toggle("hidden",t!==b.dataset.tab))}));
(async()=>{try{const me=await api("/api/me");document.getElementById("userArea").innerHTML='Hola, '+esc(me.user.global_name||me.user.username)+' · <button class="secondary" onclick="logout()">Salir</button>';const d=await api("/api/guilds");document.getElementById("guilds").innerHTML=d.guilds.length?d.guilds.map(g=>'<div class="card server" onclick="openGuild(\''+g.id+'\',\''+esc(g.name).replace(/'/g,"&#39;")+'\')"><div class="row">'+(g.icon?'<img class="server-icon" src="'+g.icon+'">':'<div class="server-icon"></div>')+'<div><b>'+esc(g.name)+'</b><div class="muted">'+g.memberCount+' miembros</div></div></div></div>').join(""):'<div class="card">No se encontraron servidores donde tengas permisos de administración y el bot esté instalado.</div>';}catch(e){document.getElementById("guilds").innerHTML='<div class="card">Inicia sesión con Discord para administrar tus servidores.<br><br><a href="/auth/login"><button>Continuar con Discord</button></a></div>'}})();
async function logout(){await fetch("/auth/logout",{method:"POST"});location.reload()}
</script></body></html>`;

module.exports = { createWebServer };
