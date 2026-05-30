import { AL_MediaFormat, AL_MediaSeason, AL_MediaSort, AL_MediaStatus } from "@/api/generated/types"
import { atom } from "jotai"

export type SearchParams = {
    title: string | null
    sorting: AL_MediaSort
    genre: string[]
    status: AL_MediaStatus[]
    format: AL_MediaFormat | null
    season: AL_MediaSeason | null
    year: string | null
    minScore: string | null
    isAdult: boolean
    countryOfOrigin: string | null
    type: "anime" | "manga"
}

export const DEFAULT_SEARCH_PARAMS: SearchParams = {
    title: null,
    sorting: "SCORE_DESC",
    genre: [],
    status: [],
    format: null,
    season: null,
    year: null,
    minScore: null,
    isAdult: false,
    countryOfOrigin: null,
    type: "anime",
}


export const searchParamsAtom = atom<SearchParams>({ ...DEFAULT_SEARCH_PARAMS })

export function isSearchActive(params: SearchParams): boolean {
    return !!params.title?.trim() || getActiveFiltersCount(params) > 0
}

export function getAnimeSearchVariables(params: SearchParams, page: number) {
    const hasTitle = !!params.title?.trim()
    return {
        page,
        perPage: 30,
        format: params.format ?? undefined,
        search: hasTitle ? params.title ?? undefined : undefined,
        genres: params.genre.length > 0 ? params.genre : undefined,
        season: params.season ?? undefined,
        seasonYear: params.year ? parseInt(params.year, 10) : undefined,
        averageScore_greater: params.minScore ? parseInt(params.minScore, 10) : undefined,
        sort: hasTitle
            ? (["SEARCH_MATCH", params.sorting] as AL_MediaSort[])
            : ([params.sorting] as AL_MediaSort[]),
        status:
            params.sorting === "START_DATE_DESC"
                ? params.status.filter(s => s !== "NOT_YET_RELEASED").length > 0
                    ? params.status.filter(s => s !== "NOT_YET_RELEASED")
                    : undefined
                : params.status.length > 0
                    ? params.status
                    : undefined,
        isAdult: params.isAdult,
    }
}

export function getMangaSearchVariables(params: SearchParams, page: number) {
    const hasTitle = !!params.title?.trim()
    return {
        page,
        perPage: 30,
        search: hasTitle ? params.title ?? undefined : undefined,
        genres: params.genre.length > 0 ? params.genre : undefined,
        year: params.year ? parseInt(params.year, 10) : undefined,
        format: params.format ?? undefined,
        averageScore_greater: params.minScore ? parseInt(params.minScore, 10) : undefined,
        sort: hasTitle
            ? (["SEARCH_MATCH", params.sorting] as AL_MediaSort[])
            : ([params.sorting] as AL_MediaSort[]),
        status:
            params.sorting === "START_DATE_DESC"
                ? params.status.filter(s => s !== "NOT_YET_RELEASED").length > 0
                    ? params.status.filter(s => s !== "NOT_YET_RELEASED")
                    : undefined
                : params.status.length > 0
                    ? params.status
                    : undefined,
        countryOfOrigin: params.countryOfOrigin ?? undefined,
        isAdult: params.isAdult,
    }
}

export function getActiveFiltersCount(params: SearchParams): number {
    let count = 0
    if (params.sorting !== "SCORE_DESC") count++
    if (params.genre.length > 0) count++
    if (params.status.length > 0) count++
    if (params.format !== null) count++
    if (params.season !== null && params.type === "anime") count++
    if (params.year !== null) count++
    if (params.minScore !== null) count++
    if (params.countryOfOrigin !== null && params.type === "manga") count++
    if (params.isAdult) count++
    return count
}
