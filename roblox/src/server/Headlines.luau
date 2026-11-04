-- Free fallback programming: Wikipedia "On this day" events and deaths as
-- headline cards. Used only when nothing is published for today. Each channel
-- is a single year (the years with the most to report), so a channel never
-- mixes years. Needs HttpEnabled.
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local shared = ReplicatedStorage:WaitForChild("ThisDayTV")
local Config = require(shared:WaitForChild("Config"))
local Broadcast = require(shared:WaitForChild("Broadcast"))

local Headlines = {}

local MAX_CHANNELS = 3
local NUMBERS = { 4, 7, 11 }
local CALLSIGNS = { "WTDI", "WKTV", "WNTW" }

local cache: { [string]: any } = {}

function Headlines.build(day: { key: string, month: number, day: number }): any
	if cache[day.key] ~= nil then
		return cache[day.key] or nil
	end
	local url = string.format("https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/%02d/%02d", day.month, day.day)
	local ok, body = pcall(function()
		return HttpService:GetAsync(url, true)
	end)
	if not ok then
		warn(`[ThisDayTV] headline fallback unavailable: {body}`)
		return nil
	end
	local decoded, data = pcall(HttpService.JSONDecode, HttpService, body)
	if not decoded or type(data) ~= "table" then
		return nil
	end

	-- Group events, then deaths, by year.
	local byYear: { [number]: { { text: string, death: boolean } } } = {}
	for _, kind in { "events", "deaths" } do
		for _, e in (data[kind] or {}) do
			if type(e.year) == "number" and e.year >= Config.HeadlineYearFrom and e.year <= Config.HeadlineYearTo and type(e.text) == "string" then
				byYear[e.year] = byYear[e.year] or {}
				table.insert(byYear[e.year], { text = e.text, death = kind == "deaths" })
			end
		end
	end
	local years = {}
	for year, list in byYear do
		table.insert(years, { year = year, count = #list })
	end
	table.sort(years, function(a, b)
		return if a.count ~= b.count then a.count > b.count else a.year < b.year
	end)
	if #years == 0 then
		cache[day.key] = false
		return nil
	end
	local picked = {}
	for i = 1, math.min(MAX_CHANNELS, #years) do
		table.insert(picked, years[i].year)
	end
	table.sort(picked)

	local dateText = `{Broadcast.MONTHS[day.month]} {day.day}`
	local channels = {}
	for n, year in picked do
		local callsign = CALLSIGNS[n]
		local items = {
			{ kind = "card", style = "station-id", duration = 8, year = year, title = `{callsign} · CHANNEL {NUMBERS[n]}`, text = `Good evening. It's {dateText}, {year}. Here is the news.` },
		}
		for i, e in byYear[year] do
			table.insert(items, {
				kind = "card",
				style = "headline",
				duration = 12,
				year = year,
				title = `{dateText}, {year}`,
				text = string.sub(if e.death then "Died today: " .. e.text else e.text, 1, 400),
			})
			if i % 4 == 0 and i < #byYear[year] then
				table.insert(items, { kind = "card", style = "break", duration = 4, title = "We'll be right back", text = "Stay tuned!" })
			end
		end
		table.insert(items, { kind = "card", style = "sign-off", duration = 8, year = year, title = "That concludes our news", text = `{callsign} thanks you for watching. Headlines courtesy of Wikipedia.` })
		table.insert(channels, { number = NUMBERS[n], name = callsign, tagline = `News of {year}`, year = year, items = items })
	end

	local schedule = { format = 1, date = day.key, title = `Headlines — {dateText}`, channels = channels }
	cache[day.key] = schedule
	return schedule
end

return Headlines
