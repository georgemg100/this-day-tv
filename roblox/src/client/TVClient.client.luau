-- This Day TV: client controller. Tunes the living-room set to the shared
-- broadcast clock so every player sees the same moment of the same day in history.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local shared = ReplicatedStorage:WaitForChild("ThisDayTV")
local Config = require(shared:WaitForChild("Config"))
local Broadcast = require(shared:WaitForChild("Broadcast"))
local Screen = require(script.Parent:WaitForChild("Screen"))
local Remote = require(script.Parent:WaitForChild("Remote"))
local Decor = require(script.Parent:WaitForChild("Decor"))

local station = workspace:WaitForChild("TVStation")
local screenPart = station:WaitForChild("TV"):WaitForChild("Screen") :: BasePart
local broadcastValue = ReplicatedStorage:WaitForChild("ThisDayTVState"):WaitForChild("Broadcast") :: StringValue

local screen = Screen.new(screenPart)
local decor = Decor.new(station)

local state = {
	payload = nil :: any,
	channelIndex = 1,
	current = nil :: string?, -- identity of what's on screen
	item = nil :: any,
	startedAt = 0,
	token = 0,
	muted = false,
	watching = false,
}

local function serverNow(): number
	return workspace:GetServerTimeNow()
end

local function channels(): { any }?
	local p = state.payload
	return if p and p.schedule then p.schedule.channels else nil
end

local function currentChannel(): any?
	local chs = channels()
	return if chs then chs[state.channelIndex] else nil
end

local function dayText(year: number?): string
	local p = state.payload
	if not p then
		return ""
	end
	local base = `{Broadcast.MONTHS_SHORT[p.month]} {p.day}`
	return if year then `{base}, {year}` else base
end

local function longDate(item: any): string
	if item.airDate then
		local y, m, d = string.match(item.airDate, "^(%d+)-(%d+)-(%d+)$")
		if y then
			return `{Broadcast.MONTHS[tonumber(m) :: number]} {tonumber(d)}, {y}`
		end
	end
	return if item.year then tostring(item.year) else ""
end

local remote

local function describeNow(ch: any?, item: any?)
	if not ch or not item then
		remote:setNow("Off the air")
		return
	end
	if item.kind == "card" then
		remote:setNow(item.title or "")
	elseif item.category == "commercial" then
		remote:setNow("A word from our sponsors")
	else
		remote:setNow(`{item.title or "Untitled"}{if item.year then ` · {item.year}` else ""}`)
	end
end

local function cardKicker(ch: any, item: any): string
	if item.style == "station-id" then
		return `Channel {ch.number}`
	elseif item.style == "headline" then
		return "The news of the day"
	end
	return ch.name
end

local function mediaLowerThird(item: any)
	if item.category == "commercial" then
		return
	end
	local sub = {}
	local when = longDate(item)
	if when ~= "" then
		table.insert(sub, if item.airDate then `Originally broadcast {when}` else when)
	end
	if item.parts and item.parts > 1 then
		table.insert(sub, `Part {item.part} of {item.parts}`)
	end
	screen:showLowerThird(item.title or "", table.concat(sub, "  ·  "), Config.LowerThirdSeconds)
end

-- Wait for an asset to load, bail out if the channel moved on meanwhile.
local function waitLoaded(obj: any, token: number): boolean
	local t0 = os.clock()
	while not obj.IsLoaded do
		if token ~= state.token or os.clock() - t0 > Config.LoadTimeout then
			return false
		end
		task.wait(0.1)
	end
	return token == state.token
end

local function technicalDifficulties(ch: any)
	screen:showCard("trouble", ch.name, "TECHNICAL DIFFICULTIES", "Please stand by. Normal programming will resume shortly.")
end

local function tune(ch: any, item: any, startedAt: number)
	state.token += 1
	local token = state.token
	state.item = item
	state.startedAt = startedAt
	screen:stopMedia()
	screen:setCredit(nil)
	decor:setYear(ch.year or item.year)
	decor:setListings(ch, serverNow(), state.payload.anchor)
	describeNow(ch, item)

	if item.kind == "card" then
		screen:setBug(nil)
		screen:showCard(item.style, cardKicker(ch, item), item.title or "", item.text or "")
		return
	end

	screen:setBug(`CH {ch.number}  ·  {dayText(ch.year or item.year)}`)
	local media: any
	if item.kind == "video" then
		screen:showVideoLayer()
		media = screen.video
		media.Video = "rbxassetid://" .. item.assetId
	else
		screen:showRadio(item.title or "", longDate(item))
		media = screen.sound
		media.SoundId = "rbxassetid://" .. item.assetId
	end

	task.spawn(function()
		if not waitLoaded(media, token) then
			if token == state.token then
				technicalDifficulties(ch)
			end
			return
		end
		local pos = serverNow() - startedAt
		if pos >= item.duration - 0.25 then
			return
		end
		if pos > 0.4 then
			media.TimePosition = pos
		end
		media:Play()
		if item.credit then
			screen:setCredit(item.credit)
		end
		mediaLowerThird(item)
	end)
end

local function showOffAir()
	state.token += 1
	state.item = nil
	screen:stopMedia()
	screen:setBug(nil)
	local p = state.payload
	local when = if p then `{Broadcast.MONTHS[p.month]} {p.day}` else "today"
	screen:showTestPattern(`Programming for {when} has not been scheduled yet.`)
	decor:setYear(nil)
	decor:setListings(nil, 0, 0)
	remote:setChannel("This Day TV")
	describeNow(nil, nil)
end

local function updateChannelLabel()
	local ch = currentChannel()
	if ch then
		remote:setChannel(`{ch.name} · CH {ch.number}{if ch.year then ` · {ch.year}` else ""}`)
	end
end

local function refresh(force: boolean?)
	local ch = currentChannel()
	if not ch then
		if state.current ~= "off-air" then
			state.current = "off-air"
			showOffAir()
		end
		return
	end
	local now = serverNow()
	local idx, _, startedAt = Broadcast.locate(ch, now, state.payload.anchor)
	local item = ch.items[idx]
	local key = `{ch.number}|{idx}|{math.floor(startedAt + 0.5)}|{item.assetId or item.title or ""}`
	if force or key ~= state.current then
		state.current = key
		tune(ch, item, startedAt)
	end
end

local function applyPayload(json: string)
	local ok, payload = pcall(HttpService.JSONDecode, HttpService, json)
	if not ok or type(payload) ~= "table" then
		return
	end
	local previous = currentChannel()
	state.payload = payload
	decor:setDate(payload.month, payload.day)
	-- Stay on the same channel number across reloads if it still exists.
	state.channelIndex = 1
	local chs = channels()
	if chs and previous then
		for i, ch in chs do
			if ch.number == previous.number then
				state.channelIndex = i
			end
		end
	end
	updateChannelLabel()
	refresh() -- identity key means an unchanged item keeps playing untouched
end

local function changeChannel(delta: number)
	local chs = channels()
	if not chs or #chs == 0 then
		screen:snow(0.35)
		return
	end
	state.channelIndex = (state.channelIndex - 1 + delta) % #chs + 1
	updateChannelLabel()
	screen:snow(0.45)
	refresh(true)
end

-- Watch mode: settle the camera in front of the set.
local camera = workspace.CurrentCamera
local function setWatching(on: boolean)
	state.watching = on
	camera = workspace.CurrentCamera
	if on then
		camera.CameraType = Enum.CameraType.Scriptable
		local target = screenPart.Position
		local eye = target + screenPart.CFrame.LookVector * 6.6
		TweenService:Create(camera, TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			CFrame = CFrame.lookAt(eye, target),
			FieldOfView = 50,
		}):Play()
	else
		camera.FieldOfView = 70
		camera.CameraType = Enum.CameraType.Custom
	end
	remote:setWatching(on)
end

remote = Remote.new(player:WaitForChild("PlayerGui") :: PlayerGui, {
	onChannel = changeChannel,
	onMute = function()
		state.muted = not state.muted
		screen:setVolume(if state.muted then 0 else Config.Volume)
		return state.muted
	end,
	onWatch = function()
		setWatching(not state.watching)
		return state.watching
	end,
})

player.CharacterAdded:Connect(function()
	if state.watching then
		setWatching(false)
	end
end)

local prompt = station:FindFirstChild("ChannelPrompt", true) :: ProximityPrompt?
if prompt then
	prompt.Triggered:Connect(function()
		changeChannel(1)
	end)
end

screen:setVolume(Config.Volume)
broadcastValue.Changed:Connect(applyPayload)
if broadcastValue.Value ~= "" then
	applyPayload(broadcastValue.Value)
else
	showOffAir()
	state.current = "off-air"
end

-- Main loop: re-evaluate what's on, keep media in sync, refresh listings.
local accum, lastSync, lastListings = 0, 0, 0
RunService.Heartbeat:Connect(function(dt)
	accum += dt
	if accum < 0.2 then
		return
	end
	accum = 0
	if not state.payload then
		return
	end
	refresh()

	local now = os.clock()
	local item = state.item
	if item and item.kind ~= "card" and now - lastSync > 2 then
		lastSync = now
		local media: any = if item.kind == "video" then screen.video else screen.sound
		local expected = serverNow() - state.startedAt
		local playing = if item.kind == "video" then media.Playing else media.IsPlaying
		if playing and expected < item.duration - 1 and math.abs(media.TimePosition - expected) > Config.ResyncThreshold then
			media.TimePosition = expected
		end
	end
	if now - lastListings > 30 then
		lastListings = now
		local ch = currentChannel()
		if ch then
			decor:setListings(ch, serverNow(), state.payload.anchor)
		end
	end
end)
