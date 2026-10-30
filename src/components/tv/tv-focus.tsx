import { tvSize } from "@/components/tv/tv-scale"
import { tvKeyAction } from "@/components/tv/tv-native"
import { cn } from "@/lib/utils"
import { useSegments } from "expo-router"
import * as React from "react"
import { Animated, Pressable, type PressableProps, Text, useTVEventHandler, View } from "react-native"

const activeFocusLabels = new Set<string>()
let checkTimeout: ReturnType<typeof setTimeout> | null = null

function verifySingleFocus() {
    if (checkTimeout) {
        clearTimeout(checkTimeout)
    }
    checkTimeout = setTimeout(() => {
        if (__DEV__) {
            if (activeFocusLabels.size > 1) {
                console.warn(
                    `[Focus Conflict] Multiple elements are focused simultaneously: ${Array.from(activeFocusLabels).map(l => `"${l}"`).join(", ")}`
                )
            }
        }
    }, 50)
}

const uniqueCounter = { current: 0 }

export function useTVFocus(scaleTo = 1.04, debugLabel?: string) {
    const [focused, setFocused] = React.useState(false)
    const scale = React.useRef(new Animated.Value(1)).current
    const elementId = React.useRef(0)

    if (elementId.current === 0) {
        uniqueCounter.current++
        elementId.current = uniqueCounter.current
    }

    const label = debugLabel || `Element #${elementId.current}`

    React.useEffect(() => {
        return () => {
            if (activeFocusLabels.has(label)) {
                activeFocusLabels.delete(label)
                verifySingleFocus()
            }
        }
    }, [label])

    const run = React.useCallback((value: number) => {
        Animated.timing(scale, {
            toValue: value,
            duration: 110,
            useNativeDriver: true,
        }).start()
    }, [scale])

    const focus = React.useCallback(() => {
        activeFocusLabels.add(label)
        if (__DEV__ && debugLabel) {
            console.log(`[Focus] -> Focused: "${debugLabel}"`)
        }
        verifySingleFocus()
        setFocused(true)
        run(scaleTo)
    }, [run, scaleTo, debugLabel, label])

    const blur = React.useCallback(() => {
        activeFocusLabels.delete(label)
        if (__DEV__ && debugLabel) {
            console.log(`[Focus] <- Blurred: "${debugLabel}"`)
        }
        verifySingleFocus()
        setFocused(false)
        run(1)
    }, [run, debugLabel, label])

    return {
        focused,
        focus,
        blur,
        style: { transform: [{ scale }] },
    }
}

type TVButtonProps = PressableProps & {
    label: string
    detail?: string
    icon?: React.ReactNode
    variant?: "primary" | "secondary" | "ghost" | "danger"
    size?: "default" | "compact"
    preferred?: boolean
    className?: string
}

const VARIANT_CLASSES = {
    primary: "bg-brand-600 border-brand-400/40",
    secondary: "bg-white/[0.08] border-white/15",
    ghost: "bg-transparent border-transparent",
    danger: "bg-red-500/20 border-red-400/30",
}

export const TVButton = React.forwardRef<React.ElementRef<typeof Pressable>, TVButtonProps>(
    ({
        label,
        detail,
        icon,
        variant = "secondary",
        size = "default",
        preferred,
        className,
        onFocus,
        onBlur,
        hasTVPreferredFocus,
        disabled,
        ...props
    }, ref) => {
        const focusState = useTVFocus(1.04, label)
        const routePreferred = usePreferredFocus(preferred)
        const isPreferred = hasTVPreferredFocus ?? routePreferred
        const primary = variant === "primary"

        return (
            <Pressable
                {...props}
                ref={ref}
                disabled={disabled}
                hasTVPreferredFocus={isPreferred}
                onFocus={(event) => {
                    focusState.focus()
                    onFocus?.(event)
                }}
                onBlur={(event) => {
                    focusState.blur()
                    onBlur?.(event)
                }}
                className={cn("rounded-xl", disabled && "opacity-40", className)}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(disabled) }}
                style={{ flexShrink: 0 }}
            >
                <Animated.View
                    style={[
                        focusState.style,
                        {
                            minHeight: tvSize(size === "compact" ? 56 : 64),
                            gap: tvSize(size === "compact" ? 12 : 16),
                            paddingHorizontal: tvSize(size === "compact" ? 18 : 22),
                            paddingVertical: tvSize(size === "compact" ? 10 : 14),
                            borderRadius: tvSize(99),
                            borderWidth: tvSize(2),
                        },
                    ]}
                    className={cn(
                        "flex-row items-center",
                        VARIANT_CLASSES[variant],
                        focusState.focused && (primary
                            ? "border-white bg-brand-700"
                            : "border-white bg-white/15"),
                    )}
                >
                    {icon}
                    <View style={{ flexShrink: 1 }}>
                        <Text
                            className="font-semibold text-white"
                            style={{ fontSize: tvSize(size === "compact" ? 20 : 22) }}
                        >
                            {label}
                        </Text>
                        {detail ? (
                            <Text
                                className={cn(
                                    "text-white/55",
                                    primary && "text-white/75",
                                )}
                                style={{
                                    fontSize: tvSize(18),
                                    marginTop: tvSize(2),
                                }}
                                numberOfLines={1}
                            >
                                {detail}
                            </Text>
                        ) : null}
                    </View>
                </Animated.View>
            </Pressable>
        )
    },
)

TVButton.displayName = "TVButton"

type TVPillButtonProps = PressableProps & {
    label: string
    active?: boolean
    preferred?: boolean
    icon?: React.ReactNode | ((focused: boolean) => React.ReactNode)
    className?: string
    variant?: string
}

export const TVPillButton = React.forwardRef<React.ElementRef<typeof Pressable>, TVPillButtonProps>(
    ({
        label,
        active,
        preferred,
        icon,
        className,
        onFocus,
        onBlur,
        disabled,
        variant,
        ...props
    }, ref) => {
        const focusState = useTVFocus(1.05, label)
        const isPreferred = usePreferredFocus(preferred)
        const renderedIcon = typeof icon === "function"
            ? icon(focusState.focused)
            : (focusState.focused && React.isValidElement(icon)
                ? React.cloneElement(icon as React.ReactElement<{ color?: string }>, { color: "#000000" })
                : icon)

        return (
            <Pressable
                {...props}
                ref={ref}
                disabled={disabled}
                hasTVPreferredFocus={isPreferred}
                onFocus={(event) => {
                    focusState.focus()
                    onFocus?.(event)
                }}
                onBlur={(event) => {
                    focusState.blur()
                    onBlur?.(event)
                }}
                className={cn("rounded-full", disabled && "opacity-40", className)}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(disabled), selected: active }}
                style={{ flexShrink: 0 }}
            >
                <Animated.View
                    style={[
                        focusState.style,
                        {
                            minHeight: tvSize(42),
                            paddingHorizontal: label ? tvSize(18) : tvSize(10),
                            paddingVertical: label ? tvSize(6) : tvSize(10),
                            borderRadius: tvSize(24),
                            borderWidth: tvSize(2),
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: label ? tvSize(8) : 0,
                            backgroundColor: focusState.focused
                                ? "#ffffff"
                                : (active ? "rgba(168,159,255,0.2)" : "rgba(255,255,255,0.06)"),
                            borderColor: focusState.focused
                                ? "#ffffff"
                                : (active ? "#9b90ff" : "rgba(255,255,255,0.1)"),
                            flexShrink: 0,
                        },
                    ]}
                >
                    {renderedIcon}
                    {label ? (
                        <Text
                            className="font-semibold"
                            style={{
                                fontSize: tvSize(18),
                                color: focusState.focused
                                    ? "#000000"
                                    : (active ? "#b8b0ff" : "#ffffff"),
                            }}
                        >
                            {label}
                        </Text>
                    ) : null}
                </Animated.View>
            </Pressable>
        )
    },
)

TVPillButton.displayName = "TVPillButton"

export function useTVFocusLogger() {
    useTVEventHandler((event) => {
        if (!__DEV__ || !event) return
        const { eventType, tag } = event
        if (eventType !== "focus" && eventType !== "blur" && tvKeyAction(event) === 1) {
            return
        }
        console.log(`[TVEvent] Action: ${eventType} (tag: ${tag})`)
    })
}

export function usePreferredFocus(preferred?: boolean): boolean {
    try {
        const segments = useSegments()
        return segments.includes("entry") ? !!preferred : false
    } catch {
        return false
    }
}
