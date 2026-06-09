import { useDebridCancelDownload, useDebridDeleteTorrent, useDebridDownloadTorrent, useDebridGetTorrents } from "@/api/hooks/debrid.hooks"
import { useGetActiveTorrentList, useTorrentClientAction } from "@/api/hooks/torrent_client.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { ProfileSubpageHeader } from "@/components/features/profile/profile-menu"
import { SegmentedControl } from "@/components/shared/segmented-control"
import { useIOSScrollRefreshRateWorkaround } from "@/hooks/use-ios-scroll-refresh-rate-workaround"
import { useIsServerConnected } from "@/lib/offline"
import { toast } from "@/lib/utils/toast"
import { Ionicons } from "@expo/vector-icons"
import * as React from "react"
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type DownloadTab = "torrent" | "debrid"

export default function ServerDownloadsScreen() {
    const insets = useSafeAreaInsets()
    const isConnected = useIsServerConnected()
    const serverStatus = useServerStatus()
    const [activeTab, setActiveTab] = React.useState<DownloadTab>("torrent")

    useIOSScrollRefreshRateWorkaround()

    const { data: rawTorrents, isLoading: isLoadingTorrents } = useGetActiveTorrentList(
        isConnected && activeTab === "torrent",
        "",
        "",
    )

    const { data: rawDebridTorrents, isLoading: isLoadingDebrid } = useDebridGetTorrents(
        isConnected && activeTab === "debrid",
        3000,
    )

    const torrents = React.useMemo(() => {
        return rawTorrents?.filter(t => {
            const isComplete = t.progress >= 1
            const isPausedOrStopped = t.status === "paused" || t.status === "stopped"
            return !(isComplete && isPausedOrStopped)
        })
    }, [rawTorrents])

    const debridTorrents = React.useMemo(() => {
        return rawDebridTorrents?.filter((item: any) => {
            const isComplete = item.completionPercentage >= 100
            const isPausedOrStopped = item.status?.toLowerCase() === "paused" || item.status?.toLowerCase() === "stopped"
            return !(isComplete && isPausedOrStopped)
        })
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

    const handleDebridDownload = React.useCallback((item: any) => {
        const libraryPath = serverStatus?.settings?.library?.libraryPath
        if (!libraryPath) {
            toast.error("Library path not configured on server settings")
            return
        }
        downloadDebrid({ torrentItem: item, destination: libraryPath })
    }, [downloadDebrid, serverStatus?.settings?.library?.libraryPath])

    const handleDebridCancel = React.useCallback((item: any) => {
        cancelDebridDownload({ itemID: item.id })
    }, [cancelDebridDownload])

    const handleDebridDelete = React.useCallback((item: any) => {
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

    const isLoading = activeTab === "torrent" ? isLoadingTorrents : isLoadingDebrid
    const isEmpty = activeTab === "torrent" ? !torrents || torrents.length === 0 : !debridTorrents || debridTorrents.length === 0

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

            {isLoading ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color="white" />
                </View>
            ) : isEmpty ? (
                <View className="flex-1 items-center justify-center px-6 gap-3">
                    <Ionicons name="cloud-download-outline" size={48} color="rgba(255,255,255,0.15)" />
                    <Text className="text-white/40 text-sm font-medium text-center">No active server downloads found</Text>
                </View>
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
                    showsVerticalScrollIndicator={false}
                >
                    {activeTab === "torrent" && torrents?.map((torrent) => (
                        <TorrentRow
                            key={torrent.hash}
                            torrent={torrent}
                            onAction={(action) => handleTorrentAction(torrent.hash, torrent.name, action)}
                        />
                    ))}

                    {activeTab === "debrid" && debridTorrents?.map((item) => (
                        <DebridRow
                            key={item.id}
                            item={item}
                            onDownload={() => handleDebridDownload(item)}
                            onCancel={() => handleDebridCancel(item)}
                            onDelete={() => handleDebridDelete(item)}
                        />
                    ))}
                </ScrollView>
            )}
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
        case "error":
            bgClass = "bg-red-500/15 border"
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

function TorrentRow({ torrent, onAction }: { torrent: any; onAction: (action: "pause" | "resume" | "remove") => void }) {
    const progressPercent = Math.round((torrent.progress || 0) * 100)
    const isPaused = torrent.status === "paused" || torrent.status === "stopped"

    return (
        <View className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 mb-3 gap-2">
            <View className="flex-row justify-between items-start">
                <Text className="text-white font-semibold text-sm flex-1 mr-2" numberOfLines={2}>
                    {torrent.name}
                </Text>
                <StatusBadge status={torrent.status} />
            </View>

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
                    onPress={() => onAction(isPaused ? "resume" : "pause")}
                    className="flex-row items-center bg-white/5 active:bg-white/10 px-3 py-1.5 rounded-lg gap-1 border border-white/5"
                >
                    <Ionicons name={isPaused ? "play-outline" : "pause-outline"} size={14} color="white" />
                    <Text className="text-white text-xs font-medium">{isPaused ? "Resume" : "Pause"}</Text>
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
    item: any
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
