import { Status } from "@/api/generated/types"
import { TabBarIcon } from "@/components/navigation/tab-bar-icon"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { COLORS } from "@/constants/colors"
import { cn } from "@/lib/utils"
import Ionicons from "@expo/vector-icons/Ionicons"
import { BottomTabBarProps, BottomTabNavigationOptions } from "@react-navigation/bottom-tabs"
import * as React from "react"
import { ComponentProps } from "react"
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native"
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export type AppTabConfig = {
    show: boolean
    name: string
    displayName: string
    icon: ComponentProps<typeof Ionicons>["name"]
    options?: BottomTabNavigationOptions
}

const BAR_MARGIN = 30
const BAR_MAX_WIDTH = 560

export function TabBar({ state, descriptors, navigation, tabs, user }: BottomTabBarProps & {
    tabs: AppTabConfig[],
    user: Status["user"] | undefined
}) {
    const insets = useSafeAreaInsets()
    const { width: screenWidth } = useWindowDimensions()
    const availableWidth = Math.max(0, screenWidth - insets.left - insets.right)
    const barWidth = Math.min(BAR_MAX_WIDTH, Math.max(0, availableWidth - 2 * BAR_MARGIN))
    const barLeft = insets.left + (availableWidth - barWidth) / 2
    const bottomOffset = Platform.OS === "android"
        ? (insets.bottom > 0 ? insets.bottom + 10 : 10)
        : 20

    return (
        <View style={[styles.tabBar, { bottom: bottomOffset, left: barLeft, width: barWidth }]}>
            {state.routes.map((route, index) => {
                const { options } = descriptors[route.key]
                const tab = tabs.find(tab => tab.name === route.name)
                if (!tab?.show) return null
                // const label =
                //     options.tabBarLabel !== undefined
                //         ? options.tabBarLabel as string
                //         : options.title !== undefined
                //             ? options.title
                //             : route.name

                const isFocused = state.index === index

                const onPress = () => {
                    const event = navigation.emit({
                        type: "tabPress",
                        target: route.key,
                        canPreventDefault: true,
                    })

                    if (!isFocused && !event.defaultPrevented) {
                        navigation.navigate(route.name, route.params)
                    }
                }

                const onLongPress = () => {
                    navigation.emit({
                        type: "tabLongPress",
                        target: route.key,
                    })
                }

                return (
                    <TabBarButton
                        key={route.name}
                        focused={isFocused}
                        options={options}
                        onPress={onPress}
                        onLongPress={onLongPress}
                        tab={tab}
                        viewer={user}
                    />
                )
            })}
        </View>
    )
}

export function TabBarButton(props: {
    focused: boolean,
    onPress: () => void,
    onLongPress: () => void,
    tab: AppTabConfig | undefined,
    viewer: Status["user"] | undefined,
    options: BottomTabNavigationOptions
}) {
    const scale = useSharedValue(0)

    React.useEffect(() => {
        scale.set(withSpring(props.focused ? 0 : 1, { duration: 350 }))
    }, [scale, props.focused])

    const animatedIconStyle = useAnimatedStyle(() => {
        const scaleValue = interpolate(scale.value, [0, 1], [1.2, 1])
        const topValue = interpolate(scale.value, [0, 1], [1, 9])

        return {
            transform: [{ scale: scaleValue }],
            top: topValue,
        }
    })

    const animatedTextStyle = useAnimatedStyle(() => {
        const opacity = interpolate(scale.value, [0, 1], [1, 0])
        const topValue = interpolate(scale.value, [1, 0], [20, 4])

        return {
            opacity,
            top: topValue,
        }
    })

    return <Pressable
        accessibilityRole="button"
        accessibilityState={props.focused ? { selected: true } : {}}
        accessibilityLabel={props.options.tabBarAccessibilityLabel}
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        style={styles.tabBarItem}
    >
        <Animated.View style={animatedIconStyle}>
            {props.tab?.name !== "(profile)" ? <TabBarIcon
                name={props.tab?.icon as ComponentProps<typeof Ionicons>["name"]}
                size={24}
                className={cn(
                    "text-gray",
                    { "text-brand-300": props.focused },
                )}
            /> : <Avatar alt="Profile picture" className="w-7 h-7">
                <AvatarImage source={{ uri: props.viewer?.viewer?.avatar?.large || "" }} />
                <AvatarFallback>
                    <Text>S</Text>
                </AvatarFallback>
            </Avatar>}
        </Animated.View>


        <Animated.Text
            className={cn(
                "text-xs text-gray",
                { "text-brand-300": props.focused },
            )}
            style={[animatedTextStyle, styles.tabBarLabel]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
        >
            {props.tab?.displayName}
        </Animated.Text>
    </Pressable>
}

const styles = StyleSheet.create({
    tabBar: {
        position: "absolute",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        overflow: "hidden",
        backgroundColor: COLORS.background,
        bottom: Platform.OS === "ios" ? 20 : 10,
        borderTopWidth: 0,
        borderRadius: 36,
        gap: 0,
        shadowOpacity: 0.1,
        shadowOffset: { width: 0, height: 10 },
        shadowRadius: 10,
        paddingVertical: 15,
        paddingHorizontal: 14,
    },
    tabBarItem: {
        flex: 1,
        minWidth: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    tabBarLabel: {
        width: "100%",
        textAlign: "center",
        includeFontPadding: false,
    },
})
