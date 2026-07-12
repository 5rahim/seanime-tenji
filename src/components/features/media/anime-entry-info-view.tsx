import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useGetAnilistAnimeDetails } from "@/api/hooks/anilist.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
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

type AnimeEntryInfoViewProps = {
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

export function AnimeEntryInfoView({ mediaId, fallbackDescription }: AnimeEntryInfoViewProps) {
    const { data, isLoading } = useGetAnilistAnimeDetails(mediaId)
    const serverStatus = useServerStatus()
    const { width: screenWidth } = useWindowDimensions()
    const cardWidth = React.useMemo(() => getHorizontalMediaCardWidth(screenWidth), [screenWidth])
    const cardRowHeight = React.useMemo(() => getHorizontalMediaCardRowHeight(cardWidth), [cardWidth])

    const description = React.useMemo(() => {
        return stripHtml(data?.description || fallbackDescription)
    }, [data?.description, fallbackDescription])

    const characters = React.useMemo(() => {
        return (data?.characters?.edges ?? []).filter(edge => !!edge.node).slice(0, 20)
    }, [data?.characters?.edges])

    const sourceManga = React.useMemo(() => {
        if (!serverStatus?.settings?.library?.enableManga) return undefined

        return (data?.relations?.edges ?? []).find(
            edge =>
                !!edge.node &&
                (edge.relationType === "SOURCE" || edge.relationType === "ADAPTATION") &&
                edge.node.format === "MANGA",
        )?.node
    }, [data?.relations?.edges, serverStatus?.settings?.library?.enableManga])

    const relations = React.useMemo(() => {
        return (data?.relations?.edges ?? []).filter(
            edge =>
                !!edge.node &&
                edge.relationType !== "CHARACTER" &&
                edge.node.format !== "MANGA" &&
                edge.node.format !== "ONE_SHOT" &&
                edge.node.format !== "NOVEL" &&
                edge.node.format !== "MUSIC",
        )
    }, [data?.relations?.edges])

    const relationCards = React.useMemo(() => {
        const items: Array<
            | { key: string; kind: "source-manga"; media: AL_BaseManga }
            | { key: string; kind: "relation"; edge: typeof relations[number] }
        > = []

        if (sourceManga) {
            items.push({
                key: `source-${sourceManga.id}`,
                kind: "source-manga",
                media: sourceManga as unknown as AL_BaseManga,
            })
        }

        relations.forEach(edge => {
            items.push({
                key: `relation-${edge.node?.id}-${edge.relationType}`,
                kind: "relation",
                edge,
            })
        })

        return items
    }, [relations, sourceManga])

    const recommendations = React.useMemo(() => {
        return (data?.recommendations?.edges ?? [])
            .map(edge => edge.node?.mediaRecommendation)
            .filter((m): m is NonNullable<typeof m> => !!m)
    }, [data?.recommendations?.edges])

    if (isLoading && !data) {
        return <CenteredSpinner />
    }

    if (!description && characters.length === 0 && relationCards.length === 0 && recommendations.length === 0) {
        return (
            <LuffyError
                title="No info available"
                description="Could not load the extended AniList description or characters for this title right now."
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
                                    index !== 0 && "border-t border-white/[0.05]",
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

            {relationCards.length > 0 && (
                <View>
                    <Text className="text-xl font-bold text-foreground mb-3 px-4">Relations</Text>
                    <View style={{ height: cardRowHeight }}>
                        <FlatList
                            data={relationCards}
                            horizontal
                            style={{ height: cardRowHeight }}
                            showsHorizontalScrollIndicator={false}
                            keyExtractor={(item) => item.key}
                            contentContainerStyle={{ gap: SPACING, paddingHorizontal: CARD_PADDING_H }}
                            decelerationRate="normal"
                            renderItem={({ item }) => {
                                if (item.kind === "source-manga") {
                                    return (
                                        <View style={{ position: "relative", width: cardWidth }}>
                                            <MediaEntryCard
                                                type="manga"
                                                media={item.media}
                                                cardWidth={cardWidth}
                                                onPress={() => router.replace(buildMediaEntryHref(item.media, "manga"))}
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
                                                            Manga
                                                        </Text>
                                                    </View>
                                                )}
                                            />
                                        </View>
                                    )
                                }

                                const label = formatRelationType(item.edge.relationType ?? "")
                                const suffix = item.edge.node?.format === "MOVIE" ? " (Movie)" : ""
                                return (
                                    <View style={{ position: "relative", width: cardWidth }}>
                                        <MediaEntryCard
                                            type="anime"
                                            media={item.edge.node as AL_BaseAnime}
                                            cardWidth={cardWidth}
                                            onPress={() => router.replace(buildMediaEntryHref(item.edge.node as AL_BaseAnime, "anime"))}
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
                    type="anime"
                    title="Recommendations"
                    media={recommendations as unknown as AL_BaseAnime[]}
                    showAudienceScore
                    onMediaPress={(media) => router.replace(buildMediaEntryHref(media, "anime"))}
                />
            )}
        </View>
    )
}
