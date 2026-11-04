-- The picture tube: a local SurfaceGui on TVStation.TV.Screen with layers for
-- video, audio ("radio"), text cards, test pattern, static and on-screen graphics.
-- Parented directly to the part so VideoFrame/Sound audio is 3D from the TV.

local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local Screen = {}
Screen.__index = Screen

local W, H = 640, 480

local function new(className: string, props: { [string]: any }, children: { Instance }?): any
	local inst = Instance.new(className)
	for k, v in props do
		if k ~= "Parent" then
			(inst :: any)[k] = v
		end
	end
	for _, c in children or {} do
		c.Parent = inst
	end
	if props.Parent then
		inst.Parent = props.Parent
	end
	return inst
end

local function full(props: { [string]: any }): { [string]: any }
	props.Size = props.Size or UDim2.fromScale(1, 1)
	props.BorderSizePixel = 0
	return props
end

local function label(props: { [string]: any }): TextLabel
	props.BackgroundTransparency = props.BackgroundTransparency or 1
	props.TextWrapped = if props.TextWrapped == nil then true else props.TextWrapped
	props.TextColor3 = props.TextColor3 or Color3.new(1, 1, 1)
	props.BorderSizePixel = 0
	return new("TextLabel", props)
end

local CARD_THEMES = {
	["station-id"] = { bg = Color3.fromRGB(18, 34, 74), bg2 = Color3.fromRGB(8, 14, 34), ink = Color3.fromRGB(255, 236, 190), accent = Color3.fromRGB(230, 120, 40), titleFont = Enum.Font.Bodoni, bodyFont = Enum.Font.Garamond },
	headline = { bg = Color3.fromRGB(238, 230, 210), bg2 = Color3.fromRGB(214, 204, 180), ink = Color3.fromRGB(30, 26, 22), accent = Color3.fromRGB(120, 24, 20), titleFont = Enum.Font.Garamond, bodyFont = Enum.Font.Merriweather },
	["break"] = { bg = Color3.fromRGB(226, 120, 40), bg2 = Color3.fromRGB(200, 70, 40), ink = Color3.fromRGB(255, 248, 225), accent = Color3.fromRGB(40, 110, 110), titleFont = Enum.Font.FredokaOne, bodyFont = Enum.Font.FredokaOne },
	["sign-off"] = { bg = Color3.fromRGB(10, 10, 12), bg2 = Color3.fromRGB(30, 30, 40), ink = Color3.fromRGB(230, 230, 230), accent = Color3.fromRGB(200, 170, 90), titleFont = Enum.Font.Bodoni, bodyFont = Enum.Font.Garamond },
	custom = { bg = Color3.fromRGB(30, 80, 80), bg2 = Color3.fromRGB(14, 40, 44), ink = Color3.fromRGB(245, 235, 210), accent = Color3.fromRGB(230, 170, 50), titleFont = Enum.Font.Oswald, bodyFont = Enum.Font.Garamond },
	trouble = { bg = Color3.fromRGB(20, 20, 20), bg2 = Color3.fromRGB(50, 50, 50), ink = Color3.fromRGB(255, 255, 255), accent = Color3.fromRGB(220, 50, 50), titleFont = Enum.Font.Oswald, bodyFont = Enum.Font.Oswald },
}
Screen.CARD_THEMES = CARD_THEMES

local SMPTE_TOP = { { 192, 192, 192 }, { 192, 192, 0 }, { 0, 192, 192 }, { 0, 192, 0 }, { 192, 0, 192 }, { 192, 0, 0 }, { 0, 0, 192 } }
local SMPTE_MID = { { 0, 0, 192 }, { 19, 19, 19 }, { 192, 0, 192 }, { 19, 19, 19 }, { 0, 192, 192 }, { 19, 19, 19 }, { 192, 192, 192 } }
local SMPTE_LOW = { { 0, 33, 76, 5 / 28 }, { 255, 255, 255, 5 / 28 }, { 50, 0, 106, 5 / 28 }, { 19, 19, 19, 13 / 28 } }

function Screen.new(part: BasePart)
	local self = setmetatable({}, Screen)
	self.part = part

	local gui = new("SurfaceGui", {
		Name = "ThisDayTVPicture",
		Face = Enum.NormalId.Front,
		SizingMode = Enum.SurfaceGuiSizingMode.FixedSize,
		CanvasSize = Vector2.new(W, H),
		LightInfluence = 0,
		Brightness = 1.25,
		ClipsDescendants = true,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		ResetOnSpawn = false,
		MaxDistance = 250,
	})
	self.gui = gui

	new("Frame", full({ Name = "Black", BackgroundColor3 = Color3.new(0, 0, 0), ZIndex = 1, Parent = gui }))

	self.video = new("VideoFrame", full({ Name = "Video", BackgroundTransparency = 1, Visible = false, Looped = false, ZIndex = 2, Parent = gui }))

	-- Audio-only programming: a radio-style slate.
	self.radio = new("Frame", full({ Name = "Radio", BackgroundColor3 = Color3.fromRGB(44, 30, 22), Visible = false, ZIndex = 3, Parent = gui }), {
		new("UIGradient", { Rotation = 90, Color = ColorSequence.new(Color3.fromRGB(70, 46, 30), Color3.fromRGB(24, 16, 12)) }),
	})
	label({ Name = "OnAir", Parent = self.radio, Text = "ON THE AIR", Font = Enum.Font.Oswald, TextSize = 26, TextColor3 = Color3.fromRGB(255, 90, 60), Position = UDim2.fromOffset(0, 70), Size = UDim2.new(1, 0, 0, 34), ZIndex = 4 })
	self.radioTitle = label({ Name = "Title", Parent = self.radio, Text = "", Font = Enum.Font.Bodoni, TextSize = 40, TextColor3 = Color3.fromRGB(255, 236, 190), Position = UDim2.fromOffset(40, 130), Size = UDim2.new(1, -80, 0, 140), ZIndex = 4 })
	self.radioSub = label({ Name = "Sub", Parent = self.radio, Text = "", Font = Enum.Font.Garamond, TextSize = 26, TextColor3 = Color3.fromRGB(220, 200, 160), Position = UDim2.fromOffset(40, 290), Size = UDim2.new(1, -80, 0, 40), ZIndex = 4 })
	self.radioBars = {}
	for i = 1, 24 do
		self.radioBars[i] = new("Frame", { Parent = self.radio, BackgroundColor3 = Color3.fromRGB(230, 160, 60), BorderSizePixel = 0, AnchorPoint = Vector2.new(0, 1), Position = UDim2.fromOffset(80 + (i - 1) * 20, 420), Size = UDim2.fromOffset(12, 10), ZIndex = 4 })
	end

	-- Text cards.
	self.card = new("Frame", full({ Name = "Card", Visible = false, ZIndex = 5, Parent = gui }))
	self.cardGradient = new("UIGradient", { Rotation = 90, Parent = self.card })
	self.cardRule = new("Frame", { Parent = self.card, BorderSizePixel = 0, Position = UDim2.fromOffset(60, 150), Size = UDim2.new(1, -120, 0, 4), ZIndex = 6 })
	self.cardKicker = label({ Name = "Kicker", Parent = self.card, Text = "", TextSize = 22, Position = UDim2.fromOffset(60, 60), Size = UDim2.new(1, -120, 0, 28), ZIndex = 6, TextXAlignment = Enum.TextXAlignment.Left })
	self.cardTitle = label({ Name = "Title", Parent = self.card, Text = "", TextSize = 44, Position = UDim2.fromOffset(60, 88), Size = UDim2.new(1, -120, 0, 60), ZIndex = 6, TextScaled = true, TextXAlignment = Enum.TextXAlignment.Left })
	new("UITextSizeConstraint", { MaxTextSize = 48, Parent = self.cardTitle })
	self.cardBody = label({ Name = "Body", Parent = self.card, Text = "", TextSize = 30, Position = UDim2.fromOffset(60, 172), Size = UDim2.new(1, -120, 0, 250), ZIndex = 6, TextScaled = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top })
	new("UITextSizeConstraint", { MaxTextSize = 34, MinTextSize = 14, Parent = self.cardBody })

	-- Test pattern (SMPTE-style colour bars).
	self.pattern = new("Frame", full({ Name = "TestPattern", BackgroundColor3 = Color3.new(0, 0, 0), Visible = false, ZIndex = 7, Parent = gui }))
	for i, c in SMPTE_TOP do
		new("Frame", { Parent = self.pattern, BorderSizePixel = 0, BackgroundColor3 = Color3.fromRGB(c[1], c[2], c[3]), Position = UDim2.fromScale((i - 1) / 7, 0), Size = UDim2.fromScale(1 / 7 + 0.002, 0.67), ZIndex = 7 })
	end
	for i, c in SMPTE_MID do
		new("Frame", { Parent = self.pattern, BorderSizePixel = 0, BackgroundColor3 = Color3.fromRGB(c[1], c[2], c[3]), Position = UDim2.fromScale((i - 1) / 7, 0.67), Size = UDim2.fromScale(1 / 7 + 0.002, 0.08), ZIndex = 7 })
	end
	local x = 0
	for _, c in SMPTE_LOW do
		new("Frame", { Parent = self.pattern, BorderSizePixel = 0, BackgroundColor3 = Color3.fromRGB(c[1], c[2], c[3]), Position = UDim2.fromScale(x, 0.75), Size = UDim2.fromScale(c[4] + 0.002, 0.25), ZIndex = 7 })
		x += c[4]
	end
	local slate = new("Frame", { Parent = self.pattern, BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.15, BorderSizePixel = 0, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.42), Size = UDim2.fromOffset(470, 150), ZIndex = 8 })
	label({ Parent = slate, Text = "PLEASE STAND BY", Font = Enum.Font.Oswald, TextSize = 46, Size = UDim2.new(1, 0, 0, 70), Position = UDim2.fromOffset(0, 12), ZIndex = 9 })
	self.patternSub = label({ Parent = slate, Text = "", Font = Enum.Font.Garamond, TextSize = 22, Size = UDim2.new(1, -30, 0, 60), Position = UDim2.fromOffset(15, 80), ZIndex = 9 })

	-- Snow between channels.
	self.static = new("Frame", full({ Name = "Static", BackgroundColor3 = Color3.fromRGB(90, 90, 90), Visible = false, ZIndex = 20, Parent = gui }))
	self.staticCells = {}
	local cols, rows = 32, 24
	for r = 0, rows - 1 do
		for c = 0, cols - 1 do
			table.insert(self.staticCells, new("Frame", { Parent = self.static, BorderSizePixel = 0, Position = UDim2.fromScale(c / cols, r / rows), Size = UDim2.fromScale(1 / cols + 0.001, 1 / rows + 0.001), ZIndex = 20 }))
		end
	end

	-- Station bug (top right) and lower third.
	self.bug = new("Frame", { Name = "Bug", Parent = gui, BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.45, BorderSizePixel = 0, AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -16, 0, 14), Size = UDim2.fromOffset(170, 34), ZIndex = 15, Visible = false }, {
		new("UICorner", { CornerRadius = UDim.new(0, 6) }),
	})
	self.bugText = label({ Parent = self.bug, Text = "", Font = Enum.Font.Oswald, TextSize = 20, Size = UDim2.fromScale(1, 1), ZIndex = 16 })

	self.lower = new("Frame", { Name = "LowerThird", Parent = gui, BackgroundColor3 = Color3.fromRGB(16, 30, 60), BackgroundTransparency = 0.12, BorderSizePixel = 0, Position = UDim2.new(0, 24, 1, -112), Size = UDim2.new(1, -48, 0, 78), ZIndex = 15, Visible = false }, {
		new("UICorner", { CornerRadius = UDim.new(0, 4) }),
		new("Frame", { BackgroundColor3 = Color3.fromRGB(230, 120, 40), BorderSizePixel = 0, Size = UDim2.new(0, 8, 1, 0), ZIndex = 16 }),
	})
	self.lowerTitle = label({ Parent = self.lower, Text = "", Font = Enum.Font.Oswald, TextSize = 28, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, TextWrapped = false, Position = UDim2.fromOffset(22, 8), Size = UDim2.new(1, -34, 0, 34), ZIndex = 16 })
	self.lowerSub = label({ Parent = self.lower, Text = "", Font = Enum.Font.Garamond, TextSize = 22, TextColor3 = Color3.fromRGB(230, 220, 190), TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, TextWrapped = false, Position = UDim2.fromOffset(22, 42), Size = UDim2.new(1, -34, 0, 28), ZIndex = 16 })

	self.credit = label({ Name = "Credit", Parent = gui, Text = "", Font = Enum.Font.Gotham, TextSize = 13, TextColor3 = Color3.fromRGB(220, 220, 220), TextTransparency = 0.35, TextXAlignment = Enum.TextXAlignment.Left, Position = UDim2.new(0, 14, 1, -24), Size = UDim2.new(1, -28, 0, 18), ZIndex = 15, TextWrapped = false })

	-- Glass: a soft highlight and darkened edges, CRT-style.
	new("Frame", full({ Name = "Glass", Parent = gui, BackgroundColor3 = Color3.new(1, 1, 1), ZIndex = 30, BackgroundTransparency = 0 }), {
		new("UIGradient", {
			Rotation = 70,
			Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.88), NumberSequenceKeypoint.new(0.35, 0.97), NumberSequenceKeypoint.new(1, 1) }),
		}),
	})
	for _, spec in { { 0, 90 }, { 1, 270 } } do
		new("Frame", { Parent = gui, BackgroundColor3 = Color3.new(0, 0, 0), BorderSizePixel = 0, Position = UDim2.fromScale(0, 0), Size = UDim2.fromScale(1, 1), ZIndex = 31 }, {
			new("UIGradient", {
				Rotation = spec[2],
				Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.55), NumberSequenceKeypoint.new(0.12, 1), NumberSequenceKeypoint.new(1, 1) }),
			}),
		})
	end

	self.sound = new("Sound", { Name = "ThisDayTVAudio", RollOffMode = Enum.RollOffMode.InverseTapered, RollOffMinDistance = 10, RollOffMaxDistance = 90, Parent = part })
	self.video.RollOffMode = Enum.RollOffMode.InverseTapered
	self.video.RollOffMinDistance = 10
	self.video.RollOffMaxDistance = 90

	gui.Parent = part
	self.glow = part:FindFirstChild("Glow") :: SurfaceLight?
	self.lowerToken = 0

	RunService.RenderStepped:Connect(function()
		if self.radio.Visible then
			local t = os.clock()
			for i, bar in self.radioBars do
				local hgt = 10 + math.abs(math.sin(t * (3 + i % 5) + i)) * (40 + (i % 3) * 25)
				bar.Size = UDim2.fromOffset(12, hgt)
			end
		end
	end)
	return self
end

function Screen:setGlow(color: Color3)
	if self.glow then
		TweenService:Create(self.glow, TweenInfo.new(0.6), { Color = color }):Play()
	end
end

function Screen:hideAll()
	self.video.Visible = false
	self.radio.Visible = false
	self.card.Visible = false
	self.pattern.Visible = false
	self.lower.Visible = false
	self.credit.Text = ""
end

function Screen:stopMedia()
	pcall(function()
		self.video:Pause()
	end)
	self.video.Video = "" -- frees the decoder, per Roblox guidance
	self.sound:Stop()
	self.sound.SoundId = ""
end

function Screen:setVolume(v: number)
	self.video.Volume = v
	self.sound.Volume = v
end

function Screen:showCard(style: string?, kicker: string, title: string, body: string)
	local theme = CARD_THEMES[style or "custom"] or CARD_THEMES.custom
	self:hideAll()
	self.card.BackgroundColor3 = Color3.new(1, 1, 1)
	self.cardGradient.Color = ColorSequence.new(theme.bg, theme.bg2)
	self.cardRule.BackgroundColor3 = theme.accent
	self.cardKicker.Font = theme.bodyFont
	self.cardKicker.TextColor3 = theme.accent
	self.cardKicker.Text = string.upper(kicker)
	self.cardTitle.Font = theme.titleFont
	self.cardTitle.TextColor3 = theme.ink
	self.cardTitle.Text = title
	self.cardBody.Font = theme.bodyFont
	self.cardBody.TextColor3 = theme.ink
	self.cardBody.Text = body
	self.card.Visible = true
	self:setGlow(theme.bg:Lerp(Color3.new(1, 1, 1), 0.4))
end

function Screen:showTestPattern(sub: string)
	self:hideAll()
	self.patternSub.Text = sub
	self.pattern.Visible = true
	self:setGlow(Color3.fromRGB(210, 210, 255))
end

function Screen:showRadio(title: string, sub: string)
	self:hideAll()
	self.radioTitle.Text = title
	self.radioSub.Text = sub
	self.radio.Visible = true
	self:setGlow(Color3.fromRGB(255, 190, 120))
end

function Screen:showVideoLayer()
	self:hideAll()
	self.video.Visible = true
	self:setGlow(Color3.fromRGB(190, 210, 255))
end

function Screen:setBug(text: string?)
	self.bug.Visible = text ~= nil and text ~= ""
	self.bugText.Text = text or ""
end

function Screen:setCredit(text: string?)
	self.credit.Text = text or ""
end

function Screen:showLowerThird(title: string, sub: string, seconds: number)
	self.lowerToken += 1
	local token = self.lowerToken
	self.lowerTitle.Text = title
	self.lowerSub.Text = sub
	self.lower.Visible = true
	task.delay(seconds, function()
		if self.lowerToken == token then
			self.lower.Visible = false
		end
	end)
end

-- Channel-change snow, `seconds` long. Runs alongside whatever loads beneath.
function Screen:snow(seconds: number)
	self.static.Visible = true
	local untilT = os.clock() + seconds
	local conn
	conn = RunService.RenderStepped:Connect(function()
		if os.clock() >= untilT then
			conn:Disconnect()
			self.static.Visible = false
			return
		end
		for _, cell in self.staticCells do
			local v = math.random(20, 235)
			cell.BackgroundColor3 = Color3.fromRGB(v, v, v)
		end
	end)
end

return Screen
