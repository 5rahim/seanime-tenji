import { buildSeaQuery } from "@/api/client/requests"
import { hashServerPassword } from "@/api/client/server-auth"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useSetServerUrl } from "@/atoms/server.atoms"
import { useServerUrl, useSetServerAuthToken, useSetServerStatus } from "@/atoms/server.atoms"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IMAGES } from "@/constants/images"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { Ionicons } from "@expo/vector-icons"
import * as Linking from "expo-linking"
import { router } from "expo-router"
import * as React from "react"
import { Image, KeyboardAvoidingView, Pressable, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

export default function Screen() {
    const currentServerUrl = useServerUrl()
    const setServerStatus = useSetServerStatus()
    const setServerAuthToken = useSetServerAuthToken()

    const [inputValue, setInputValue] = React.useState(currentServerUrl ?? "")
    const [passwordValue, setPasswordValue] = React.useState("")
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const setServerUrl = useSetServerUrl()

    // React.useEffect(() => {
    //     if (!inputValue && currentServerUrl) {
    //         setInputValue(currentServerUrl)
    //     }
    // }, [currentServerUrl, inputValue])

    const showErrorToast = React.useCallback((message: string) => {
        toast.error(message, {
            position: "bottom",
            visibilityTime: 1000,
        })
    }, [])

    const handleOnContinue = React.useCallback(() => {
        let sanitizedUrl = inputValue.trim()
        if (!sanitizedUrl) {
            showErrorToast("Please enter a valid server URL")
            return
        }

        if (!sanitizedUrl.startsWith("http://") && !sanitizedUrl.startsWith("https://")) {
            showErrorToast("URL must start with http:// or https://")
            return
        }
        void (async () => {
            if (sanitizedUrl.endsWith("/")) {
                sanitizedUrl = sanitizedUrl.slice(0, -1)
            }

            const trimmedPassword = passwordValue.trim()
            const hashedPassword = trimmedPassword ? hashServerPassword(trimmedPassword) : null

            setIsSubmitting(true)

            logger("set-server-url").info("Setting server url:", sanitizedUrl)

            try {
                await buildSeaQuery({
                    serverUrl: sanitizedUrl,
                    endpoint: API_ENDPOINTS.SETTINGS.GetSettings.endpoint,
                    method: API_ENDPOINTS.SETTINGS.GetSettings.methods[0],
                    authToken: hashedPassword,
                    muteError: true,
                })

                await setServerStatus(null)
                await setServerAuthToken(hashedPassword)
                await setServerUrl(sanitizedUrl)

                toast.success(`Server connection saved\n${sanitizedUrl}`, {
                    position: "bottom",
                    visibilityTime: 1000,
                })

                router.replace("/(app)/(tabs)/(library)")
            }
            catch (error) {
                const message = error instanceof Error
                    ? error.message
                    : (typeof error === "object" && error !== null && "error" in error && typeof error.error === "string"
                        ? error.error
                        : "Unable to connect to the server")

                if (message === "UNAUTHENTICATED") {
                    showErrorToast(trimmedPassword ? "Server password is incorrect" : "This server requires a password")
                } else if (message.includes("Network request failed") || message.includes("Failed to fetch")) {
                    showErrorToast("Could not reach the server")
                } else {
                    showErrorToast(message)
                }
            }
            finally {
                setIsSubmitting(false)
            }
        })()
    }, [inputValue, passwordValue, setServerAuthToken, setServerStatus, setServerUrl, showErrorToast])

    return (
        <KeyboardAvoidingView className="flex-1 justify-center bg-background px-4">
            <SafeAreaView
                style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 10,
                }}
                edges={["top", "right", "bottom", "left"]}
            >
                <View className="px-6 flex justify-center items-center -top-32">
                    <Image
                        className="w-32 h-32"
                        source={IMAGES.logo2}
                        resizeMode="cover"
                    />
                </View>
                <Card className="w-full p-4 rounded-xl bg-background -top-32">
                    <CardHeader className="items-center">
                        {/*<CardTitle className="pb-2 text-center">Configuration</CardTitle>*/}
                        <CardDescription>
                            <Text>Enter your Seanime server URL and password.</Text>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <View className="gap-4">
                            <View className="gap-2">
                                <Label htmlFor="server-url-input" nativeID="server-url-label">Server URL</Label>
                                <Input
                                    nativeID="server-url-input"
                                    className="w-full"
                                    placeholder="http://192.168.1.1:43211"
                                    value={inputValue}
                                    onChangeText={setInputValue}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="url"
                                />
                            </View>

                            <View className="gap-2">
                                <Label htmlFor="server-password-input" nativeID="server-password-label">Server Password</Label>
                                <Input
                                    nativeID="server-password-input"
                                    className="w-full"
                                    placeholder="Optional"
                                    value={passwordValue}
                                    onChangeText={setPasswordValue}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    secureTextEntry
                                    textContentType="password"
                                />
                                <Text className="text-xs text-white/45">
                                    Leave this blank if the server does not require a password.
                                </Text>
                            </View>
                        </View>
                    </CardContent>
                    <CardFooter className="flex-col gap-3 pb-0">
                        <Button
                            variant="default"
                            className=""
                            onPress={handleOnContinue}
                            disabled={isSubmitting}
                        >
                            <Text>{isSubmitting ? "Connecting..." : "Continue"}</Text>
                        </Button>
                    </CardFooter>
                </Card>

                <Pressable
                    onPress={() => Linking.openURL("https://seanime.app/mobile-server")}
                    className="mt-4 flex-row items-center justify-center gap-1.5 active:opacity-75"
                >
                    <Ionicons name="information-circle-outline" size={16} color="rgba(255,255,255,0.4)" />
                    <Text className="text-white/40 text-xs font-medium underline">
                        Run a Seanime Server on this phone
                    </Text>
                </Pressable>
            </SafeAreaView>
        </KeyboardAvoidingView>
    )
}
