-- Builds the 1960s living room in code, so the project needs no binary place
-- file. Skipped if workspace already has a "TVStation" (e.g. you built your own;
-- just keep a TVStation.TV.Screen part whose Front face is the picture tube,
-- plus optional TVStation.Calendar and TVStation.Listings parts).

local Lighting = game:GetService("Lighting")

local WorldBuilder = {}

local WALNUT = Color3.fromRGB(92, 58, 36)
local DARK_WALNUT = Color3.fromRGB(64, 40, 26)
local AVOCADO = Color3.fromRGB(112, 122, 52)
local HARVEST_GOLD = Color3.fromRGB(218, 165, 32)
local BURNT_ORANGE = Color3.fromRGB(196, 98, 38)
local WALLPAPER = Color3.fromRGB(222, 196, 128)
local CREAM = Color3.fromRGB(240, 228, 200)

local function part(parent: Instance, props: { [string]: any }): BasePart
	local className = props.ClassName or "Part"
	local p = Instance.new(className) :: BasePart
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in props do
		if k ~= "ClassName" and k ~= "Shape" then
			(p :: any)[k] = v
		end
	end
	if props.Shape then
		(p :: any).Shape = props.Shape
	end
	p.Parent = parent
	return p
end

local function model(parent: Instance, name: string): Model
	local m = Instance.new("Model")
	m.Name = name
	m.Parent = parent
	return m
end

-- Cylinder standing upright (Roblox cylinders run along X by default).
local function upright(cf: CFrame): CFrame
	return cf * CFrame.Angles(0, 0, math.rad(90))
end

local function buildRoom(root: Model)
	local room = model(root, "Room")
	part(room, { Name = "Floor", Size = Vector3.new(44, 1, 34), CFrame = CFrame.new(0, -0.5, 0), Material = Enum.Material.WoodPlanks, Color = Color3.fromRGB(122, 82, 50) })
	part(room, { Name = "ShagRug", Size = Vector3.new(20, 0.2, 13), CFrame = CFrame.new(0, 0.1, 1), Material = Enum.Material.Fabric, Color = BURNT_ORANGE })
	part(room, { Name = "Ceiling", Size = Vector3.new(44, 1, 34), CFrame = CFrame.new(0, 14.5, 0), Color = CREAM })

	local walls = {
		{ "NorthWall", Vector3.new(44, 14, 1), Vector3.new(0, 7, -17.5), Vector3.new(0, 0, 1) },
		{ "SouthWall", Vector3.new(44, 14, 1), Vector3.new(0, 7, 17.5), Vector3.new(0, 0, -1) },
		{ "WestWall", Vector3.new(1, 14, 34), Vector3.new(-22.5, 7, 0), Vector3.new(1, 0, 0) },
		{ "EastWall", Vector3.new(1, 14, 34), Vector3.new(22.5, 7, 0), Vector3.new(-1, 0, 0) },
	}
	for _, w in walls do
		local name, size, pos, inward = w[1], w[2], w[3], w[4]
		part(room, { Name = name, Size = size, CFrame = CFrame.new(pos), Material = Enum.Material.Fabric, Color = WALLPAPER })
		-- Wood paneling on the lower half, slightly proud of the wall.
		local panelSize = Vector3.new(if size.X > 1 then size.X - 2 else 0.2, 5, if size.Z > 1 then size.Z - 2 else 0.2)
		part(room, { Name = name .. "Paneling", Size = panelSize, CFrame = CFrame.new(Vector3.new(pos.X, 2.5, pos.Z) + inward * 0.6), Material = Enum.Material.Wood, Color = DARK_WALNUT })
		part(room, { Name = name .. "ChairRail", Size = panelSize + Vector3.new(0, -4.7, 0) + Vector3.new(if size.X > 1 then 0 else 0.15, 0, if size.Z > 1 then 0 else 0.15), CFrame = CFrame.new(Vector3.new(pos.X, 5.1, pos.Z) + inward * 0.7), Material = Enum.Material.Wood, Color = WALNUT })
	end

	-- Night-time window on the east wall, with curtains.
	part(room, { Name = "WindowFrame", Size = Vector3.new(0.4, 6.4, 8.4), CFrame = CFrame.new(21.85, 8, -2), Material = Enum.Material.Wood, Color = CREAM })
	local glass = part(room, { Name = "WindowGlass", Size = Vector3.new(0.2, 6, 8), CFrame = CFrame.new(21.6, 8, -2), Material = Enum.Material.Neon, Color = Color3.fromRGB(24, 32, 70), Transparency = 0.15 })
	glass.CastShadow = false
	part(room, { Name = "WindowMullion", Size = Vector3.new(0.3, 6, 0.25), CFrame = CFrame.new(21.5, 8, -2), Color = CREAM })
	part(room, { Name = "WindowTransom", Size = Vector3.new(0.3, 0.25, 8), CFrame = CFrame.new(21.5, 8, -2), Color = CREAM })
	for _, z in { -7, 3 } do
		part(room, { Name = "Curtain", Size = Vector3.new(0.4, 8, 2.4), CFrame = CFrame.new(21.2, 7.6, z), Material = Enum.Material.Fabric, Color = HARVEST_GOLD })
	end

	-- Door on the south wall (decor).
	part(room, { Name = "Door", Size = Vector3.new(4.5, 9, 0.3), CFrame = CFrame.new(14, 4.5, 16.85), Material = Enum.Material.Wood, Color = WALNUT })
	part(room, { Name = "DoorKnob", Shape = Enum.PartType.Ball, Size = Vector3.new(0.4, 0.4, 0.4), CFrame = CFrame.new(12.3, 4.3, 16.6), Material = Enum.Material.Metal, Color = HARVEST_GOLD })

	-- Framed art.
	for i, spec in { { -15, Color3.fromRGB(46, 110, 120) }, { 15, Color3.fromRGB(180, 70, 50) } } do
		part(room, { Name = "Frame" .. i, Size = Vector3.new(3.6, 2.8, 0.2), CFrame = CFrame.new(spec[1], 9.2, -16.85), Material = Enum.Material.Wood, Color = HARVEST_GOLD })
		part(room, { Name = "Art" .. i, Size = Vector3.new(3, 2.2, 0.1), CFrame = CFrame.new(spec[1], 9.2, -16.72), Color = spec[2] })
	end
end

local function buildTV(root: Model): BasePart
	local tv = model(root, "TV")
	local cabinetCF = CFrame.new(0, 3.2, -14.6)
	part(tv, { Name = "Cabinet", Size = Vector3.new(10, 4.4, 3.4), CFrame = cabinetCF, Material = Enum.Material.Wood, Color = WALNUT })
	part(tv, { Name = "CabinetTop", Size = Vector3.new(10.4, 0.25, 3.7), CFrame = cabinetCF * CFrame.new(0, 2.3, 0), Material = Enum.Material.Wood, Color = DARK_WALNUT })
	for _, x in { -4.4, 4.4 } do
		for _, z in { -1.2, 1.2 } do
			part(tv, { Name = "Leg", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1, 0.35, 0.35), CFrame = upright(CFrame.new(x, 0.5, -14.6 + z)), Material = Enum.Material.Wood, Color = DARK_WALNUT })
		end
	end

	local front = -14.6 + 1.7 -- cabinet front face z
	part(tv, { Name = "Bezel", Size = Vector3.new(6.1, 4.0, 0.12), CFrame = CFrame.new(-1.6, 3.25, front + 0.06), Color = Color3.fromRGB(38, 34, 30) })
	-- 4:3 picture tube. Its Front face (local -Z) points into the room.
	local screenPos = Vector3.new(-1.6, 3.25, front + 0.14)
	local screen = part(tv, {
		Name = "Screen",
		Size = Vector3.new(5.2, 3.9, 0.05),
		CFrame = CFrame.lookAt(screenPos, screenPos + Vector3.new(0, 0, 1)),
		Color = Color3.fromRGB(12, 14, 14),
		Material = Enum.Material.Glass,
		Reflectance = 0.05,
	})
	screen.CastShadow = false
	local glow = Instance.new("SurfaceLight")
	glow.Name = "Glow"
	glow.Face = Enum.NormalId.Front
	glow.Angle = 100
	glow.Range = 16
	glow.Brightness = 1.4
	glow.Color = Color3.fromRGB(190, 210, 255)
	glow.Shadows = true
	glow.Parent = screen

	part(tv, { Name = "SpeakerGrille", Size = Vector3.new(2.4, 2.4, 0.1), CFrame = CFrame.new(3.4, 2.6, front + 0.05), Material = Enum.Material.Fabric, Color = Color3.fromRGB(196, 176, 140) })
	for i, x in { 2.8, 4.0 } do
		part(tv, {
			Name = "Knob" .. i,
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(0.35, 0.7, 0.7),
			CFrame = CFrame.new(x, 4.55, front + 0.17) * CFrame.Angles(0, math.rad(90), 0),
			Color = Color3.fromRGB(30, 26, 22),
		})
	end
	part(tv, { Name = "BrandPlate", Size = Vector3.new(1.4, 0.25, 0.05), CFrame = CFrame.new(-1.6, 1.12, front + 0.03), Material = Enum.Material.Metal, Color = HARVEST_GOLD })

	-- Rabbit ears.
	local base = Vector3.new(0.5, 5.65, -14.8)
	part(tv, { Name = "AntennaBase", Shape = Enum.PartType.Ball, Size = Vector3.new(0.9, 0.9, 0.9), CFrame = CFrame.new(base), Color = Color3.fromRGB(30, 26, 22) })
	for i, tilt in { 28, -28 } do
		local cf = CFrame.new(base) * CFrame.Angles(math.rad(-8), 0, math.rad(tilt)) * CFrame.new(0, 2.2, 0)
		part(tv, { Name = "Antenna" .. i, Shape = Enum.PartType.Cylinder, Size = Vector3.new(4.4, 0.08, 0.08), CFrame = upright(cf), Material = Enum.Material.Metal, Color = Color3.fromRGB(200, 200, 205) })
	end

	local prompt = Instance.new("ProximityPrompt")
	prompt.Name = "ChannelPrompt"
	prompt.ActionText = "Change channel"
	prompt.ObjectText = "Television"
	prompt.KeyboardKeyCode = Enum.KeyCode.E
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.Parent = tv:FindFirstChild("Cabinet")

	return screen
end

local function buildFurniture(root: Model)
	local furn = model(root, "Furniture")

	-- Couch facing the TV.
	local couchZ = 7
	part(furn, { Name = "CouchBase", Size = Vector3.new(12, 1.4, 4), CFrame = CFrame.new(0, 1.0, couchZ), Material = Enum.Material.Fabric, Color = AVOCADO })
	part(furn, { Name = "CouchBack", Size = Vector3.new(12, 3.4, 1.2), CFrame = CFrame.new(0, 3.1, couchZ + 1.6) * CFrame.Angles(math.rad(-8), 0, 0), Material = Enum.Material.Fabric, Color = AVOCADO })
	for _, x in { -6.6, 6.6 } do
		part(furn, { Name = "CouchArm", Size = Vector3.new(1.2, 2.6, 4.2), CFrame = CFrame.new(x, 1.6, couchZ), Material = Enum.Material.Fabric, Color = AVOCADO })
	end
	for i, x in { -4, 0, 4 } do
		-- Seats face the TV (-Z), which is CFrame.new's default look direction.
		part(furn, { ClassName = "Seat", Name = "CouchSeat" .. i, Size = Vector3.new(3.8, 0.6, 3.4), CFrame = CFrame.new(x, 2.0, couchZ - 0.2), Material = Enum.Material.Fabric, Color = Color3.fromRGB(124, 134, 60) })
	end

	-- Coffee table.
	part(furn, { Name = "CoffeeTableTop", Size = Vector3.new(6.5, 0.3, 3), CFrame = CFrame.new(0, 1.6, 1.8), Material = Enum.Material.Wood, Color = WALNUT })
	for _, x in { -2.9, 2.9 } do
		for _, z in { -1.1, 1.1 } do
			part(furn, { Name = "CoffeeTableLeg", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.45, 0.25, 0.25), CFrame = upright(CFrame.new(x, 0.72, 1.8 + z)), Material = Enum.Material.Wood, Color = DARK_WALNUT })
		end
	end
	part(furn, { Name = "CandyDish", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 1.2, 1.2), CFrame = upright(CFrame.new(1.6, 1.9, 1.8)), Material = Enum.Material.Glass, Color = BURNT_ORANGE, Transparency = 0.3 })

	-- Floor lamp with the room's warm light.
	local lampPos = Vector3.new(-9.5, 0, 7.5)
	part(furn, { Name = "LampBase", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 1.6, 1.6), CFrame = upright(CFrame.new(lampPos + Vector3.new(0, 0.15, 0))), Material = Enum.Material.Metal, Color = HARVEST_GOLD })
	part(furn, { Name = "LampPole", Shape = Enum.PartType.Cylinder, Size = Vector3.new(7, 0.18, 0.18), CFrame = upright(CFrame.new(lampPos + Vector3.new(0, 3.6, 0))), Material = Enum.Material.Metal, Color = HARVEST_GOLD })
	local shade = part(furn, { Name = "LampShade", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.6, 2.2, 2.2), CFrame = upright(CFrame.new(lampPos + Vector3.new(0, 7.4, 0))), Material = Enum.Material.Fabric, Color = CREAM, Transparency = 0.1 })
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 196, 130)
	light.Range = 26
	light.Brightness = 1.3
	light.Shadows = true
	light.Parent = shade

	-- Side table with a rotary phone.
	local st = Vector3.new(9.5, 0, 7.5)
	part(furn, { Name = "SideTable", Size = Vector3.new(2.6, 2.4, 2.6), CFrame = CFrame.new(st + Vector3.new(0, 1.2, 0)), Material = Enum.Material.Wood, Color = WALNUT })
	part(furn, { Name = "PhoneBody", Size = Vector3.new(1.2, 0.5, 1.0), CFrame = CFrame.new(st + Vector3.new(0, 2.65, 0)), Color = Color3.fromRGB(180, 40, 40) })
	part(furn, { Name = "PhoneHandset", Size = Vector3.new(1.4, 0.25, 0.35), CFrame = CFrame.new(st + Vector3.new(0, 3.0, -0.2)), Color = Color3.fromRGB(180, 40, 40) })
	part(furn, { Name = "PhoneDial", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.05, 0.6, 0.6), CFrame = CFrame.new(st + Vector3.new(0, 2.8, 0.52)) * CFrame.Angles(0, math.rad(90), 0), Color = CREAM })

	-- Hi-fi console along the west wall.
	part(furn, { Name = "HiFiConsole", Size = Vector3.new(2.6, 2.6, 10), CFrame = CFrame.new(-20.4, 1.3, 1), Material = Enum.Material.Wood, Color = WALNUT })
	part(furn, { Name = "HiFiGrille", Size = Vector3.new(0.1, 1.8, 3), CFrame = CFrame.new(-19.05, 1.4, -2.2), Material = Enum.Material.Fabric, Color = Color3.fromRGB(196, 176, 140) })
	part(furn, { Name = "HiFiGrille2", Size = Vector3.new(0.1, 1.8, 3), CFrame = CFrame.new(-19.05, 1.4, 4.2), Material = Enum.Material.Fabric, Color = Color3.fromRGB(196, 176, 140) })
	part(furn, { Name = "Record", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.06, 2, 2), CFrame = upright(CFrame.new(-20.4, 2.65, 1)), Color = Color3.fromRGB(15, 15, 15) })
end

local function buildWallDisplays(root: Model)
	-- Client scripts draw on these (see client/Decor.luau).
	local calPos = Vector3.new(-8.5, 7.6, -16.9)
	part(root, { Name = "Calendar", Size = Vector3.new(2.6, 3.4, 0.1), CFrame = CFrame.lookAt(calPos, calPos + Vector3.new(0, 0, 1)), Color = Color3.fromRGB(250, 246, 236) })
	local listPos = Vector3.new(9.5, 7.4, -16.9)
	part(root, { Name = "ListingsFrame", Size = Vector3.new(5.0, 5.4, 0.12), CFrame = CFrame.new(listPos - Vector3.new(0, 0, 0.04)), Material = Enum.Material.Wood, Color = WALNUT })
	part(root, { Name = "Listings", Size = Vector3.new(4.6, 5.0, 0.1), CFrame = CFrame.lookAt(listPos + Vector3.new(0, 0, 0.04), listPos + Vector3.new(0, 0, 1)), Material = Enum.Material.Fabric, Color = Color3.fromRGB(176, 128, 82) })
end

local function setupLighting()
	Lighting.ClockTime = 21
	Lighting.Brightness = 1
	Lighting.Ambient = Color3.fromRGB(78, 62, 50)
	Lighting.OutdoorAmbient = Color3.fromRGB(40, 40, 60)
	Lighting.EnvironmentDiffuseScale = 0.2
	Lighting.EnvironmentSpecularScale = 0.3
	Lighting.GlobalShadows = true
	if not Lighting:FindFirstChild("ThisDayTVGrade") then
		local cc = Instance.new("ColorCorrectionEffect")
		cc.Name = "ThisDayTVGrade"
		cc.TintColor = Color3.fromRGB(255, 240, 222)
		cc.Saturation = 0.05
		cc.Contrast = 0.05
		cc.Parent = Lighting
		local bloom = Instance.new("BloomEffect")
		bloom.Name = "ThisDayTVBloom"
		bloom.Intensity = 0.35
		bloom.Size = 20
		bloom.Threshold = 1.6
		bloom.Parent = Lighting
	end
end

function WorldBuilder.build()
	if workspace:FindFirstChild("TVStation") then
		return
	end
	local root = Instance.new("Model")
	root.Name = "TVStation"
	buildRoom(root)
	buildTV(root)
	buildFurniture(root)
	buildWallDisplays(root)

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(6, 0.2, 4)
	spawn.CFrame = CFrame.new(0, 0.1, 13) -- faces -Z, toward the TV
	spawn.Transparency = 1
	spawn.CanCollide = false
	spawn.Neutral = true
	spawn.Duration = 0
	spawn.Parent = root

	root.Parent = workspace
	setupLighting()
end

return WorldBuilder
