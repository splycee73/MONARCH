const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WELCOME_CHANNEL = "1574445237206515752";
const DEFAULT_WELCOME_GIF = "https://i.pinimg.com/originals/dc/3e/cd/dc3ecdab0fa15f3bd29d1e20718648e6.gif";
const DEFAULT_WELCOME_MESSAGE = [
  "<:30053darkmodeids:1574439368771502120> `:` Bienvenido {user}",
  "",
  "<:13163notificationids:1574439452707782666> **Nos alegra tenerte en {server}.**",
  "Ahora formas parte de nuestra comunidad.",
  "",
  "<:86863verifiedmembersids:1574439427558604830>  **Usuario:** {username}",
  "<:74190networkids:1574439408776515766>  **Miembros:** {membercount}",
  "",
  "> ¡Disfruta tu estadía y pásala genial!"
].join("\n");

const root = path.resolve(process.env.CONFIG_DIR || "./data");
const guildDir = path.join(root, "guilds");
const warningDir = path.join(root, "warnings");
const prefixDir = path.join(root, "prefixes");

function ensureDirs() {
  fs.mkdirSync(guildDir, { recursive: true });
  fs.mkdirSync(warningDir, { recursive: true });
  fs.mkdirSync(prefixDir, { recursive: true });
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
    welcome: { enabled: true, channelId: DEFAULT_WELCOME_CHANNEL, message: DEFAULT_WELCOME_MESSAGE, style: "classic", title: null, color: "#5865F2", image: DEFAULT_WELCOME_GIF, thumbnail: null },
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
  const base = defaults(id);
  const saved = readJson(guildFile(id), {});
  const config = { ...base, ...saved, logs: {
    ...base.logs, ...(saved.logs || {}),
    events: { ...base.logs.events, ...((saved.logs || {}).events || {}) }
  }, welcome: { ...base.welcome, ...(saved.welcome || {}) } };

  // Migrate installations that still have the old empty welcome defaults.
  if (!config.welcome.channelId) {
    config.welcome.enabled = true;
    config.welcome.channelId = DEFAULT_WELCOME_CHANNEL;
    config.welcome.message = DEFAULT_WELCOME_MESSAGE;
    config.welcome.style = "classic";
    config.welcome.title = null;
    config.welcome.color = "#5865F2";
  }
  // Use the preset animation for existing configurations without a welcome image.
  if (config.welcome.image === null || config.welcome.image === undefined) {
    config.welcome.image = DEFAULT_WELCOME_GIF;
  }
  return config;
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
function getPrefixState(guildId) {
  ensureDirs();
  return readJson(path.join(prefixDir, guildId + ".json"), {});
}
function savePrefixState(guildId, state) {
  writeJson(path.join(prefixDir, guildId + ".json"), state);
  return state;
}
function addWarning(guildId, warning) {
  const warnings = getWarnings(guildId);
  warnings.push({ id: Date.now().toString(36), createdAt: new Date().toISOString(), ...warning });
  writeJson(path.join(warningDir, guildId + ".json"), warnings);
  return warnings.at(-1);
}
module.exports = { ensureDirs, getGuildConfig, saveGuildConfig, getWarnings, addWarning, getPrefixState, savePrefixState };
