-- Run with: ./tests/run.sh   (plain Luau, no Roblox needed)
local function eq(a, b, msg)
	if a ~= b then error(`{msg}: expected {tostring(b)}, got {tostring(a)}`, 2) end
end

eq(Broadcast.daysFromCivil(1970, 1, 1), 0, "epoch")
eq(Broadcast.daysFromCivil(2000, 3, 1), 11017, "2000-03-01")
eq(Broadcast.daysFromCivil(2026, 11, 3), 20760, "2026-11-03")

-- US Eastern with DST (2026: Mar 8 07:00Z -> Nov 1 06:00Z)
eq(Broadcast.utcOffsetSeconds(1793707200), -18000, "Nov 3 2026 noon UTC is EST")
eq(Broadcast.utcOffsetSeconds(1782907200), -14400, "Jul 1 2026 is EDT")
eq(Broadcast.utcOffsetSeconds(1772953199), -18000, "just before DST starts")
eq(Broadcast.utcOffsetSeconds(1772953200), -14400, "DST starts 2026-03-08 07:00Z")
eq(Broadcast.utcOffsetSeconds(1793512799), -14400, "just before DST ends")
eq(Broadcast.utcOffsetSeconds(1793512800), -18000, "DST ends 2026-11-01 06:00Z")

local d = Broadcast.stationDay(1793680200) -- 2026-11-03 04:30Z = Nov 2, 11:30pm EST
eq(d.key, "11-02", "still Nov 2 locally")
d = Broadcast.stationDay(1793683800) -- 05:30Z = 12:30am EST
eq(d.key, "11-03", "rolled to Nov 3")
eq(d.anchor, 1793682000, "anchor = local midnight (05:00Z)")
eq(Broadcast.localClock(1793682000 + 20 * 3600 + 5 * 60), "8:05 PM", "local clock")

-- Loop math
local ch = Broadcast.sanitize({ channels = { { number = 4, name = "WTDI", year = 1967, items = {
	{ kind = "card", duration = 10, title = "ID" },
	{ kind = "video", duration = 100, assetId = "123" },
	{ kind = "video", duration = 50, assetId = "abc" }, -- dropped: no digits
	{ kind = "audio", duration = 40, assetId = "rbxassetid://456" },
	{ kind = "bogus", duration = 5 },
	{ kind = "card", duration = -1 },
} } } }).channels[1]
eq(#ch.items, 3, "sanitize drops bad items")
eq(ch.year, 1967, "channel year kept")
eq(ch.totalDuration, 150, "total recomputed")
eq(ch.items[3].assetId, "456", "asset id digits only")

local anchor = 1000
local i, off, started = Broadcast.locate(ch, anchor + 5, anchor)
eq(i, 1, "first item") eq(off, 5, "offset") eq(started, anchor, "start")
i, off, started = Broadcast.locate(ch, anchor + 115, anchor)
eq(i, 3, "third item") eq(off, 5, "offset 3") eq(started, anchor + 110, "start 3")
i, off, started = Broadcast.locate(ch, anchor + 150 * 7 + 12, anchor)
eq(i, 2, "wraps around") eq(off, 2, "offset after wrap") eq(started, anchor + 150 * 7 + 10, "start after wrap")

local up = Broadcast.upcoming(ch, anchor + 115, anchor, 4)
eq(#up, 3, "upcoming capped at item count")
eq(up[2].item.kind, "card", "upcoming wraps")
eq(up[2].startsAt, anchor + 150, "upcoming start time")

eq(Broadcast.sanitize({ channels = {} }), nil, "empty -> nil")
eq(Broadcast.sanitize("nope"), nil, "garbage -> nil")
print("broadcast.spec: all passed")
