import { usePreferredFocus, useTVFocus } from "@/components/tv/tv-focus"
import { requestTVFocus } from "@/components/tv/tv-native"
import { tvSize } from "@/components/tv/tv-scale"
import * as React from "react"
import {
    Animated,
    Keyboard,
    Pressable,
    Text,
    TextInput,
    type TextInputInstance,
    type TextInputProps,
    View,
    type ViewStyle,
} from "react-native"

type TVInputProps = TextInputProps & {
    containerStyle?: ViewStyle
    floating?: boolean
    icon?: React.ReactNode
    preferred?: boolean
}

export type TVInputHandle = {
    focus: () => void
    blur: () => void
    isFocused: () => boolean
    requestTVFocus: () => void
}

export const TVInput = React.forwardRef<TVInputHandle, TVInputProps>(
    ({ style, containerStyle, floating, icon, preferred, onFocus, onBlur, ...props }, ref) => {
        const focusState = useTVFocus(1.02, props.placeholder || "TextInput")
        const isPreferred = usePreferredFocus(preferred)
        const [editing, setEditing] = React.useState(false)
        const inputRef = React.useRef<TextInputInstance>(null)
        const fieldRef = React.useRef<React.ElementRef<typeof Pressable>>(null)
        const focusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

        const edit = React.useCallback(() => {
            setEditing(true)
            requestAnimationFrame(() => inputRef.current?.focus())
        }, [])

        const returnFocus = React.useCallback(() => {
            if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
            focusTimerRef.current = setTimeout(() => {
                requestTVFocus(fieldRef.current)
            }, 80)
        }, [])

        React.useImperativeHandle(ref, () => ({
            focus: edit,
            blur: () => inputRef.current?.blur(),
            isFocused: () => inputRef.current?.isFocused() ?? false,
            requestTVFocus: () => requestTVFocus(fieldRef.current),
        }), [edit])

        React.useEffect(() => {
            const sub = Keyboard.addListener("keyboardDidHide", () => {
                if (!inputRef.current?.isFocused()) return
                setEditing(false)
                inputRef.current.blur()
                returnFocus()
            })

            return () => sub.remove()
        }, [returnFocus])

        React.useEffect(() => () => {
            if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
        }, [])

        const value = props.value ?? props.defaultValue ?? ""
        const displayValue = props.secureTextEntry
            ? "•".repeat(value.length)
            : value

        return (
            <Pressable
                ref={fieldRef}
                focusable={!editing}
                hasTVPreferredFocus={isPreferred}
                onPress={edit}
                onFocus={focusState.focus}
                onBlur={focusState.blur}
                accessibilityRole="button"
                accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
                style={{
                    minHeight: tvSize(56),
                    flexGrow: 1,
                    flexShrink: 1,
                }}
            >
                {({ focused }) => {
                    const active = focused || editing
                    return (
                        <Animated.View
                            style={[
                                focusState.style,
                                {
                                    flex: 1,
                                    height: tvSize(56),
                                    backgroundColor: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                                    borderColor: active ? "#ffffff" : "rgba(255,255,255,0.1)",
                                    borderWidth: tvSize(2),
                                    borderRadius: tvSize(99),
                                    paddingHorizontal: tvSize(16),
                                    paddingVertical: 0,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: tvSize(12),
                                    justifyContent: "center",
                                },
                                floating && {
                                    backgroundColor: "rgba(10,10,12,0.9)",
                                    borderColor: active ? "#fff" : "transparent",
                                    // shadowColor: "#000000",
                                    // shadowOpacity: 0.35,
                                    // shadowRadius: tvSize(14),
                                    // shadowOffset: { width: 0, height: tvSize(6) },
                                    // elevation: 14,
                                },
                                containerStyle,
                            ]}
                        >
                            {icon}
                            {editing ? (
                                <TextInput
                                    {...props}
                                    ref={inputRef}
                                    autoFocus
                                    focusable
                                    allowFontScaling={props.allowFontScaling ?? false}
                                    style={[
                                        {
                                            color: "#ffffff",
                                            fontSize: tvSize(22),
                                            lineHeight: tvSize(28),
                                            flex: 1,
                                            padding: 0,
                                            textAlignVertical: "center",
                                            includeFontPadding: false,
                                        },
                                        style,
                                    ]}
                                    onFocus={(event) => {
                                        event.stopPropagation()
                                        focusState.focus()
                                        onFocus?.(event)
                                    }}
                                    onBlur={(event) => {
                                        event.stopPropagation()
                                        setEditing(false)
                                        focusState.blur()
                                        onBlur?.(event)
                                    }}
                                />
                            ) : (
                                <View style={{ flex: 1, justifyContent: "center" }}>
                                    <Text
                                        numberOfLines={1}
                                        allowFontScaling={props.allowFontScaling ?? false}
                                        style={[
                                            {
                                                color: displayValue
                                                    ? "#ffffff"
                                                    : (props.placeholderTextColor ?? "rgba(255,255,255,0.35)"),
                                                fontSize: tvSize(22),
                                                lineHeight: tvSize(28),
                                                includeFontPadding: false,
                                            },
                                            style,
                                        ]}
                                    >
                                        {displayValue || props.placeholder}
                                    </Text>
                                </View>
                            )}
                        </Animated.View>
                    )
                }}
            </Pressable>
        )
    }
)

TVInput.displayName = "TVInput"
