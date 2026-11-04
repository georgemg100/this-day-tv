# This Day TV

Television from **today's date** in past years (1960–1999 by default): newsreels, newscasts, shows and period commercials from the Internet Archive, played on a full-screen retro TV. Everyone tuned in sees the same moment of the same broadcast. Open it on November 3 and you're watching November 3, 1967 as it went out.

It runs in two places, both fed by one admin console:

- **Website (`web/`), the main one.** A static page that streams straight from archive.org. It's free to host and run, shared with a link, and works on phones, laptops and smart-TV browsers.
- **Roblox (`roblox/`), optional.** A 1960s living room in Roblox. Video there must be uploaded to Roblox at 2,000 Robux each (see below).

```
 ┌──────────────── admin console (Node, localhost:4747) ────────────────┐
 │ Find ─► archive.org (date-matched) · Exa.ai · era commercials        │
 │         Wikipedia "On this day" headlines (free cards)               │
 │ Library ─► Stream: archive.org link + clip times (free) ─────────┐   │
 │         ─► Download & cut ─► Roblox upload (R$) ───────────┐     │   │
 │ Lineup ─► auto-build (IDs, headlines, breaks, sign-off)    │     │   │
 │         ─► Publish ─┬─► web/schedules/MM-DD.json  ◄────────┼─────┘   │
 │                     └─► Roblox DataStore + live reload ◄───┘         │
 └──────────────────────────────────────────────────────────────────────┘
        ▼                                              ▼
  web/ (any static host)                       roblox/ (Studio place)
  <video> streams archive.org                  VideoFrame plays uploads
```

## Website

### Try it locally
```sh
cd admin && npm start        # console → http://127.0.0.1:4747
open http://127.0.0.1:4747/tv/
```
Click the power knob. Browsers only allow sound after a click or tap. A sample November 3 lineup is included in `web/schedules/11-03.json`: CH 4 is 1967, CH 7 is 1969. On days with nothing published, the TV builds free headline channels from Wikipedia.

**Controls:** ↑/↓ change channel, number keys jump to a channel, **G** opens the listings, **M** mutes, **F** goes full screen, **P** is power. The controls hide while you watch and come back when you move the mouse or tap.

For a dedicated screen (an old monitor or a smart TV browser), open `…/?on` to switch on automatically. This only works where the browser allows autoplay; otherwise the power knob comes back.

### Autopilot: programming every morning, no admin
`admin/autopilot.js` programs a whole day on its own. By default (`--mode exact`) **every program on air aired on that exact date**:
1. Finds everything archive.org has from that month and day, across all years in range.
2. Keeps only items with real evidence of the date: the date written in the title or ID (for example "The Price is Right (November 3, 1972)"), or a TV, game-show or newsreel collection whose uploaders record air dates. It skips mis-dated movies, season box sets, fringe uploads, and titles that name a different year.
3. Picks up to 10 years, rotating across decades, one channel each.
4. Fills each channel with that year's exact-date programs, commercials from that year (not date-specific), and Wikipedia headlines.
5. Publishes `web/schedules/MM-DD.json`.

```sh
cd admin
node autopilot.js                 # today
node autopilot.js --days 7        # today + next 6 days
node autopilot.js --date 12-25 --dry-run
node autopilot.js --channels 12   # more channels
node autopilot.js --mode pd       # public domain only, filled from the same week/year
```

**Rights:** almost everything that aired on a given date is a recording of a copyrighted broadcast. For November 3, only 5 of about 500 exact-date items are public domain. Exact mode plays them regardless of rights status. The video streams from archive.org, not your site, but showing it publicly is your responsibility. `--mode pd` is the cautious alternative: public domain only, with same-week and same-year filler.

Days you published by hand from the console are never overwritten unless you pass `--force`.

**Running it daily:** `.github/workflows/daily-programming.yml` runs the autopilot at 09:00 UTC (4–5 AM Eastern), commits the schedules, and deploys `web/` to GitHub Pages, all free. One-time setup:
1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → *Daily programming* → **Run workflow**.

The console (`npm start`) is still there if you want to hand-pick a day, but it's optional.

### One year per channel
Each channel is locked to a single year, so CH 4 can be November 3, 1967 while CH 7 is November 3, 1969. Everything on a channel comes from its year: programs, commercials, headlines, the on-screen date, and the wall calendar in Roblox. Pick the channel and year in the console's top bar. The year chips on the Find tab show which years have the most programming for that date. With a year set:

- **Search order:** what aired on that exact date first, then the same week (±7 days), then the rest of that year.
- **Commercials and headlines:** limited to that year. Headlines include Wikipedia's "died today" entries, because a single year has few events per date.
- **Auto-build:** only offers that year's clips. It puts news first, then programs, and the nearest air dates first.
- **Lineup:** clips from another year are flagged.

On days with nothing published, the free Wikipedia fallback builds up to three channels, each a different year.

### Publish a day
1. In the console, choose the channel and its year, then **Find programming** and **Add to library…** with the destination "Stream on the website". Nothing is downloaded. Long programs are split into 12-minute acts (`WEB_ACT_SECONDS`) so commercials can go between them.
2. **Lineup & publish**: Auto-build, Save, then **Publish** with "Website" ticked. This writes `web/schedules/MM-DD.json`.
3. Deploy the `web/` folder.

### Put it online
`web/` is plain static files with no build step. Any static host works, and hosting stays free because archive.org serves the video:

- **Netlify / Cloudflare Pages:** drag the `web/` folder onto their deploy page, or connect the repo with `web` as the publish directory.
- **GitHub Pages:** push the repo and serve `/web`, or copy `web/` into a `gh-pages` branch.

Redeploy after you publish a new day. Players check for updates every 5 minutes. Lineups are keyed by month and day, so each one replays every year.

**Sync:** each channel loops from local midnight in `STATION_TIMEZONE`, and the player seeks to "now". Viewers anywhere see the same frame, give or take a second. The player corrects for a wrong device clock using the host's `Date` header.

**Rights:** whoever shows a broadcast is responsible for having the rights to it, website or not. The console ranks Universal Newsreels, Prelinger, NASA and other curated public-domain collections first, and flags everything else "verify". Each clip's archive.org source is credited on screen.

## Roblox version (optional)

### Roblox video costs

Roblox can only play videos that were uploaded to Roblox. It cannot stream from archive.org. As of November 2026 ([docs](https://create.roblox.com/docs/ui/video-frames)):

| | Video | Audio |
|---|---|---|
| Cost | **2,000 Robux per upload** | free |
| Max length | 5 minutes | 7 minutes |
| Limit | 20 per day, ID-verified, 13+ | 100 per month if ID-verified (10 if not) |

A 30-minute episode becomes 7 parts, which costs 14,000 Robux. The console shows the cost before every upload and requires two confirmations. Ways to stretch a budget:

- **Short clips.** Newsreel stories (about 1 to 3 minutes) and real commercials (30 to 60 seconds) each fit in one upload.
- **Clip start and end.** Upload the best 4:55 of a long show instead of all of it.
- **Radio.** Audio uploads are free, and archive.org has a lot of period radio news. The TV shows an "ON THE AIR" slate while audio plays.
- **Cards.** Headline cards, station IDs and "We'll be right back" slides are drawn in-game and cost nothing.
- **Lineups repeat every year.** They are keyed by month and day (`11-03`), so this year's November 3 lineup plays again next November 3.

Even with nothing uploaded, the station works. If no lineup is published for today, the server builds a free all-headlines channel from Wikipedia. If that fails too, the TV shows color bars and "PLEASE STAND BY".

**Rights.** Roblox requires you to hold the rights to anything you upload. The console ranks Universal Newsreels, Prelinger, NASA and similar curated public-domain collections highest. Items marked "Uploader says PD — verify" or "Rights unknown" carry exactly that warning: many archive.org TV rips are not public domain, whatever their license tag says. The on-screen credit line shows the archive.org source of each clip.

### Roblox quick start

#### 1. The Roblox experience

Requires Roblox Studio. [Rojo](https://rojo.space) is optional.

- **Easiest:** open `roblox/build/ThisDayTV.rbxlx` in Studio.
- **Live sync:** `cd roblox && rojo serve`, then connect from the Rojo Studio plugin. Rebuild the place file with `rojo build -o build/ThisDayTV.rbxlx`.

Then in Studio:
1. **File → Publish to Roblox** to create the experience.
2. **Game Settings → Security:** turn on **Enable Studio Access to API Services** (DataStore while testing) and **Allow HTTP Requests** (Wikipedia fallback and the optional `ScheduleUrl`).
3. Press Play. You'll see the living room, and either headline cards or the test pattern.

Controls: `[` / `]` change channel (or **E** at the TV), `M` mutes, `F` toggles watch mode, which settles the camera in front of the set. Touch players get the on-screen remote.

#### 2. The admin console

Requires Node 20+ and ffmpeg (`brew install ffmpeg`). There are no npm dependencies.

```sh
cd admin
cp .env.example .env     # fill in what you have; the Setup tab shows what's missing
npm start                # → http://127.0.0.1:4747
```

archive.org search works with no keys. Add the rest as you need it:

| Setting | Get it from | Unlocks |
|---|---|---|
| `EXA_API_KEY` | dashboard.exa.ai | Exa semantic search |
| `ROBLOX_API_KEY` | Creator Hub → Credentials → API Keys | uploads and publishing |
| `ROBLOX_CREATOR_USER_ID` or `_GROUP_ID` | your profile or group URL | who owns uploaded assets |
| `ROBLOX_UNIVERSE_ID` | Creations → ⋯ → Copy Universe ID | publishing to your experience |

API key permissions: **Assets** (`asset:read`, `asset:write`). On your experience: **Data stores** (entry read, create and update) and **Messaging service** (`universe-messaging-service:publish`).

### Roblox daily workflow

1. **Pick the day** at the top. It defaults to today in `STATION_TIMEZONE`.
2. **Find programming.**
   - *archive.org · this date* runs three searches at once: items whose `date` is MM-DD in any year in range, identifiers like `1967-11-03_…`, and the date written out in titles and descriptions ("November 3, 1967"). Results are scored by how much the date and rights can be trusted, and obvious movie rips are pushed down.
   - *Commercials* searches period ads by year. They don't need to match the date.
   - *Exa.ai* finds pages that describe a broadcast but that keyword search misses. It is restricted to archive.org, so results can be ingested.
   - *Headlines* lists Wikipedia events for the date. Tick the ones auto-build should use.
3. **Add to library.** Choose the file, category, and an optional clip start and end. The console downloads the file, letterboxes it to 640×480, splits it evenly into parts of 295 seconds or less, and sizes the bitrate so each part stays under the 20 MB upload cap. Preview the parts in the Library tab.
4. **Upload.** The Library tab shows the Robux cost on the button. If you'd rather upload in Creator Hub, paste the asset ID with **Set ID**. Already-uploaded assets can be added with **Add existing Roblox asset**.
5. **Lineup & publish.**
   - **Auto-build** lays out a broadcast day: a station ID, then each program oldest first, introduced by a headline from its year. Multi-part programs get commercial breaks between parts, a news roundup collects the leftover headlines, and a sign-off ends the day before it loops.
   - Reorder entries, edit cards, add channels.
   - **Publish** writes the lineup to the DataStore and messages live servers, which switch within seconds. Parts that aren't uploaded yet are skipped, along with their orphaned breaks.

### How Roblox sync works

Each channel is a loop anchored to local midnight of the station day. A client computes `(GetServerTimeNow() − anchor) mod loopLength`, finds the item playing at that moment, and seeks into it. Clients check for drift every 2 seconds and re-seek past 2 seconds. Every player in every server therefore sees the same frame of the same broadcast. Live servers reload when the day rolls over, on a publish message, and every 5 minutes.

Keep these in sync between `admin/.env` and `roblox/src/shared/Config.luau`:

| admin/.env | Config.luau |
|---|---|
| `ROBLOX_DATASTORE=ThisDayTV` | `DataStoreName` |
| `ROBLOX_TOPIC=ThisDayTV` | `MessagingTopic` |
| `STATION_TIMEZONE=America/New_York` | `UtcOffsetMinutes = -300`, `ObserveUSDaylightSaving = true` |

To host the console publicly instead, set `Config.ScheduleUrl = "https://your-host/public/schedule/%s"` as a second source. Put `ADMIN_TOKEN` and HTTPS in front of it first.

## Layout

```
web/                        the TV website (static; deploy this folder)
  index.html, css/tv.css    the set, cards, test pattern, controls, listings
  js/broadcast.js           day/time math + "what's on now" (mirrors Broadcast.luau)
  js/tv.js                  player: power, tuning, preloading, sync, guide
  station.json              timezone + year range (written on publish)
  schedules/MM-DD.json      published lineups
admin/                      Node admin console (zero dependencies)
  server.js                 HTTP API + static UI
  lib/archive.js            archive.org search, scoring, rights, item files
  lib/exa.js                Exa.ai search
  lib/onthisday.js          Wikipedia "On this day"
  lib/media.js              download + ffmpeg segmenting
  lib/library.js            ingest / upload jobs
  lib/roblox.js             Open Cloud: assets, DataStore, MessagingService
  lib/schedule.js           drafts → compiled broadcast (web or roblox), auto-build
  lib/web.js                publish to web/
  public/                   the console UI
  test/                     node --test
roblox/
  default.project.json      Rojo project
  src/shared/Config.luau    station settings
  src/shared/Broadcast.luau day/time math, schedule validation, "what's on now"
  src/server/               room builder, schedule loader, headline fallback
  src/client/               TV picture, remote, calendar + listings
  tests/                    pure-Luau specs (./tests/run.sh)
  build/ThisDayTV.rbxlx     prebuilt place
```

## Tests

```sh
cd admin && npm test            # dates, archive search, segmenting, lineup compile, web player math
cd roblox && ./tests/run.sh     # DST, station day, loop math, sanitising (needs `luau`)
```

## Troubleshooting

- **"TECHNICAL DIFFICULTIES" on the TV:** the asset didn't load within 12 seconds. It may still be in moderation, it may have been rejected, or the asset ID is wrong. Check it in Creator Hub.
- **Test pattern even though you published:** check that the DataStore name and timezone match, that Studio has API access turned on, and the server output (`[ThisDayTV] 11-03: N channel(s) from datastore`).
- **Upload fails with a price error:** Roblox changed the video price. Update `ROBLOX_VIDEO_PRICE`.
- **An upload is stuck "processing" after a restart:** click **Check status** on that part.
