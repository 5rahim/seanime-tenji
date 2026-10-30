import { TVButton } from "@/components/tv/tv-focus"
import { requestTVFocus } from "@/components/tv/tv-native"
import { tvSize } from "@/components/tv/tv-scale"
import { IMAGES } from "@/constants/images"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Image } from "expo-image"
import * as React from "react"
import {
    Animated,
    BackHandler,
    Keyboard,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native"

type TVServerSetupProps = {
    serverUrl: string
    password: string
    passwordRequired: boolean
    submitting: boolean
    onServerUrlChange: (value: string) => void
    onPasswordChange: (value: string) => void
    onBackToServer: () => void
    onContinue: () => void
}

type TVInputProps = {
    value: string
    placeholder: string
    label: string
    secure?: boolean
    preferred?: boolean
    keyboardType?: "default" | "url"
    onChangeText: (value: string) => void
    onSubmitEditing: () => void
}

function TVInput({
    value,
    placeholder,
    label,
    secure,
    preferred,
    keyboardType = "default",
    onChangeText,
    onSubmitEditing,
}: TVInputProps) {
    const localRef = React.useRef<React.ElementRef<typeof TextInput> | null>(null)
    const fieldRef = React.useRef<React.ElementRef<typeof Pressable> | null>(null)
    const focusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const scale = React.useRef(new Animated.Value(1)).current
    const [focused, setFocused] = React.useState(false)

    const returnFocus = React.useCallback(() => {
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
        focusTimerRef.current = setTimeout(() => {
            requestTVFocus(fieldRef.current)
        }, 80)
    }, [])

    React.useEffect(() => {
        const sub = Keyboard.addListener("keyboardDidHide", () => {
            if (!localRef.current?.isFocused()) return
            localRef.current.blur()
            returnFocus()
        })

        return () => sub.remove()
    }, [returnFocus])

    React.useEffect(() => () => {
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
    }, [])

    const setFocus = React.useCallback((active: boolean) => {
        setFocused(active)
        Animated.timing(scale, {
            toValue: active ? 1.02 : 1,
            duration: 140,
            useNativeDriver: true,
        }).start()
    }, [scale])

    return (
        <View style={{ gap: tvSize(10) }}>
            <Text
                style={{
                    color: focused ? "#d4d0ff" : "rgba(255,255,255,0.45)",
                    fontSize: tvSize(17),
                    fontWeight: "600",
                    letterSpacing: tvSize(1.2),
                    paddingHorizontal: tvSize(4),
                    textTransform: "uppercase",
                }}
            >
                {label}
            </Text>
            <Pressable
                ref={fieldRef}
                onPress={() => localRef.current?.focus()}
                onFocus={() => setFocus(true)}
                onBlur={() => setFocus(false)}
                focusable
                hasTVPreferredFocus={preferred}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${label}`}
            >
                <Animated.View
                    style={{
                        height: tvSize(64),
                        transform: [{ scale }],
                        borderRadius: tvSize(12),
                        borderWidth: tvSize(2),
                        borderColor: focused ? "#b8b0ff" : "rgba(255,255,255,0.1)",
                        backgroundColor: focused ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                    }}
                >
                    <TextInput
                        ref={localRef}
                        value={value}
                        onChangeText={onChangeText}
                        placeholder={placeholder}
                        placeholderTextColor="rgba(255,255,255,0.28)"
                        secureTextEntry={secure}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType={keyboardType}
                        allowFontScaling={false}
                        onFocus={() => setFocus(true)}
                        onBlur={() => {
                            setFocus(false)
                            returnFocus()
                        }}
                        returnKeyType="done"
                        submitBehavior="submit"
                        onSubmitEditing={onSubmitEditing}
                        selectionColor="#b8b0ff"
                        accessibilityLabel={label}
                        style={{
                            flex: 1,
                            paddingHorizontal: tvSize(18),
                            paddingVertical: 0,
                            fontSize: tvSize(22),
                            lineHeight: tvSize(28),
                            color: "white",
                            textAlignVertical: "center",
                            includeFontPadding: false,
                        }}
                    />
                </Animated.View>
            </Pressable>
        </View>
    )
}

export function TVServerSetup({
    serverUrl,
    password,
    passwordRequired,
    submitting,
    onServerUrlChange,
    onPasswordChange,
    onBackToServer,
    onContinue,
}: TVServerSetupProps) {
    React.useEffect(() => {
        if (!passwordRequired) return

        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            onBackToServer()
            return true
        })

        return () => sub.remove()
    }, [onBackToServer, passwordRequired])

    const field = passwordRequired ? (
        <TVInput
            key="password"
            label="Server password"
            value={password}
            placeholder="Enter server password"
            secure
            preferred
            onChangeText={onPasswordChange}
            onSubmitEditing={onContinue}
        />
    ) : (
        <TVInput
            key="server"
            label="Server URL"
            value={serverUrl}
            placeholder="http://192.168.1.1:43211"
            keyboardType="url"
            preferred
            onChangeText={onServerUrlChange}
            onSubmitEditing={onContinue}
        />
    )

    return (
        <View className="flex-1 bg-background">
            <View
                className="flex-row items-center border-b border-white/[0.06]"
                style={{
                    height: tvSize(72),
                    gap: tvSize(12),
                    paddingHorizontal: tvSize(48),
                }}
            >
                <Image
                    source={IMAGES.logo2}
                    style={{ width: tvSize(38), height: tvSize(38) }}
                    contentFit="contain"
                />
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                    flexGrow: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingVertical: tvSize(48),
                }}
                showsVerticalScrollIndicator={false}
            >
                <View
                    style={{
                        width: "100%",
                        maxWidth: tvSize(800),
                        paddingHorizontal: tvSize(32),
                        gap: tvSize(24),
                    }}
                >
                    <View style={{ gap: tvSize(8) }}>
                        <Text
                            className="font-black text-white"
                            style={{ fontSize: tvSize(38) }}
                        >
                            {passwordRequired ? "Password required" : "Connect your server"}
                        </Text>
                        <Text
                            className="text-white/45"
                            style={{ fontSize: tvSize(20) }}
                        >
                            {passwordRequired
                                ? serverUrl
                                : "Enter the address of your Seanime server."}
                        </Text>
                    </View>

                    <View style={{ gap: tvSize(18) }}>
                        {field}
                        <TVButton
                            label={submitting ? "Connecting…" : "Connect"}
                            variant="primary"
                            size="compact"
                            icon={<Ionicons name="arrow-forward" size={tvSize(20)} color="white" />}
                            onPress={onContinue}
                            disabled={submitting}
                        />
                    </View>

                    <Text
                        className="text-white/35"
                        style={{ fontSize: tvSize(16) }}
                    >
                        {passwordRequired
                            ? "Press Back to change the server address"
                            : ""}
                    </Text>
                </View>
            </ScrollView>
        </View>
    )
}
