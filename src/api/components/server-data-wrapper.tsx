import { ApiLoaders } from "@/api/components/api-loaders"
import { useGetSettings } from "@/api/hooks/settings.hooks"
import { useGetStatus } from "@/api/hooks/status.hooks"
import { useServerAuthToken, useServerStatus, useServerUrl, useSetServerStatus, useSetServerUrl } from "@/atoms/server.atoms"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { IMAGES } from "@/constants/images"
import { useManualOfflineMode } from "@/lib/offline"
import { isServerVersionSupported, MIN_SERVER_VERSION } from "@/lib/server-version"
import { router, usePathname } from "expo-router"
import React from "react"
import { Alert, Image, View } from "react-native"

export function ServerUrlWrapper({ children }: { children: React.ReactNode }) {

    const serverUrl = useServerUrl()
    const pathname = usePathname()

    React.useEffect(() => {
        async function checkServerUrl() {
            if (serverUrl) {
                if (pathname === "/set-server-url") return
                router.replace("/(app)/(tabs)/(library)")
            } else {
                if (pathname === "/set-server-url") return
                router.replace("/(out)/set-server-url")
            }
        }

        checkServerUrl()
    }, [serverUrl])

    return (
        <>
            {children}
        </>
    )
}

export function ServerDataWrapper({ children }: { children: React.ReactNode }) {

    const serverUrl = useServerUrl()
    const serverAuthToken = useServerAuthToken()
    const setServerUrl = useSetServerUrl()

    const setServerStatus = useSetServerStatus()
    // cached status from MMKV, available even when offline
    const cachedStatus = useServerStatus()

    const [manualOffline, setManualOffline] = useManualOfflineMode()

    const { data: _serverStatus, isLoading } = useGetStatus({ enabled: !manualOffline })

    React.useEffect(() => {
        if (_serverStatus) {
            setServerStatus(_serverStatus)
        }
    }, [_serverStatus, setServerStatus])

    // use either fresh or cached status, don't block on network
    const effectiveStatus = _serverStatus || cachedStatus
    const requiresServerAuth = !!effectiveStatus?.serverHasPassword
    const isUnsupportedServerVersion = !!_serverStatus && !isServerVersionSupported(_serverStatus.version)
    const authVerification = useGetSettings({
        enabled: requiresServerAuth && !!serverAuthToken && !manualOffline,
    })
    const isInvalidServerAuth = authVerification.error?.error === "UNAUTHENTICATED"

    const isConnectingOrAuthenticating = !manualOffline && (
        (isLoading && !effectiveStatus) ||
        (requiresServerAuth && (!serverAuthToken || authVerification.isLoading || isInvalidServerAuth))
    )

    const [showOfflineFallback, setShowOfflineFallback] = React.useState(false)

    React.useEffect(() => {
        if (!isConnectingOrAuthenticating) {
            setShowOfflineFallback(false)
            return
        }

        const timer = setTimeout(() => {
            setShowOfflineFallback(true)
        }, 3000)

        return () => clearTimeout(timer)
    }, [isConnectingOrAuthenticating])

    const handleChangeUrlPress = React.useCallback(() => {
        Alert.alert(
            "Change server URL?",
            "The setup screen has no back action. You will need to complete server setup before returning to the app.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Continue",
                    onPress: () => {
                        setServerUrl(null)
                        router.push("/(out)/set-server-url")
                    },
                },
            ],
        )
    }, [setServerUrl])

    React.useEffect(() => {
        if (manualOffline) return
        if (!requiresServerAuth) return

        if (!serverAuthToken || isInvalidServerAuth) {
            setServerStatus(null)
            router.replace("/(out)/set-server-url")
        }
    }, [isInvalidServerAuth, requiresServerAuth, serverAuthToken, setServerStatus, manualOffline])

    if (manualOffline) {
        return <ApiLoaders>
            {children}
        </ApiLoaders>
    }

    if (isConnectingOrAuthenticating && showOfflineFallback) {
        return <View className="bg-background flex-1 justify-center items-center gap-6 px-8">
            <Image source={IMAGES.logo2} style={{ width: 128, height: 128 }} resizeMode="contain" />
            <View className="items-center gap-1.5">
                <Text className="text-white text-base font-semibold">Connection is taking longer than expected</Text>
                <Text className="text-white/45 text-sm text-center">The server might be offline. You can switch to offline mode or update the server
                                                                    URL.</Text>
            </View>
            <View className="gap-3 w-full items-center">
                <Button
                    variant="default"
                    className="w-full max-w-xs z-[50] shadow shadow-foreground/5 rounded-full"
                    onPress={() => setManualOffline(true)}
                >
                    <Text>Switch to offline mode</Text>
                </Button>
                <Button
                    variant="secondary"
                    className="w-full max-w-xs z-[50] shadow shadow-foreground/5 rounded-full"
                    onPress={handleChangeUrlPress}
                >
                    <Text>Change URL</Text>
                </Button>
            </View>
        </View>
    }

    if (isLoading && !effectiveStatus) {
        return <View className="bg-background flex-1 justify-center items-center gap-4">
            <Image source={IMAGES.logo2} style={{ width: 128, height: 128 }} resizeMode="contain" />
            <Button
                variant="default"
                className="z-[50] shadow shadow-foreground/5 rounded-full"
                onPress={handleChangeUrlPress}
            >
                <Text>Change URL</Text>
            </Button>
        </View>
    }

    if (requiresServerAuth && (!serverAuthToken || authVerification.isLoading || isInvalidServerAuth)) {
        return <View className="bg-background flex-1 justify-center items-center gap-4">
            <Image source={IMAGES.logo2} style={{ width: 128, height: 128 }} resizeMode="contain" />
            <Text className="text-sm text-white/50">Authenticating server connection...</Text>
        </View>
    }

    if (isUnsupportedServerVersion) {
        return <View className="bg-background flex-1 items-center justify-center gap-5 px-8">
            <Image source={IMAGES.logo2} style={{ width: 104, height: 104 }} resizeMode="contain" />
            <View className="items-center gap-2">
                <Text className="text-center text-xl font-bold text-white">Server update required</Text>
                <Text className="text-center text-sm leading-5 text-white/55">
                    This version of Seanime Tenji requires a Seanime server with the version {MIN_SERVER_VERSION} or newer. This Seanime server is
                    running {_serverStatus.version || "an unknown version"}.
                </Text>
            </View>
            <Button
                variant="secondary"
                className="rounded-full px-6"
                onPress={handleChangeUrlPress}
            >
                <Text>Change URL</Text>
            </Button>
        </View>
    }

    return (
        <ApiLoaders>
            {children}
        </ApiLoaders>
    )
}
