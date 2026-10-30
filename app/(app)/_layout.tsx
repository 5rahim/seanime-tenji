import { ServerDataWrapper } from "@/api/components/server-data-wrapper"
import { useServerUrl } from "@/atoms/server.atoms"
import { useDownloadQueueResumeService } from "@/lib/downloads/download-queue-resume-service"
import { useDownloadSnapshotRefreshService, useOfflineSyncService, useServerLocalSyncService } from "@/lib/offline"
import { usePlayerEventListener } from "@/lib/player"
import { Stack } from "expo-router"
import { Platform, View } from "react-native"

function BackgroundServices() {
    useOfflineSyncService()
    useDownloadSnapshotRefreshService()
    useServerLocalSyncService()
    useDownloadQueueResumeService()
    return null
}

function PlayerEventMount() {
    usePlayerEventListener()
    return null
}

export default function AppLayout() {
    const serverUrl = useServerUrl()

    // ServerUrlWrapper in root _layout handles redirect to set-server-url
    // when serverUrl is null. We just show nothing here while waiting.
    if (!serverUrl) {
        return <View className="bg-background flex-1" />
    }

    return (
        <ServerDataWrapper>
            {!Platform.isTV && <BackgroundServices />}
            <PlayerEventMount />
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                    name="entry"
                    options={{
                        headerShown: false,
                        animation: "slide_from_right",
                    }}
                />
                <Stack.Screen name="(media)" options={{ headerShown: false }} />
            </Stack>
        </ServerDataWrapper>
    )
}
