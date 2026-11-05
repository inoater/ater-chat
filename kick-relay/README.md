# Ater Kick relay

Since October 2026, Kick's chat servers only accept connections from kick.com. To show Kick chatters, Ater needs to reach Kick through a small relay. This folder is that relay: a Cloudflare Worker (the free plan is enough).

It forwards exactly three things to Kick, with no browser `Origin` attached:

| Relay path | Goes to |
|---|---|
| `POST /api/v1/realtime/*` | `https://web.kick.com/api/v1/realtime/*`, which gets the chat connection and token |
| `GET /api/v2/channels/:slug` | `https://kick.com/api/v2/channels/:slug`, which finds a channel's chatroom ID |
| `GET /ws?to=wss://…` | the Kick chat WebSocket, piped both ways (only `*.kick.com` hosts) |

## Deploy (about 3 minutes)

**With the command line**

```bash
cd kick-relay
npx wrangler login
npx wrangler deploy
```

Wrangler prints an address like `https://ater-kick-relay.<you>.workers.dev`.

**Without installing anything**

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Create Worker**.
2. Replace the code with the contents of [`worker.js`](worker.js) and click **Deploy**.

## Use it

Paste the relay address into **Channels → Kick → Relay URL** on the site. To set it for every visitor, put it in `public/js/config.js`:

```js
kickRelay: 'https://ater-kick-relay.<you>.workers.dev',
```

## Lock it down

By default any website can use your relay. Set `ALLOWED_ORIGINS` in `wrangler.toml` (or under the Worker's **Settings → Variables**) to your own site:

```toml
ALLOWED_ORIGINS = "https://your-site.example,http://localhost:8080"
```

`WS_HOSTS` limits which hosts the relay will open WebSockets to (default `kick.com`, which includes its subdomains). This stops it being used as an open proxy.
