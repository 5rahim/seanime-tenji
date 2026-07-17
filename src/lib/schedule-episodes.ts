import type { Anime_Episode, Anime_UpcomingEpisode } from "@/api/generated/types"
import { format, isValid, parseISO } from "date-fns"

export type ShelfEpisode = Anime_Episode | Anime_UpcomingEpisode

export function getShelfTitle(episode: ShelfEpisode, hideTitle: boolean) {
    const fallback = `Episode ${episode.episodeNumber}`

    if (!("airingAt" in episode) && episode.isMissingGroup) {
        return episode.displayTitle || fallback
    }

    if (hideTitle) return fallback

    return episode.episodeMetadata?.title || fallback
}

export function getShelfBadge(episode: ShelfEpisode) {
    if ("airingAt" in episode) {
        return format(new Date(episode.airingAt * 1000), "EEE, MMM d · HH:mm")
    }

    const value = episode.episodeMetadata?.airDate
    if (!value) return null

    const date = parseISO(value)
    return isValid(date) ? format(date, "MMM d, yyyy") : value
}
