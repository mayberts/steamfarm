# Steamfarm

A self-hosted Steam idler you run with Docker and control from your browser. Every feature is free. There are no ads, accounts, telemetry or paid tiers.

It logs into Steam itself, the same way ArchiSteamFarm does, so it runs headless and **does not need the Steam client installed or running**.

## Features

- **Playtime booster:** idle up to 32 games at once per account.
- **Trading card farmer:** reads your badge pages, idles every game that still has card drops (closest to finishing first), re-checks on a timer and stops when nothing is left. You can blacklist games and start farming automatically after login.
- **Achievement manager:** lists every achievement with icons, descriptions and global unlock rates, and locks or unlocks them one at a time or all at once.
- **Gradual achievement unlocker:** unlocks a game's remaining achievements one at a time with random delays (most common first), optionally idling the game at the same time. It resumes after a restart.
- **Multiple accounts**, each with its own online status (online, away, invisible or offline) and an optional custom "playing" text.
- **Login options:** username and password with a Steam Guard code (email or mobile), a mobile authenticator shared secret for fully automatic 2FA, or QR code login from the Steam mobile app.
- **Pauses automatically** when you start playing on another device, and resumes when you stop.
- **Survives restarts:** accounts log back in automatically using Steam's saved login token.

## Quick start

```sh
mkdir steamfarm && cd steamfarm
curl -O https://raw.githubusercontent.com/mayberts/steamfarm/main/docker-compose.yml
echo "WEB_PASSWORD=pick-a-strong-password" > .env
docker compose pull
docker compose up -d
```

Open <http://localhost:8080>, sign in with `WEB_PASSWORD`, and click **Add account**.

If you leave `WEB_PASSWORD` empty, a password is generated on first start. Find it with `docker compose logs steamfarm`.

Or just pull the image:

```sh
docker pull ghcr.io/mayberts/steamfarm:latest
docker run -d --name steamfarm -p 8080:8080 -e WEB_PASSWORD=change-me \
  -v steamfarm-data:/data --restart unless-stopped ghcr.io/mayberts/steamfarm:latest
```

### Build from source

```sh
git clone https://github.com/mayberts/steamfarm && cd steamfarm
docker compose up -d --build
```

## Configuration

| Variable        | Default  | Description |
|-----------------|----------|-------------|
| `WEB_PASSWORD`  | generated | Password for the web UI. |
| `COOKIE_SECURE` | `false`  | Set to `true` when you serve the UI over HTTPS (behind a reverse proxy). |
| `PORT`          | `8080`   | Port the web UI listens on inside the container. |
| `DATA_DIR`      | `/data`  | Where state is kept. Mount a volume here. |
| `TZ`            | `UTC`    | Time zone for log timestamps. |

Everything else (accounts, idle lists, farming options) is configured in the UI and saved to `/data/steamfarm.json`.

## Security notes

- Your Steam password is sent to Steam once, during login, and never written to disk. Steamfarm stores only Steam's refresh token, which you can revoke at any time under *Steam → Account details → Deauthorize all other devices*.
- `/data` holds those tokens (and your shared secret, if you add one). Treat the volume like a password store.
- The web UI is protected by `WEB_PASSWORD`, but don't expose it to the internet without HTTPS. Put it behind a reverse proxy with TLS, or keep it on your LAN or VPN.

## How it works

- Steamfarm connects to Steam's servers with [`steam-user`](https://github.com/DoctorMcKay/node-steam-user) and reports up to 32 "games played". Steam counts that as playtime and card-drop time.
- The card farmer uses the account's web session to read `steamcommunity.com/profiles/<id>/badges` for "card drops remaining".
- Achievements are read and written with Steam's client user-stats messages (`ClientGetUserStats` and `ClientStoreUserStats2`). Achievements a game marks as server-only (protected) can't be changed and are shown as such.

## Development

```sh
npm install
npm test           # type-check, build and run unit tests
WEB_PASSWORD=dev npm run dev
```

The backend is TypeScript in `src/`. The UI is plain HTML, CSS and JS in `public/`, with no build step.

## Publishing the image

`.github/workflows/docker.yml` runs the tests, then builds a multi-arch image (amd64 and arm64) and pushes it to `ghcr.io/<owner>/<repo>`:

- `latest` on pushes to `main`
- `X.Y.Z` and `X.Y` on `vX.Y.Z` tags
- `sha-…` on every build

If the repository is private, the package is private too. Either run `docker login ghcr.io` with a personal access token that has `read:packages`, or make the package public under *GitHub → Packages → steamfarm → Package settings*.

## Disclaimer

Idling and changing achievements may break Steam's Subscriber Agreement or a game's rules. Some multiplayer games ban accounts for manipulated achievements. Use it at your own risk. This project isn't affiliated with Valve.

## License

MIT
