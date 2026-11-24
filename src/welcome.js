const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags } = require("discord.js");
const { getGuildConfig, saveGuildConfig } = require("./storage");
const welcomeCommand = new SlashCommandBuilder().setName("welcome").setDescription("Configura las bienvenidas de MONARCH.")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
.addSubcommand(s=>s.setName("setup").setDescription("Activa las bienvenidas y elige un canal.").addChannelOption(o=>o.setName("canal").setDescription("Canal de bienvenida").addChannelTypes(ChannelType.GuildText).setRequired(true)))
.addSubcommand(s=>s.setName("disable").setDescription("Desactiva las bienvenidas."))
.addSubcommand(s=>s.setName("style").setDescription("Elige el formato.").addStringOption(o=>o.setName("tipo").setDescription("Formato").setRequired(true).addChoices({name:"Embed clásico",value:"classic"},{name:"Components V2",value:"v2"})))
.addSubcommand(s=>s.setName("message").setDescription("Configura el mensaje.").addStringOption(o=>o.setName("texto").setDescription("Texto con variables").setMaxLength(3500).setRequired(true)))
.addSubcommand(s=>s.setName("title").setDescription("Configura el título.").addStringOption(o=>o.setName("texto").setDescription("Título").setMaxLength(256).setRequired(true)))
.addSubcommand(s=>s.setName("color").setDescription("Configura el color hexadecimal.").addStringOption(o=>o.setName("hex").setDescription("Ejemplo #5865F2").setRequired(true)))
.addSubcommand(s=>s.setName("image").setDescription("Configura una imagen grande.").addStringOption(o=>o.setName("url").setDescription("URL HTTPS").setRequired(true)))
.addSubcommand(s=>s.setName("thumbnail").setDescription("Configura una miniatura clásica.").addStringOption(o=>o.setName("url").setDescription("URL HTTPS").setRequired(true)))
.addSubcommand(s=>s.setName("test").setDescription("Prueba la bienvenida."))
.addSubcommand(s=>s.setName("status").setDescription("Muestra la configuración."))
.addSubcommand(s=>s.setName("variables").setDescription("Muestra las variables disponibles."));
function render(template, member) {
 return String(template||"").replaceAll("{user}",member.toString()).replaceAll("{username}",member.user.username).replaceAll("{server}",member.guild.name).replaceAll("{membercount}",String(member.guild.memberCount)).replaceAll("{avatar}",member.user.displayAvatarURL({extension:"png",size:512}));
}
function validUrl(value){try{return new URL(value).protocol==="https:";}catch{return false;}}
function buildPayload(member,config){
 const w=config.welcome, description=render(w.message,member), parsed=Number.parseInt((w.color||"#D6A84B").replace("#",""),16), color=Number.isFinite(parsed)?parsed:0xD6A84B;
 if(w.style==="v2"){
  const container=new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(w.title?"## "+render(w.title,member)+"\n"+description:description));
  if(w.image){container.addSeparatorComponents(new SeparatorBuilder());container.addTextDisplayComponents(new TextDisplayBuilder().setContent("[Imagen de bienvenida]("+w.image+")"));}
  return {components:[container],flags:MessageFlags.IsComponentsV2,allowedMentions:{users:[member.id]}};
 }
 const embed=new EmbedBuilder().setColor(color).setDescription(description).setTimestamp();
 if(w.title)embed.setTitle(render(w.title,member)); if(w.thumbnail)embed.setThumbnail(w.thumbnail); if(w.image)embed.setImage(w.image);
 embed.setFooter({text:member.guild.name}); return {embeds:[embed],allowedMentions:{users:[member.id]}};
}
async function sendWelcome(member,options={}){
 const config=getGuildConfig(member.guild.id),w=config.welcome;
 if(!options.test&&(!w.enabled||!w.channelId))return false;
 const channel=member.guild.channels.cache.get(w.channelId);
 if(!channel||!channel.isTextBased()||!channel.send)return false;
 await channel.send(buildPayload(member,config));return true;
}
async function handleWelcome(interaction){
 const config=getGuildConfig(interaction.guild.id),w=config.welcome,sub=interaction.options.getSubcommand();
 if(sub==="setup"){w.channelId=interaction.options.getChannel("canal").id;w.enabled=true;saveGuildConfig(interaction.guild.id,config);return interaction.reply({content:"Bienvenidas activadas en <#"+w.channelId+">. Usa /welcome test para probar.",ephemeral:true});}
 if(sub==="disable"){w.enabled=false;saveGuildConfig(interaction.guild.id,config);return interaction.reply({content:"Bienvenidas desactivadas.",ephemeral:true});}
 if(sub==="style"){w.style=interaction.options.getString("tipo");saveGuildConfig(interaction.guild.id,config);return interaction.reply({content:"Formato actualizado: "+(w.style==="v2"?"Components V2":"Embed clásico")+".",ephemeral:true});}
 if(sub==="message"){w.message=interaction.options.getString("texto");saveGuildConfig(interaction.guild.id,config);return interaction.reply({content:"Mensaje actualizado.",ephemeral:true});}
 if(sub==="title"){w.title=interaction.options.getString("texto");saveGuildConfig(interaction.guild.id,config);return interaction.reply({content:"Título actualizado.",ephemeral:true});}
 if(sub==="color"){const hex=interaction.options.getString("hex");if(!/^#?[0-9a-fA-F]{6}$/.test(hex))return interaction.reply({content:"Color inválido. Usa por ejemplo #5865F2.",ephemeral:true});w.color=hex.startsWith("#")?hex:"#"+hex;saveGuildConfig(interaction.guild.id,config);return interaction.reply({content:"Color actualizado a "+w.color+".",ephemeral:true});}
 if(sub==="image"||sub==="thumbnail"){const url=interaction.options.getString("url");if(!validUrl(url))return interaction.reply({content:"La URL debe ser HTTPS válida.",ephemeral:true});w[sub]=url;saveGuildConfig(interaction.guild.id,config);return interaction.reply({content:(sub==="image"?"Imagen":"Miniatura")+" actualizada.",ephemeral:true});}
 if(sub==="test"){await interaction.deferReply({ephemeral:true});const previewMember=await interaction.guild.members.fetch(interaction.user.id);
 const sent=await sendWelcome(previewMember,{test:true});return interaction.editReply(sent?"Vista previa enviada al canal configurado.":"Primero configura un canal con /welcome setup.");}
 if(sub==="status")return interaction.reply({content:["**Estado:** "+(w.enabled?"Activado":"Desactivado"),"**Canal:** "+(w.channelId?"<#"+w.channelId+">":"Sin configurar"),"**Formato:** "+(w.style==="v2"?"Components V2":"Embed clásico"),"**Color:** "+(w.color||"#D6A84B"),"**Imagen:** "+(w.image?"Configurada":"No configurada"),"**Miniatura:** "+(w.thumbnail?"Configurada":"No configurada")].join("\n"),ephemeral:true});
 if(sub==="variables")return interaction.reply({content:"**Variables disponibles**\n{user} mención\n{username} nombre\n{server} servidor\n{membercount} miembros\n{avatar} URL del avatar",ephemeral:true});
}
module.exports={welcomeCommand,handleWelcome,sendWelcome};
