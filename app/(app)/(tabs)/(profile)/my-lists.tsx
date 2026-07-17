import {
    AL_AnimeCollection_MediaListCollection_Lists,
    AL_AnimeCollection_MediaListCollection_Lists_Entries,
    AL_BaseAnime,
    AL_BaseManga,
    AL_MangaCollection_MediaListCollection_Lists,
    AL_MangaCollection_MediaListCollection_Lists_Entries,
    AL_MediaListStatus,
    AL_MediaTagMap,
} from "@/api/generated/types"
import { useGetRawAnimeCollection, useGetRawAnimeCollectionTags } from "@/api/hooks/anilist.hooks"
import { useGetRawAnilistMangaCollection, useGetRawAnilistMangaCollectionTags } from "@/api/hooks/manga.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { FilterButton } from "@/components/features/discover/search-filter-sheet"
import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { CollectionFilterSheet, countActiveCollectionFilters } from "@/components/features/my-lists/collection-filter-sheet"
import { InlineSelect } from "@/components/shared/inline-select"
import { LibrarySearchBar } from "@/components/shared/library-search-bar"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { useIsServerConnected } from "@/lib/offline"
import { getMediaGridLayout } from "@/lib/responsive-card-layout"
import { cn } from "@/lib/utils"
import { CollectionParams, DEFAULT_COLLECTION_PARAMS, filterEntriesByTitle, filterListEntries } from "@/lib/utils/filtering"
import Ionicons from "@expo/vector-icons/Ionicons"
import { router } from "expo-router"
import * as React from "react"
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native"
import { ScrollView } from "react-native-gesture-handler"
import Animated, { FadeIn } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const H_PADDING = 14
const GAP = 10
const INITIAL_MY_LIST_ROWS = 5

type CollectionGridCardData = {
    id: number
    media: AL_BaseAnime | AL_BaseManga
    listData: {
        progress: number
        score: number
        status: AL_MediaListStatus | undefined
        startedAt?: string
        completedAt?: string
    }
}

type CollectionListItem =
    | { key: string; kind: "section-header"; title: string; count: number }
    | { key: string; kind: "row"; row: CollectionGridCardData[] }

////////////////////////// Status labels & ordering

const STATUS_ORDER: AL_MediaListStatus[] = [
    "CURRENT",
    "REPEATING",
    "PLANNING",
    "PAUSED",
    "COMPLETED",
    "DROPPED",
]

function statusLabel(status: AL_MediaListStatus, type: "anime" | "manga"): string {
    switch (status) {
        case "CURRENT":
            return type === "anime" ? "Watching" : "Reading"
        case "REPEATING":
            return type === "anime" ? "Rewatching" : "Rereading"
        case "PLANNING":
            return "Planning"
        case "PAUSED":
            return "Paused"
        case "COMPLETED":
            return "Completed"
        case "DROPPED":
            return "Dropped"
        default:
            return status
    }
}

////////////////////////// List selector options

type ListOption = { value: string; label: string }

function buildListOptions(
    lists: (AL_AnimeCollection_MediaListCollection_Lists | AL_MangaCollection_MediaListCollection_Lists)[] | undefined,
    type: "anime" | "manga",
): ListOption[] {
    const options: ListOption[] = [{ value: "ALL", label: "All lists" }]
    if (!lists) return options

    // standard status-based lists
    for (const s of STATUS_ORDER) {
        const list = lists.find(l => !l.isCustomList && l.status === s)
        if (list?.entries?.length) {
            options.push({ value: s, label: statusLabel(s, type) })
        }
    }

    // custom lists
    for (const list of lists) {
        if (list.isCustomList && list.name && list.entries?.length) {
            options.push({ value: `custom:${list.name}`, label: list.name })
        }
    }

    return options
}

////////////////////////// Section data builder

type SectionData = {
    title: string
    count: number
    data: CollectionGridCardData[][]
}

function toIsoDate(date?: { year?: number | null; month?: number | null; day?: number | null }) {
    if (!date?.year) return undefined

    return new Date(date.year, (date.month || 1) - 1, date.day || 1).toISOString()
}

/**
 * Builds SectionList-compatible sections from the raw collection.
 * Each section represents a status group (or named custom list). Entries
 * within each section are filtered, sorted, and chunked into grid rows.
 */
function buildSections(
    lists: (AL_AnimeCollection_MediaListCollection_Lists | AL_MangaCollection_MediaListCollection_Lists)[] | undefined,
    selectedList: string,
    titleQuery: string,
    params: CollectionParams,
    showAdult: boolean | undefined,
    type: "anime" | "manga",
    numColumns: number,
    mediaTagMap: AL_MediaTagMap | undefined,
): SectionData[] {
    if (!lists) return []

    const sections: SectionData[] = []

    function processListEntries(
        label: string,
        entries: (AL_AnimeCollection_MediaListCollection_Lists_Entries | AL_MangaCollection_MediaListCollection_Lists_Entries)[] | undefined,
    ) {
        if (!entries?.length) return
        let filtered = filterListEntries(entries, params, showAdult, mediaTagMap)
        if (titleQuery.trim()) {
            filtered = filterEntriesByTitle(filtered, titleQuery) as typeof filtered
        }
        const preparedEntries: CollectionGridCardData[] = filtered.flatMap(entry => {
            if (!entry.media) return []

            return [{
                id: entry.id,
                media: entry.media as AL_BaseAnime | AL_BaseManga,
                listData: {
                    progress: entry.progress ?? 0,
                    score: entry.score ?? 0,
                    status: entry.status,
                    startedAt: toIsoDate(entry.startedAt),
                    completedAt: toIsoDate(entry.completedAt),
                },
            }]
        })
        if (preparedEntries.length === 0) return
        // chunk into rows for grid rendering
        const rows: CollectionGridCardData[][] = []
        for (let i = 0; i < preparedEntries.length; i += numColumns) {
            rows.push(preparedEntries.slice(i, i + numColumns))
        }
        sections.push({ title: label, count: preparedEntries.length, data: rows })
    }

    if (selectedList === "ALL") {
        // standard lists first, in order
        for (const s of STATUS_ORDER) {
            const list = lists.find(l => !l.isCustomList && l.status === s)
            if (list) processListEntries(statusLabel(s, type), list.entries as typeof sections[0]["data"][0])
        }
        // then custom lists
        for (const list of lists) {
            if (list.isCustomList && list.name) {
                processListEntries(list.name, list.entries as typeof sections[0]["data"][0])
            }
        }
    } else if (selectedList.startsWith("custom:")) {
        const name = selectedList.slice(7)
        const list = lists.find(l => l.isCustomList && l.name === name)
        if (list) processListEntries(name, list.entries as typeof sections[0]["data"][0])
    } else {
        // specific status
        const list = lists.find(l => !l.isCustomList && l.status === selectedList)
        if (list) processListEntries(statusLabel(selectedList as AL_MediaListStatus, type), list.entries as typeof sections[0]["data"][0])
    }

    return sections
}

////////////////////////// Helper components

function TypeToggle({
    type,
    onChange,
}: {
    type: "anime" | "manga"
    onChange: (t: "anime" | "manga") => void
}) {
    return (
        <View className="flex-row gap-0.5 rounded-3xl">
            {(["anime", "manga"] as const).map(t => (
                <Pressable
                    key={t}
                    onPress={() => onChange(t)}
                    className={cn(
                        "rounded-xl px-5 py-2 active:opacity-70",
                        type === t ? "bg-white/15" : "bg-transparent",
                    )}
                >
                    <Text className={cn("text-sm font-medium text-white/40", type === t && "font-bold text-white")}>
                        {t === "anime" ? "Anime" : "Manga"}
                    </Text>
                </Pressable>
            ))}
        </View>
    )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
    return (
        <Animated.View entering={FadeIn.duration(200)} className="items-center justify-center pt-24 gap-3">
            <Ionicons name="albums-outline" size={40} color="rgba(255,255,255,0.12)" />
            <Text className="text-center text-sm text-white/30">
                {hasFilters ? "No entries match your filters" : "No entries in this list"}
            </Text>
        </Animated.View>
    )
}

const CollectionGridRow = React.memo(function CollectionGridRow({
    row,
    type,
    onPress,
    cardWidth,
    numColumns,
}: {
    row: CollectionGridCardData[]
    type: "anime" | "manga"
    onPress: (item: AL_BaseAnime | AL_BaseManga) => void
    cardWidth: number
    numColumns: number
}) {
    return (
        <View className="flex-row" style={{ gap: GAP, marginBottom: GAP }}>
            {row.map(entry => (
                <MediaEntryCard
                    key={entry.id}
                    type={type}
                    cardWidth={cardWidth}
                    media={entry.media as AL_BaseAnime & AL_BaseManga}
                    listData={entry.listData as never}
                    onPress={() => onPress(entry.media)}
                />
            ))}
            {row.length < numColumns && Array.from({ length: numColumns - row.length }).map((_, i) => (
                <View key={`spacer-${i}`} style={{ width: cardWidth }} />
            ))}
        </View>
    )
})

////////////////////////// Main screen

export default function MyListsScreen() {
    const insets = useSafeAreaInsets()
    const { width: screenWidth } = useWindowDimensions()
    const { cardWidth, numColumns } = React.useMemo(
        () => getMediaGridLayout({
            screenWidth,
            horizontalPadding: H_PADDING,
            spacing: GAP,
        }),
        [screenWidth],
    )
    const serverStatus = useServerStatus()
    const isConnected = useIsServerConnected()
    const enableManga = serverStatus?.settings?.library?.enableManga ?? false
    const showAdult = serverStatus?.settings?.anilist?.enableAdultContent

    useIOSScrollRefreshRateWorkaround()

    const [type, setType] = React.useState<"anime" | "manga">("anime")

    const { data: animeCollection, isLoading: animeLoading } = useGetRawAnimeCollection()
    const { data: mangaCollection, isLoading: mangaLoading } = useGetRawAnilistMangaCollection()
    const { data: animeTagMap } = useGetRawAnimeCollectionTags(isConnected)
    const { data: mangaTagMap } = useGetRawAnilistMangaCollectionTags(isConnected && enableManga)

    const lists = type === "anime"
        ? animeCollection?.MediaListCollection?.lists
        : mangaCollection?.MediaListCollection?.lists
    const mediaTagMap = type === "anime" ? animeTagMap : mangaTagMap

    const isLoading = type === "anime" ? animeLoading : mangaLoading

    // list selector
    const listOptions = React.useMemo(() => buildListOptions(lists, type), [lists, type])
    const [selectedList, setSelectedList] = React.useState("ALL")

    // reset selection when switching types
    React.useEffect(() => {
        setSelectedList("ALL")
    }, [type])

    // filter state
    const [filterParams, setFilterParams] = React.useState({ ...DEFAULT_COLLECTION_PARAMS })
    const [filterOpen, setFilterOpen] = React.useState(false)
    const activeFilterCount = countActiveCollectionFilters(filterParams, type)

    // title search
    const [titleInput, setTitleInput] = React.useState("")
    const [titleQuery, setTitleQuery] = React.useState("")
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    function handleTitleChange(text: string) {
        setTitleInput(text)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            setTitleQuery(text.trim())
        }, 300)
    }

    // reset search when switching types
    React.useEffect(() => {
        setTitleInput("")
        setTitleQuery("")
        setFilterParams({ ...DEFAULT_COLLECTION_PARAMS })
    }, [type])

    // build sections
    const sections = React.useMemo(
        () => buildSections(lists, selectedList, titleQuery, filterParams, showAdult, type, numColumns, mediaTagMap),
        [lists, selectedList, titleQuery, filterParams, showAdult, type, numColumns, mediaTagMap],
    )

    const hasFilters = activeFilterCount > 0 || !!titleQuery.trim()

    const flatItems = React.useMemo<CollectionListItem[]>(() => {
        return sections.flatMap((section, sectionIndex) => [
            {
                key: `header-${sectionIndex}-${section.title}`,
                kind: "section-header" as const,
                title: section.title,
                count: section.count,
            },
            ...section.data.map((row, rowIndex) => ({
                key: `row-${sectionIndex}-${rowIndex}-${row.map(entry => entry.id).join("-")}`,
                kind: "row" as const,
                row,
            })),
        ])
    }, [sections])

    const handlePress = React.useCallback((item: AL_BaseAnime | AL_BaseManga) => {
        router.push(`/(app)/entry/${type}/${item.id}`)
    }, [type])

    const renderCollectionItem = React.useCallback(({ item }: { item: CollectionListItem }) => {
        if (item.kind === "section-header") {
            return (
                <View className="flex-row items-center gap-2 pt-4 pb-2">
                    <Text className="text-base font-semibold text-white">
                        {item.title}
                    </Text>
                    <Text className="text-sm text-white/35">
                        {item.count}
                    </Text>
                </View>
            )
        }

        return <CollectionGridRow row={item.row} type={type} onPress={handlePress} cardWidth={cardWidth} numColumns={numColumns} />
    }, [cardWidth, handlePress, numColumns, type])

    return (
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
            <View className="gap-2.5 border-b border-white/5 bg-background px-4 py-4">
                <View className="flex-row items-center gap-2">
                    <Pressable
                        onPress={() => router.back()}
                        className="w-10 h-10 rounded-full items-center justify-center bg-white/[0.06] active:opacity-60"
                    >
                        <Ionicons name="arrow-back" size={20} color="rgba(255,255,255,0.8)" />
                    </Pressable>
                    <View className="flex-1">
                        <LibrarySearchBar
                            value={titleInput}
                            onChangeText={handleTitleChange}
                            placeholder={type === "anime" ? "Search anime\u2026" : "Search manga\u2026"}
                        />
                    </View>
                </View>

                <View className="flex-row items-center justify-between">
                    {enableManga ? (
                        <TypeToggle type={type} onChange={setType} />
                    ) : (
                        <View />
                    )}
                    <FilterButton
                        activeCount={activeFilterCount}
                        onPress={() => setFilterOpen(true)}
                    />
                </View>

                {listOptions.length > 2 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
                        <InlineSelect
                            options={listOptions}
                            value={selectedList}
                            nullable={false}
                            onSelect={v => v && setSelectedList(v)}
                        />
                    </ScrollView>
                )}
            </View>

            {isLoading ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color="rgba(255,255,255,0.3)" />
                </View>
            ) : !isConnected && !lists ? (
                <EmptyState hasFilters={false} />
            ) : sections.length === 0 ? (
                <EmptyState hasFilters={hasFilters} />
            ) : (
                <FlatList
                    data={flatItems}
                    renderItem={renderCollectionItem}
                    keyExtractor={item => item.key}
                    showsVerticalScrollIndicator={false}
                    contentInsetAdjustmentBehavior="never"
                    initialNumToRender={INITIAL_MY_LIST_ROWS}
                    maxToRenderPerBatch={INITIAL_MY_LIST_ROWS}
                    updateCellsBatchingPeriod={16}
                    windowSize={7}
                    removeClippedSubviews
                    contentContainerStyle={{
                        paddingHorizontal: H_PADDING,
                        paddingTop: 8,
                        paddingBottom: insets.bottom + 80,
                    }}
                />
            )}

            <CollectionFilterSheet
                open={filterOpen}
                onOpenChange={setFilterOpen}
                params={filterParams}
                type={type}
                onApply={setFilterParams}
            />
        </View>
    )
}
