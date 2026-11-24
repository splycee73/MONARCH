const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags } = require("discord.js");
const { getGuildConfig, saveGuildConfig } = require("./storage");

const welcomeCommand = new SlashCommandBuilder()
 .setName("welcome").setDescription("Configura las bienvenidas de MONARCH.")
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
 .addSubcommand(s => s.setName("setup").setDescription("Configura todo el sistema de bienvenida en un solo comando.")
  .addChannelOption(o => o.setName("canal").setDescription("Canal donde se enviarán las bienvenidas").addChannelTypes(ChannelType.GuildText))
  .addStringOption(o => o.setName("estilo").setDescription("Diseño del mensaje").addChoices({name:"Embed clásico",value:"classic"},{name:"Components V2",value:"v2"}))
  .addStringOption(o => o.setName("titulo").setDescription("Título de la bienvenida").setMaxLength(256))
  .addStringOption(o => o.setName("mensaje").setDescription("Mensaje. Variables: {user}, {username}, {server}, {membercount}, {avatar}").setMaxLength(3500))
  .addStringOption(o => o.setName("color").setDescription("Color hexadecimal, por ejemplo #D6A84B"))
  .addStringOption(o => o.setName("imagen").setDescription("URL HTTPS de imagen; escribe none para quitarla").setMaxLength(500))
  .addStringOption(o => o.setName("miniatura").setDescription("URL HTTPS de miniatura; escribe none para quitarla").setMaxLength(500)))
 .addSubcommand(s => s.setName("disable").setDescription("Desactiva las bienvenidas."))
 .addSubcommand(s => s.setName("test").setDescription("Envía una prueba al canal configurado."))
 .addSubcommand(s => s.setName("status").setDescription("Muestra la configuración actual."))
 .addSubcommand(s => s.setName("variables").setDescription("Muestra las variables disponibles."));

function render(template, member) {
 return String(template || "").replaceAll("{user}", member.toString()).replaceAll("{username}", member.user.username).replaceAll("{server}", member.guild.name).replaceAll("{membercount}", String(member.guild.memberCount)).replaceAll("{avatar}", member.user.displayAvatarURL({extension:"png",size:512}));
}
function validUrl(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }
function buildPayload(member, config) {
 const w=config.welcome, description=render(w.message,member), parsed=Number.parseInt((w.color||"#D6A84B").replace("#",""),16), color=Number.isFinite(parsed)?parsed:0xD6A84B;
 if(w.style==="v2") {
  const container=new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(w.title?"## "+render(w.title,member)+"\n"+description:description));
  if(w.image) { container.addSeparatorComponents(new SeparatorBuilder()); container.addTextDisplayComponents(new TextDisplayBuilder().setContent("[Imagen de bienvenida]("+w.image+")")); }
  return {components:[container],flags:MessageFlags.IsComponentsV2,allowedMentions:{users:[member.id]}};
 }
 const embed=new EmbedBuilder().setColor(color).setDescription(description).setTimestamp();
 if(w.title) embed.setTitle(render(w.title,member));
 if(w.thumbnail) embed.setThumbnail(w.thumbnail);
 if(w.image) embed.setImage(w.image);
 embed.setFooter({text:member.guild.name});
 return {embeds:[embed],allowedMentions:{users:[member.id]}};
}
async function sendWelcome(member, options={}) {
 const config=getGuildConfig(member.guild.id), w=config.welcome;
 if(!options.test && (!w.enabled || !w.channelId)) return false;
 const channel=member.guild.channels.cache.get(w.channelId);
 if(!channel || !channel.isTextBased() || !channel.send) return false;
 await channel.send(buildPayload(member,config));
 return true;
}
async function handleWelcome(interaction) {
 const config=getGuildConfig(interaction.guild.id), w=config.welcome, sub=interaction.options.getSubcommand();
 if(sub==="setup") {
  const channel=interaction.options.getChannel("canal");
  const style=interaction.options.getString("estilo");
  const title=interaction.options.getString("titulo");
  const message=interaction.options.getString("mensaje");
  const color=interaction.options.getString("color");
  const image=interaction.options.getString("imagen");
  const thumbnail=interaction.options.getString("miniatura");
  if(color!==null && !/^#?[0-9a-fA-F]{6}$/.test(color)) return interaction.editReply({content:"Color inválido. Usa un hexadecimal como #5865F2."});
  if(image && image.toLowerCase()!=="none" && !validUrl(image)) return interaction.editReply({content:"La imagen debe ser una URL HTTPS válida o none para quitarla."});
  if(thumbnail && thumbnail.toLowerCase()!=="none" && !validUrl(thumbnail)) return interaction.editReply({content:"La miniatura debe ser una URL HTTPS válida o none para quitarla."});
  if(channel) w.channelId=channel.id;
  if(style) w.style=style;
  if(title!==null) w.title=title;
  if(message!==null) w.message=message;
  if(color!==null) w.color=color.startsWith("#")?color:"#"+color;
  if(image!==null) w.image=image.toLowerCase()==="none"?"":image;
  if(thumbnail!==null) w.thumbnail=thumbnail.toLowerCase()==="none"?"":thumbnail;
  if(!w.channelId) return interaction.editReply({content:"Selecciona un canal la primera vez que configures /welcome setup."});
  w.enabled=true;
  saveGuildConfig(interaction.guild.id,config);
  return interaction.editReply({content:"**¡Bienvenidas configuradas!**\nCanal: <#"+w.channelId+">\nEstilo: "+(w.style==="v2"?"Components V2":"Embed clásico")+"\nTítulo: "+(w.title||"Sin título")+"\nColor: "+(w.color||"#D6A84B")+"\nImagen: "+(w.image?"Configurada":"No configurada")+"\nMiniatura: "+(w.thumbnail?"Configurada":"No configurada")+"\n\nPuedes volver a usar /welcome setup para cambiar cualquier campo. Usa /welcome test para probar."});
 }
 if(sub==="disable") { w.enabled=false; saveGuildConfig(interaction.guild.id,config); return interaction.editReply({content:"Bienvenidas desactivadas."}); }
 if(sub==="test") {
  const previewMember=await interaction.guild.members.fetch(interaction.user.id);
  const sent=await sendWelcome(previewMember,{test:true});
  return interaction.editReply({content:sent?"Vista previa enviada al canal configurado.":"Primero configura un canal con /welcome setup."});
 }
 if(sub==="status") return interaction.editReply({content:["**Estado:** "+(w.enabled?"Activado":"Desactivado"),"**Canal:** "+(w.channelId?"<#"+w.channelId+">":"Sin configurar"),"**Formato:** "+(w.style==="v2"?"Components V2":"Embed clásico"),"**Título:** "+(w.title||"Sin título"),"**Color:** "+(w.color||"#D6A84B"),"**Imagen:** "+(w.image?"Configurada":"No configurada"),"**Miniatura:** "+(w.thumbnail?"Configurada":"No configurada")].join("\n")});
 if(sub==="variables") return interaction.editReply({content:"**Variables disponibles**\n{user} mención\n{username} nombre\n{server} servidor\n{membercount} miembros\n{avatar} URL del avatar"});
}
module.exports={welcomeCommand,handleWelcome,sendWelcome};
