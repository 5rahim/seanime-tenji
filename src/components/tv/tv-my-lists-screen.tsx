import { requestTVFocus } from "@/components/tv/tv-native"
import type {
    AL_AnimeCollection_MediaListCollection_Lists,
    AL_BaseAnime,
    AL_MediaListStatus,
    AL_MediaTagMap,
    Anime_EntryListData,
} from "@/api/generated/types"
import {
    useGetRawAnimeCollection,
    useGetRawAnimeCollectionTags,
} from "@/api/hooks/anilist.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import {
    TV,
    TVButton,
    TVCollectionFilterDrawer,
    TVInput,
    TVPillButton,
    TVPageSkeleton,
    TVShelf,
    TVToolbar,
    tvSize,
} from "@/components/tv"
import type { TVMediaMeta } from "@/components/tv/tv-shelf"
import {
    type CollectionParams,
    countActiveCollectionFilters,
    DEFAULT_COLLECTION_PARAMS,
    filterEntriesByTitle,
    filterListEntries,
} from "@/lib/utils/filtering"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useIsFocused } from "expo-router"
import * as React from "react"
import {
    FlatList,
    Pressable,
    ScrollView,
    Text,
    TVFocusGuideView,
    View,
} from "react-native"

const ORDER: AL_MediaListStatus[] = [
    "CURRENT",
    "REPEATING",
    "PLANNING",
    "PAUSED",
    "COMPLETED",
    "DROPPED",
]

const LABELS: Partial<Record<AL_MediaListStatus, string>> = {
    CURRENT: "Watching",
    REPEATING: "Rewatching",
    PLANNING: "Planning",
    PAUSED: "Paused",
    COMPLETED: "Completed",
    DROPPED: "Dropped",
}

type Shelf = {
    key: string
    title: string
    media: AL_BaseAnime[]
    meta: ReadonlyMap<number, TVMediaMeta>
}

type ListChoice = {
    value: string
    label: string
}

type ButtonRef = React.ElementRef<typeof Pressable>

function makeShelf(
    list: AL_AnimeCollection_MediaListCollection_Lists,
    key: string,
    title: string,
    query: string,
    params: CollectionParams,
    showAdult: boolean | undefined,
    tagMap: AL_MediaTagMap | undefined,
): Shelf | null {
    let entries = filterListEntries(list.entries, params, showAdult, tagMap)
    if (query) {
        entries = filterEntriesByTitle(entries, query) as typeof entries
    }
    if (entries.length === 0) return null

    const meta = new Map<number, TVMediaMeta>()
    for (const entry of entries) {
        if (!entry.media) continue
        const listData: Anime_EntryListData = {
            progress: entry.progress,
            repeat: entry.repeat,
            score: entry.score,
            status: entry.status,
        }
        meta.set(entry.media.id, { listData })
    }

    return {
        key,
        title,
        media: entries.flatMap(entry => entry.media ? [entry.media as AL_BaseAnime] : []),
        meta,
    }
}

function getChoices(lists: AL_AnimeCollection_MediaListCollection_Lists[]): ListChoice[] {
    const choices: ListChoice[] = [{ value: "ALL", label: "All lists" }]

    for (const status of ORDER) {
        const list = lists.find(item => !item.isCustomList && item.status === status)
        if (list?.entries?.length) {
            choices.push({ value: status, label: LABELS[status] ?? status })
        }
    }

    for (const list of lists) {
        if (list.isCustomList && list.name && list.entries?.length) {
            choices.push({ value: `custom:${list.name}`, label: list.name })
        }
    }

    return choices
}

function returnFocus(ref: React.RefObject<ButtonRef | null>) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => requestTVFocus(ref.current))
    })
}

export function TVMyListsScreen() {
    const isFocused = useIsFocused()
    const { data, isLoading } = useGetRawAnimeCollection()
    const { data: tagMap } = useGetRawAnimeCollectionTags()
    const serverStatus = useServerStatus()
    const showAdult = serverStatus?.settings?.anilist?.enableAdultContent
    const lists = data?.MediaListCollection?.lists ?? []

    const [input, setInput] = React.useState("")
    const [query, setQuery] = React.useState("")
    const [list, setList] = React.useState("ALL")
    const [params, setParams] = React.useState<CollectionParams>({
        ...DEFAULT_COLLECTION_PARAMS,
    })
    const [filterOpen, setFilterOpen] = React.useState(false)
    const [preferList, setPreferList] = React.useState(true)
    const [firstList, setFirstList] = React.useState<ButtonRef | null>(null)
    const filterRef = React.useRef<ButtonRef>(null)

    const choices = React.useMemo(() => getChoices(lists), [lists])
    const active = countActiveCollectionFilters(params, "anime")

    React.useEffect(() => {
        if (!choices.some(choice => choice.value === list)) {
            setList("ALL")
        }
    }, [choices, list])

    const shelves = React.useMemo(() => {
        const items: Shelf[] = []

        for (const status of ORDER) {
            if (list !== "ALL" && list !== status) continue
            const item = lists.find(entry => !entry.isCustomList && entry.status === status)
            if (!item) continue
            const shelf = makeShelf(
                item,
                status,
                LABELS[status] ?? status,
                query,
                params,
                showAdult,
                tagMap,
            )
            if (shelf) items.push(shelf)
        }

        for (const item of lists) {
            if (!item.isCustomList || !item.name) continue
            const key = `custom:${item.name}`
            if (list !== "ALL" && list !== key) continue
            const shelf = makeShelf(
                item,
                key,
                item.name,
                query,
                params,
                showAdult,
                tagMap,
            )
            if (shelf) items.push(shelf)
        }

        return items
    }, [list, lists, params, query, showAdult, tagMap])

    const submit = React.useCallback(() => {
        setQuery(input.trim())
    }, [input])

    const setFilter = React.useCallback((open: boolean) => {
        setFilterOpen(open)
        if (!open) returnFocus(filterRef)
    }, [])

    const filtered = Boolean(query) || active > 0

    if (isLoading && !data) {
        return <TVPageSkeleton toolbar />
    }

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                fadingEdgeLength={{ start: TV.navInset + tvSize(18), end: 0 }}
                contentContainerStyle={{
                    paddingBottom: tvSize(90),
                }}
                showsVerticalScrollIndicator={false}
            >
                <TVToolbar>
                    <View style={{ flex: 1, maxWidth: tvSize(760) }}>
                        <TVInput
                            value={input}
                            onChangeText={setInput}
                            onSubmitEditing={submit}
                            placeholder="Search your AniList collection"
                            placeholderTextColor="rgba(255,255,255,0.35)"
                            autoCorrect={false}
                            autoCapitalize="none"
                            returnKeyType="search"
                            icon={(
                                <Ionicons
                                    name="search"
                                    size={tvSize(22)}
                                    color="rgba(255,255,255,0.58)"
                                />
                            )}
                        />
                    </View>
                    <TVButton
                        label="Search"
                        variant="primary"
                        size="compact"
                        icon={<Ionicons name="search" size={tvSize(20)} color="white" />}
                        onPress={submit}
                    />
                    <TVButton
                        ref={filterRef}
                        label={active ? `Filters (${active})` : "Filters"}
                        variant="secondary"
                        size="compact"
                        icon={<Ionicons name="options-outline" size={tvSize(20)} color="white" />}
                        onPress={() => setFilterOpen(true)}
                    />
                </TVToolbar>

                <View style={{ paddingTop: tvSize(22), gap: TV.sectionGap }}>
                    <TVFocusGuideView
                        autoFocus={isFocused}
                        destinations={firstList ? [firstList] : undefined}
                        trapFocusLeft
                        trapFocusRight
                    >
                        <FlatList
                            horizontal
                            data={choices}
                            keyExtractor={choice => choice.value}
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{
                                paddingHorizontal: TV.gutter,
                                paddingTop: tvSize(8),
                                paddingBottom: tvSize(12),
                                gap: tvSize(12),
                            }}
                            renderItem={({ item, index }) => (
                                <TVPillButton
                                    ref={index === 0 ? setFirstList : undefined}
                                    label={item.label}
                                    active={list === item.value}
                                    preferred={preferList && index === 0}
                                    onFocus={() => {
                                        if (index === 0) setPreferList(false)
                                    }}
                                    onPress={() => setList(item.value)}
                                />
                            )}
                        />
                    </TVFocusGuideView>

                    {shelves.map(shelf => (
                        <TVShelf
                            key={shelf.key}
                            title={shelf.title}
                            media={shelf.media}
                            metaById={shelf.meta}
                            showAudienceScore
                            hideLibraryBadge
                        />
                    ))}

                    {shelves.length === 0 ? (
                        <View
                            style={{
                                alignItems: "center",
                                paddingTop: tvSize(90),
                                paddingHorizontal: TV.gutter,
                                gap: tvSize(8),
                            }}
                        >
                            <Text className="font-semibold text-white" style={{ fontSize: tvSize(24) }}>
                                {filtered ? "No entries match" : "No AniList entries"}
                            </Text>
                            <Text className="text-white/40" style={{ fontSize: tvSize(18) }}>
                                {filtered
                                    ? "Try another title or change the filters."
                                    : "Add a title from Discover to start a list."}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </ScrollView>

            <TVCollectionFilterDrawer
                open={filterOpen}
                onOpenChange={setFilter}
                params={params}
                onApply={setParams}
            />
        </View>
    )
}
