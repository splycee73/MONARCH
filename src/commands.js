const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Comprueba la latencia de MONARCH."),
  new SlashCommandBuilder().setName("help").setDescription("Muestra los comandos disponibles."),
  new SlashCommandBuilder().setName("clear").setDescription("Elimina mensajes recientes.")
    .addIntegerOption(o => o.setName("cantidad").setDescription("Cantidad de mensajes (1-100)").setMinValue(1).setMaxValue(100).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName("kick").setDescription("Expulsa a un miembro.")
    .addUserOption(o => o.setName("usuario").setDescription("Miembro que será expulsado").setRequired(true))
    .addStringOption(o => o.setName("razon").setDescription("Motivo de la expulsión").setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName("ban").setDescription("Banea a un miembro.")
    .addUserOption(o => o.setName("usuario").setDescription("Usuario que será baneado").setRequired(true))
    .addStringOption(o => o.setName("razon").setDescription("Motivo del baneo").setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName("timeout").setDescription("Aplica o retira un timeout.")
    .addUserOption(o => o.setName("usuario").setDescription("Miembro").setRequired(true))
    .addIntegerOption(o => o.setName("minutos").setDescription("Duración en minutos; 0 para quitar").setMinValue(0).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName("razon").setDescription("Motivo").setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("warn").setDescription("Registra una advertencia.")
    .addUserOption(o => o.setName("usuario").setDescription("Usuario").setRequired(true))
    .addStringOption(o => o.setName("razon").setDescription("Motivo").setMaxLength(500).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("warnings").setDescription("Consulta advertencias de un usuario.")
    .addUserOption(o => o.setName("usuario").setDescription("Usuario").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("prefix").setDescription("Configura prefijos automáticos por rol.")
    .addSubcommand(s => s.setName("set").setDescription("Asigna un prefijo a un rol.")
      .addRoleOption(o => o.setName("role").setDescription("Rol objetivo").setRequired(true))
      .addStringOption(o => o.setName("prefix").setDescription("Prefijo (máximo 8 caracteres)").setMaxLength(8).setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Quita el prefijo de un rol.")
      .addRoleOption(o => o.setName("role").setDescription("Rol objetivo").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("Lista los prefijos configurados."))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
  new SlashCommandBuilder().setName("logs").setDescription("Configura el canal de registros.")
    .addChannelOption(o => o.setName("canal").setDescription("Canal para los registros").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("welcome").setDescription("Activa o desactiva las bienvenidas.")
    .addBooleanOption(o => o.setName("activar").setDescription("Estado de las bienvenidas").setRequired(true))
    .addChannelOption(o => o.setName("canal").setDescription("Canal de bienvenida").addChannelTypes(ChannelType.GuildText))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(command => command.toJSON());

module.exports = commands;
