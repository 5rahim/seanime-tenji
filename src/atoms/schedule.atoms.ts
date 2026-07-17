import { AL_MediaListStatus } from "@/api/generated/types"
import { createAtomStorage } from "@/atoms/storage"
import { atomWithStorage } from "jotai/utils"

export type ScheduleSettings = {
    /** Which AniList watch statuses to include in the schedule */
    listStatuses: AL_MediaListStatus[]
    /** Grey out episodes the user has already watched */
    indicateWatchedEpisodes: boolean
    /** Hide the missing episodes shelf */
    hideMissingEpisodes: boolean
    /** Hide the upcoming episodes shelf */
    hideUpcomingEpisodes: boolean
}

const defaultSettings: ScheduleSettings = {
    listStatuses: ["CURRENT", "PLANNING", "COMPLETED", "PAUSED"],
    indicateWatchedEpisodes: true,
    hideMissingEpisodes: false,
    hideUpcomingEpisodes: false,
}

export const scheduleSettingsAtom = atomWithStorage<ScheduleSettings>(
    "sea-schedule-settings",
    defaultSettings,
    createAtomStorage<ScheduleSettings>(),
    { getOnInit: true },
)
