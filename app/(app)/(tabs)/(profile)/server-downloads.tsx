import { useDebridCancelDownload, useDebridDeleteTorrent, useDebridDownloadTorrent, useDebridGetTorrents } from "@/api/hooks/debrid.hooks"
import { useGetActiveTorrentList, useTorrentClientAction } from "@/api/hooks/torrent_client.hooks"
import type { Debrid_TorrentItem, TorrentClient_Torrent } from "@/api/generated/types"
import { useServerStatus } from "@/atoms/server.atoms"
import { ProfileSubpageHeader } from "@/components/features/profile/profile-menu"
import { getDownloadQueueViewState, shouldShowQueueRefreshWarning } from "@/components/features/profile/server-downloads-state"
import { SegmentedControl } from "@/components/shared/segmented-control"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { useIsServerConnected } from "@/lib/offline"
import { toast } from "@/lib/utils/toast"
import { Ionicons } from "@expo/vector-icons"
import * as React from "react"
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type DownloadTab = "torrent" | "debrid"

export default function ServerDownloadsScreen() {
    const insets = useSafeAreaInsets()
    const isConnected = useIsServerConnected()
    const serverStatus = useServerStatus()
    const [activeTab, setActiveTab] = React.useState<DownloadTab>("torrent")
    const [isPullRefreshing, setIsPullRefreshing] = React.useState(false)

    useIOSScrollRefreshRateWorkaround()

    const torrentQuery = useGetActiveTorrentList(
        isConnected && activeTab === "torrent",
        "",
        "",
    )

    const debridQuery = useDebridGetTorrents(
        isConnected && activeTab === "debrid",
        3000,
    )

    const rawTorrents = torrentQuery.data
    const rawDebridTorrents = debridQuery.data
    const refetchTorrents = torrentQuery.refetch
    const refetchDebrid = debridQuery.refetch

    const torrents = React.useMemo(() => {
        return rawTorrents?.filter(t => {
            const isComplete = t.progress >= 1
            const isPausedOrStopped = t.status === "paused" || t.status === "stopped"
            return !(isComplete && isPausedOrStopped)
        }) ?? []
    }, [rawTorrents])

    const debridTorrents = React.useMemo(() => {
        return rawDebridTorrents?.filter(item => {
            const isComplete = item.completionPercentage >= 100
            const isPausedOrStopped = item.status?.toLowerCase() === "paused" || item.status?.toLowerCase() === "stopped"
            return !(isComplete && isPausedOrStopped)
        }) ?? []
    }, [rawDebridTorrents])

    const { mutate: performTorrentAction } = useTorrentClientAction()
    const { mutate: downloadDebrid } = useDebridDownloadTorrent()
    const { mutate: cancelDebridDownload } = useDebridCancelDownload()
    const { mutate: deleteDebridTorrent } = useDebridDeleteTorrent()

    const handleTorrentAction = React.useCallback((hash: string, name: string, action: "pause" | "resume" | "remove") => {
        if (action === "remove") {
            Alert.alert(
                "Delete torrent download?",
                `Are you sure you want to delete "${name}" from your torrent client?`,
                [
                    { text: "Cancel", style: "cancel" },
                    {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                            performTorrentAction({ hash, action: "remove", dir: "" })
                        },
                    },
                ],
            )
        } else {
            performTorrentAction({ hash, action, dir: "" })
        }
    }, [performTorrentAction])

    const handleDebridDownload = React.useCallback((item: Debrid_TorrentItem) => {
        const libraryPath = serverStatus?.settings?.library?.libraryPath
        if (!libraryPath) {
            toast.error("Library path not configured on server settings")
            return
        }
        downloadDebrid({ torrentItem: item, destination: libraryPath })
    }, [downloadDebrid, serverStatus?.settings?.library?.libraryPath])

    const handleDebridCancel = React.useCallback((item: Debrid_TorrentItem) => {
        cancelDebridDownload({ itemID: item.id })
    }, [cancelDebridDownload])

    const handleDebridDelete = React.useCallback((item: Debrid_TorrentItem) => {
        Alert.alert(
            "Delete debrid torrent?",
            `Are you sure you want to remove "${item.name}" from your debrid service?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                        deleteDebridTorrent({ torrentItem: item })
                    },
                },
            ],
        )
    }, [deleteDebridTorrent])

    if (!isConnected) {
        return (
            <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
                <ProfileSubpageHeader title="Server Downloads" />
                <View className="flex-1 items-center justify-center px-6 gap-3">
                    <Ionicons name="wifi-outline" size={48} color="rgba(255,255,255,0.25)" />
                    <Text className="text-white text-base font-semibold text-center">Server Offline</Text>
                    <Text className="text-white/40 text-sm text-center">Please connect to the Seanime server to manage downloads.</Text>
                </View>
            </View>
        )
    }

    const activeQuery = activeTab === "torrent" ? torrentQuery : debridQuery
    const activeItems = activeTab === "torrent" ? torrents : debridTorrents
    const hasActiveData = activeTab === "torrent" ? Array.isArray(rawTorrents) : Array.isArray(rawDebridTorrents)
    const viewState = getDownloadQueueViewState({
        hasData: hasActiveData,
        isError: activeQuery.isError,
        isRefetchError: activeQuery.isRefetchError,
        isSuccess: activeQuery.isSuccess,
        itemCount: activeItems.length,
    })
    const showRefreshWarning = shouldShowQueueRefreshWarning(viewState, activeQuery.isRefetchError)
    const errorMessage = activeQuery.error?.error || "The server download queue could not be loaded."

    const handleRefresh = React.useCallback(() => {
        setIsPullRefreshing(true)
        const refreshPromise = activeTab === "torrent" ? refetchTorrents() : refetchDebrid()
        void refreshPromise.finally(() => {
            setIsPullRefreshing(false)
        })
    }, [activeTab, refetchDebrid, refetchTorrents])

    const refreshControl = (
        <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={handleRefresh}
            tintColorClassName="accent-white/45"
            colorsClassName="accent-brand-500"
        />
    )

    return (
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
            <ProfileSubpageHeader
                title="Server Downloads"
                detail="Monitor active downloads running on the server."
            />

            <View className="mx-4 mt-2 mb-4">
                <SegmentedControl
                    options={[
                        { value: "torrent", label: "Torrent Client" },
                        { value: "debrid", label: "Debrid Service" },
                    ]}
                    value={activeTab}
                    onChange={(val) => setActiveTab(val as DownloadTab)}
                />
            </View>

            {viewState === "loading" ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" colorClassName="accent-white" />
                </View>
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40, flexGrow: 1 }}
                    refreshControl={refreshControl}
                    showsVerticalScrollIndicator={false}
                >
                    {viewState === "error" ? (
                        <QueueErrorState message={errorMessage} onRetry={handleRefresh} isRetrying={isPullRefreshing} />
                    ) : viewState === "empty" ? (
                        <QueueEmptyState />
                    ) : (
                        <>
                            {showRefreshWarning && (
                                <QueueRefreshWarning onRetry={handleRefresh} isRetrying={isPullRefreshing} />
                            )}

                            {activeTab === "torrent" && torrents.map(torrent => (
                                <TorrentRow
                                    key={torrent.hash}
                                    torrent={torrent}
                                    onAction={(action) => handleTorrentAction(torrent.hash, torrent.name, action)}
                                />
                            ))}

                            {activeTab === "debrid" && debridTorrents.map(item => (
                                <DebridRow
                                    key={item.id}
                                    item={item}
                                    onDownload={() => handleDebridDownload(item)}
                                    onCancel={() => handleDebridCancel(item)}
                                    onDelete={() => handleDebridDelete(item)}
                                />
                            ))}
                        </>
                    )}
                </ScrollView>
            )}
        </View>
    )
}

function QueueEmptyState() {
    return (
        <View className="flex-1 items-center justify-center px-6 gap-3">
            <Ionicons name="cloud-download-outline" size={48} color="rgba(255,255,255,0.15)" />
            <Text className="text-sm font-medium text-white/40 text-center">No active server downloads found</Text>
            <Text className="text-xs text-white/25 text-center">Pull down to check again.</Text>
        </View>
    )
}

function QueueErrorState({ message, onRetry, isRetrying }: { message: string; onRetry: () => void; isRetrying: boolean }) {
    return (
        <View className="flex-1 items-center justify-center px-6 gap-3">
            <View className="size-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
                <Ionicons name="cloud-offline-outline" size={24} color="rgb(248 113 113)" />
            </View>
            <Text className="text-base font-semibold text-white text-center">Couldn&apos;t load server downloads</Text>
            <Text className="text-sm leading-5 text-white/40 text-center" numberOfLines={3}>{message}</Text>
            <Pressable
                onPress={onRetry}
                disabled={isRetrying}
                className="mt-1 min-h-11 flex-row items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 active:bg-white/10 disabled:opacity-50"
            >
                {isRetrying ? (
                    <ActivityIndicator size="small" colorClassName="accent-white" />
                ) : (
                    <Ionicons name="refresh-outline" size={16} color="white" />
                )}
                <Text className="text-sm font-semibold text-white">Retry</Text>
            </Pressable>
        </View>
    )
}

function QueueRefreshWarning({ onRetry, isRetrying }: { onRetry: () => void; isRetrying: boolean }) {
    return (
        <View className="mb-3 flex-row items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
            <Ionicons name="warning-outline" size={18} color="rgb(251 191 36)" />
            <View className="flex-1 gap-0.5">
                <Text className="text-xs font-semibold text-amber-200">Unable to refresh</Text>
                <Text className="text-xs text-white/40">Showing the last server response.</Text>
            </View>
            <Pressable
                onPress={onRetry}
                disabled={isRetrying}
                hitSlop={8}
                className="min-h-9 min-w-14 items-center justify-center rounded-lg bg-amber-500/10 px-2 active:bg-amber-500/20 disabled:opacity-50"
            >
                {isRetrying ? (
                    <ActivityIndicator size="small" colorClassName="accent-amber-300" />
                ) : (
                    <Text className="text-xs font-semibold text-amber-300">Retry</Text>
                )}
            </Pressable>
        </View>
    )
}

function StatusBadge({ status }: { status: string }) {
    let bgClass = "bg-white/5 border border-white/10"
    let textClass = "text-white/40"
    const label = status.toUpperCase()

    switch (status.toLowerCase()) {
        case "downloading":
            bgClass = "bg-blue-500/15 border"
            textClass = "text-blue-400"
            break
        case "seeding":
            bgClass = "bg-blue-500/15 border"
            textClass = "text-blue-400"
            break
        case "completed":
            bgClass = "bg-green-500/15 border"
            textClass = "text-green-400"
            break
        case "paused":
        case "stopped":
            bgClass = "bg-amber-500/15 border"
            textClass = "text-amber-400"
            break
        case "queued":
            bgClass = "bg-violet-500/15 border border-violet-500/20"
            textClass = "text-violet-300"
            break
        case "error":
            bgClass = "bg-red-500/15 border border-red-500/20"
            textClass = "text-red-400"
            break
        case "stalled":
            bgClass = "bg-orange-500/15 border"
            textClass = "text-orange-400"
            break
    }

    return (
        <View className={`px-2 py-0.5 rounded-md ${bgClass}`}>
            <Text className={`text-[10px] font-bold ${textClass}`}>{label}</Text>
        </View>
    )
}

function TorrentRow({ torrent, onAction }: { torrent: TorrentClient_Torrent; onAction: (action: "pause" | "resume" | "remove") => void }) {
    const progressPercent = Math.max(0, Math.min(100, Math.round((torrent.progress || 0) * 100)))
    const canResume = torrent.status === "paused" || torrent.status === "stopped" || torrent.status === "error"

    return (
        <View className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 mb-3 gap-2">
            <View className="flex-row justify-between items-start">
                <Text className="text-white font-semibold text-sm flex-1 mr-2" numberOfLines={2}>
                    {torrent.name}
                </Text>
                <StatusBadge status={torrent.status} />
            </View>

            {torrent.status === "error" && !!torrent.error && (
                <Text className="text-xs text-red-300/80" numberOfLines={2}>{torrent.error}</Text>
            )}

            <View className="flex-row items-center justify-between">
                <Text className="text-xs text-white/40">{torrent.size}</Text>
                <View className="flex-row items-center gap-2">
                    {!!torrent.downSpeed && torrent.downSpeed !== "0 B/s" && (
                        <Text className="text-xs text-white/40">D: {torrent.downSpeed}</Text>
                    )}
                    {!!torrent.upSpeed && torrent.upSpeed !== "0 B/s" && (
                        <Text className="text-xs text-white/40">U: {torrent.upSpeed}</Text>
                    )}
                </View>
                {!!torrent.eta && torrent.eta !== "0s" && (
                    <Text className="text-xs text-white/40">ETA: {torrent.eta}</Text>
                )}
            </View>

            <View className="mt-1">
                <View className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <View className="h-full bg-brand-500 rounded-full" style={{ width: `${progressPercent}%` }} />
                </View>
                <View className="flex-row justify-between mt-1">
                    <Text className="text-[10px] text-white/40">Progress</Text>
                    <Text className="text-[10px] text-white/60 font-semibold">{progressPercent}%</Text>
                </View>
            </View>

            <View className="flex-row justify-end gap-2 mt-2">
                <Pressable
                    onPress={() => onAction(canResume ? "resume" : "pause")}
                    className="flex-row items-center bg-white/5 active:bg-white/10 px-3 py-1.5 rounded-lg gap-1 border border-white/5"
                >
                    <Ionicons name={canResume ? "play-outline" : "pause-outline"} size={14} color="white" />
                    <Text className="text-white text-xs font-medium">{canResume ? "Resume" : "Pause"}</Text>
                </Pressable>
                <Pressable
                    onPress={() => onAction("remove")}
                    className="flex-row items-center bg-red-500/10 active:bg-red-500/20 px-3 py-1.5 rounded-lg gap-1 border border-red-500/20"
                >
                    <Ionicons name="trash-outline" size={14} color="rgb(190 110 110)" />
                    <Text className="text-red-400 text-xs font-medium">Delete</Text>
                </Pressable>
            </View>
        </View>
    )
}

function DebridRow({
    item,
    onDownload,
    onCancel,
    onDelete,
}: {
    item: Debrid_TorrentItem
    onDownload: () => void
    onCancel: () => void
    onDelete: () => void
}) {
    const isDownloadingLocally = item.isDownloadingLocally || item.isQueuedForLocalDownload

    return (
        <View className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 mb-3 gap-2">
            <View className="flex-row justify-between items-start">
                <Text className="text-white font-semibold text-sm flex-1 mr-2" numberOfLines={2}>
                    {item.name}
                </Text>
                <StatusBadge status={item.status} />
            </View>

            <View className="flex-row items-center justify-between">
                <Text className="text-xs text-white/40">{item.formattedSize}</Text>
                {!!item.speed && (
                    <Text className="text-xs text-white/40">{item.speed}</Text>
                )}
                {!!item.eta && (
                    <Text className="text-xs text-white/40">ETA: {item.eta}</Text>
                )}
            </View>

            <View className="mt-1">
                <View className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <View className="h-full bg-brand-300 rounded-full" style={{ width: `${item.completionPercentage}%` }} />
                </View>
                <View className="flex-row justify-between mt-1">
                    <Text className="text-[10px] text-white/40">Progress</Text>
                    <Text className="text-[10px] text-white/60 font-semibold">{item.completionPercentage}%</Text>
                </View>
            </View>

            <View className="flex-row justify-end gap-2 mt-2">
                {isDownloadingLocally ? (
                    <Pressable
                        onPress={onCancel}
                        className="flex-row items-center bg-amber-500/10 active:bg-amber-500/20 px-3 py-1.5 rounded-lg gap-1 border border-amber-500/20"
                    >
                        <Ionicons name="close-circle-outline" size={14} color="rgb(190 155 95)" />
                        <Text className="text-amber-400 text-xs font-medium">Cancel Local</Text>
                    </Pressable>
                ) : item.isReady ? (
                    <Pressable
                        onPress={onDownload}
                        className="flex-row items-center bg-brand-500/10 active:bg-brand-500/20 px-3 py-1.5 rounded-lg gap-1 border border-brand-500/20"
                    >
                        <Ionicons name="cloud-download-outline" size={14} color="rgb(159 146 255)" />
                        <Text className="text-brand-400 text-xs font-medium">Download to Server</Text>
                    </Pressable>
                ) : null}

                <Pressable
                    onPress={onDelete}
                    className="flex-row items-center bg-red-500/10 active:bg-red-500/20 px-3 py-1.5 rounded-lg gap-1 border border-red-500/20"
                >
                    <Ionicons name="trash-outline" size={14} color="rgb(190 110 110)" />
                    <Text className="text-red-400 text-xs font-medium">Delete</Text>
                </Pressable>
            </View>
        </View>
    )
}
