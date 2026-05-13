# RSS Feed for Tracked Games

Users can now subscribe to their tracked games using RSS feeds. This allows them to get automatic updates with download links in any RSS reader.

## Features

- **Per-User Feeds**: Each user has their own private RSS feed
- **Download Links**: All download links are included in the feed items
- **Flexible Filtering**: Multiple query parameters for customization
- **Token-Based Access**: Secure token-based authentication (no need to share session)
- **Session-Based Access**: Also supports authenticated session access

## Getting Started

1. Go to **Account Settings** → **Manage Account**
2. Scroll to the **📡 RSS Feed** section
3. Click **Generate RSS Token** to create a unique token
4. Copy the feed URL and add it to your favorite RSS reader

## Feed URL Format

```
https://your-domain.com/api/rss/feed?token=YOUR_TOKEN_HERE
```

Or if using session authentication:
```
https://your-domain.com/api/rss/feed
```

## Query Parameters

### Sort Mode

- `?sort=recent` (default) - Games with updates in the last 7 days
- `?sort=all` - All active tracked games
- `?sort=updated` - Games that have at least one update in history

### Limit

- `?limit=50` (default) - Number of items to include
- `?limit=100` - Custom limit (max: 500)

### Enclosures (qBittorrent and similar clients)

- `?enclosures=torrents` (default) — Only **magnet** and **.torrent** URLs are emitted as `<enclosure>`, with `type="application/x-bittorrent"`. Direct / file-host links stay in the HTML description only. This matches what qBittorrent’s RSS downloader expects (it tries to parse each enclosure as a torrent or magnet).
- `?enclosures=all` — Legacy behavior: every stored download link is also an enclosure (including direct/host links). Not recommended for qBittorrent auto-download rules.

### Combined Examples

```
/api/rss/feed?token=xxx&sort=all&limit=100
/api/rss/feed?token=xxx&sort=updated&limit=50
/api/rss/feed?token=xxx&sort=recent
```

### qBittorrent

1. Use your normal token feed URL (default `enclosures=torrents` is already suitable).
2. In qBittorrent: **RSS** → **New subscription** → paste the feed URL.
3. Add an **RSS Downloader** rule for that feed (e.g. enable “Use regex to download” only if you need title filtering). Rules apply to **articles** that include at least one usable enclosure.
4. Games whose latest scrape has only direct/host links (no magnet or `.torrent` URL) will appear with **no** enclosures; the RSS reader will not auto-grab a torrent for those entries until a torrent-capable link exists in your stored update data.

## Feed Items Include

Each RSS item contains:

- **Title**: Game name
- **Description**: 
  - Latest version information
  - Source
  - Download links organized by service
- **Publication Date**: Latest update date
- **Image**: Game cover image
- **Category**: Source (e.g., "site_name")
- **Enclosures**: By default, only magnet and `.torrent` links (for clients like qBittorrent). Other links remain in the description HTML.

## Security

- **Private Tokens**: Each token is unique and tied to your account
- **Revokable**: You can revoke your token anytime from settings
- **No Expiration**: Tokens don't expire automatically (you can regenerate to invalidate old ones)
- **Token Regeneration**: Generating a new token invalidates the old one

## API Endpoints

### Get Current Token

```bash
GET /api/rss/token
```

Response:
```json
{
  "token": "abc123def456...",
  "createdAt": "2024-01-15T10:30:00Z",
  "feedUrl": "https://domain.com/api/rss/feed?token=abc123def456..."
}
```

### Generate New Token

```bash
POST /api/rss/token
```

Response:
```json
{
  "success": true,
  "token": "new_token_here",
  "createdAt": "2024-01-15T10:30:00Z",
  "feedUrl": "https://domain.com/api/rss/feed?token=new_token_here",
  "message": "RSS feed token generated. Keep it private!"
}
```

### Revoke Token

```bash
DELETE /api/rss/token
```

Response:
```json
{
  "success": true,
  "message": "RSS feed token revoked"
}
```

### Get RSS Feed

```bash
GET /api/rss/feed?token=YOUR_TOKEN&sort=recent&limit=50
```

Response: Valid RSS 2.0 XML with game updates

## Usage with Popular RSS Readers

### Feedly
1. Copy your feed URL
2. Click the "+" to add a new feed
3. Paste the URL and subscribe

### Apple News+
1. In Settings, go to RSS Feeds
2. Add the feed URL

### Inoreader
1. Click "Add subscription"
2. Paste the feed URL

### Thunderbird / Email Clients
1. Add RSS feed from the appropriate menu
2. Paste the feed URL

## Troubleshooting

**Feed shows no items:**
- Ensure you have tracked games
- Check the sort parameter (try `?sort=all`)
- Verify the token is valid

**Feed not updating:**
- RSS feeds cache for 1 hour
- Clear your reader's cache
- Try generating a new token

**Invalid token error:**
- Token may have been revoked
- Generate a new token from settings

## Future Enhancements

- Custom filtering by game source
- Filtering by update type
- RSS feed expiration dates
- Download link authentication
