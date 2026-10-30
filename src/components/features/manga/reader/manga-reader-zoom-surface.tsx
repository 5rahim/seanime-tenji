import * as React from "react"
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView, type ScrollViewInstance, StyleProp, View, ViewStyle } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"

const ZOOM_THRESHOLD = 1.01
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MAX_DELAY = 280
const DOUBLE_TAP_POSITION_TOLERANCE = 48
const ZOOM_TIMING_CONFIG = {
    duration: 180,
    easing: Easing.inOut(Easing.quad),
}

function clampZoomValue(value: number, min: number, max: number): number {
    "worklet"

    return Math.min(Math.max(value, min), max)
}

function getEffectiveAndroidTranslate(translate: number, focal: number, scale: number): number {
    "worklet"

    return translate + focal * (1 - scale)
}

function isTapInsideExclusion(
    y: number,
    tapViewportHeight: number,
    tapExclusionTop: number,
    tapExclusionBottom: number,
): boolean {
    "worklet"

    const insideTopExclusion = tapExclusionTop > 0 && y <= tapExclusionTop
    const insideBottomExclusion = tapExclusionBottom > 0
        && tapViewportHeight > 0
        && y >= tapViewportHeight - tapExclusionBottom

    return insideTopExclusion || insideBottomExclusion
}

type MangaReaderZoomSurfaceProps = {
    children: React.ReactNode
    instanceKey?: string
    disabled?: boolean
    onTap?: () => void
    onZoomChange?: (zoomed: boolean) => void
    maxScale?: number
    pinchEnabled?: boolean
    style?: StyleProp<ViewStyle>
    contentContainerStyle?: StyleProp<ViewStyle>
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
    removeClippedSubviews?: boolean
    scrollEventThrottle?: number
    tapViewportHeight?: number
    tapExclusionTop?: number
    tapExclusionBottom?: number
    scrollViewRef?: React.RefObject<ScrollViewInstance | null>
}

export function MangaReaderZoomSurface({
    children,
    instanceKey,
    disabled,
    onTap,
    onZoomChange,
    maxScale = 4,
    pinchEnabled = false,
    style,
    contentContainerStyle,
    onScroll,
    removeClippedSubviews = false,
    scrollEventThrottle = 16,
    tapViewportHeight = 0,
    tapExclusionTop = 0,
    tapExclusionBottom = 0,
    scrollViewRef,
}: MangaReaderZoomSurfaceProps) {
    const surfaceKey = instanceKey ?? "default"
    const isNativePinch = pinchEnabled && Platform.OS === "ios" && !disabled
    const isCustomPinch = pinchEnabled && Platform.OS !== "ios" && !disabled
    const hasScrollableContainer = Boolean(onScroll || scrollViewRef)
    const hasTapHandler = Boolean(onTap)
    const nativeScrollRef = React.useRef<ScrollViewInstance | null>(null)
    const nativeZoomScaleRef = React.useRef(1)
    const nativeScrollMetricsRef = React.useRef({
        offsetX: 0,
        offsetY: 0,
        viewportWidth: 0,
        viewportHeight: 0,
    })
    const zoomedRef = React.useRef(false)
    const onTapRef = React.useRef(onTap)
    const onZoomChangeRef = React.useRef(onZoomChange)
    const pendingNativeTapRef = React.useRef<{
        timeout: ReturnType<typeof setTimeout>
        timestamp: number
        x: number
        y: number
    } | null>(null)
    onTapRef.current = onTap
    onZoomChangeRef.current = onZoomChange
    const [androidZoomed, setAndroidZoomed] = React.useState(false)

    const tapViewportHeightValue = useSharedValue(tapViewportHeight)
    const tapExclusionTopValue = useSharedValue(tapExclusionTop)
    const tapExclusionBottomValue = useSharedValue(tapExclusionBottom)

    const androidScale = useSharedValue(1)
    const androidInitialFocalX = useSharedValue(0)
    const androidInitialFocalY = useSharedValue(0)
    const androidSavedFocalX = useSharedValue(0)
    const androidSavedFocalY = useSharedValue(0)
    const androidFocalX = useSharedValue(0)
    const androidFocalY = useSharedValue(0)
    const androidSavedTranslateX = useSharedValue(0)
    const androidSavedTranslateY = useSharedValue(0)
    const androidTranslateX = useSharedValue(0)
    const androidTranslateY = useSharedValue(0)
    const androidSavedScale = useSharedValue(1)
    const androidContainerX = useSharedValue(0)
    const androidContainerY = useSharedValue(0)
    const androidContainerWidth = useSharedValue(0)
    const androidContainerHeight = useSharedValue(0)
    const androidScrollOffsetX = useSharedValue(0)
    const androidScrollOffsetY = useSharedValue(0)

    React.useEffect(() => {
        tapViewportHeightValue.set(tapViewportHeight)
        tapExclusionTopValue.set(tapExclusionTop)
        tapExclusionBottomValue.set(tapExclusionBottom)
    }, [
        tapExclusionBottom,
        tapExclusionBottomValue,
        tapExclusionTop,
        tapExclusionTopValue,
        tapViewportHeight,
        tapViewportHeightValue,
    ])

    const setScrollViewNode = React.useCallback((node: ScrollViewInstance | null) => {
        nativeScrollRef.current = node

        if (scrollViewRef) {
            scrollViewRef.current = node
        }
    }, [scrollViewRef])

    const reportZoomChange = React.useCallback((zoomed: boolean) => {
        setAndroidZoomed(current => current === zoomed ? current : zoomed)

        if (zoomedRef.current === zoomed) return
        zoomedRef.current = zoomed
        onZoomChangeRef.current?.(zoomed)
    }, [])

    const handleTap = React.useCallback(() => {
        onTapRef.current?.()
    }, [])

    const clearPendingNativeTap = React.useCallback(() => {
        if (!pendingNativeTapRef.current) return
        clearTimeout(pendingNativeTapRef.current.timeout)
        pendingNativeTapRef.current = null
    }, [])

    const resetAndroidZoom = React.useCallback((animated: boolean = true) => {
        "worklet"

        // console.log("[ZoomSurface] resetAndroidZoom start", {
        //     animated,
        //     scale: androidScale.value,
        //     translateX: androidTranslateX.value,
        //     translateY: androidTranslateY.value,
        //     focalX: androidFocalX.value,
        //     focalY: androidFocalY.value
        // })

        if (animated) {
            androidScale.value = withTiming(1, ZOOM_TIMING_CONFIG, (finished) => {
                if (finished) {
                    androidFocalX.value = 0
                    androidFocalY.value = 0
                }
            })
            androidTranslateX.value = withTiming(0, ZOOM_TIMING_CONFIG)
            androidTranslateY.value = withTiming(0, ZOOM_TIMING_CONFIG)
        } else {
            androidScale.value = 1
            androidTranslateX.value = 0
            androidTranslateY.value = 0
            androidFocalX.value = 0
            androidFocalY.value = 0
        }

        androidSavedScale.value = 1
        androidSavedTranslateX.value = 0
        androidSavedTranslateY.value = 0
        androidSavedFocalX.value = 0
        androidSavedFocalY.value = 0
        androidInitialFocalX.value = 0
        androidInitialFocalY.value = 0

        runOnJS(reportZoomChange)(false)
    }, [
        androidFocalX,
        androidFocalY,
        androidInitialFocalX,
        androidInitialFocalY,
        androidSavedFocalX,
        androidSavedFocalY,
        androidSavedScale,
        androidSavedTranslateX,
        androidSavedTranslateY,
        androidScale,
        androidTranslateX,
        androidTranslateY,
        reportZoomChange,
    ])

    const clampAndroidZoomIntoView = React.useCallback((animated: boolean = true) => {
        "worklet"

        if (androidScale.value <= ZOOM_THRESHOLD
            || androidContainerWidth.value <= 0
            || androidContainerHeight.value <= 0) {
            resetAndroidZoom(animated)
            return
        }

        const rightLimit = (androidContainerWidth.value * (androidScale.value - 1)) / 2
        const leftLimit = -rightLimit
        const bottomLimit = (androidContainerHeight.value * (androidScale.value - 1)) / 2
        const topLimit = -bottomLimit

        const totalTranslateX = getEffectiveAndroidTranslate(androidTranslateX.value, androidFocalX.value, androidScale.value)
        const totalTranslateY = getEffectiveAndroidTranslate(androidTranslateY.value, androidFocalY.value, androidScale.value)
        const nextTranslateX = clampZoomValue(totalTranslateX, leftLimit, rightLimit)
        const nextTranslateY = clampZoomValue(totalTranslateY, topLimit, bottomLimit)

        // console.log("[ZoomSurface] clampAndroidZoomIntoView", {
        //     scale: androidScale.value,
        //     containerWidth: androidContainerWidth.value,
        //     containerHeight: androidContainerHeight.value,
        //     leftLimit,
        //     rightLimit,
        //     topLimit,
        //     bottomLimit,
        //     totalTranslateX,
        //     totalTranslateY,
        //     nextTranslateX,
        //     nextTranslateY
        // })

        if (animated) {
            androidTranslateX.value = withTiming(nextTranslateX - androidFocalX.value * (1 - androidScale.value), ZOOM_TIMING_CONFIG)
            androidTranslateY.value = withTiming(nextTranslateY - androidFocalY.value * (1 - androidScale.value), ZOOM_TIMING_CONFIG)
        } else {
            androidTranslateX.value = nextTranslateX - androidFocalX.value * (1 - androidScale.value)
            androidTranslateY.value = nextTranslateY - androidFocalY.value * (1 - androidScale.value)
        }

        runOnJS(reportZoomChange)(true)
    }, [
        androidContainerHeight,
        androidContainerWidth,
        androidFocalX,
        androidFocalY,
        androidScale,
        androidTranslateX,
        androidTranslateY,
        reportZoomChange,
        resetAndroidZoom,
    ])

    const handleAndroidZoomLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { x, y, width, height } = event.nativeEvent.layout
        androidContainerX.set(x)
        androidContainerY.set(y)
        androidContainerWidth.set(width)
        androidContainerHeight.set(height)
    }, [androidContainerHeight, androidContainerWidth, androidContainerX, androidContainerY])

    const handleAndroidScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        androidScrollOffsetX.set(event.nativeEvent.contentOffset.x)
        androidScrollOffsetY.set(event.nativeEvent.contentOffset.y)
        onScroll?.(event)
    }, [androidScrollOffsetX, androidScrollOffsetY, onScroll])

    const resetNativeZoomSurface = React.useCallback(() => {
        if (!isNativePinch) return

        const scrollNode = nativeScrollRef.current
        if (!scrollNode) return

        nativeZoomScaleRef.current = 1
        nativeScrollMetricsRef.current.offsetX = 0
        nativeScrollMetricsRef.current.offsetY = 0
        scrollNode.setNativeProps({ zoomScale: 1 })
        scrollNode.scrollTo({ x: 0, y: 0, animated: false })
    }, [isNativePinch])

    const handleNativeScrollLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout
        nativeScrollMetricsRef.current.viewportWidth = width
        nativeScrollMetricsRef.current.viewportHeight = height
    }, [])

    const handleNativeZoomScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const zoomScale = event.nativeEvent.zoomScale ?? 1
        nativeZoomScaleRef.current = zoomScale
        nativeScrollMetricsRef.current.offsetX = event.nativeEvent.contentOffset.x
        nativeScrollMetricsRef.current.offsetY = event.nativeEvent.contentOffset.y
        nativeScrollMetricsRef.current.viewportWidth = event.nativeEvent.layoutMeasurement.width
        nativeScrollMetricsRef.current.viewportHeight = event.nativeEvent.layoutMeasurement.height
        reportZoomChange(zoomScale > ZOOM_THRESHOLD)
        onScroll?.(event)
    }, [onScroll, reportZoomChange])

    const handleNativeDoubleTap = React.useCallback((x: number, y: number) => {
        const scrollNode = nativeScrollRef.current
        if (!scrollNode) return

        const currentScale = nativeZoomScaleRef.current
        const targetScale = currentScale > ZOOM_THRESHOLD ? 1 : Math.min(DOUBLE_TAP_SCALE, maxScale)
        const { offsetX, offsetY, viewportWidth, viewportHeight } = nativeScrollMetricsRef.current
        if (viewportWidth <= 0 || viewportHeight <= 0 || targetScale <= 0) return

        const contentCenterX = (offsetX + x) / Math.max(currentScale, 1)
        const contentCenterY = (offsetY + y) / Math.max(currentScale, 1)
        const targetWidth = viewportWidth / targetScale
        const targetHeight = viewportHeight / targetScale

        scrollNode.scrollResponderZoomTo({
            x: contentCenterX - targetWidth / 2,
            y: contentCenterY - targetHeight / 2,
            width: targetWidth,
            height: targetHeight,
            animated: true,
        })
    }, [maxScale])

    const handleNativeTap = React.useCallback((x: number, y: number) => {
        const now = Date.now()
        const pendingTap = pendingNativeTapRef.current
        const isDoubleTap = pendingTap
            && now - pendingTap.timestamp <= DOUBLE_TAP_MAX_DELAY
            && Math.hypot(x - pendingTap.x, y - pendingTap.y) <= DOUBLE_TAP_POSITION_TOLERANCE

        if (isDoubleTap) {
            clearTimeout(pendingTap.timeout)
            pendingNativeTapRef.current = null
            handleNativeDoubleTap(x, y)
            return
        }

        if (pendingTap) {
            clearTimeout(pendingTap.timeout)
            pendingNativeTapRef.current = null
            handleTap()
        }

        const timeout = setTimeout(() => {
            if (pendingNativeTapRef.current?.timeout !== timeout) return
            pendingNativeTapRef.current = null
            handleTap()
        }, DOUBLE_TAP_MAX_DELAY)

        pendingNativeTapRef.current = { timeout, timestamp: now, x, y }
    }, [handleNativeDoubleTap, handleTap])

    const tapGesture = React.useMemo(() => Gesture.Tap()
        .enabled(hasTapHandler && !disabled)
        .numberOfTaps(1)
        .maxDuration(220)
        .maxDistance(24)
        .onEnd((event, success) => {
            if (!success) return
            if (isTapInsideExclusion(
                event.absoluteY,
                tapViewportHeightValue.value,
                tapExclusionTopValue.value,
                tapExclusionBottomValue.value,
            )) return
            runOnJS(handleTap)()
        }), [
        disabled,
        handleTap,
        hasTapHandler,
        tapExclusionBottomValue,
        tapExclusionTopValue,
        tapViewportHeightValue,
    ])

    const nativeTapGesture = React.useMemo(() => Gesture.Tap()
        .enabled(isNativePinch)
        .numberOfTaps(1)
        .maxDuration(250)
        .maxDistance(32)
        .shouldCancelWhenOutside(false)
        .cancelsTouchesInView(false)
        .onEnd((event, success) => {
            if (!success) return
            if (isTapInsideExclusion(
                event.absoluteY,
                tapViewportHeightValue.value,
                tapExclusionTopValue.value,
                tapExclusionBottomValue.value,
            )) return
            runOnJS(handleNativeTap)(event.absoluteX, event.absoluteY)
        }), [
        handleNativeTap,
        isNativePinch,
        tapExclusionBottomValue,
        tapExclusionTopValue,
        tapViewportHeightValue,
    ])

    React.useEffect(() => {
        if (disabled) {
            reportZoomChange(false)
        }
    }, [disabled, reportZoomChange])

    React.useEffect(() => {
        clearPendingNativeTap()
        reportZoomChange(false)
    }, [clearPendingNativeTap, instanceKey, reportZoomChange])

    React.useEffect(() => {
        if (!isCustomPinch) return

        androidScale.set(1)
        androidTranslateX.set(0)
        androidTranslateY.set(0)
        androidFocalX.set(0)
        androidFocalY.set(0)
        androidSavedScale.set(1)
        androidSavedTranslateX.set(0)
        androidSavedTranslateY.set(0)
        androidSavedFocalX.set(0)
        androidSavedFocalY.set(0)
        androidInitialFocalX.set(0)
        androidInitialFocalY.set(0)
        reportZoomChange(false)
    }, [
        androidFocalX,
        androidFocalY,
        androidInitialFocalX,
        androidInitialFocalY,
        androidSavedFocalX,
        androidSavedFocalY,
        androidSavedScale,
        androidSavedTranslateX,
        androidSavedTranslateY,
        androidScale,
        androidTranslateX,
        androidTranslateY,
        isCustomPinch,
        instanceKey,
        reportZoomChange,
    ])

    React.useEffect(() => {
        if (!isNativePinch) return

        const frame = requestAnimationFrame(() => {
            resetNativeZoomSurface()
        })

        return () => cancelAnimationFrame(frame)
    }, [isNativePinch, instanceKey, resetNativeZoomSurface])

    React.useEffect(() => () => {
        clearPendingNativeTap()
        reportZoomChange(false)
    }, [clearPendingNativeTap, reportZoomChange])

    const androidTapGesture = React.useMemo(() => Gesture.Tap()
        .enabled(hasTapHandler && !disabled)
        .numberOfTaps(1)
        .maxDuration(220)
        .maxDistance(24)
        .onEnd((event, success) => {
            if (!success) return
            if (isTapInsideExclusion(
                event.absoluteY,
                tapViewportHeightValue.value,
                tapExclusionTopValue.value,
                tapExclusionBottomValue.value,
            )) return
            runOnJS(handleTap)()
        }), [
        disabled,
        handleTap,
        hasTapHandler,
        tapExclusionBottomValue,
        tapExclusionTopValue,
        tapViewportHeightValue,
    ])

    const androidDoubleTapGesture = React.useMemo(() => Gesture.Tap()
        .enabled(isCustomPinch)
        .numberOfTaps(2)
        .maxDuration(220)
        .maxDelay(DOUBLE_TAP_MAX_DELAY)
        .maxDistance(24)
        .onEnd((event, success) => {
            if (!success) return
            if (isTapInsideExclusion(
                event.absoluteY,
                tapViewportHeightValue.value,
                tapExclusionTopValue.value,
                tapExclusionBottomValue.value,
            )) return

            if (androidScale.value > ZOOM_THRESHOLD) {
                // console.log("[ZoomSurface] DoubleTap unzoom start", {
                //     scale: androidScale.value,
                //     translateX: androidTranslateX.value,
                //     translateY: androidTranslateY.value,
                //     focalX: androidFocalX.value,
                //     focalY: androidFocalY.value
                // })
                resetAndroidZoom()
                return
            }

            const targetScale = Math.min(DOUBLE_TAP_SCALE, maxScale)
            if (targetScale <= ZOOM_THRESHOLD) return

            const focalX = androidScrollOffsetX.value + event.x - androidContainerX.value - androidContainerWidth.value / 2
            const focalY = androidScrollOffsetY.value + event.y - androidContainerY.value - androidContainerHeight.value / 2

            androidScale.value = withTiming(targetScale, ZOOM_TIMING_CONFIG)
            androidTranslateX.value = 0
            androidTranslateY.value = 0
            androidFocalX.value = focalX
            androidFocalY.value = focalY
            androidSavedScale.value = targetScale
            androidSavedTranslateX.value = 0
            androidSavedTranslateY.value = 0
            androidSavedFocalX.value = focalX
            androidSavedFocalY.value = focalY
            androidInitialFocalX.value = event.x
            androidInitialFocalY.value = event.y
            runOnJS(reportZoomChange)(true)
        }), [
        androidContainerHeight,
        androidContainerWidth,
        androidContainerX,
        androidContainerY,
        androidFocalX,
        androidFocalY,
        androidInitialFocalX,
        androidInitialFocalY,
        androidSavedFocalX,
        androidSavedFocalY,
        androidSavedScale,
        androidSavedTranslateX,
        androidSavedTranslateY,
        androidScale,
        androidScrollOffsetX,
        androidScrollOffsetY,
        androidTranslateX,
        androidTranslateY,
        isCustomPinch,
        maxScale,
        reportZoomChange,
        resetAndroidZoom,
        tapExclusionBottomValue,
        tapExclusionTopValue,
        tapViewportHeightValue,
    ])

    const androidTapGestures = React.useMemo(
        () => Gesture.Exclusive(androidDoubleTapGesture, androidTapGesture),
        [androidDoubleTapGesture, androidTapGesture],
    )

    const androidPanOnlyGesture = React.useMemo(() => Gesture.Pan()
        .enabled(isCustomPinch)
        .averageTouches(true)
        .enableTrackpadTwoFingerGesture(true)
        .minPointers(1)
        .maxPointers(1)
        .onTouchesDown((_, manager) => {
            if (androidScale.value <= ZOOM_THRESHOLD) {
                manager.fail()
            }
        })
        .onStart(() => {
            androidSavedTranslateX.value = androidTranslateX.value
            androidSavedTranslateY.value = androidTranslateY.value
            runOnJS(reportZoomChange)(true)
        })
        .onUpdate((event) => {
            androidTranslateX.value = androidSavedTranslateX.value + event.translationX
            androidTranslateY.value = androidSavedTranslateY.value + event.translationY
        })
        .onEnd(() => {
            clampAndroidZoomIntoView()
        }), [
        androidSavedTranslateX,
        androidSavedTranslateY,
        androidScale,
        androidTranslateX,
        androidTranslateY,
        isCustomPinch,
        clampAndroidZoomIntoView,
        reportZoomChange,
    ])

    const androidPinchGesture = React.useMemo(() => Gesture.Pinch()
        .enabled(isCustomPinch)
        .onStart((event) => {
            const effectiveTranslateX = getEffectiveAndroidTranslate(androidTranslateX.value, androidFocalX.value, androidScale.value)
            const effectiveTranslateY = getEffectiveAndroidTranslate(androidTranslateY.value, androidFocalY.value, androidScale.value)

            const nextFocalX = androidScrollOffsetX.value + event.focalX - androidContainerX.value - androidContainerWidth.value / 2
            const nextFocalY = androidScrollOffsetY.value + event.focalY - androidContainerY.value - androidContainerHeight.value / 2

            // console.log("[ZoomSurface] Pinch onStart", {
            //     focalX: event.focalX,
            //     focalY: event.focalY,
            //     translateX: androidTranslateX.value,
            //     translateY: androidTranslateY.value,
            //     scale: androidScale.value
            // })

            androidSavedScale.value = androidScale.value
            androidSavedFocalX.value = nextFocalX
            androidSavedFocalY.value = nextFocalY
            androidSavedTranslateX.value = effectiveTranslateX - nextFocalX * (1 - androidSavedScale.value)
            androidSavedTranslateY.value = effectiveTranslateY - nextFocalY * (1 - androidSavedScale.value)
            androidInitialFocalX.value = event.focalX
            androidInitialFocalY.value = event.focalY
            androidTranslateX.value = androidSavedTranslateX.value
            androidTranslateY.value = androidSavedTranslateY.value
            androidFocalX.value = androidSavedFocalX.value
            androidFocalY.value = androidSavedFocalY.value
            runOnJS(reportZoomChange)(true)
        })
        .onUpdate((event) => {
            if (event.numberOfPointers < 2) {
                return
            }

            const deltaX = event.focalX - androidInitialFocalX.value
            const deltaY = event.focalY - androidInitialFocalY.value

            if (Math.abs(deltaX) > 25 || Math.abs(deltaY) > 25) {
                return
            }

            androidInitialFocalX.value = event.focalX
            androidInitialFocalY.value = event.focalY

            const nextScale = clampZoomValue(androidSavedScale.value * event.scale, 1, maxScale)

            if (androidSavedScale.value > ZOOM_THRESHOLD && event.scale < 1) {
                const remainingZoom = androidSavedScale.value - 1
                const progress = remainingZoom > 0
                    ? clampZoomValue((nextScale - 1) / remainingZoom, 0, 1)
                    : 0
                const savedEffectiveTranslateX = getEffectiveAndroidTranslate(androidSavedTranslateX.value,
                    androidSavedFocalX.value,
                    androidSavedScale.value)
                const savedEffectiveTranslateY = getEffectiveAndroidTranslate(androidSavedTranslateY.value,
                    androidSavedFocalY.value,
                    androidSavedScale.value)

                androidScale.value = nextScale
                androidTranslateX.value = savedEffectiveTranslateX * progress
                androidTranslateY.value = savedEffectiveTranslateY * progress
                androidFocalX.value = 0
                androidFocalY.value = 0
                return
            }

            androidScale.value = nextScale
            androidTranslateX.value = androidTranslateX.value + deltaX
            androidTranslateY.value = androidTranslateY.value + deltaY
            androidFocalX.value = androidSavedFocalX.value
            androidFocalY.value = androidSavedFocalY.value
        })
        .onEnd(() => {
            // console.log("[ZoomSurface] Pinch onEnd", {
            //     translateX: androidTranslateX.value,
            //     translateY: androidTranslateY.value,
            //     scale: androidScale.value
            // })

            androidTranslateX.value += androidFocalX.value * (1 - androidScale.value)
            androidTranslateY.value += androidFocalY.value * (1 - androidScale.value)
            androidFocalX.value = 0
            androidFocalY.value = 0
            clampAndroidZoomIntoView()
        }), [
        androidFocalX,
        androidFocalY,
        androidInitialFocalX,
        androidInitialFocalY,
        androidSavedFocalX,
        androidSavedFocalY,
        androidSavedScale,
        androidSavedTranslateX,
        androidSavedTranslateY,
        androidScrollOffsetX,
        androidScrollOffsetY,
        androidScale,
        androidTranslateX,
        androidTranslateY,
        isCustomPinch,
        clampAndroidZoomIntoView,
        maxScale,
        reportZoomChange,
    ])

    const androidAnimatedStyle = useAnimatedStyle(() => ({
        // translate to the pinch focus then scale then translate back
        transform: [
            { translateX: androidTranslateX.value },
            { translateY: androidTranslateY.value },
            { translateX: androidFocalX.value },
            { translateY: androidFocalY.value },
            { scale: androidScale.value },
            { translateX: -androidFocalX.value },
            { translateY: -androidFocalY.value },
        ],
    }), [androidFocalX, androidFocalY, androidScale, androidTranslateX, androidTranslateY])

    const androidGesture = React.useMemo(() => Gesture.Race(
        androidPinchGesture,
        androidPanOnlyGesture,
        androidTapGestures,
    ), [androidPanOnlyGesture, androidPinchGesture, androidTapGestures])

    if (isCustomPinch) {
        if (hasScrollableContainer) {
            return (
                <GestureDetector key={surfaceKey} gesture={androidGesture}>
                    <ScrollView
                        alwaysBounceHorizontal={false}
                        alwaysBounceVertical={false}
                        bounces={false}
                        className="overflow-hidden"
                        contentInsetAdjustmentBehavior="never"
                        contentContainerStyle={contentContainerStyle}
                        onScroll={handleAndroidScroll}
                        ref={setScrollViewNode}
                        removeClippedSubviews={removeClippedSubviews && !androidZoomed}
                        scrollEnabled={!androidZoomed}
                        scrollEventThrottle={scrollEventThrottle}
                        showsHorizontalScrollIndicator={false}
                        showsVerticalScrollIndicator={false}
                        style={style}
                    >
                        <Animated.View
                            collapsable={false}
                            onLayout={handleAndroidZoomLayout}
                            style={[{ width: "100%" }, androidAnimatedStyle]}
                        >
                            {children}
                        </Animated.View>
                    </ScrollView>
                </GestureDetector>
            )
        }

        return (
            <GestureDetector key={surfaceKey} gesture={androidGesture}>
                <View className="overflow-hidden" style={style}>
                    <Animated.View
                        collapsable={false}
                        onLayout={handleAndroidZoomLayout}
                        style={[contentContainerStyle, androidAnimatedStyle]}
                    >
                        {children}
                    </Animated.View>
                </View>
            </GestureDetector>
        )
    }

    if (!isNativePinch) {
        return (
            <GestureDetector key={surfaceKey} gesture={tapGesture}>
                <View className="overflow-hidden" style={style}>
                    {children}
                </View>
            </GestureDetector>
        )
    }

    return (
        <GestureDetector key={surfaceKey} gesture={nativeTapGesture}>
            <ScrollView
                alwaysBounceHorizontal={false}
                alwaysBounceVertical={false}
                bounces={false}
                bouncesZoom={false}
                className="overflow-hidden"
                contentInsetAdjustmentBehavior="never"
                contentContainerStyle={contentContainerStyle}
                directionalLockEnabled
                maximumZoomScale={maxScale}
                minimumZoomScale={1}
                onLayout={handleNativeScrollLayout}
                onMomentumScrollEnd={handleNativeZoomScroll}
                onScroll={handleNativeZoomScroll}
                onScrollEndDrag={handleNativeZoomScroll}
                pinchGestureEnabled
                ref={setScrollViewNode}
                scrollEventThrottle={scrollEventThrottle}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                style={style}
            >
                <View collapsable={false}>
                    {children}
                </View>
            </ScrollView>
        </GestureDetector>
    )
}
