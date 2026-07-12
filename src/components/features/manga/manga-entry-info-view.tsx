import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useGetMangaEntryDetails } from "@/api/hooks/manga.hooks"
import { HorizontalMediaCardList } from "@/components/features/media/horizontal-media-card-list"
import { MediaEntryCard } from "@/components/features/media/media-entry-card"
import { CenteredSpinner } from "@/components/shared/centered-spinner"
import { LuffyError } from "@/components/shared/luffy-error"
import { SeaImage } from "@/components/shared/sea-image"
import { Surface } from "@/components/shared/surface"
import { buildMediaEntryHref } from "@/lib/media-entry-route"
import { getHorizontalMediaCardRowHeight, getHorizontalMediaCardWidth } from "@/lib/responsive-card-layout"
import { cn } from "@/lib/utils"
import { router } from "expo-router"
import * as React from "react"
import { FlatList, Text, useWindowDimensions, View } from "react-native"

const SPACING = 10
const CARD_PADDING_H = 20

function formatRelationType(type: string) {
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase().replace(/_/g, " ")
}

type MangaEntryInfoViewProps = {
    mediaId: number
    fallbackDescription?: string
}

function stripHtml(value?: string) {
    if (!value) return ""

    return value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&quot;/g, "\"")
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&")
        .trim()
}

export function MangaEntryInfoView({ mediaId, fallbackDescription }: MangaEntryInfoViewProps) {
    const { data, isLoading } = useGetMangaEntryDetails(mediaId)
    const { width: screenWidth } = useWindowDimensions()
    const cardWidth = React.useMemo(() => getHorizontalMediaCardWidth(screenWidth), [screenWidth])
    const cardRowHeight = React.useMemo(() => getHorizontalMediaCardRowHeight(cardWidth), [cardWidth])

    const description = React.useMemo(() => {
        return stripHtml(fallbackDescription)
    }, [fallbackDescription])

    const characters = React.useMemo(() => {
        return (data?.characters?.edges ?? []).filter(edge => !!edge.node).slice(0, 20)
    }, [data?.characters?.edges])

    const animeRelations = React.useMemo(() => {
        return (data?.relations?.edges ?? []).filter(
            edge =>
                !!edge.node &&
                edge.node.type === "ANIME" &&
                (edge.node.format === "TV" || edge.node.format === "MOVIE" || edge.node.format === "TV_SHORT"),
        )
    }, [data?.relations?.edges])

    const recommendations = React.useMemo(() => {
        return (data?.recommendations?.edges ?? [])
            .map(edge => edge.node?.mediaRecommendation)
            .filter((m): m is NonNullable<typeof m> => !!m)
    }, [data?.recommendations?.edges])

    if (isLoading && !data) {
        return <CenteredSpinner />
    }

    if (!description && characters.length === 0 && animeRelations.length === 0 && recommendations.length === 0) {
        return (
            <LuffyError
                title="No info available"
                description="Could not load extended details or characters for this title right now."
            />
        )
    }

    return (
        <View className="gap-6 pt-2">
            {!!description && (
                <View className="px-4">
                    <Text className="text-xl font-bold text-foreground mb-3">Description</Text>
                    <Surface className="p-4">
                        <Text className="text-sm leading-6 text-white/70">
                            {description}
                        </Text>
                    </Surface>
                </View>
            )}

            {characters.length > 0 && (
                <View className="px-4">
                    <Text className="text-xl font-bold text-foreground mb-3">Characters</Text>
                    <Surface className="overflow-hidden">
                        {characters.map((edge, index) => (
                            <View
                                key={edge.id ?? edge.node?.id}
                                className={cn(
                                    "flex-row items-center gap-3 p-3",
                                    index !== 0 && "border-t border-white/5",
                                )}
                            >
                                <View
                                    style={{ width: 40, height: 56, borderRadius: 8, overflow: "hidden" }}
                                    className="bg-white/10 flex-none"
                                >
                                    <SeaImage
                                        source={{ uri: edge.node?.image?.large }}
                                        contentFit="cover"
                                        transition={100}
                                        style={{ width: "100%", height: "100%" }}
                                    />
                                </View>

                                <View className="flex-1 gap-0.5">
                                    <Text className="text-sm font-semibold text-white" numberOfLines={1}>
                                        {edge.node?.name?.full || edge.name || "Unknown"}
                                    </Text>
                                    {!!edge.node?.name?.native && edge.node.name.native !== edge.node?.name?.full && (
                                        <Text className="text-xs text-white/40" numberOfLines={1}>
                                            {edge.node.name.native}
                                        </Text>
                                    )}
                                    {!!edge.role && (
                                        <Text className="text-xs font-medium text-white/35 uppercase tracking-wide">
                                            {edge.role.replace(/_/g, " ")}
                                        </Text>
                                    )}
                                </View>
                            </View>
                        ))}
                    </Surface>
                </View>
            )}

            {animeRelations.length > 0 && (
                <View>
                    <Text className="text-xl font-bold text-foreground mb-3 px-4">Anime Adaptation</Text>
                    <View style={{ height: cardRowHeight }}>
                        <FlatList
                            data={animeRelations}
                            horizontal
                            style={{ height: cardRowHeight }}
                            showsHorizontalScrollIndicator={false}
                            keyExtractor={(item) => String(item.node?.id)}
                            contentContainerStyle={{ gap: SPACING, paddingHorizontal: CARD_PADDING_H }}
                            decelerationRate="normal"
                            renderItem={({ item }) => {
                                const label = formatRelationType(item.relationType ?? "")
                                const suffix = item.node?.format === "MOVIE" ? " (Movie)" : ""
                                return (
                                    <View style={{ position: "relative", width: cardWidth }}>
                                        <MediaEntryCard
                                            type="anime"
                                            media={item.node as AL_BaseAnime}
                                            cardWidth={cardWidth}
                                            onPress={() => router.replace(buildMediaEntryHref(item.node as AL_BaseAnime, "anime"))}
                                            overlay={(
                                                <View
                                                    style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}
                                                    className="bg-gray-950/80 px-2 py-1 rounded-t-xl"
                                                    pointerEvents="none"
                                                >
                                                    <Text
                                                        className="text-[10px] font-bold text-white/90 text-center uppercase tracking-wider"
                                                        numberOfLines={1}
                                                    >
                                                        {label}{suffix}
                                                    </Text>
                                                </View>
                                            )}
                                        />
                                    </View>
                                )
                            }}
                        />
                    </View>
                </View>
            )}

            {recommendations.length > 0 && (
                <HorizontalMediaCardList
                    type="manga"
                    title="Recommendations"
                    media={recommendations as unknown as AL_BaseManga[]}
                    showAudienceScore
                    onMediaPress={(media) => router.replace(buildMediaEntryHref(media, "manga"))}
                />
            )}
        </View>
    )
}
