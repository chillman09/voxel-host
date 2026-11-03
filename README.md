# Voxel Host

A small Minecraft server hosting panel: accounts, live console, start/stop, file manager (with upload) and a `server.properties` editor. Each customer only sees their own servers.

## Run it

```bash
# 1. Java (needed to run Minecraft servers) and Node 18+
apt-get update && apt-get install -y openjdk-21-jre-headless
java -version

# 2. Install and configure
cd voxel-host
npm install
cp .env.example .env && nano .env     # set ADMIN_PASSWORD, PUBLIC_HOST, PORT_POOL

# 3. Start (keeps running after you close the terminal)
nohup npm start > panel.log 2>&1 &
tail -f panel.log
```

Open `http://YOUR_HOST:3000`. Sign in with the admin account from `.env`, or create a customer account.

## How a customer starts a server
1. **New server** (name + RAM)  2. **Files** tab: upload a server jar (Paper, Vanilla...) named `server.jar`
3. **Settings** tab: accept the Minecraft EULA  4. **Console** tab: press **Start**

## Ports (important)
Players connect to the server's port. `PORT_POOL` lists the ports the panel may hand out (`25565-25570` or a single `19007`). Each server gets its own port from the pool, so you can host as many servers as you have open ports.

## Limits
`MAX_SERVERS_PER_USER`, `MAX_RAM_MB`, `MAX_UPLOAD_MB` in `.env`. There is no disk quota, CPU limit or container isolation yet: servers run as the same OS user as the panel.
