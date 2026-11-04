--!strict
-- Pure broadcast math shared by server and client: station day, schedule
-- validation, and "what is on channel N at time T".
--
-- Every channel is a loop anchored to local midnight of the station day, so
-- all servers and all players see the same thing at the same moment, using
-- workspace:GetServerTimeNow() as the shared clock.

local Config = require(script.Parent.Config)

export type Item = {
	kind: string, -- "video" | "audio" | "card"
	duration: number,
	assetId: string?,
	title: string?,
	text: string?,
	style: string?,
	year: number?,
	airDate: string?,
	category: string?,
	part: number?,
	parts: number?,
	credit: string?,
}

export type Channel = {
	number: number,
	name: string,
	tagline: string?,
	year: number?, -- the channel's broadcast year (everything on it is from then)
	totalDuration: number,
	items: { Item },
}

export type Schedule = {
	format: number,
	date: string,
	title: string?,
	channels: { Channel },
}

export type StationDay = { key: string, anchor: number, month: number, day: number }

local Broadcast = {}

Broadcast.MONTHS = {
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
}
Broadcast.MONTHS_SHORT = { "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC" }

-- Days since 1970-01-01 for a civil date (proleptic Gregorian).
function Broadcast.daysFromCivil(y: number, m: number, d: number): number
	if m <= 2 then
		y -= 1
	end
	local era = (if y >= 0 then y else y - 399) // 400
	local yoe = y - era * 400
	local mp = (m + 9) % 12
	local doy = (153 * mp + 2) // 5 + d - 1
	local doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
	return era * 146097 + doe - 719468
end

-- Day of month of the nth Sunday of (y, m).
local function nthSunday(y: number, m: number, n: number): number
	local dow = (Broadcast.daysFromCivil(y, m, 1) + 4) % 7 -- 0 = Sunday (1970-01-01 was a Thursday)
	return 1 + (7 - dow) % 7 + (n - 1) * 7
end

function Broadcast.utcOffsetSeconds(now: number): number
	local std = Config.UtcOffsetMinutes * 60
	if not Config.ObserveUSDaylightSaving then
		return std
	end
	local year = (os.date("!*t", math.floor(now + std)) :: any).year
	-- 2:00 local standard time, second Sunday of March -> 2:00 local daylight time, first Sunday of November
	local startsAt = Broadcast.daysFromCivil(year, 3, nthSunday(year, 3, 2)) * 86400 + 7200 - std
	local endsAt = Broadcast.daysFromCivil(year, 11, nthSunday(year, 11, 1)) * 86400 + 7200 - (std + 3600)
	if now >= startsAt and now < endsAt then
		return std + 3600
	end
	return std
end

function Broadcast.stationDay(now: number): StationDay
	local offset = Broadcast.utcOffsetSeconds(now)
	local dayIndex = (now + offset) // 86400
	local t = os.date("!*t", math.floor(dayIndex * 86400)) :: any
	return {
		key = string.format("%02d-%02d", t.month, t.day),
		anchor = dayIndex * 86400 - offset,
		month = t.month,
		day = t.day,
	}
end

-- Station-local "h:mm PM" for a unix time (for listings).
function Broadcast.localClock(t: number): string
	local lt = os.date("!*t", math.floor(t + Broadcast.utcOffsetSeconds(t))) :: any
	local hour = lt.hour % 12
	if hour == 0 then
		hour = 12
	end
	return string.format("%d:%02d %s", hour, lt.min, if lt.hour < 12 then "AM" else "PM")
end

local VALID_KINDS = { video = true, audio = true, card = true }

local function str(v: any, max: number): string?
	if type(v) ~= "string" or v == "" then
		return nil
	end
	return string.sub(v, 1, max)
end

-- Defensive copy of whatever came out of the DataStore / HTTP. Drops bad items
-- and recomputes totals rather than trusting them.
function Broadcast.sanitize(raw: any): Schedule?
	if type(raw) ~= "table" or type(raw.channels) ~= "table" then
		return nil
	end
	local channels: { Channel } = {}
	for _, ch in raw.channels do
		if type(ch) ~= "table" or type(ch.items) ~= "table" then
			continue
		end
		local items: { Item } = {}
		local total = 0
		for _, it in ch.items do
			if type(it) ~= "table" or not VALID_KINDS[it.kind] then
				continue
			end
			local duration = tonumber(it.duration)
			if not duration or duration <= 0 or duration ~= duration then
				continue
			end
			local assetId: string? = if it.assetId ~= nil then (string.gsub(tostring(it.assetId), "%D", "")) else nil
			if it.kind ~= "card" and (not assetId or assetId == "") then
				continue
			end
			table.insert(items, {
				kind = it.kind,
				duration = duration,
				assetId = assetId,
				title = str(it.title, 120),
				text = str(it.text, 400),
				style = str(it.style, 20),
				year = tonumber(it.year),
				airDate = str(it.airDate, 10),
				category = str(it.category, 20),
				part = tonumber(it.part),
				parts = tonumber(it.parts),
				credit = str(it.credit, 120),
			})
			total += duration
		end
		if #items > 0 then
			table.insert(channels, {
				number = tonumber(ch.number) or (#channels + 2),
				name = str(ch.name, 24) or "TV",
				tagline = str(ch.tagline, 80),
				year = tonumber(ch.year),
				totalDuration = total,
				items = items,
			})
		end
	end
	if #channels == 0 then
		return nil
	end
	table.sort(channels, function(a, b)
		return a.number < b.number
	end)
	return {
		format = tonumber(raw.format) or 1,
		date = str(raw.date, 5) or "",
		title = str(raw.title, 100),
		channels = channels,
	}
end

-- What's on `channel` at `now`: item index, seconds into it, and the unix time it started.
function Broadcast.locate(channel: Channel, now: number, anchor: number): (number, number, number)
	local total = channel.totalDuration
	local elapsed = (now - anchor) % total
	local loopStart = now - elapsed
	local acc = 0
	for i, item in channel.items do
		if elapsed < acc + item.duration then
			return i, elapsed - acc, loopStart + acc
		end
		acc += item.duration
	end
	local last = #channel.items
	return last, 0, loopStart + total - channel.items[last].duration
end

-- Next `count` items after the current one, with their start times.
function Broadcast.upcoming(channel: Channel, now: number, anchor: number, count: number): { { item: Item, startsAt: number } }
	local index, offset = Broadcast.locate(channel, now, anchor)
	local out = {}
	local t = now - offset
	for _ = 1, math.min(count, #channel.items) do
		local item = channel.items[index]
		table.insert(out, { item = item, startsAt = t })
		t += item.duration
		index = index % #channel.items + 1
	end
	return out
end

return Broadcast
