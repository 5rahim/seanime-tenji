import { NAV_THEME } from "@/lib/constants"
import BottomSheet, {
    BottomSheetBackdrop,
    type BottomSheetBackdropProps,
    BottomSheetScrollView,
    type BottomSheetScrollViewMethods,
} from "@gorhom/bottom-sheet"
import { Portal } from "@rn-primitives/portal"
import React, { useCallback, useId, useMemo, useRef } from "react"
import { Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type BottomSheetProps = {
    className?: string
    title?: string
    children?: React.ReactNode
    footer?: React.ReactNode
    index?: number
    open: boolean
    onOpenChange: (open: boolean) => void
    snapPoints?: string[]
    enableContentPanningGesture?: boolean
    enableHandlePanningGesture?: boolean
    enablePanDownToClose?: boolean
    enableOverDrag?: boolean
    keyboardBehavior?: React.ComponentProps<typeof BottomSheet>["keyboardBehavior"]
    keyboardBlurBehavior?: React.ComponentProps<typeof BottomSheet>["keyboardBlurBehavior"]
    enableBlurKeyboardOnGesture?: boolean
    androidKeyboardInputMode?: React.ComponentProps<typeof BottomSheet>["android_keyboardInputMode"]
    scrollRef?: React.Ref<BottomSheetScrollViewMethods>
}

export function SeaBottomSheet({
    className,
    title,
    children,
    footer,
    index = 0,
    open,
    onOpenChange,
    snapPoints: _snapPoints = ["50%"],
    enableContentPanningGesture = true,
    enableHandlePanningGesture = true,
    enablePanDownToClose = true,
    enableOverDrag = true,
    keyboardBehavior,
    keyboardBlurBehavior,
    enableBlurKeyboardOnGesture,
    androidKeyboardInputMode,
    scrollRef,
}: BottomSheetProps) {
    const id = useId()
    const bottomSheetRef = useRef<BottomSheet>(null)
    const insets = useSafeAreaInsets()

    const snapPoints = useMemo(() => _snapPoints, [_snapPoints])

    const handleSheetChanges = useCallback((changedIndex: number) => {
        if (changedIndex < 0) {
            onOpenChange(false)
        }
    }, [onOpenChange])

    const handleSheetClose = useCallback(() => {
        onOpenChange(false)
    }, [onOpenChange])

    const renderBackdrop = useCallback(
        (props: BottomSheetBackdropProps) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.7}
                pressBehavior="close"
            />
        ),
        [],
    )

    const topPadding = 4
    const bottomPadding = footer ? 8 : Math.max(28, insets.bottom + 8)

    return (
        <>
            {open && (
                <Portal name={`bottom-sheet-${id}`}>
                    <BottomSheet
                        ref={bottomSheetRef}
                        index={index}
                        snapPoints={snapPoints}
                        enableContentPanningGesture={enableContentPanningGesture}
                        enableHandlePanningGesture={enableHandlePanningGesture}
                        enablePanDownToClose={enablePanDownToClose}
                        enableOverDrag={enableOverDrag}
                        keyboardBehavior={keyboardBehavior}
                        keyboardBlurBehavior={keyboardBlurBehavior}
                        enableBlurKeyboardOnGesture={enableBlurKeyboardOnGesture}
                        android_keyboardInputMode={androidKeyboardInputMode}
                        backdropComponent={renderBackdrop}
                        handleIndicatorStyle={{ backgroundColor: "#666" }}
                        backgroundStyle={{ backgroundColor: NAV_THEME.dark.card }}
                        onChange={handleSheetChanges}
                        onClose={handleSheetClose}
                        topInset={insets.top}
                    >
                        <BottomSheetScrollView
                            ref={scrollRef}
                            style={{ flex: 1 }}
                            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: topPadding, paddingBottom: bottomPadding }}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                        >
                            {title && (
                                <Text className="text-xl font-semibold mb-3 text-foreground">{title}</Text>
                            )}
                            {children}
                        </BottomSheetScrollView>
                        {footer && (
                            <View
                                style={{
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                    paddingBottom: Math.max(28, insets.bottom + 8),
                                    borderTopWidth: 1,
                                    borderTopColor: "rgba(255,255,255,0.08)",
                                    backgroundColor: NAV_THEME.dark.card,
                                }}
                            >
                                {footer}
                            </View>
                        )}
                    </BottomSheet>
                </Portal>
            )}
        </>
    )
}
