-- On-screen "remote control": channel up/down, mute, and watch mode (camera
-- settles in front of the set). Keyboard: [ / ] change channel, M mutes, F
-- toggles watch mode. The TV's E prompt changes channel too.

local ContextActionService = game:GetService("ContextActionService")

local Remote = {}
Remote.__index = Remote

local WOOD = Color3.fromRGB(78, 50, 32)
local CREAM = Color3.fromRGB(245, 232, 200)
local ORANGE = Color3.fromRGB(214, 106, 44)

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

local function button(parent: Instance, text: string, order: number, width: number): TextButton
	return new("TextButton", {
		Parent = parent,
		LayoutOrder = order,
		Text = text,
		Font = Enum.Font.Oswald,
		TextSize = 20,
		TextColor3 = Color3.fromRGB(40, 26, 18),
		BackgroundColor3 = CREAM,
		AutoButtonColor = true,
		Size = UDim2.fromOffset(width, 44),
	}, {
		new("UICorner", { CornerRadius = UDim.new(0, 8) }),
		new("UIStroke", { Color = Color3.fromRGB(40, 26, 18), Thickness = 1.5, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }),
	})
end

export type Handlers = {
	onChannel: (delta: number) -> (),
	onMute: () -> boolean,
	onWatch: () -> boolean,
}

function Remote.new(playerGui: PlayerGui, handlers: Handlers)
	local self = setmetatable({}, Remote)
	local gui = new("ScreenGui", { Name = "ThisDayTVRemote", ResetOnSpawn = false, IgnoreGuiInset = false, ZIndexBehavior = Enum.ZIndexBehavior.Sibling, Parent = playerGui })

	local panel = new("Frame", {
		Parent = gui,
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -14),
		Size = UDim2.fromOffset(560, 64),
		BackgroundColor3 = WOOD,
	}, {
		new("UICorner", { CornerRadius = UDim.new(0, 14) }),
		new("UIStroke", { Color = Color3.fromRGB(40, 26, 18), Thickness = 2 }),
		new("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10) }),
		new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, VerticalAlignment = Enum.VerticalAlignment.Center, HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
		new("UISizeConstraint", { MaxSize = Vector2.new(560, 64) }),
	})
	-- Shrink on narrow (phone) screens.
	local scale = new("UIScale", { Parent = panel })
	local function rescale()
		local cam = workspace.CurrentCamera
		if cam then
			scale.Scale = math.clamp((cam.ViewportSize.X - 16) / 560, 0.5, 1)
		end
	end
	rescale()
	if workspace.CurrentCamera then
		workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)
	end

	local down = button(panel, "◀ CH", 1, 64)
	local info = new("Frame", { Parent = panel, LayoutOrder = 2, BackgroundTransparency = 1, Size = UDim2.fromOffset(250, 52) })
	self.channelLabel = new("TextLabel", { Parent = info, BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 26), Font = Enum.Font.Oswald, TextSize = 22, TextColor3 = ORANGE, Text = "WTDI · CH 4", TextTruncate = Enum.TextTruncate.AtEnd })
	self.nowLabel = new("TextLabel", { Parent = info, BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 26), Size = UDim2.new(1, 0, 0, 24), Font = Enum.Font.Garamond, TextSize = 18, TextColor3 = CREAM, Text = "", TextTruncate = Enum.TextTruncate.AtEnd })
	local up = button(panel, "CH ▶", 3, 64)
	local mute = button(panel, "🔊", 4, 48)
	local watch = button(panel, "Watch", 5, 70)

	down.Activated:Connect(function()
		handlers.onChannel(-1)
	end)
	up.Activated:Connect(function()
		handlers.onChannel(1)
	end)
	local function doMute()
		mute.Text = if handlers.onMute() then "🔇" else "🔊"
	end
	local function doWatch()
		watch.Text = if handlers.onWatch() then "Leave" else "Watch"
	end
	mute.Activated:Connect(doMute)
	watch.Activated:Connect(doWatch)
	self.watchButton = watch

	ContextActionService:BindAction("ThisDayTV_ChannelDown", function(_, s)
		if s == Enum.UserInputState.Begin then
			handlers.onChannel(-1)
		end
		return Enum.ContextActionResult.Pass
	end, false, Enum.KeyCode.LeftBracket, Enum.KeyCode.PageDown)
	ContextActionService:BindAction("ThisDayTV_ChannelUp", function(_, s)
		if s == Enum.UserInputState.Begin then
			handlers.onChannel(1)
		end
		return Enum.ContextActionResult.Pass
	end, false, Enum.KeyCode.RightBracket, Enum.KeyCode.PageUp)
	ContextActionService:BindAction("ThisDayTV_Mute", function(_, s)
		if s == Enum.UserInputState.Begin then
			doMute()
		end
		return Enum.ContextActionResult.Pass
	end, false, Enum.KeyCode.M)
	ContextActionService:BindAction("ThisDayTV_Watch", function(_, s)
		if s == Enum.UserInputState.Begin then
			doWatch()
		end
		return Enum.ContextActionResult.Pass
	end, false, Enum.KeyCode.F)

	return self
end

function Remote:setChannel(text: string)
	self.channelLabel.Text = text
end

function Remote:setNow(text: string)
	self.nowLabel.Text = text
end

function Remote:setWatching(on: boolean)
	self.watchButton.Text = if on then "Leave" else "Watch"
end

return Remote
