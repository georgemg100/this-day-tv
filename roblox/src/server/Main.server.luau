-- This Day TV: server entry point.
local ServerScriptService = game:GetService("ServerScriptService")

local root = ServerScriptService:WaitForChild("ThisDayTVServer")
local WorldBuilder = require(root:WaitForChild("WorldBuilder"))
local ScheduleService = require(root:WaitForChild("ScheduleService"))

WorldBuilder.build()
ScheduleService.start()
