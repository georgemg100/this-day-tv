-- Loads today's lineup and replicates it to every client.
--
-- Sources, in order:
--   1. DataStore Config.DataStoreName, key "MM-DD"  (written by the admin console via Open Cloud)
--   2. Config.ScheduleUrl                            (optional HTTPS mirror)
--   3. Wikipedia "On this day" headline cards        (free fallback, needs HTTP)
--   4. nothing -> clients show a test pattern
--
-- Reloads when the station day rolls over, every Config.RefreshSeconds, and
-- immediately when the admin console publishes (MessagingService topic).

local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local MessagingService = game:GetService("MessagingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local shared = ReplicatedStorage:WaitForChild("ThisDayTV")
local Config = require(shared:WaitForChild("Config"))
local Broadcast = require(shared:WaitForChild("Broadcast"))
local Headlines = require(script.Parent:WaitForChild("Headlines"))

local ScheduleService = {}

local stateFolder: Folder
local broadcastValue: StringValue
local currentKey: string? = nil
local loading = false

local function getStore()
	local ok, store = pcall(function()
		return DataStoreService:GetDataStore(Config.DataStoreName)
	end)
	return if ok then store else nil
end

local function fromDataStore(key: string): any
	local store = getStore()
	if not store then
		return nil
	end
	for attempt = 1, 3 do
		local ok, value = pcall(function()
			return store:GetAsync(key)
		end)
		if ok then
			return value
		end
		warn(`[ThisDayTV] DataStore read failed (attempt {attempt}): {value}`)
		task.wait(attempt * 2)
	end
	return nil
end

local function fromUrl(key: string): any
	if Config.ScheduleUrl == "" then
		return nil
	end
	local ok, body = pcall(function()
		return HttpService:GetAsync(string.format(Config.ScheduleUrl, key), true)
	end)
	if not ok then
		warn(`[ThisDayTV] ScheduleUrl fetch failed: {body}`)
		return nil
	end
	local decoded, value = pcall(HttpService.JSONDecode, HttpService, body)
	return if decoded then value else nil
end

local function loadNow(reason: string)
	local day = Broadcast.stationDay(os.time())
	local source = "none"
	local schedule = Broadcast.sanitize(fromDataStore(day.key))
	if schedule then
		source = "datastore"
	else
		schedule = Broadcast.sanitize(fromUrl(day.key))
		if schedule then
			source = "url"
		elseif Config.AutoHeadlinesWhenEmpty then
			schedule = Broadcast.sanitize(Headlines.build(day))
			if schedule then
				source = "headlines"
			end
		end
	end

	currentKey = day.key
	broadcastValue.Value = HttpService:JSONEncode({
		key = day.key,
		month = day.month,
		day = day.day,
		anchor = day.anchor,
		source = source,
		schedule = schedule,
		loadedAt = os.time(),
	})
	local channelCount = if schedule then #schedule.channels else 0
	print(`[ThisDayTV] {day.key}: {channelCount} channel(s) from {source} ({reason})`)
end

local pending: string? = nil

-- Serialised: a publish message that arrives mid-load triggers one more load
-- afterwards instead of being dropped.
local function load(reason: string)
	if loading then
		pending = reason
		return
	end
	loading = true
	local nextReason: string? = reason
	while nextReason do
		pending = nil
		local ok, err = pcall(loadNow, nextReason)
		if not ok then
			warn(`[ThisDayTV] schedule load failed: {err}`)
		end
		nextReason = pending
	end
	loading = false
end

function ScheduleService.start()
	stateFolder = Instance.new("Folder")
	stateFolder.Name = "ThisDayTVState"
	broadcastValue = Instance.new("StringValue")
	broadcastValue.Name = "Broadcast"
	broadcastValue.Parent = stateFolder
	stateFolder.Parent = ReplicatedStorage

	load("startup")

	task.spawn(function()
		local ok, err = pcall(function()
			MessagingService:SubscribeAsync(Config.MessagingTopic, function(message)
				local data = tostring(message.Data)
				if data == "*" or data == currentKey then
					load("publish message")
				end
			end)
		end)
		if not ok then
			warn(`[ThisDayTV] MessagingService subscribe failed (live reload disabled): {err}`)
		end
	end)

	task.spawn(function()
		local lastFull = os.clock()
		while true do
			task.wait(15)
			local day = Broadcast.stationDay(os.time())
			if day.key ~= currentKey then
				load("new day")
				lastFull = os.clock()
			elseif os.clock() - lastFull >= Config.RefreshSeconds then
				load("refresh")
				lastFull = os.clock()
			end
		end
	end)
end

return ScheduleService
