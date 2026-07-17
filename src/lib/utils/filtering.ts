import {
    AL_AnimeCollection_MediaListCollection_Lists_Entries,
    AL_BaseAnime,
    AL_BaseManga,
    AL_MangaCollection_MediaListCollection_Lists_Entries,
    AL_MediaFormat,
    AL_MediaSeason,
    AL_MediaStatus,
    Anime_Episode,
    Anime_LibraryCollectionEntry,
    Continuity_WatchHistory,
    Manga_CollectionEntry,
} from "@/api/generated/types"
import { getMangaEntryLatestChapterNumber, MangaEntryFilters } from "@/hooks/use-manga-chapters"
import { hasMediaTags } from "@/lib/search/tag-filter"
import type { AnimeCollectionSorting, ContinueWatchingSorting, MangaCollectionSorting } from "@/lib/theme-settings"
import sortBy from "lodash/sortBy"

export type CollectionSorting =
    "START_DATE"
    | "START_DATE_DESC"
    | "END_DATE"
    | "END_DATE_DESC"
    | "SCORE"
    | "SCORE_DESC"
    | "AUDIENCE_SCORE"
    | "AUDIENCE_SCORE_DESC"
    | "RELEASE_DATE"
    | "RELEASE_DATE_DESC"
    | "PROGRESS"
    | "PROGRESS_DESC"
    | "TITLE"
    | "TITLE_DESC"
    | "AIRDATE"
    | "AIRDATE_DESC"
    | "UNWATCHED_EPISODES"
    | "UNWATCHED_EPISODES_DESC"
    | "LAST_WATCHED"
    | "LAST_WATCHED_DESC"
    | "UNREAD_CHAPTERS"
    | "UNREAD_CHAPTERS_DESC"

export const CONTINUE_WATCHING_SORTING_OPTIONS: { label: string; value: ContinueWatchingSorting }[] = [
    { label: "Aired recently", value: "AIRDATE_DESC" },
    { label: "Aired oldest", value: "AIRDATE" },
    { label: "Highest episode number", value: "EPISODE_NUMBER_DESC" },
    { label: "Lowest episode number", value: "EPISODE_NUMBER" },
    { label: "Most unwatched episodes", value: "UNWATCHED_EPISODES_DESC" },
    { label: "Least unwatched episodes", value: "UNWATCHED_EPISODES" },
    { label: "Highest score", value: "SCORE_DESC" },
    { label: "Lowest score", value: "SCORE" },
    { label: "Started recently", value: "START_DATE_DESC" },
    { label: "Oldest start date", value: "START_DATE" },
    { label: "Most recent watch", value: "LAST_WATCHED_DESC" },
    { label: "Least recent watch", value: "LAST_WATCHED" },
]

export const COLLECTION_SORTING_OPTIONS = [
    { label: "Highest score", value: "SCORE_DESC" },
    { label: "Lowest score", value: "SCORE" },
    { label: "Title", value: "TITLE" },
    { label: "Title (Z-A)", value: "TITLE_DESC" },
    { label: "Highest audience score", value: "AUDIENCE_SCORE_DESC" },
    { label: "Lowest audience score", value: "AUDIENCE_SCORE" },
    { label: "Highest progress", value: "PROGRESS_DESC" },
    { label: "Lowest progress", value: "PROGRESS" },
    { label: "Started recently", value: "START_DATE_DESC" },
    { label: "Oldest start date", value: "START_DATE" },
    { label: "Completed recently", value: "END_DATE_DESC" },
    { label: "Oldest completion date", value: "END_DATE" },
    { label: "Released recently", value: "RELEASE_DATE_DESC" },
    { label: "Oldest release", value: "RELEASE_DATE" },
] satisfies { label: string; value: CollectionSorting }[]

export const ANIME_COLLECTION_SORTING_OPTIONS: { label: string; value: AnimeCollectionSorting }[] = [
    { label: "Aired recently and not up-to-date", value: "AIRDATE_DESC" },
    { label: "Aired oldest and not up-to-date", value: "AIRDATE" },
    { label: "Most unwatched episodes", value: "UNWATCHED_EPISODES_DESC" },
    { label: "Least unwatched episodes", value: "UNWATCHED_EPISODES" },
    { label: "Most recent watch", value: "LAST_WATCHED_DESC" },
    { label: "Least recent watch", value: "LAST_WATCHED" },
    ...COLLECTION_SORTING_OPTIONS,
]

export const MANGA_COLLECTION_SORTING_OPTIONS: { label: string; value: MangaCollectionSorting }[] = [
    { label: "Most unread chapters", value: "UNREAD_CHAPTERS_DESC" },
    { label: "Least unread chapters", value: "UNREAD_CHAPTERS" },
    ...COLLECTION_SORTING_OPTIONS,
]

export type CollectionParams = {
    sorting: CollectionSorting
    genre: string[] | null
    tags: string[] | null
    status: AL_MediaStatus | null
    format: AL_MediaFormat | null
    season: AL_MediaSeason | null
    year: string | null
    isAdult: boolean
}

export const DEFAULT_COLLECTION_PARAMS: CollectionParams = {
    sorting: "SCORE_DESC",
    genre: null,
    tags: null,
    status: null,
    format: null,
    season: null,
    year: null,
    isAdult: false,
}


function getParamValue<T extends any>(value: T | ""): any {
    if (value === "") return undefined
    if (Array.isArray(value) && value.filter(Boolean).length === 0) return undefined
    if (typeof value === "string" && !isNaN(parseInt(value))) return Number(value)
    if (value === null) return undefined
    return value
}

function getCurrentAnimeEpisodeCount(media: AL_BaseAnime | undefined) {
    const nextAiringEpisode = media?.nextAiringEpisode?.episode
    if (nextAiringEpisode) {
        return Math.max(0, nextAiringEpisode - 1)
    }

    return media?.episodes ?? 0
}

function getAnimeUnwatchedCount(entry: Anime_LibraryCollectionEntry) {
    if (entry.libraryData?.mainFileCount) return entry.libraryData.unwatchedCount
    if (entry.nakamaLibraryData?.mainFileCount) return entry.nakamaLibraryData.unwatchedCount

    return Math.max(0, getCurrentAnimeEpisodeCount(entry.media) - (entry.listData?.progress ?? 0))
}

function getMangaUnreadCount(
    entry: Manga_CollectionEntry,
    latestChapterNumbers: Parameters<typeof getMangaEntryLatestChapterNumber>[1],
    storedProviders: Record<string, string>,
    storedFilters: Record<string, MangaEntryFilters>,
) {
    const latestChapterNumber = getMangaEntryLatestChapterNumber(
        entry.mediaId,
        latestChapterNumbers,
        storedProviders,
        storedFilters,
    )

    if (!latestChapterNumber) return 0

    return Math.max(0, latestChapterNumber - (entry.listData?.progress ?? 0))
}


export function filterEntriesByTitle<T extends { media?: AL_BaseAnime | AL_BaseManga }[] | null | undefined>(arr: T, input: string): T {
    // @ts-expect-error
    if (!arr) return []
    if (arr.length > 0 && input.length > 0) {
        const _input = input.toLowerCase().trim().replace(/\s+/g, " ")
        // @ts-expect-error
        return arr.filter(entry => (
            entry.media?.title?.english?.toLowerCase().includes(_input)
            || entry.media?.title?.userPreferred?.toLowerCase().includes(_input)
            || entry.media?.title?.romaji?.toLowerCase().includes(_input)
            || entry.media?.synonyms?.some(syn => syn?.toLowerCase().includes(_input))
        ))
    }
    return arr
}

export function filterListEntries<T extends AL_MangaCollection_MediaListCollection_Lists_Entries[] | AL_AnimeCollection_MediaListCollection_Lists_Entries[]>(
    entries: T | null | undefined,
    params: CollectionParams,
    showAdultContent: boolean | undefined,
    mediaTagMap?: Record<number, Array<string>> | null,
) {
    if (!entries) return []
    let arr = [...entries]

    // Filter by isAdult
    if (!!arr && params.isAdult) arr = arr.filter(n => n.media?.isAdult)

    // Filter by showAdultContent
    if (!showAdultContent) arr = arr.filter(n => !n.media?.isAdult)

    // Filter by format
    if (!!arr && !!params.format) arr = arr.filter(n => n.media?.format === params.format)

    // Filter by season
    if (!!arr && !!params.season) arr = arr.filter(n => n.media?.season === params.season)

    // Filter by status
    if (!!arr && !!params.status) arr = arr.filter(n => n.media?.status === params.status)

    // Filter by year
    if (!!arr && !!params.year) arr = arr.filter(n => n.media?.startDate?.year === Number(params.year))

    // Filter by genre
    if (!!arr && !!params.genre?.length) {
        arr = arr.filter(n => {
            return params.genre?.every(genre => n.media?.genres?.includes(genre))
        })
    }

    // Filter by AniList tags
    if (!!arr && !!params.tags?.length && !!mediaTagMap) {
        arr = arr.filter(n => hasMediaTags(n.media?.id, params.tags ?? [], mediaTagMap))
    }

    // Initial sort by name
    arr = sortBy(arr, n => n?.media?.title?.userPreferred).reverse()

    // Sort by title
    if (getParamValue(params.sorting) === "TITLE")
        arr = sortBy(arr, n => n?.media?.title?.userPreferred)
    if (getParamValue(params.sorting) === "TITLE_DESC")
        arr = sortBy(arr, n => n?.media?.title?.userPreferred).reverse()

    // Sort by release date
    if (getParamValue(params.sorting) === "RELEASE_DATE" || getParamValue(params.sorting) === "RELEASE_DATE_DESC") {
        arr = arr?.filter(n => n.media?.startDate && !!n.media.startDate.year && !!n.media.startDate.month)
    }
    if (getParamValue(params.sorting) === "RELEASE_DATE")
        arr = sortBy(arr, n => new Date(n?.media?.startDate?.year!, n?.media?.startDate?.month! - 1))
    if (getParamValue(params.sorting) === "RELEASE_DATE_DESC")
        arr = sortBy(arr, n => new Date(n?.media?.startDate?.year!, n?.media?.startDate?.month! - 1)).reverse()

    // Sort by score
    if (getParamValue(params.sorting) === "SCORE")
        arr = sortBy(arr, n => n?.score)
    if (getParamValue(params.sorting) === "SCORE_DESC")
        arr = sortBy(arr, n => n?.score).reverse()

    if (getParamValue(params.sorting) === "AUDIENCE_SCORE")
        arr = sortBy(arr, n => n?.media?.meanScore || 999999)
    if (getParamValue(params.sorting) === "AUDIENCE_SCORE_DESC")
        arr = sortBy(arr, n => n?.media?.meanScore || 0).reverse()

    // Sort by start date
    if (getParamValue(params.sorting) === "START_DATE" || getParamValue(params.sorting) === "START_DATE_DESC") {
        arr = arr?.filter(n => n.startedAt && !!n.startedAt.year && !!n.startedAt.month && !!n.startedAt.day)
    }
    if (getParamValue(params.sorting) === "START_DATE")
        arr = sortBy(arr, n => new Date(n?.startedAt?.year!, n?.startedAt?.month! - 1, n?.startedAt?.day))
    if (getParamValue(params.sorting) === "START_DATE_DESC")
        arr = sortBy(arr, n => new Date(n?.startedAt?.year!, n?.startedAt?.month! - 1, n?.startedAt?.day)).reverse()

    // Sort by end date
    if (getParamValue(params.sorting) === "END_DATE" || getParamValue(params.sorting) === "END_DATE_DESC") {
        arr = arr?.filter(n => n.completedAt && !!n.completedAt.year && !!n.completedAt.month && !!n.completedAt.day)
    }
    if (getParamValue(params.sorting) === "END_DATE")
        arr = sortBy(arr, n => new Date(n?.completedAt?.year!, n?.completedAt?.month! - 1, n?.completedAt?.day))
    if (getParamValue(params.sorting) === "END_DATE_DESC")
        arr = sortBy(arr, n => new Date(n?.completedAt?.year!, n?.completedAt?.month! - 1, n?.completedAt?.day)).reverse()

    // Sort by progress
    if (getParamValue(params.sorting) === "PROGRESS")
        arr = sortBy(arr, n => n?.progress || 0)
    if (getParamValue(params.sorting) === "PROGRESS_DESC")
        arr = sortBy(arr, n => n?.progress || 0).reverse()

    return arr
}

export function filterCollectionEntries<T extends (Anime_LibraryCollectionEntry | Manga_CollectionEntry)[]>(
    entries: T | null | undefined,
    params: CollectionParams,
    showAdultContent: boolean | undefined,
) {
    if (!entries) return []
    let arr = [...entries]

    // Filter by isAdult
    if (!!arr && params.isAdult) arr = arr.filter(n => n.media?.isAdult)

    // Filter by showAdultContent
    if (!showAdultContent) arr = arr.filter(n => !n.media?.isAdult)

    // Filter by format
    if (!!arr && !!params.format) arr = arr.filter(n => n.media?.format === params.format)

    // Filter by season
    if (!!arr && !!params.season) arr = arr.filter(n => n.media?.season === params.season)

    // Filter by status
    if (!!arr && !!params.status) arr = arr.filter(n => n.media?.status === params.status)

    // Filter by year
    if (!!arr && !!params.year) arr = arr.filter(n => n.media?.startDate?.year === Number(params.year))

    // Filter by genre
    if (!!arr && !!params.genre?.length) {
        arr = arr.filter(n => {
            return params.genre?.every(genre => n.media?.genres?.includes(genre))
        })
    }

    // Initial sort by name
    arr = sortBy(arr, n => n?.media?.title?.userPreferred).reverse()

    // Sort by title
    if (getParamValue(params.sorting) === "TITLE")
        arr = sortBy(arr, n => n?.media?.title?.userPreferred)
    if (getParamValue(params.sorting) === "TITLE_DESC")
        arr = sortBy(arr, n => n?.media?.title?.userPreferred).reverse()

    // Sort by release date
    if (getParamValue(params.sorting) === "RELEASE_DATE" || getParamValue(params.sorting) === "RELEASE_DATE_DESC") {
        arr = arr?.filter(n => n.media?.startDate && !!n.media.startDate.year && !!n.media.startDate.month)
    }
    if (getParamValue(params.sorting) === "RELEASE_DATE")
        arr = sortBy(arr, n => new Date(n?.media?.startDate?.year!, n?.media?.startDate?.month! - 1))
    if (getParamValue(params.sorting) === "RELEASE_DATE_DESC")
        arr = sortBy(arr, n => new Date(n?.media?.startDate?.year!, n?.media?.startDate?.month! - 1)).reverse()

    // Sort by score
    if (getParamValue(params.sorting) === "SCORE")
        arr = sortBy(arr, n => n?.listData?.score)
    if (getParamValue(params.sorting) === "SCORE_DESC")
        arr = sortBy(arr, n => n?.listData?.score).reverse()

    if (getParamValue(params.sorting) === "AUDIENCE_SCORE")
        arr = sortBy(arr, n => n?.media?.meanScore || 999999)
    if (getParamValue(params.sorting) === "AUDIENCE_SCORE_DESC")
        arr = sortBy(arr, n => n?.media?.meanScore || 0).reverse()

    // Sort by start date
    if (getParamValue(params.sorting) === "START_DATE" || getParamValue(params.sorting) === "START_DATE_DESC") {
        arr = arr?.filter(n => !!n.listData?.startedAt)
    }
    if (getParamValue(params.sorting) === "START_DATE")
        arr = sortBy(arr, n => new Date(n?.listData?.startedAt!))
    if (getParamValue(params.sorting) === "START_DATE_DESC")
        arr = sortBy(arr, n => new Date(n?.listData?.startedAt!)).reverse()

    // Sort by end date
    if (getParamValue(params.sorting) === "END_DATE" || getParamValue(params.sorting) === "END_DATE_DESC") {
        arr = arr?.filter(n => !!n.listData?.completedAt)
    }
    if (getParamValue(params.sorting) === "END_DATE")
        arr = sortBy(arr, n => new Date(n?.listData?.completedAt!))
    if (getParamValue(params.sorting) === "END_DATE_DESC")
        arr = sortBy(arr, n => new Date(n?.listData?.completedAt!)).reverse()

    // Sort by progress
    if (getParamValue(params.sorting) === "PROGRESS")
        arr = sortBy(arr, n => n?.listData?.progress || 0)
    if (getParamValue(params.sorting) === "PROGRESS_DESC")
        arr = sortBy(arr, n => n?.listData?.progress || 0).reverse()

    return arr
}

export function filterAnimeCollectionEntries(
    entries: Anime_LibraryCollectionEntry[] | null | undefined,
    params: CollectionParams,
    showAdultContent: boolean | undefined,
    continueWatchingList: Anime_Episode[] | null | undefined,
    watchHistory: Continuity_WatchHistory | null | undefined,
) {
    let arr = filterCollectionEntries(entries, params, showAdultContent)

    // anime-only sorts need episode and watch history context from the library view
    if (getParamValue(params.sorting) === "AIRDATE") {
        arr = sortBy(arr, entry => (
            continueWatchingList?.find(episode => episode.baseAnime?.id === entry.media?.id)?.episodeMetadata?.airDate
            || new Date(9999, 0, 1).toISOString()
        ))
    }
    if (getParamValue(params.sorting) === "AIRDATE_DESC") {
        arr = sortBy(arr, entry => (
            continueWatchingList?.find(episode => episode.baseAnime?.id === entry.media?.id)?.episodeMetadata?.airDate
            || new Date(1000, 0, 1).toISOString()
        )).reverse()
    }

    if (getParamValue(params.sorting) === "UNWATCHED_EPISODES") {
        arr = sortBy(arr, entry => getAnimeUnwatchedCount(entry) || 999999)
    }
    if (getParamValue(params.sorting) === "UNWATCHED_EPISODES_DESC") {
        arr = sortBy(arr, entry => getAnimeUnwatchedCount(entry)).reverse()
    }

    if (getParamValue(params.sorting) === "LAST_WATCHED") {
        arr = sortBy(arr, entry => watchHistory?.[entry.mediaId]?.timeUpdated || new Date(9999, 0, 1).toISOString())
    }
    if (getParamValue(params.sorting) === "LAST_WATCHED_DESC") {
        arr = sortBy(arr, entry => watchHistory?.[entry.mediaId]?.timeUpdated || new Date(1000, 0, 1).toISOString()).reverse()
    }

    return arr
}

export function filterMangaCollectionEntries(
    entries: Manga_CollectionEntry[] | null | undefined,
    params: CollectionParams,
    showAdultContent: boolean | undefined,
    latestChapterNumbers: Parameters<typeof getMangaEntryLatestChapterNumber>[1],
    storedProviders: Record<string, string>,
    storedFilters: Record<string, MangaEntryFilters>,
) {
    let arr = filterCollectionEntries(entries, params, showAdultContent)

    // unread chapter sorting depends on the selected manga provider and filters
    if (getParamValue(params.sorting) === "UNREAD_CHAPTERS") {
        arr = sortBy(arr, entry => getMangaUnreadCount(entry, latestChapterNumbers, storedProviders, storedFilters) || 999999)
    }
    if (getParamValue(params.sorting) === "UNREAD_CHAPTERS_DESC") {
        arr = sortBy(arr, entry => getMangaUnreadCount(entry, latestChapterNumbers, storedProviders, storedFilters)).reverse()
    }

    return arr
}

export function sortContinueWatchingEpisodes(
    entries: Anime_Episode[] | null | undefined,
    sorting: ContinueWatchingSorting,
    libraryEntries: Anime_LibraryCollectionEntry[] | null | undefined,
    watchHistory: Continuity_WatchHistory | null | undefined,
) {
    if (!entries) return []
    let arr = sortBy([...entries], episode => episode.displayTitle)

    // continue watching uses anime entry context so the card row matches web ordering
    if (sorting === "EPISODE_NUMBER") arr = sortBy(arr, episode => episode.episodeNumber)
    if (sorting === "EPISODE_NUMBER_DESC") arr = sortBy(arr, episode => episode.episodeNumber).reverse()
    if (sorting === "AIRDATE") arr = sortBy(arr, episode => episode.episodeMetadata?.airDate || new Date(9999, 0, 1).toISOString())
    if (sorting === "AIRDATE_DESC") arr = sortBy(arr, episode => episode.episodeMetadata?.airDate || new Date(1000, 0, 1).toISOString()).reverse()

    if (sorting === "UNWATCHED_EPISODES") {
        arr = sortBy(arr, episode => {
            const entry = libraryEntries?.find(item => item.mediaId === episode.baseAnime?.id)
            return entry ? getAnimeUnwatchedCount(entry) || 999999 : 999999
        })
    }
    if (sorting === "UNWATCHED_EPISODES_DESC") {
        arr = sortBy(arr, episode => {
            const entry = libraryEntries?.find(item => item.mediaId === episode.baseAnime?.id)
            return entry ? getAnimeUnwatchedCount(entry) : 0
        }).reverse()
    }

    if (sorting === "SCORE") {
        arr = sortBy(arr, episode => libraryEntries?.find(item => item.mediaId === episode.baseAnime?.id)?.listData?.score || 999999)
    }
    if (sorting === "SCORE_DESC") {
        arr = sortBy(arr, episode => libraryEntries?.find(item => item.mediaId === episode.baseAnime?.id)?.listData?.score || 0).reverse()
    }

    if (sorting === "START_DATE") {
        arr = sortBy(arr,
            episode => libraryEntries?.find(item => item.mediaId === episode.baseAnime?.id)?.listData?.startedAt || new Date(9999,
                0,
                1).toISOString())
    }
    if (sorting === "START_DATE_DESC") {
        arr = sortBy(arr,
            episode => libraryEntries?.find(item => item.mediaId === episode.baseAnime?.id)?.listData?.startedAt || new Date(1000,
                0,
                1).toISOString()).reverse()
    }

    if (sorting === "LAST_WATCHED") {
        arr = sortBy(arr,
            episode => episode.baseAnime?.id
                ? watchHistory?.[episode.baseAnime.id]?.timeUpdated || new Date(9999, 0, 1).toISOString()
                : new Date(9999, 0, 1).toISOString())
    }
    if (sorting === "LAST_WATCHED_DESC") {
        arr = sortBy(arr,
            episode => episode.baseAnime?.id
                ? watchHistory?.[episode.baseAnime.id]?.timeUpdated || new Date(1000, 0, 1).toISOString()
                : new Date(1000, 0, 1).toISOString()).reverse()
    }

    return arr
}
