# 🎮 AIO-Games — Game Update Tracker

A self-hosted Next.js app that monitors game updates across 8+ sites, verifies versions against Steam and GOG, and sends instant Telegram/push notifications when new releases drop.

**[🌐 Live Demo](https://aiogames.iforgor.cc) | [📡 Game API](https://github.com/darkmaster420/gameapi)**

> The demo is for testing — self-host for reliable long-term use.

## 🖼️ Screenshots

| Platform | Home | Tracking | Downloads |
|----------|------|----------|-----------|
| **PC** | ![PC Home](docs/images/pc-home-with-posts.png) | ![PC Tracking](docs/images/pc-tracking-page.png) | ![PC Downloads](docs/images/pc-tracking-page-dl-options.png) |
| **Mobile** | ![Mobile Home](docs/images/moble-home-with-posts.png) | ![Mobile Tracking](docs/images/mobile-tracking-page.png) | ![Mobile Downloads](docs/images/mobile-tracking-page-dl-options.png) |

---

## ✨ Features (v2.0)

### Core
- **Multi-Site Monitoring** — SteamRip, SteamUnderground, SkidRow, FreeGOG, ReloadedSteam, Online-Fix, GOG-Games, DODI-Repacks, CS.RIN.RU
- **Multi-Site Search Filter** — Pick any combination of sites from the home page (e.g. `?site=steamrip,skidrow`); default search excludes high-cost sources like CS.RIN.RU unless explicitly opted into
- **Comprehensive Search Pagination** — Searches walk every page of matching results per site (WordPress REST `X-WP-TotalPages` with parallel fan-out), up to 10 pages × 100 per site, instead of silently truncating at the first page
- **Auto-Fallback Search** — When a filtered site returns zero results (e.g. SkidRow's WP search missing a scene-format title), the search auto-widens to all sites and shows a banner explaining what happened
- **Smart Version Detection** — Semantic versions, build numbers, date-based versions, scene group tags, and 50+ release format patterns
- **Automatic Update Scheduling** — Built-in background scheduler, per-game frequency, no cron jobs
- **Download Links** — One-click download link extraction with 30+ file host support (Mega, Mediafire, Pixeldrain, etc.)
- **Embedded Downloads** — GOG-Games torrent links available directly without extra fetch
- **Follow-Post Sites** — DODI-Repacks and CS.RIN.RU don't expose machine-readable download lists; the UI surfaces a clear "open the original post" CTA instead of attempting a failing scrape

### Verification & Matching
- **Steam Auto-Verification** — Automatic appid resolution with configurable confidence threshold
- **GOG Verification** — Link GOG product IDs, fetch version/build info from GOGDB
- **SteamDB Monitoring** — Real-time RSS-based Steam update tracking with build number comparison
- **IGDB Integration** — Twitch/IGDB metadata lookup for cover art, genres, and release dates
- **Roman Numeral Search** — Searches both "Schedule 1" and "Schedule I" to find Steam listings
- **Sequel & DLC Detection** — Automatically identifies numbered sequels, expansions, remasters, and definitive editions

### Notifications & Approval
- **Telegram Notifications** — Instant alerts with game images via a shared bot. Uses `getUpdates` long-poll on the server (no public URL or webhook setup needed)
- **Web Push Notifications** — Browser notifications via service worker
- **Admin Approval System** — Vote-based multi-admin approval for pending updates via Telegram
- **Auto-Approval** — Configurable threshold for automatic update approval when version confidence is high

### Management
- **Owner/Admin/User Roles** — Role-based permissions with ban/unban and user management
- **Per-Game Pages** — `/appid/{id}` detail pages with Steam data, version history, and download links
- **Persistent Layout Preferences** — Layout mode (grid/horizontal), grid columns/rows, sort order, and "Show advanced" are saved per account so they follow you across logins, reloads, and devices. Homepage layout options are hidden behind an "Edit Layout" toggle so the controls stay out of the way until you need them
- **Title Cleaning** — Strips scene tags, platform indicators, and release group names for clean display
- **AI-Powered Analysis** — Optional AI integration for intelligent title analysis and update detection

### Deployment
- **Docker Ready** — Production and development compose files with MongoDB
- **Electron Desktop App** — Standalone Windows app with auto-updater from GitHub releases
- **Cloudflare Workers** — Game API and Steam API proxy deploy to the edge

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB instance (or use the Docker compose)
- Deployed [gameapi](https://github.com/darkmaster420/gameapi) instance

### Docker (Recommended)

```bash
git clone https://github.com/darkmaster420/AIOgames.git
cd AIOgames

# Configure .env (see Environment section below)

docker compose -f docker-compose.production.yml up -d
```

### Local Development

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your settings
npm run dev
```

---

## ⚙️ Environment Variables

```env
# Required
MONGODB_URI=mongodb://localhost:27017/aiogames
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key
GAME_API_URL=https://your-gameapi-instance.workers.dev

# Owner Account (auto-created at startup)
OWNER_EMAIL=admin@example.com
OWNER_PASSWORD=secure-password-here
OWNER_NAME=Admin

# Optional — Steam
STEAM_API_KEY=your-steam-api-key

# Optional — Telegram (polling, no public URL needed)
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather

# Optional — Cloudflare-protected sources
# Required for SteamRip / FreeGOG when their CF challenges are active.
# Recommended to run a private FlareSolverr container; URL points at it.
FLARESOLVERR_URL=http://localhost:8191/v1

# Optional — CS.RIN.RU search source
# Required only if you want CS.RIN.RU to appear in search results.
# Use a dedicated bot account; the app shares this login across all users.
# Without these, CS.RIN.RU is silently skipped.
CSRIN_USERNAME=your-csrin-bot-username
CSRIN_PASSWORD=your-csrin-bot-password

# Optional — Push Notifications (auto-generated on first run)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-key
VAPID_PRIVATE_KEY=your-vapid-private-key
```

---

## 📡 Supported Sites

| Site | Type | Search | Recent | Download Links | Notes |
|------|------|--------|--------|----------------|-------|
| SteamRip | WordPress API | ✅ | ✅ | ✅ | FlareSolverr recommended |
| SteamUnderground | WordPress API | ✅ | ✅ | ✅ | — |
| SkidRow Reloaded | WordPress API | ✅ | ✅ | ✅ | Circuit-breaker protected; weak built-in WP search triggers auto-fallback when no matches |
| FreeGOG PC Games | WordPress API | ✅ | ✅ | ✅ | Cloudflare-gated; cached `cf_clearance` cookie reused before resolving via FlareSolverr |
| ReloadedSteam | WordPress API | ✅ | ✅ | ✅ | — |
| Online-Fix | Custom scraper | ✅ | ✅ | ✅ | HTML scraping, no WP API |
| GOG-Games | JSON API | — | ✅ | ✅ | Includes embedded torrent links |
| DODI-Repacks | WordPress API | ✅ | ✅ | "Open post" | Downloads aren't scraped; UI links straight to the DODI post |
| CS.RIN.RU | phpBB forum | ✅ (opt-in) | — | "Open thread" | Bot login required (`CSRIN_USERNAME`/`CSRIN_PASSWORD`); excluded from default-all search; search results jump straight to the latest page of each thread |

---

## 👑 Roles & Permissions

| Feature | Owner | Admin | User |
|---------|-------|-------|------|
| Track & manage games | ✅ | ✅ | ✅ |
| View updates & downloads | ✅ | ✅ | ✅ |
| Configure notifications | ✅ | ✅ | ✅ |
| Approve/deny updates | ✅ | ✅ | — |
| Ban/unban users | ✅ | ✅ | — |
| Promote to admin | ✅ | — | — |

The owner account is auto-created from environment variables at startup.

---

## 📲 Telegram Setup

1. Create a bot via [@BotFather](https://t.me/botfather) → set `TELEGRAM_BOT_TOKEN`
2. (No webhook required) The app uses Telegram long-poll `getUpdates` on startup — works on localhost / behind NAT, no public URL needed.
3. Users send `/start` to the bot to get their Chat ID
4. Enter Chat ID or `@username` in `/user/manage` settings

Admin commands: `/approve <key>`, `/deny <key>`, `/help`

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend | Next.js API Routes, MongoDB/Mongoose, NextAuth.js |
| External | [Game API](https://github.com/darkmaster420/gameapi) (Cloudflare Workers), SteamDB RSS, Steam Web API, IGDB/Twitch API, GOGDB |
| Desktop | Electron with auto-updater |
| Infrastructure | Docker, Docker Compose |

---

## 📊 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/games/search` | Search games. Params: `search`, `site` (comma-separated for multi-site, e.g. `?site=steamrip,skidrow`). Paginates each WP REST site up to 10 pages × 100 results. Falls back to all sites if a filtered selection returns nothing. |
| `GET /api/games/recent` | Recent uploads. Same comma-separated `site` filter as search. |
| `GET /api/games/{appid}` | Game details by Steam appid |
| `GET /api/games/downloads` | Download links for tracked games. Returns a "follow post" notice payload for DODI/CS.RIN.RU instead of links. |
| `GET /api/games/links` | Download links by postId + siteType |
| `GET /api/tracking` | List tracked games |
| `POST /api/tracking` | Track a game |
| `POST /api/updates/check` | Check all tracked games for updates |
| `POST /api/updates/check-single` | Check a single game |
| `POST /api/updates/approve` | Approve a pending update |
| `GET /api/user/preferences` | Per-account UI preferences (homepage & tracking page layout, sort, etc.) |
| `PATCH /api/user/preferences` | Update per-account UI preferences |
| `GET /api/steam` | Steam search and SteamDB data proxy |
| `GET /api/steamdb` | SteamDB RSS update feed |
| `GET /api/gogdb` | GOG database queries |
| `GET /api/scheduler` | Background scheduler status |

---

## 🐳 Docker

```bash
# Production
docker compose -f docker-compose.production.yml up -d

# Development (hot reload)
docker compose -f docker-compose.development.yml up -d

# Logs
docker compose -f docker-compose.production.yml logs -f
```

---

## 📖 Documentation

See [docs/README.md](docs/README.md) for detailed guides:
- Docker deployment
- AI worker setup
- Steam API migration
- GOG priority integration
- Game tracking internals

---

## ❓ FAQ

**Is this legal?**
AIOgames only aggregates publicly available information. It does not download or distribute games. Use your own judgment and visit external sites with a VPN and adblocker.

**Do I need my own gameapi instance?**
Yes. Self-deployment keeps the project free, decentralized, and private. Setup takes minutes on Cloudflare Workers.

**How often does it check for updates?**
Configurable per game — from 1 hour to 1 month. The background scheduler runs automatically.

**Does it download games?**
No. It's a notification and tracking system only. You download manually from your preferred source.

**Do I need a Steam API key?**
Optional. Steam integration improves tracking accuracy but everything works without it. SteamDB monitoring uses public RSS feeds.

---

## ☑️ To-Do

- [x] Search across all sites from home page
- [x] Per-game detail pages (`/appid/{id}`)
- [x] Telegram admin approval system
- [x] GOG verification and version tracking
- [x] SteamDB real-time monitoring
- [x] Auto-approval with configurable threshold
- [x] Sequel and DLC detection
- [x] Electron desktop app
- [x] Embedded download links for GOG-Games
- [x] Multi-site search filter (`?site=a,b,c`) with per-site auto-fallback when a selection returns nothing
- [x] Full search pagination — fetch every page of matching results per site, not just the first 40
- [x] Persistent per-account layout preferences (homepage + tracking page) across logins/devices
- [x] Homepage layout controls collapsed behind an "Edit Layout" toggle
- [x] CS.RIN.RU forum integration (search-only, opt-in, follow-post style)
- [x] Telegram bot via `getUpdates` long-poll (no webhook / public URL required)
- [ ] Email notifications
- [ ] Custom themes
- [ ] Merge GameAPI into AIOGames

---

## 🔗 Related Projects

- **[gameapi](https://github.com/darkmaster420/gameapi)** — Cloudflare Workers API powering game search (required)
- **[Pixeldrain Limit Bypass](https://pdbypass.iforgor.cc)** — Cloudflare Workers proxy to bypass Pixeldrain limits
- **[Game Search](https://github.com/darkmaster420/gamesearch)** — The original prototype that evolved into AIOgames

---

## 🤝 Contributing

1. Fork the repo
2. Deploy [gameapi](https://github.com/darkmaster420/gameapi) and configure `.env`
3. Create a feature branch
4. Test with both Steam-verified and non-verified games
5. Open a Pull Request

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

*AIOgames v2.0 — Built for the gaming community*
