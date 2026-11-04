--!strict
-- Station settings. Keep DataStoreName / MessagingTopic / timezone in sync
-- with admin/.env (ROBLOX_DATASTORE, ROBLOX_TOPIC, STATION_TIMEZONE).

local Config = {
	-- Where the admin console publishes each day's lineup (key = "MM-DD").
	DataStoreName = "ThisDayTV",
	-- Open Cloud publishMessage topic that makes live servers reload at once.
	MessagingTopic = "ThisDayTV",

	-- Optional second source, used when the DataStore has no entry: an HTTPS URL
	-- with %s for MM-DD, e.g. "https://tv.example.com/public/schedule/%s".
	-- Needs Game Settings > Security > Allow HTTP Requests.
	ScheduleUrl = "",

	-- What "today" means. Default is US Eastern: UTC-5, plus US daylight saving.
	UtcOffsetMinutes = -300,
	ObserveUSDaylightSaving = true,

	-- If nothing is published for today, build a free all-headlines channel from
	-- Wikipedia's "On this day" feed (needs Allow HTTP Requests). Otherwise the
	-- TV shows a test pattern.
	AutoHeadlinesWhenEmpty = true,
	HeadlineYearFrom = 1960,
	HeadlineYearTo = 1999,

	-- Re-read the DataStore this often even without a publish message (seconds).
	RefreshSeconds = 300,

	-- Playback
	Volume = 2, -- VideoFrame/Sound volume (0-10). Sound is 3D, from the TV.
	ResyncThreshold = 2.0, -- seconds of drift before a video is re-seeked
	LoadTimeout = 12, -- seconds to wait for an asset before "technical difficulties"
	LowerThirdSeconds = 7,
}

return Config
