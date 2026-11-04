-- Wall calendar (its year flips to whatever year is on the TV) and the
-- listings board (what's coming up on the channel you're watching).
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Broadcast = require(ReplicatedStorage:WaitForChild("ThisDayTV"):WaitForChild("Broadcast"))

local Decor = {}
Decor.__index = Decor

local function new(className: string, props: { [string]: any }): any
	local inst = Instance.new(className)
	for k, v in props do
		if k ~= "Parent" then
			(inst :: any)[k] = v
		end
	end
	inst.Parent = props.Parent
	return inst
end

local function surface(part: BasePart, w: number, h: number): SurfaceGui
	return new("SurfaceGui", {
		Parent = part,
		Face = Enum.NormalId.Front,
		SizingMode = Enum.SurfaceGuiSizingMode.FixedSize,
		CanvasSize = Vector2.new(w, h),
		LightInfluence = 0.6,
		MaxDistance = 120,
	})
end

function Decor.new(station: Instance)
	local self = setmetatable({}, Decor)
	local cal = station:FindFirstChild("Calendar") :: BasePart?
	if cal then
		local g = surface(cal, 260, 340)
		new("Frame", { Parent = g, BackgroundColor3 = Color3.fromRGB(176, 40, 32), BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 70) })
		self.calMonth = new("TextLabel", { Parent = g, BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 70), Font = Enum.Font.Oswald, TextSize = 40, TextColor3 = Color3.new(1, 1, 1), Text = "" })
		self.calDay = new("TextLabel", { Parent = g, BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 70), Size = UDim2.new(1, 0, 0, 170), Font = Enum.Font.Bodoni, TextSize = 150, TextColor3 = Color3.fromRGB(30, 26, 22), Text = "" })
		self.calYear = new("TextLabel", { Parent = g, BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 240), Size = UDim2.new(1, 0, 0, 60), Font = Enum.Font.Garamond, TextSize = 52, TextColor3 = Color3.fromRGB(176, 40, 32), Text = "19__" })
		new("TextLabel", { Parent = g, BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 300), Size = UDim2.new(1, 0, 0, 30), Font = Enum.Font.Garamond, TextSize = 20, TextColor3 = Color3.fromRGB(110, 100, 90), Text = "the year on your screen" })
	end

	local board = station:FindFirstChild("Listings") :: BasePart?
	if board then
		local g = surface(board, 460, 500)
		local paper = new("Frame", { Parent = g, BackgroundColor3 = Color3.fromRGB(250, 244, 226), BorderSizePixel = 0, Position = UDim2.fromOffset(20, 20), Size = UDim2.new(1, -40, 1, -40), Rotation = -1 })
		self.listTitle = new("TextLabel", { Parent = paper, BackgroundTransparency = 1, Position = UDim2.fromOffset(16, 10), Size = UDim2.new(1, -32, 0, 44), Font = Enum.Font.Oswald, TextSize = 30, TextColor3 = Color3.fromRGB(176, 40, 32), Text = "TONIGHT'S LISTINGS", TextXAlignment = Enum.TextXAlignment.Left })
		new("Frame", { Parent = paper, BackgroundColor3 = Color3.fromRGB(30, 26, 22), BorderSizePixel = 0, Position = UDim2.fromOffset(16, 56), Size = UDim2.new(1, -32, 0, 3) })
		self.rows = {}
		for i = 1, 8 do
			local y = 66 + (i - 1) * 46
			local time = new("TextLabel", { Parent = paper, BackgroundTransparency = 1, Position = UDim2.fromOffset(16, y), Size = UDim2.fromOffset(92, 42), Font = Enum.Font.Oswald, TextSize = 20, TextColor3 = Color3.fromRGB(30, 26, 22), TextXAlignment = Enum.TextXAlignment.Left, Text = "" })
			local title = new("TextLabel", { Parent = paper, BackgroundTransparency = 1, Position = UDim2.fromOffset(110, y), Size = UDim2.new(1, -126, 0, 42), Font = Enum.Font.Garamond, TextSize = 21, TextColor3 = Color3.fromRGB(30, 26, 22), TextXAlignment = Enum.TextXAlignment.Left, TextWrapped = true, TextTruncate = Enum.TextTruncate.AtEnd, Text = "" })
			self.rows[i] = { time = time, title = title }
		end
	end
	return self
end

function Decor:setDate(month: number?, day: number?)
	if self.calMonth then
		self.calMonth.Text = if month then string.upper(Broadcast.MONTHS[month]) else ""
		self.calDay.Text = if day then tostring(day) else ""
	end
end

function Decor:setYear(year: number?)
	if self.calYear then
		self.calYear.Text = if year then tostring(year) else "19__"
	end
end

local function listingTitle(item: any): string?
	if item.kind == "card" then
		if item.style == "break" then
			return nil
		end
		return item.title
	end
	if item.category == "commercial" then
		return nil
	end
	local t = item.title or "Untitled"
	if item.year then
		t ..= ` ({item.year})`
	end
	return t
end

function Decor:setListings(channel: any?, now: number, anchor: number)
	if not self.rows then
		return
	end
	local entries = {}
	if channel then
		self.listTitle.Text = `ON CH {channel.number} · {channel.name}`
		local last: string? = nil
		for _, u in Broadcast.upcoming(channel, now, anchor, math.min(#channel.items, 80)) do
			local title = listingTitle(u.item)
			if title and title ~= last then
				table.insert(entries, { time = Broadcast.localClock(u.startsAt), title = title })
				last = title
			end
			if #entries >= #self.rows then
				break
			end
		end
	else
		self.listTitle.Text = "TONIGHT'S LISTINGS"
	end
	for i, row in self.rows do
		local e = entries[i]
		row.time.Text = if e then e.time else ""
		row.title.Text = if e then e.title else (if i == 1 and not channel then "No programming scheduled" else "")
	end
end

return Decor
