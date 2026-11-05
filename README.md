<p align="center"><img src="public/img/logo.png" alt="Ater" width="96"></p>

<h1 align="center">Ater Live</h1>

<p align="center">A streamer's home on the web, with its own chat.<br>
The stream, Ater Chat, the schedule and the archive in one place. Twitch, Kick and YouTube chatters can join the chat when you switch them on.</p>

![The home page: next stream countdown, live chat preview, schedule](docs/home.png)

## What's in it

**Home page.** A big stream card shows a muted live preview when you're live, and a countdown to the next scheduled stream when you're not. Beside it, the chat right now with messages per minute. Below that: the weekly schedule in each visitor's own time zone, upcoming events with *Add to calendar*, videos (uploads, appearances, clips), the chat leaderboard, merch and an about section.

**Big Screen.** Watch any Twitch, Kick, YouTube, Rumble or AngelThump stream next to the chat. Keep several streams on a strip and switch between them, use theater mode, swap sides, and resize the chat. You can share a layout as a link (`#/bigscreen?s=kick:name,twitch:name`).

![The Big Screen: a stream with Ater Chat beside it, a pinned message and a poll](docs/bigscreen.png)

**Ater Chat.** The site's own chat, served by this repo's server:

- Accounts with the **Ater badge**, plus broadcaster, moderator, **OG** (the first 100 accounts) and 🔥 **streak** badges (3+ days in a row)
- **Ater emotes**: 10 built in (AterW, AterL, AterGG, AterPog, AterLUL, AterSadge, AterCope, AterHmm, AterHype, AterLove). Moderators can upload more. 7TV emotes work too.
- **Combos**: the same emote sent back to back stacks into *AterPog ×4 C‑C‑C‑COMBO*
- **Pins** and **polls** (with a timer; results show after you vote)
- Replies, whispers, `/me`, name colours, @mention autocomplete, a "who's here" list
- Moderation: hover to pin, mute or delete; slow mode, bans, purge, clear
- A **links queue** of every link posted in chat (with who sent it, and warnings on shorteners and IP loggers), a **leaderboard**, a **Mentions** inbox, and search

<img src="docs/chat.png" alt="Ater Chat in its own window" width="330" align="right">

**Platform chatters, when you want them.** Settings has one switch each for Twitch, Kick and YouTube. When it's on, those messages mix into the chat with the platform's logo. They are read-only: to talk to Twitch chat, you use Twitch.

- Twitch is read anonymously, so it needs no keys.
- Kick needs a small relay ([kick-relay/](kick-relay/), free on Cloudflare).
- YouTube needs a live video and your own Data API key.

**Extras.**

- A command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>).
- A chat pop-out window (`#/chat`).
- An OBS overlay (`?overlay&size=20&fade=30`).
- Keyboard shortcuts: <kbd>N</kbd> opens the next link, <kbd>T</kbd> toggles theater mode, <kbd>/</kbd> starts a command, <kbd>↑</kbd> brings back your last message.

<br clear="right">

## Run it

You need [Node.js](https://nodejs.org) 20 or newer. There is nothing to install.

```bash
git clone https://github.com/inoater/ater-chat.git
cd ater-chat
npm start
```

Open <http://localhost:8080> and create an account. **The first account becomes the broadcaster.** To pick the broadcaster by name instead, set `ATER_OWNER`.

> Open the site through the server, not by double-clicking `index.html`. The page still loads from disk, but Ater Chat needs the server. Twitch's player also refuses to run on a `file://` page.

## Make it yours

**The site:** edit [`public/js/config.js`](public/js/config.js) and reload. It holds your name, your channels, your aliases (mentions of these land in Mentions), social links, the weekly schedule (written in UTC), events, videos, merch and the about text. The content that ships is an example; replace it.

**The server:** set environment variables, or copy [`.env.example`](.env.example) to `.env`:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `127.0.0.1` | Only this machine can connect. Use `0.0.0.0` when hosting. |
| `ATER_OWNER` | *(empty)* | This account gets the broadcaster badge. If empty, the first account created gets it. |
| `ATER_DATA` | `data/ater-data.json` | Where accounts, sessions, emotes and recent chat are saved |
| `TRUST_PROXY` | `0` | Set to `1` behind nginx, Caddy or Cloudflare, so rate limits see visitors' real IPs |

## Chat commands

Type `/` in the chat box for autocomplete, or `/help` for the full list.

| Everyone | |
|---|---|
| `/me action` | Say it in italics |
| `/w name message` | Whisper to someone on Ater |
| `/color #a855f7` / `/color reset` | Pick your name colour (also in the account menu) |
| `/vote 2` | Vote in the running poll |
| `/embed kick name` · `/unembed` · `/main` · `/embeds` · `/clearembeds` | Manage the Big Screen |
| `/connect twitch name` · `/disconnect` | Show or hide a platform's chatters |
| `/search text` · `/user name` · `/next` | Search chat, see one person's messages, open the next link |
| `/theater` · `/swap` · `/size 18` · `/cls` · `/popout` · `/overlay` | Display options |

| Moderators | |
|---|---|
| `/poll 60 Question? A \| B \| C` · `/endpoll` | Polls (or use *Start a poll* in settings) |
| `/pin text` · `/unpin` | Pin a note (or hover any message and press the pin) |
| `/mute name 10m` · `/unmute name` | Mute (durations: `30s`, `10m`, `2h`, `1d`) |
| `/ban name [reason]` · `/unban name` · `/purge name` | Ban, unban, delete someone's recent messages |
| `/slow 10` · `/slow off` · `/clear` | Slow mode, clear chat for everyone |
| `/emote remove Name` | Remove an uploaded emote (add them in chat settings) |

| Broadcaster | |
|---|---|
| `/mod name` · `/unmod name` | Make or remove moderators |

## Hosting

Ater Live is one Node process with no database, so any small VPS works.

1. Run it with `HOST=0.0.0.0` (or keep `127.0.0.1` and put a proxy on the same machine).
2. Put it behind HTTPS (Caddy or nginx), set `TRUST_PROXY=1`, and back up the data file.
3. Chat uses Server-Sent Events on `/api/stream`. If you use nginx, turn buffering off for that path:

   ```nginx
   location /api/stream {
     proxy_pass http://127.0.0.1:8080;
     proxy_http_version 1.1;
     proxy_set_header Connection "";
     proxy_buffering off;
     proxy_read_timeout 1h;
   }
   ```

4. To run it in Docker instead:

   ```bash
   docker build -t ater-live .
   docker run -d -p 8080:8080 -v ater-data:/data -e ATER_OWNER=yourname ater-live
   ```

Twitch embeds need the page served from a real hostname. The site passes its own hostname to Twitch as `parent` automatically.

## Data and privacy

- **On the server:** accounts (passwords hashed with scrypt), sessions (an HttpOnly cookie, 90 days), uploaded emotes, pins, bans and the last 300 messages. All of it is saved in the data file, which git ignores.
- **In each viewer's browser only:** settings, the links queue, the leaderboard, mentions and Big Screen layouts. The leaderboard counts what *that* browser has seen.
- **Third parties the page talks to:**
  - Twitch, Kick and YouTube, when their chat is switched on or a stream is embedded.
  - 7TV, for emotes.
  - decapi.me, for Twitch live status. To turn this off, set `liveStatus: false` in the config.
  - Google Fonts.

## Project layout

```
public/              the website (no build step)
  index.html
  css/ater.css
  js/config.js       ← your settings
  js/engine.js       chat engine: Ater, Twitch, Kick, YouTube, 7TV, links, leaderboard
  js/app.js          the site: routing, chat UI, Big Screen, home page
  js/early.js        OBS overlay switch, runs before first paint
server/              Node server, no dependencies
  index.js           entry point: env vars, .env, listen, shutdown
  app.js             HTTP routes and the chat API
  chat.js            live clients (SSE), messages, polls, pins, commands
  accounts.js        accounts, passwords, sessions, badges
  emotes.js          built-in Ater emotes, upload checks
  store.js           JSON file storage
  static.js          serves public/ with ETags and gzip
kick-relay/          Cloudflare Worker that lets the page reach Kick chat
test/                npm test (Node's built-in test runner)
```

## Development

```bash
npm run dev    # restarts the server when server/ or public/ changes
npm test       # 28 tests: accounts, chat, moderation, polls, emotes, static files, the front end
```

The chat API is documented at the top of [`server/app.js`](server/app.js), and the live events at the top of [`server/chat.js`](server/chat.js).

## Not done yet

- No password reset. A forgotten password means a new account.
- One server process. Chat state lives in memory and in the JSON file, so it doesn't spread across several servers.
- The leaderboard is per browser, not site-wide.
- No license has been chosen yet, so all rights are reserved by default.
