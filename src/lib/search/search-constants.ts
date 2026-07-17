import { AL_MediaFormat } from "@/api/generated/types"

export const SEARCH_MEDIA_GENRES = [
    "Action",
    "Adventure",
    "Comedy",
    "Drama",
    "Ecchi",
    "Fantasy",
    "Horror",
    "Mahou Shoujo",
    "Mecha",
    "Music",
    "Mystery",
    "Psychological",
    "Romance",
    "Sci-Fi",
    "Slice of Life",
    "Sports",
    "Supernatural",
    "Thriller",
]

export const SEARCH_SEASONS = [
    { value: "WINTER", label: "Winter" },
    { value: "SPRING", label: "Spring" },
    { value: "SUMMER", label: "Summer" },
    { value: "FALL", label: "Fall" },
] as const

export const SEARCH_FORMATS_ANIME: { value: AL_MediaFormat; label: string }[] = [
    { value: "TV", label: "TV" },
    { value: "MOVIE", label: "Movie" },
    { value: "ONA", label: "ONA" },
    { value: "OVA", label: "OVA" },
    { value: "TV_SHORT", label: "TV Short" },
    { value: "SPECIAL", label: "Special" },
]

export const SEARCH_FORMATS_MANGA: { value: AL_MediaFormat; label: string }[] = [
    { value: "MANGA", label: "Manga" },
    { value: "ONE_SHOT", label: "One Shot" },
]

export const SEARCH_COUNTRIES_MANGA = [
    { value: "JP", label: "Japan" },
    { value: "KR", label: "South Korea" },
    { value: "CN", label: "China" },
    { value: "TW", label: "Taiwan" },
]

export const SEARCH_STATUS = [
    { value: "FINISHED", label: "Finished" },
    { value: "RELEASING", label: "Releasing" },
    { value: "NOT_YET_RELEASED", label: "Upcoming" },
    { value: "HIATUS", label: "Hiatus" },
    { value: "CANCELLED", label: "Cancelled" },
]

export const SEARCH_SORTING_ANIME = [
    { value: "TRENDING_DESC", label: "Trending" },
    { value: "START_DATE_DESC", label: "Release date" },
    { value: "SCORE_DESC", label: "Highest score" },
    { value: "POPULARITY_DESC", label: "Most popular" },
    { value: "EPISODES_DESC", label: "Most episodes" },
]

export const SEARCH_SORTING_MANGA = [
    { value: "TRENDING_DESC", label: "Trending" },
    { value: "START_DATE_DESC", label: "Release date" },
    { value: "SCORE_DESC", label: "Highest score" },
    { value: "POPULARITY_DESC", label: "Most popular" },
    { value: "CHAPTERS_DESC", label: "Most chapters" },
]

export const CURRENT_YEAR = new Date().getFullYear()
export const SEARCH_YEARS = Array.from({ length: CURRENT_YEAR - 1990 + 2 }, (_, i) =>
    String(CURRENT_YEAR + 1 - i),
)

export const SEARCH_MIN_SCORES = Array.from({ length: 9 }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1}+`,
}))
