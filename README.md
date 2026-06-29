# 🎲 Calentaos Bets — Apuestas entre amigos

App web para crear apuestas entre amigos. Una persona hace de **casa** (admin) y crea
las apuestas totalmente personalizables; el resto **apuesta** a opciones concretas o
**combina** varias en una sola jugada. Todo con **fichas virtuales** (sin dinero real)
y **en tiempo real** (lo que hace la casa o un jugador se ve al instante en todas las pantallas).

## Cómo arrancar

```powershell
cd C:\Users\Usuario\Desktop\goated
npm install        # solo la primera vez
npm start
```

Abre **http://localhost:3000** en el navegador.

> Para desarrollo con recarga automática: `npm run dev`

## Cómo jugar

1. **La casa**: regístrate marcando la casilla _"Soy la casa"_ e introduce el código
   de admin. El código por defecto es **`CASA2026`** (aparece en la consola al arrancar).
   - _Truco:_ el **primer usuario** que se registre se convierte en casa automáticamente,
     aunque no ponga código.
2. **Los amigos**: cada uno se registra con su nombre y contraseña desde su móvil/PC.
   Empiezan con **1000 fichas**.
3. **La casa crea apuestas** (pestaña _Crear apuesta_): título, descripción, opciones y
   **cuotas** personalizables, con plantillas rápidas (Sí/No, 1·X·2, 3 opciones…) y hora
   de cierre opcional.
4. **Los jugadores apuestan**: tocan una cuota para añadirla al boleto. Si añaden varias
   de eventos distintos, se convierte en una **combinada** (las cuotas se multiplican y
   solo paga si aciertan todas).
5. **La casa liquida** cada apuesta eligiendo la opción ganadora → las fichas se pagan
   automáticamente. También puede **cerrar**, **reabrir**, **anular** (reembolsa) y
   **ajustar fichas** a cualquier jugador.

## Acceso desde otros dispositivos (misma red WiFi)

Otros pueden entrar desde su móvil usando la IP de tu equipo, p. ej. `http://192.168.1.50:3000`.
Para ver tu IP: `ipconfig` (busca _Dirección IPv4_). Asegúrate de permitir Node en el
firewall de Windows si lo pide.

## Configuración

Variables de entorno opcionales (antes de `npm start`):

```powershell
$env:PORT = "8080"          # puerto (por defecto 3000)
$env:HOUSE_CODE = "MICODIGO" # código secreto de la casa (por defecto CASA2026)
```

## Detalles técnicos

- **Backend**: Node + Express + Socket.IO (tiempo real) + JWT (sesiones) + bcrypt (contraseñas).
- **Persistencia**: archivo `data.json` (sin base de datos ni dependencias nativas).
- **Frontend**: HTML/CSS/JS puro (sin paso de build).
- **Tipos de apuesta**: simple (varias opciones), Sí/No, y cualquier combinación
  personalizada de opciones + cuotas. Las **combinadas** las arma el jugador uniendo
  varias apuestas en el boleto.

> Para empezar de cero, borra `data.json` (se recrea al arrancar).

## Desplegar en internet (Railway) para que entren tus amigos

GitHub Pages **no** sirve para esta app (solo aloja archivos estáticos y aquí hace falta
un servidor Node). Usa **Railway**, que ejecuta el servidor y te da una URL pública.

### 1) Subir el código a GitHub (la cuenta que quieras)
```powershell
git init
git add .
git commit -m "Calentaos Bets"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/calentaos-bets.git
git push -u origin main
```
> `data.json` está en `.gitignore` a propósito: contiene el secreto de sesión y los
> hashes de contraseñas, no debe subirse. Tus datos locales no se borran.

### 2) Desplegar en Railway
1. Entra en <https://railway.app> e inicia sesión (puedes usar tu cuenta de GitHub).
2. **New Project → Deploy from GitHub repo →** elige `calentaos-bets`.
3. Railway detecta Node y ejecuta `npm start` automáticamente. Lee el puerto de `PORT`.
4. En **Settings → Networking → Generate Domain** obtienes la URL pública
   (ej. `https://calentaos-bets-production.up.railway.app`). Esa es la que compartes.

### 3) Variables de entorno (Railway → Variables)
| Variable | Para qué | Ejemplo |
|---|---|---|
| `JWT_SECRET` | Mantiene las sesiones tras reinicios | una cadena larga aleatoria |
| `HOUSE_CODE` | Código secreto para registrarse como casa | `loquequieras` |

### 4) Que los datos no se borren (volumen persistente)
Por defecto el disco de Railway es efímero (se reinicia en cada despliegue). Para
conservar usuarios, fichas e historial:
- En el servicio: **Settings → Volumes → Add Volume**, móntalo en `/data`.
- Añade la variable `DATA_DIR=/data`. El servidor guardará ahí `data.json` y los datos
  persistirán entre reinicios y despliegues.

