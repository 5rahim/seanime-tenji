import { cn } from "@/lib/utils"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as React from "react"
import { Pressable, TextInput, type TextInputInstance, View } from "react-native"
import Animated, { FadeIn, FadeOut, interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated"

export type LibrarySearchBarProps = {
    value: string
    onChangeText: (text: string) => void
    placeholder?: string
    className?: string
    autoFocus?: boolean
}

export function LibrarySearchBar({
    value,
    onChangeText,
    placeholder = "Search...",
    className,
    autoFocus,
}: LibrarySearchBarProps) {
    const inputRef = React.useRef<TextInputInstance>(null)
    const focused = useSharedValue(0)

    function handleFocus() {
        focused.set(withSpring(1, { damping: 20, stiffness: 300 }))
    }

    function handleBlur() {
        focused.set(withSpring(0, { damping: 20, stiffness: 300 }))
    }

    function handleClear() {
        onChangeText("")
        inputRef.current?.focus()
    }

    const animatedContainerStyle = useAnimatedStyle(() => ({
        borderWidth: 1,
        borderColor: interpolateColor(
            focused.value,
            [0, 1],
            ["rgba(255,255,255,0.08)", "rgba(97,82,223,0.5)"],
        ),
    }))

    return (
        <Pressable
            onPress={() => inputRef.current?.focus()}
            style={{ flex: 1 }}
        >
            <Animated.View
                className={cn(
                    "flex-row items-center h-11 rounded-2xl bg-white/[0.04] px-3 gap-2",
                    className,
                )}
            // style={animatedContainerStyle}
            >
                <Ionicons name="search-outline" size={16} color="rgba(255,255,255,0.35)" />
                <TextInput
                    ref={inputRef}
                    value={value}
                    onChangeText={onChangeText}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    placeholder={placeholder}
                    placeholderTextColor="rgba(255,255,255,0.30)"
                    className="flex-1 text-white h-full"
                    returnKeyType="search"
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="never"
                    autoFocus={autoFocus}
                />
                {value.length > 0 && (
                    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)}>
                        <Pressable onPress={handleClear} hitSlop={8}>
                            <View className="h-5 w-5 items-center justify-center rounded-full bg-white/15">
                                <Ionicons name="close" size={12} color="rgba(255,255,255,0.65)" />
                            </View>
                        </Pressable>
                    </Animated.View>
                )}
            </Animated.View>
        </Pressable>
    )
}

