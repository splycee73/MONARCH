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
ensureDirs();
const app = createWebServer(client);
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`MONARCH dashboard listening on port ${port}`));
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
