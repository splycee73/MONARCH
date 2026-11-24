require("dotenv").config();

const client = require("./bot/client");
const { createWebServer } = require("./web/server");
const { ensureDirs } = require("./storage");

const required = ["DISCORD_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "SESSION_SECRET"];
const missing = required.filter(key => !process.env[key]);

if (missing.length) {
  console.error("Faltan variables de entorno:", missing.join(", "));
  process.exit(1);
}

const port = Number(process.env.PORT || 10000);
const host = "0.0.0.0";

let httpServer;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} recibido. Cerrando MONARCH...`);

  const forceExit = setTimeout(() => {
    console.error("El cierre tardó demasiado; finalizando proceso.");
    process.exit(1);
  }, 25000);
  forceExit.unref();

  if (client.isReady()) client.destroy();

  if (!httpServer) {
    clearTimeout(forceExit);
    process.exit(0);
    return;
  }

  httpServer.close(error => {
    clearTimeout(forceExit);
    if (error) {
      console.error("Error al cerrar el servidor web:", error);
      process.exit(1);
      return;
    }
    console.log("Servidor web cerrado correctamente.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", error => {
  console.error("Promesa rechazada sin manejar:", error);
});
process.on("uncaughtException", error => {
  console.error("Excepción no controlada:", error);
  shutdown("uncaughtException");
});

async function start() {
  ensureDirs();

  const app = createWebServer(client);

  httpServer = app.listen(port, host, async () => {
    console.log(`MONARCH web server listening on http://${host}:${port}`);

    try {
      await client.login(process.env.DISCORD_TOKEN);
      console.log("MONARCH conectado a Discord.");
    } catch (error) {
      console.error("Discord login failed:", error);
      httpServer.close(() => process.exit(1));
    }
  });

  httpServer.on("error", error => {
    console.error("No se pudo iniciar el servidor web:", error);
    process.exit(1);
  });
}

start().catch(error => {
  console.error("MONARCH startup failed:", error);
  process.exit(1);
});
