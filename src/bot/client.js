const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits,
  REST, Routes, AuditLogEvent
} = require("discord.js");
const commands = require("../commands");
const { getGuildConfig, saveGuildConfig, addWarning, getWarnings, getPrefixState, savePrefixState } = require("../storage");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User]
});

function render(template, member) {
  return String(template || "")
    .replaceAll("{user}", member.toString())
    .replaceAll("{username}", member.user.username)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{membercount}", String(member.guild.memberCount));
}
async function sendLog(guild, key, title, description, color = 0xD62828) {
  const config = getGuildConfig(guild.id);
  if (!config.logs.events[key] || !config.logs.channelId) return;
  const channel = guild.channels.cache.get(config.logs.channelId);
  if (!channel?.isTextBased()) return;
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description.slice(0, 4000)).setTimestamp();
  channel.send({ embeds: [embed] }).catch(() => {});
}
async function applyRolePrefix(member) {
  if (!member || member.user.bot || !member.manageable) return;
  const config = getGuildConfig(member.guild.id);
  const state = getPrefixState(member.guild.id);
  const record = state[member.id];
  const currentNick = member.nickname;
  const active = Object.entries(config.prefixRoles || {})
    .filter(([roleId]) => member.roles.cache.has(roleId))
    .sort((a, b) => (member.guild.roles.cache.get(b[0])?.position || 0) - (member.guild.roles.cache.get(a[0])?.position || 0));
  let baseNickname = record ? record.baseNickname : currentNick;
  if (record && currentNick !== record.appliedNickname) baseNickname = currentNick;

  if (!active.length) {
    if (record && currentNick === record.appliedNickname) {
      await member.setNickname(record.baseNickname, "MONARCH: restore nickname after role prefix").catch(() => {});
    }
    delete state[member.id];
    savePrefixState(member.guild.id, state);
    return;
  }

  const [roleId, prefix] = active[0];
  const desired = (prefix.trim() + " " + (baseNickname || member.user.username)).slice(0, 32);
  if (currentNick !== desired) await member.setNickname(desired, "MONARCH: synchronize role prefix").catch(() => {});
  state[member.id] = { baseNickname, appliedNickname: desired, roleId, prefix: prefix.trim() };
  savePrefixState(member.guild.id, state);
}
async function logModeration(guild, text) {
  const config = getGuildConfig(guild.id);
  const id = config.moderation?.modLogChannelId || config.logs.channelId;
  const channel = id && guild.channels.cache.get(id);
  if (channel?.isTextBased()) channel.send({ embeds: [new EmbedBuilder().setColor(0xD62828).setDescription(text).setTimestamp()] }).catch(() => {});
}

client.once("ready", async () => {
  console.log(`MONARCH online as ${client.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("Global slash commands registered.");
  } catch (error) { console.error("Command registration failed:", error); }
});

client.on("guildMemberAdd", async member => {
  const config = getGuildConfig(member.guild.id);
  if (config.welcome.enabled && config.welcome.channelId) {
    const channel = member.guild.channels.cache.get(config.welcome.channelId);
    if (channel?.isTextBased()) {
      const text = render(config.welcome.message, member);
      const embed = config.welcome.embed
        ? new EmbedBuilder().setColor(0xD62828).setDescription(text).setThumbnail(member.user.displayAvatarURL()).setTimestamp()
        : null;
      channel.send(embed ? { embeds: [embed] } : { content: text }).catch(() => {});
    }
  }
  await sendLog(member.guild, "memberJoin", "Miembro nuevo", `${member.user.tag} (${member.id})`);
  await applyRolePrefix(member);
});
client.on("guildMemberRemove", async member => {
  const config = getGuildConfig(member.guild.id);
  if (config.goodbye?.enabled && config.goodbye.channelId) {
    const channel = member.guild.channels.cache.get(config.goodbye.channelId);
    if (channel?.isTextBased()) channel.send(config.goodbye.message.replaceAll("{username}", member.user.username).replaceAll("{server}", member.guild.name)).catch(() => {});
  }
  await sendLog(member.guild, "memberLeave", "Miembro salió", `${member.user.tag} (${member.id})`);
});
client.on("guildMemberUpdate", async (before, after) => {
  const added = after.roles.cache.filter(role => !before.roles.cache.has(role.id));
  const removed = before.roles.cache.filter(role => !after.roles.cache.has(role.id));
  if (added.size || removed.size) {
    await sendLog(after.guild, "memberUpdate", "Roles actualizados", `${after.user.tag}\nAñadidos: ${added.map(r => r.name).join(", ") || "ninguno"}\nQuitados: ${removed.map(r => r.name).join(", ") || "ninguno"}`);
    await applyRolePrefix(after);
  }
  if (before.nickname !== after.nickname) await sendLog(after.guild, "memberUpdate", "Apodo modificado", `${after.user.tag}: ${before.nickname || "sin apodo"} → ${after.nickname || "sin apodo"}`);
});
client.on("messageDelete", async message => {
  if (message.guild && !message.author?.bot) await sendLog(message.guild, "messageDelete", "Mensaje eliminado", `Autor: ${message.author?.tag || "desconocido"}\nCanal: ${message.channel}\nContenido: ${message.content || "[sin contenido o no disponible]"}`);
});
client.on("messageUpdate", async (before, after) => {
  if (after.guild && !after.author?.bot && before.content !== after.content) await sendLog(after.guild, "messageUpdate", "Mensaje editado", `Autor: ${after.author?.tag}\nCanal: ${after.channel}\nAntes: ${before.content || "[vacío]"}\nDespués: ${after.content || "[vacío]"}`);
});
client.on("roleCreate", role => sendLog(role.guild, "roleCreate", "Rol creado", role.name));
client.on("roleDelete", role => sendLog(role.guild, "roleDelete", "Rol eliminado", role.name));
client.on("roleUpdate", (before, after) => sendLog(after.guild, "roleUpdate", "Rol modificado", `${before.name} → ${after.name}`));
client.on("channelCreate", channel => { if (channel.guild) sendLog(channel.guild, "channelCreate", "Canal creado", channel.name); });
client.on("channelDelete", channel => { if (channel.guild) sendLog(channel.guild, "channelDelete", "Canal eliminado", channel.name); });
client.on("channelUpdate", (before, after) => { if (after.guild) sendLog(after.guild, "channelUpdate", "Canal modificado", `${before.name} → ${after.name}`); });
client.on("voiceStateUpdate", (before, after) => sendLog(after.guild, "voiceStateUpdate", "Cambio de voz", `${after.member?.user.tag || before.member?.user.tag}: ${before.channel?.name || "fuera"} → ${after.channel?.name || "fuera"}`));
client.on("guildUpdate", (before, after) => sendLog(after, "guildUpdate", "Servidor modificado", `${before.name} → ${after.name}`));
client.on("guildAuditLogEntryCreate", (entry, guild) => {
  const actor = entry.executor?.tag || "Desconocido";
  sendLog(guild, "moderation", "Evento de auditoría", `Acción: ${entry.action}\nAutor: ${actor}\nObjetivo: ${entry.target?.tag || entry.target?.name || entry.targetId || "No disponible"}\nMotivo: ${entry.reason || "No indicado"}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild, member } = interaction;
  try {
    if (commandName === "ping") return interaction.reply({ content: `Pong: ${client.ws.ping} ms`, ephemeral: true });
    if (commandName === "help") return interaction.reply({ content: "**MONARCH**\n/ping · /clear · /kick · /ban · /timeout · /warn · /warnings · /prefix · /logs · /welcome\nConfigura más funciones desde el panel web.", ephemeral: true });
    if (!guild) return interaction.reply({ content: "Este comando solo funciona en servidores.", ephemeral: true });

    if (commandName === "clear") {
      const amount = interaction.options.getInteger("cantidad");
      const deleted = await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ content: `Se eliminaron **${deleted.size}** mensajes. Los mensajes de más de 14 días no se pueden borrar en bloque.`, ephemeral: true });
    }
    if (commandName === "kick" || commandName === "ban") {
      const user = interaction.options.getUser("usuario");
      const reason = interaction.options.getString("razon") || "Sin motivo indicado";
      const target = await guild.members.fetch(user.id).catch(() => null);
      if (target && !target.moderatable && commandName === "ban") return interaction.reply({ content: "No puedo moderar a ese miembro por la jerarquía de roles.", ephemeral: true });
      if (commandName === "kick" && (!target || !target.kickable)) return interaction.reply({ content: "No puedo expulsar a ese miembro.", ephemeral: true });
      if (commandName === "kick") await target.kick(reason); else await guild.members.ban(user.id, { reason });
      await logModeration(guild, `**${commandName.toUpperCase()}** · ${user.tag}\nModerador: ${interaction.user.tag}\nMotivo: ${reason}`);
      return interaction.reply({ content: `${user.tag} fue ${commandName === "kick" ? "expulsado" : "baneado"}.`, ephemeral: true });
    }
    if (commandName === "timeout") {
      const user = interaction.options.getUser("usuario");
      const minutes = interaction.options.getInteger("minutos");
      const target = await guild.members.fetch(user.id);
      if (!target.moderatable) return interaction.reply({ content: "No puedo moderar a ese miembro.", ephemeral: true });
      await target.timeout(minutes === 0 ? null : minutes * 60000, interaction.options.getString("razon") || "Moderación");
      await logModeration(guild, `**TIMEOUT** · ${user.tag} · ${minutes} min · Moderador: ${interaction.user.tag}`);
      return interaction.reply({ content: minutes === 0 ? "Timeout retirado." : `Timeout aplicado por ${minutes} minutos.`, ephemeral: true });
    }
    if (commandName === "warn") {
      const user = interaction.options.getUser("usuario");
      const reason = interaction.options.getString("razon");
      const warning = addWarning(guild.id, { userId: user.id, moderatorId: interaction.user.id, reason });
      await logModeration(guild, `**WARN** · ${user.tag}\nMotivo: ${reason}\nID: ${warning.id}`);
      return interaction.reply({ content: `Advertencia registrada para ${user.tag}.`, ephemeral: true });
    }
    if (commandName === "warnings") {
      const user = interaction.options.getUser("usuario");
      const list = getWarnings(guild.id).filter(item => item.userId === user.id);
      return interaction.reply({ content: list.length ? list.slice(-10).map((w, i) => `${i + 1}. ${w.reason} — <@!${w.moderatorId}>`).join("\n") : "Este usuario no tiene advertencias.", ephemeral: true });
    }
    if (commandName === "prefix") {
      const config = getGuildConfig(guild.id);
      const sub = interaction.options.getSubcommand();
      if (sub === "set") {
        const role = interaction.options.getRole("role");
        const prefix = interaction.options.getString("prefix").trim();
        if (!prefix || prefix.length > 8) return interaction.reply({ content: "El prefijo debe tener entre 1 y 8 caracteres.", ephemeral: true });
        config.prefixRoles[role.id] = prefix;
        saveGuildConfig(guild.id, config);
        return interaction.reply({ content: `Prefijo **${prefix}** configurado para ${role}.`, ephemeral: true });
      }
      if (sub === "remove") {
        const role = interaction.options.getRole("role");
        delete config.prefixRoles[role.id];
        saveGuildConfig(guild.id, config);
        return interaction.reply({ content: `Configuración eliminada para ${role.name}.`, ephemeral: true });
      }
      const rows = Object.entries(config.prefixRoles);
      return interaction.reply({ content: rows.length ? rows.map(([id, prefix]) => `<@&${id}> → **${prefix}**`).join("\n") : "No hay prefijos configurados.", ephemeral: true });
    }
    if (commandName === "logs") {
      const config = getGuildConfig(guild.id);
      config.logs.channelId = interaction.options.getChannel("canal").id;
      saveGuildConfig(guild.id, config);
      return interaction.reply({ content: "Canal de logs configurado. Puedes activar o desactivar eventos desde el panel.", ephemeral: true });
    }
    if (commandName === "welcome") {
      const config = getGuildConfig(guild.id);
      config.welcome.enabled = interaction.options.getBoolean("activar");
      const channel = interaction.options.getChannel("canal");
      if (channel) config.welcome.channelId = channel.id;
      saveGuildConfig(guild.id, config);
      return interaction.reply({ content: `Bienvenidas ${config.welcome.enabled ? "activadas" : "desactivadas"}.`, ephemeral: true });
    }
  } catch (error) {
    console.error("Command error:", error);
    const payload = { content: "Ocurrió un error al ejecutar el comando. Revisa permisos y jerarquía de roles.", ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
});

client.on("error", console.error);
module.exports = client;
