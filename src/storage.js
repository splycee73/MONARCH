const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.env.CONFIG_DIR || "./data");
const guildDir = path.join(root, "guilds");
const warningDir = path.join(root, "warnings");

function ensureDirs() {
  fs.mkdirSync(guildDir, { recursive: true });
  fs.mkdirSync(warningDir, { recursive: true });
}

function defaults(guildId) {
  return {
    guildId,
    prefixRoles: {},
    logs: { channelId: null, events: {
      messageDelete: true, messageUpdate: true, memberJoin: true, memberLeave: true,
      memberUpdate: true, roleCreate: true, roleDelete: true, roleUpdate: true,
      channelCreate: true, channelDelete: true, channelUpdate: true,
      voiceStateUpdate: true, guildUpdate: true, moderation: true
    }},
    welcome: { enabled: false, channelId: null, message: "¡Bienvenido {user} a **{server}**! Ahora somos {membercount} miembros.", style: "classic", title: "¡Tenemos un nuevo miembro!", color: "#D6A84B", image: null, thumbnail: null },
    goodbye: { enabled: false, channelId: null, message: "{username} ha salido de {server}." },
    moderation: { modLogChannelId: null, dmOnAction: true },
    updatedAt: new Date().toISOString()
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") console.error("JSON read error:", error); return fallback; }
}

function writeJson(file, value) {
  ensureDirs();
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function guildFile(id) { return path.join(guildDir, id + ".json"); }
function getGuildConfig(id) {
  ensureDirs();
  return { ...defaults(id), ...readJson(guildFile(id), {}), logs: {
    ...defaults(id).logs, ...(readJson(guildFile(id), {}).logs || {}),
    events: { ...defaults(id).logs.events, ...((readJson(guildFile(id), {}).logs || {}).events || {}) }
  }};
}
function saveGuildConfig(id, config) {
  const value = { ...config, guildId: id, updatedAt: new Date().toISOString() };
  writeJson(guildFile(id), value);
  return value;
}
function getWarnings(guildId) {
  ensureDirs();
  return readJson(path.join(warningDir, guildId + ".json"), []);
}
function addWarning(guildId, warning) {
  const warnings = getWarnings(guildId);
  warnings.push({ id: Date.now().toString(36), createdAt: new Date().toISOString(), ...warning });
  writeJson(path.join(warningDir, guildId + ".json"), warnings);
  return warnings.at(-1);
}
module.exports = { ensureDirs, getGuildConfig, saveGuildConfig, getWarnings, addWarning };
