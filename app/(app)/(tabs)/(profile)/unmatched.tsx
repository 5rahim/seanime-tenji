import { useAnilistListAnime } from "@/api/hooks/anilist.hooks"
import { useGetLibraryCollection } from "@/api/hooks/anime_collection.hooks"
import { useAnimeEntryManualMatch } from "@/api/hooks/anime_entries.hooks"
import { useServerUrl } from "@/atoms/server.atoms"
import { ProfileSubpageHeader } from "@/components/features/profile/profile-menu"
import { SeaImage } from "@/components/shared/sea-image"
import { SeaBottomSheet } from "@/components/ui/bottom-sheet"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { syncLocalServerFilesToDownloads } from "@/lib/downloads/download-manager"
import { useIsServerConnected } from "@/lib/offline"
import { Ionicons } from "@expo/vector-icons"
import { BottomSheetTextInput } from "@gorhom/bottom-sheet"
import * as React from "react"
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type UnmatchedGroup = {
    dir: string
    localFiles?: Array<any>
    suggestions?: Array<any>
}

export default function UnmatchedScreen() {
    const insets = useSafeAreaInsets()
    const isConnected = useIsServerConnected()
    const serverUrl = useServerUrl()

    useIOSScrollRefreshRateWorkaround()

    const { data: libraryCollection, isLoading: isLoadingCollection } = useGetLibraryCollection({
        enabled: isConnected,
    })

    const { mutate: manualMatch, isPending: isMatching } = useAnimeEntryManualMatch()

    const [selectedGroup, setSelectedGroup] = React.useState<UnmatchedGroup | null>(null)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [debouncedSearchQuery, setDebouncedSearchQuery] = React.useState("")

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    const { data: searchResults, isLoading: isSearching } = useAnilistListAnime(
        {
            search: debouncedSearchQuery,
            page: 1,
            perPage: 20,
        },
        debouncedSearchQuery.length > 0 && selectedGroup !== null,
    )

    const unmatchedGroups = libraryCollection?.unmatchedGroups ?? []

    const handleMatch = React.useCallback((group: UnmatchedGroup, mediaId: number, animeTitle: string) => {
        if (!group.localFiles || group.localFiles.length === 0) return

        Alert.alert(
            "Match files?",
            `Are you sure you want to match this folder to "${animeTitle}"?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Match",
                    onPress: () => {
                        setSelectedGroup(null)
                        setSearchQuery("")
                        manualMatch(
                            {
                                mediaId,
                                paths: group.localFiles!.map(f => f.path),
                            },
                            {
                                onSuccess: () => {
                                    if (serverUrl) {
                                        void syncLocalServerFilesToDownloads(serverUrl)
                                    }
                                },
                            },
                        )
                    },
                },
            ],
        )
    }, [manualMatch, serverUrl])

    const openManualSearch = React.useCallback((group: UnmatchedGroup) => {
        setSelectedGroup(group)
        setSearchQuery("")
    }, [])

    if (!isConnected) {
        return (
            <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
                <ProfileSubpageHeader title="Resolve Unmatched" />
                <View className="flex-1 items-center justify-center px-6 gap-3">
                    <Ionicons name="wifi-outline" size={48} color="rgba(255,255,255,0.25)" />
                    <Text className="text-white text-base font-semibold text-center">Server Offline</Text>
                    <Text className="text-white/40 text-sm text-center">Please connect to the Seanime server to resolve unmatched files.</Text>
                </View>
            </View>
        )
    }

    return (
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
            <ProfileSubpageHeader
                title="Resolve Unmatched"
                detail="Manually match unmatched files/folders to anime entries."
            />

            {isLoadingCollection || isMatching ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color="white" />
                </View>
            ) : unmatchedGroups.length === 0 ? (
                <View className="flex-1 items-center justify-center px-6 gap-3">
                    <Ionicons name="checkmark-circle-outline" size={48} color="rgba(74,222,128,0.4)" />
                    <Text className="text-white text-base font-semibold text-center">All Files Matched</Text>
                    <Text className="text-white/40 text-sm text-center">No unmatched files or directories found on your server.</Text>
                </View>
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
                    showsVerticalScrollIndicator={false}
                >
                    {unmatchedGroups.map((group, index) => {
                        const pathParts = group.dir.split(/[/\\]/)
                        const folderName = pathParts[pathParts.length - 1] || group.dir

                        return (
                            <View
                                key={`${group.dir}-${index}`}
                                className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 mb-3 gap-3"
                            >
                                <View className="flex-row items-start gap-3">
                                    <View className="w-10 h-10 rounded-xl bg-indigo-500/10 items-center justify-center border border-indigo-500/20">
                                        <Ionicons name="folder-open-outline" size={20} color="#818cf8" />
                                    </View>
                                    <View className="flex-1">
                                        <Text className="text-white font-bold text-sm" numberOfLines={1}>
                                            {folderName}
                                        </Text>
                                        <Text className="text-xs text-white/40 mt-0.5" numberOfLines={1}>
                                            {group.dir}
                                        </Text>
                                        <Text className="text-[10px] text-white/60 font-semibold mt-1">
                                            {group.localFiles?.length || 0} unmatched files
                                        </Text>
                                    </View>
                                </View>

                                {group.suggestions && group.suggestions.length > 0 && (
                                    <View className="mt-1">
                                        <Text className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">
                                            Suggestions
                                        </Text>
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
                                            {group.suggestions.map((anime) => (
                                                <Pressable
                                                    key={anime.id}
                                                    onPress={() => handleMatch(group, anime.id, anime.title?.userPreferred || "Anime")}
                                                    className="flex-row items-center bg-indigo-500/10 border border-indigo-500/20 active:bg-indigo-500/20 px-3 py-2 rounded-xl gap-2 mr-2"
                                                >
                                                    <SeaImage
                                                        source={{ uri: anime.coverImage?.large }}
                                                        style={{ width: 20, height: 20, borderRadius: 4 }}
                                                    />
                                                    <Text className="text-indigo-300 text-xs font-semibold max-w-[150px]" numberOfLines={1}>
                                                        {anime.title?.userPreferred || anime.title?.romaji || anime.title?.english}
                                                    </Text>
                                                </Pressable>
                                            ))}
                                        </ScrollView>
                                    </View>
                                )}

                                <Pressable
                                    onPress={() => openManualSearch(group)}
                                    className="flex-row items-center justify-center bg-white/5 active:bg-white/10 border border-white/5 py-2.5 rounded-xl gap-2 mt-1"
                                >
                                    <Ionicons name="search-outline" size={14} color="rgba(255,255,255,0.7)" />
                                    <Text className="text-white text-xs font-semibold">Search Manually</Text>
                                </Pressable>
                            </View>
                        )
                    })}
                </ScrollView>
            )}

            <SeaBottomSheet
                title="Match Folder"
                open={selectedGroup !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setSelectedGroup(null)
                        setSearchQuery("")
                    }
                }}
                snapPoints={["60%", "85%"]}
            >
                {selectedGroup && (
                    <View className="gap-4">
                        <View className="gap-1.5">
                            <Text className="text-xs text-white/40 leading-relaxed">
                                Search AniList to manually match the folder:
                            </Text>
                            <Text className="text-sm font-semibold text-white" numberOfLines={1}>
                                {selectedGroup.dir}
                            </Text>
                        </View>

                        <View className="h-12 flex-row items-center rounded-2xl border border-white/10 bg-white/5 px-4">
                            <BottomSheetTextInput
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholder="Search AniList..."
                                placeholderTextColor="rgba(255,255,255,0.35)"
                                className="flex-1 py-0 text-foreground"
                                returnKeyType="search"
                                autoCorrect={false}
                                autoCapitalize="none"
                            />
                        </View>

                        {isSearching ? (
                            <View className="py-12 items-center">
                                <ActivityIndicator size="small" color="white" />
                            </View>
                        ) : searchQuery.length > 0 && (!searchResults?.Page?.media || searchResults.Page.media.length === 0) ? (
                            <View className="py-12 items-center">
                                <Text className="text-white/40 text-sm">No results found</Text>
                            </View>
                        ) : (
                            <ScrollView className="max-h-[300px]" showsVerticalScrollIndicator={false}>
                                {searchResults?.Page?.media?.map((anime) => (
                                    <Pressable
                                        key={anime.id}
                                        onPress={() => handleMatch(selectedGroup, anime.id, anime.title?.userPreferred || "Anime")}
                                        className="flex-row items-center p-3 rounded-2xl border border-white/5 bg-white/[0.02] mb-2 active:bg-white/5 gap-3"
                                    >
                                        <SeaImage source={{ uri: anime.coverImage?.large }} style={{ width: 32, height: 40, borderRadius: 6 }} />
                                        <View className="flex-1">
                                            <Text className="text-white font-semibold text-sm" numberOfLines={1}>
                                                {anime.title?.userPreferred || anime.title?.romaji || anime.title?.english}
                                            </Text>
                                            <Text className="text-white/40 text-xs mt-1" numberOfLines={1}>
                                                {anime.seasonYear ? `${anime.seasonYear} · ` : ""}{anime.format || ""}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
                                    </Pressable>
                                ))}
                            </ScrollView>
                        )}
                    </View>
                )}
            </SeaBottomSheet>
        </View>
    )
}
