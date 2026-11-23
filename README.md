# MONARCH

Bot avanzado de Discord con dashboard web, sistema de logs, bienvenida/despedida, prefijos por rol y moderación.

## Requisitos
- Node.js 20.11 o superior
- Aplicación y bot creados en Discord Developer Portal

## Instalación
1. Clona el repositorio.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env` y completa las variables.
4. Activa **Server Members Intent** y **Message Content Intent** en el Developer Portal.
5. Invita el bot con scopes `bot` y `applications.commands`. Permisos recomendados: View Channels, Send Messages, Embed Links, Read Message History, Manage Messages, Kick Members, Ban Members, Moderate Members, Manage Nicknames y View Audit Log.
6. Configura en OAuth2 Redirects la URL `DASHBOARD_URL/auth/callback`.
7. Ejecuta `npm start`.

## Variables
Consulta `.env.example`. No compartas ni subas el archivo `.env`.

## Persistencia
La configuración y advertencias se guardan como JSON en `CONFIG_DIR`. Usa un disco persistente en el hosting; el almacenamiento efímero puede borrar los datos al reiniciar o redesplegar.

## Limitaciones conocidas de la primera versión
- El panel solo lista servidores donde el bot está instalado y el usuario tiene Manage Server o Administrator.
- Los logs dependen de los eventos que Discord entregue y de los permisos/intents habilitados. No es posible registrar absolutamente toda acción ni recuperar contenido que Discord no entregue.
- La gestión de prefijos por rol requiere Manage Nicknames y una jerarquía de roles adecuada.
- Los comandos slash globales pueden tardar en aparecer en todos los servidores.
