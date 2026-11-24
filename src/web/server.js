const express = require("express");
const cookieSession = require("cookie-session");
const { PermissionFlagsBits } = require("discord.js");
const { getGuildConfig, saveGuildConfig } = require("../storage");

function createWebServer(client) {
  const app = express();
  const sessionSecret = process.env.SESSION_SECRET;
  const crypto = require("node:crypto");
  const dashboardUrl = (process.env.DASHBOARD_URL || "").replace(/\/+$/, "");
  const oauthStates = new Map();
  const oauthSessions = new Map();
  if (!dashboardUrl) throw new Error("DASHBOARD_URL debe apuntar al dominio público del panel.");
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET debe estar configurado en Render y tener al menos 32 caracteres.");
  }
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieSession({
    name: "monarch_session",
    keys: [sessionSecret],
    maxAge: 12 * 60 * 60 * 1000,
    httpOnly: true, sameSite: "lax", secure: true
  }));

  function auth(req, res, next) {
    const sessionId = req.session?.sid;
    const oauth = sessionId && oauthSessions.get(sessionId);
    if (!req.session?.user?.id || !oauth || oauth.expiresAt < Date.now()) {
      if (sessionId) oauthSessions.delete(sessionId);
      req.session = null;
      return res.status(401).json({ error: "Tu sesión de Discord expiró. Inicia sesión nuevamente." });
    }
    next();
  }
  async function getOAuthGuilds(req) {
    const sessionId = req.session?.sid;
    const oauth = sessionId && oauthSessions.get(sessionId);
    if (!oauth || oauth.expiresAt < Date.now()) throw new Error("La sesión de Discord expiró.");
    if (oauth.tokenExpiresAt <= Date.now() + 30000) {
      if (!oauth.refreshToken) throw new Error("Discord requiere iniciar sesión nuevamente.");
      const refreshResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: oauth.refreshToken
        })
      });
      const refreshed = await refreshResponse.json();
      if (!refreshResponse.ok || !refreshed.access_token) {
        oauthSessions.delete(sessionId);
        throw new Error("No se pudo renovar la sesión de Discord.");
      }
      oauth.accessToken = refreshed.access_token;
      oauth.refreshToken = refreshed.refresh_token || oauth.refreshToken;
      oauth.tokenExpiresAt = Date.now() + (Number(refreshed.expires_in) || 3600) * 1000;
    }
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${oauth.accessToken}` }
    });
    const guilds = await response.json();
    if (!response.ok || !Array.isArray(guilds)) throw new Error("No se pudieron consultar tus servidores de Discord.");
    return guilds;
  }
  async function canManage(guildId, req) {
    const guilds = await getOAuthGuilds(req);
    const membership = guilds.find(item => item.id === guildId);
    if (!membership) return false;
    const permissions = BigInt(membership.permissions || "0");
    const ADMINISTRATOR = 0x8n;
    const MANAGE_GUILD = 0x20n;
    return Boolean(membership.owner) || (permissions & ADMINISTRATOR) === ADMINISTRATOR || (permissions & MANAGE_GUILD) === MANAGE_GUILD;
  }

  const redirectUri = `${dashboardUrl}/auth/callback`;
  app.get("/auth/discord", (req, res) => {
    const state = crypto.randomBytes(24).toString("hex");
    oauthStates.set(state, Date.now() + 10 * 60 * 1000);
    for (const [key, expiry] of oauthStates) if (expiry < Date.now()) oauthStates.delete(key);
    const params = new URLSearchParams({ client_id: process.env.CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "identify guilds", state });
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });
  app.get("/auth/callback", async (req, res) => {
    const { code, state, error } = req.query;
    const stateKey = String(state || "");
    const expiresAt = oauthStates.get(stateKey);
    oauthStates.delete(stateKey);
    if (error || !code || !state || !expiresAt || expiresAt < Date.now()) {
      return res.status(400).send("Autorización de Discord cancelada o inválida. Vuelve al panel e inténtalo de nuevo.");
    }
    try {
      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: "authorization_code", code: String(code), redirect_uri: redirectUri })
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) throw new Error("No se pudo validar el acceso con Discord.");
      const userResponse = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const user = await userResponse.json();
      if (!userResponse.ok || !user.id) throw new Error("Discord no devolvió un usuario válido.");
      if (!tokenData.refresh_token) throw new Error("Discord no devolvió un token de renovación.");
      const sessionId = crypto.randomBytes(32).toString("hex");
      oauthSessions.set(sessionId, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: Date.now() + (Number(tokenData.expires_in) || 3600) * 1000,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000
      });
      req.session = {
        sid: sessionId,
        user: { id: user.id, username: user.username, global_name: user.global_name || user.username }
      };
      res.redirect("/dashboard");
    } catch (err) {
      console.error("Discord OAuth callback error:", err.message);
      res.status(502).send("No se pudo completar el inicio de sesión con Discord. Vuelve al panel e inténtalo.");
    }
  });
  app.post("/auth/logout", (req, res) => {
    if (req.session?.sid) oauthSessions.delete(req.session.sid);
    req.session = null;
    res.json({ ok: true });
  });
  app.get("/api/me", auth, (req, res) => res.json({ user: req.session.user }));
  app.get("/api/guilds", auth, async (req, res) => {
    try {
      const userGuilds = await getOAuthGuilds(req);
      const manageableIds = new Set(userGuilds.filter(item => {
        const permissions = BigInt(item.permissions || "0");
        return Boolean(item.owner) || (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
      }).map(item => item.id));
      const guilds = [...client.guilds.cache.values()]
        .filter(guild => manageableIds.has(guild.id))
        .map(guild => ({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }), memberCount: guild.memberCount }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ guilds });
    } catch (error) {
      console.error("Discord guild lookup error:", error.message);
      res.status(401).json({ error: "No se pudieron consultar tus servidores. Vuelve a iniciar sesión con Discord." });
    }
  });
  app.get("/api/guilds/:id/config", auth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild || !await canManage(guild.id, req)) return res.status(403).json({ error: "No tienes acceso a este servidor." });
    res.json({ config: getGuildConfig(guild.id), channels: guild.channels.cache.filter(c => c.isTextBased()).map(c => ({ id: c.id, name: c.name })) , roles: guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).map(r => ({ id: r.id, name: r.name })) });
  });
  app.put("/api/guilds/:id/config", auth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild || !await canManage(guild.id, req)) return res.status(403).json({ error: "No tienes acceso a este servidor." });
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

  app.get("/", (req, res) => res.type("html").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090909"><meta name="description" content="MONARCH: administra, protege y personaliza tu comunidad de Discord desde un solo lugar."><meta name="google-site-verification" content="6P7qBWola4bpBBfuEflM1dRnTTsoWgfTistZi1T1-LU"><title>MONARCH — Controla tu comunidad</title>
<style>
:root{color-scheme:dark;--bg:#080808;--panel:#111;--line:#252525;--red:#d62828;--red2:#ff4545;--muted:#a1a1aa;--white:#f7f7f8}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--white);font:15px Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}a{color:inherit;text-decoration:none}.wrap{width:min(1120px,calc(100% - 40px));margin:auto}.nav{height:78px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff12}.brand{font-weight:950;letter-spacing:4px;font-size:21px}.brand span{color:var(--red2)}.navlinks{display:flex;gap:28px;color:#b6b6bd;font-size:13px}.navlinks a:hover{color:white}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:13px 19px;border-radius:9px;background:var(--red);color:white;font-weight:800;border:1px solid #ff555533;transition:.2s;box-shadow:0 8px 30px #d6282826}.btn:hover{background:#ed3434;transform:translateY(-2px)}.btn.ghost{background:#ffffff08;border:1px solid #ffffff20;box-shadow:none}.hero{position:relative;overflow:hidden;padding:108px 0 92px;text-align:center}.hero:before{content:"";position:absolute;width:520px;height:520px;left:50%;top:-300px;transform:translateX(-50%);background:#d628282b;filter:blur(100px);border-radius:50%;pointer-events:none}.eyebrow{display:inline-flex;align-items:center;gap:9px;border:1px solid #d6282855;background:#d6282812;color:#ff7777;padding:8px 13px;border-radius:99px;font-size:11px;font-weight:850;letter-spacing:2px;text-transform:uppercase}.dot{width:7px;height:7px;border-radius:50%;background:#ff4c4c;box-shadow:0 0 12px #ff4c4c}.hero h1{position:relative;font-size:clamp(43px,7vw,76px);line-height:1.02;letter-spacing:-3.5px;margin:25px auto 18px;max-width:850px;font-weight:950}.hero h1 span{color:var(--red2)}.lead{color:var(--muted);font-size:17px;line-height:1.8;max-width:620px;margin:0 auto 30px}.actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap}.micro{margin-top:20px;color:#777;font-size:12px}.preview{width:min(850px,100%);margin:64px auto 0;border:1px solid #ffffff20;border-radius:16px;background:linear-gradient(145deg,#171717,#0c0c0c);padding:12px;box-shadow:0 35px 100px #0009;text-align:left}.windowbar{display:flex;align-items:center;gap:7px;padding:5px 7px 13px;border-bottom:1px solid #ffffff12}.windowbar i{width:8px;height:8px;border-radius:50%;background:#454545}.windowbar span{margin-left:auto;color:#777;font-size:10px;letter-spacing:2px}.previewbody{display:grid;grid-template-columns:180px 1fr;min-height:220px}.side{padding:18px 12px;border-right:1px solid #ffffff12}.side b{font-size:11px;letter-spacing:2px}.side p{font-size:11px;color:#777;background:#ffffff08;border-radius:6px;padding:9px}.dash{padding:22px}.dash small{color:#888}.dash h3{margin:5px 0 18px;font-size:22px}.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.tile{background:#ffffff08;border:1px solid #ffffff10;border-radius:9px;padding:14px}.tile strong{display:block;font-size:19px}.tile small{font-size:10px}.section{padding:74px 0}.sectionhead{text-align:center;margin-bottom:34px}.kicker{color:#ff6b6b;font-size:11px;letter-spacing:2.5px;font-weight:900}.section h2{font-size:clamp(28px,4vw,40px);letter-spacing:-1.3px;margin:10px 0}.sectionhead p{color:var(--muted);max-width:560px;margin:auto;line-height:1.7}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.feature{background:linear-gradient(145deg,#141414,#0d0d0d);border:1px solid var(--line);border-radius:13px;padding:23px;min-height:170px}.ico{width:38px;height:38px;border-radius:10px;background:#d6282820;color:#ff6969;display:grid;place-items:center;font-size:18px}.feature h3{font-size:16px;margin:17px 0 8px}.feature p{color:var(--muted);font-size:13px;line-height:1.7;margin:0}.cta{border:1px solid #d6282844;border-radius:16px;padding:42px 25px;text-align:center;background:radial-gradient(ellipse at top,#d6282820,transparent 65%),#101010}.cta h2{margin:0 0 12px;font-size:32px}.cta p{color:var(--muted);margin:0 auto 22px;line-height:1.7}.footer{border-top:1px solid #ffffff14;padding:25px 0;color:#777;font-size:12px}.footrow{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}.footrow b{color:#ddd;letter-spacing:3px}@media(max-width:720px){.navlinks{display:none}.hero{padding:78px 0 60px}.hero h1{letter-spacing:-2px}.preview{margin-top:42px}.previewbody{grid-template-columns:1fr}.side{display:none}.tiles{grid-template-columns:1fr}.features{grid-template-columns:1fr}.section{padding:55px 0}.cta h2{font-size:26px}}
</style></head><body>
<header class="wrap nav"><a class="brand" href="/">MON<span>ARCH</span></a><nav class="navlinks"><a href="#funciones">Funciones</a><a href="#panel">Panel</a><a href="#acceso">Acceso</a></nav><a class="btn ghost" href="/auth/discord">Iniciar sesión ↗</a></header>
<main><section class="hero wrap"><div class="eyebrow"><i class="dot"></i> BOT DE DISCORD · MONARCH</div><h1>Tu comunidad.<br><span>Tus reglas.</span> Tu reino.</h1><p class="lead">Lleva el control de tu servidor con herramientas de administración, registros y personalización reunidas en un solo lugar.</p><div class="actions"><a class="btn" href="/auth/discord">Continuar con Discord <span>→</span></a><a class="btn ghost" href="#funciones">Descubrir funciones</a></div><p class="micro">Acceso al panel para administradores de servidores con MONARCH.</p>
<div class="preview" id="panel"><div class="windowbar"><i></i><i></i><i></i><span>MONARCH CONTROL CENTER</span></div><div class="previewbody"><aside class="side"><b>MON<span style="color:#ed4545">ARCH</span></b><p>▦&nbsp; Resumen</p><p>◉&nbsp; Registros</p><p>♙&nbsp; Comunidad</p><p>⚙&nbsp; Configuración</p></aside><div class="dash"><small>VISTA GENERAL / PANEL</small><h3>Centro de control</h3><div class="tiles"><div class="tile"><strong>Logs</strong><small>Actividad del servidor</small></div><div class="tile"><strong>Welcome</strong><small>Mensajes de bienvenida</small></div><div class="tile"><strong>Roles</strong><small>Prefijos personalizados</small></div></div></div></div></div></section>
<section class="section wrap" id="funciones"><div class="sectionhead"><div class="kicker">PODER Y CONTROL</div><h2>Todo lo que tu comunidad necesita</h2><p>Configura las herramientas principales de MONARCH de forma clara y desde un mismo panel.</p></div><div class="features"><article class="feature"><div class="ico">⌁</div><h3>Registros detallados</h3><p>Organiza eventos del servidor y consulta actividad importante desde tu canal de logs.</p></article><article class="feature"><div class="ico">✦</div><h3>Bienvenidas y despedidas</h3><p>Personaliza mensajes para recibir a nuevos miembros y despedir a quienes se van.</p></article><article class="feature"><div class="ico">♛</div><h3>Prefijos por rol</h3><p>Asigna identificadores personalizados a los roles de tu comunidad.</p></article><article class="feature"><div class="ico">◈</div><h3>Panel centralizado</h3><p>Administra la configuración disponible sin tener que editar archivos manualmente.</p></article><article class="feature"><div class="ico">⌑</div><h3>Acceso protegido</h3><p>Inicio de sesión con Discord y permisos verificados por servidor.</p></article><article class="feature"><div class="ico">⚙</div><h3>Configuración sencilla</h3><p>Selecciona canales, activa funciones y guarda tus cambios desde la interfaz.</p></article></div></section>
<section class="section wrap" id="acceso"><div class="cta"><div class="kicker">EL CONTROL EMPIEZA AQUÍ</div><h2>Entra al centro de mando</h2><p>Identifícate con Discord para acceder a las herramientas de administración de MONARCH.</p><a class="btn" href="/auth/discord">Acceder con Discord →</a></div></section></main>
<footer class="footer"><div class="wrap footrow"><span><b>MONARCH</b> · Discord management</span><span>© 2026 MONARCH. Todos los derechos reservados.</span></div></footer>
</body></html>`));
  app.get("/dashboard", (req, res) => {
    if (!req.session?.user?.id || !req.session?.sid || !oauthSessions.has(req.session.sid)) return res.redirect("/");
    res.type("html").send(dashboardHtml);
  });
  app.get("/health", (req, res) => res.json({ ok: true, bot: client.isReady(), uptime: process.uptime() }));
  return app;
}

const dashboardHtml = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MONARCH Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#090909;--panel:#121212;--line:#292929;--red:#d62828;--muted:#999}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f4f4f4;font:15px Inter,system-ui,sans-serif}button,input,select,textarea{font:inherit}button{background:var(--red);border:0;color:white;border-radius:9px;padding:11px 16px;cursor:pointer;font-weight:700}button.secondary{background:#252525}header{height:70px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 max(5vw,20px)}.brand{font-weight:900;letter-spacing:3px}.brand span{color:var(--red)}main{max-width:1100px;margin:40px auto;padding:0 20px}.hero{margin-bottom:28px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:15px}.server{cursor:pointer;transition:.2s}.server:hover{border-color:var(--red);transform:translateY(-2px)}h1{font-size:30px;margin:0 0 8px}h2{font-size:18px;margin:0 0 16px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.field{display:grid;gap:7px;margin:12px 0}input,select,textarea{width:100%;background:#090909;color:white;border:1px solid var(--line);padding:11px;border-radius:8px}textarea{min-height:90px}label{color:#ccc;font-size:13px}.switch{display:flex;align-items:center;gap:9px;margin:10px 0}.switch input{width:auto}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.tabs button{background:#222}.tabs button.active{background:var(--red)}.hidden{display:none}.server-icon{width:42px;height:42px;border-radius:12px;background:#292929;object-fit:cover}.event-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px}.event{background:#0b0b0b;border:1px solid var(--line);border-radius:8px;padding:9px}.status{color:#7be0a2}.error{color:#ff7777}@media(max-width:600px){main{margin:25px auto}h1{font-size:24px}}
</style></head><body>
<header><div class="brand">MON<span>ARCH</span></div><div id="userArea"><a href="/auth/discord"><button type="button">Continuar con Discord</button></a></div></header>
<main><section id="home"><div class="hero"><h1>Panel de control</h1><p class="muted">Administra tus servidores y configura MONARCH desde un solo lugar.</p></div><div id="guilds" class="grid"><div class="card">Inicia sesión con Discord para ver los servidores que administras y donde está MONARCH.</div></div></section>
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
(async()=>{try{const me=await api("/api/me");document.getElementById("userArea").innerHTML='Hola, '+esc(me.user.global_name||me.user.username)+' · <button class="secondary" onclick="logout()">Salir</button>';const d=await api("/api/guilds");document.getElementById("guilds").innerHTML=d.guilds.length?d.guilds.map(g=>'<div class="card server" onclick="openGuild(\''+g.id+'\',\''+esc(g.name).replace(/'/g,"&#39;")+'\')"><div class="row">'+(g.icon?'<img class="server-icon" src="'+g.icon+'">':'<div class="server-icon"></div>')+'<div><b>'+esc(g.name)+'</b><div class="muted">'+g.memberCount+' miembros</div></div></div></div>').join(""):'<div class="card">No se encontraron servidores donde tengas permisos de administración y el bot esté instalado.</div>';}catch(e){document.getElementById("guilds").innerHTML='<div class="card">Inicia sesión con Discord para administrar MONARCH.</div>'}})();
async function logout(){await fetch("/auth/logout",{method:"POST"});location.reload()}
</script></body></html>`;

module.exports = { createWebServer };
