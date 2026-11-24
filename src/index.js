require("dotenv").config();
const client=require("./bot/client");
const {ensureDirs}=require("./storage");
if(!process.env.DISCORD_TOKEN){console.error("Falta DISCORD_TOKEN.");process.exit(1);}
let closing=false;
function shutdown(signal){if(closing)return;closing=true;console.log("\n"+signal+" recibido. Cerrando MONARCH...");client.destroy();process.exit(0);}
process.on("SIGTERM",()=>shutdown("SIGTERM"));
process.on("SIGINT",()=>shutdown("SIGINT"));
process.on("unhandledRejection",error=>console.error("Promesa rechazada:",error));
process.on("uncaughtException",error=>{console.error("Excepción no controlada:",error);shutdown("uncaughtException");});
async function start(){ensureDirs();await client.login(process.env.DISCORD_TOKEN);console.log("MONARCH conectado a Discord.");}
start().catch(error=>{console.error("MONARCH startup failed:",error);process.exit(1);});
