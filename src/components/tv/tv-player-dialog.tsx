import { TVButton } from "@/components/tv/tv-focus"
import { requestTVFocus } from "@/components/tv/tv-native"
import { tvSize } from "@/components/tv/tv-scale"
import * as React from "react"
import { Pressable, Text, TVFocusGuideView, View } from "react-native"

type Props = {
    open: boolean
    eyebrow?: string
    title: string
    text: string
    confirmLabel: string
    danger?: boolean
    onCancel: () => void
    onConfirm: () => void
}

export function TVPlayerDialog({
    open,
    eyebrow,
    title,
    text,
    confirmLabel,
    danger,
    onCancel,
    onConfirm,
}: Props) {
    const cancelRef = React.useRef<React.ElementRef<typeof Pressable>>(null)

    React.useEffect(() => {
        if (!open) return

        let innerFrame = 0
        const outerFrame = requestAnimationFrame(() => {
            innerFrame = requestAnimationFrame(() => {
                requestTVFocus(cancelRef.current)
            })
        })

        return () => {
            cancelAnimationFrame(outerFrame)
            if (innerFrame) cancelAnimationFrame(innerFrame)
        }
    }, [open])

    if (!open) return null

    return (
        <View
            style={{
                position: "absolute",
                inset: 0,
                zIndex: 200,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.76)",
                padding: tvSize(60),
            }}
        >
            <View
                style={{
                    width: tvSize(700),
                    borderRadius: tvSize(24),
                    borderWidth: tvSize(2),
                    borderColor: "rgba(255,255,255,0.12)",
                    backgroundColor: "#101011",
                    padding: tvSize(32),
                    gap: tvSize(26),
                }}
            >
                <View style={{ gap: tvSize(9) }}>
                    {/*{eyebrow ? (
                        <Text
                            className="font-bold tracking-widest text-white/40"
                            style={{ fontSize: tvSize(16) }}
                        >
                            {eyebrow}
                        </Text>
                    ) : null}*/}
                    <Text
                        className="font-black text-white"
                        style={{ fontSize: tvSize(30) }}
                    >
                        {title}
                    </Text>
                    <Text
                        className="text-white/60"
                        style={{
                            fontSize: tvSize(20),
                            lineHeight: tvSize(29),
                        }}
                    >
                        {text}
                    </Text>
                </View>

                <TVFocusGuideView
                    trapFocusLeft
                    trapFocusRight
                    trapFocusUp
                    trapFocusDown
                    style={{ flexDirection: "row", gap: tvSize(14) }}
                >
                    <TVButton
                        ref={cancelRef}
                        label="Cancel"
                        preferred
                        onPress={onCancel}
                    />
                    <TVButton
                        label={confirmLabel}
                        variant={danger ? "danger" : "primary"}
                        onPress={onConfirm}
                    />
                </TVFocusGuideView>
            </View>
        </View>
    )
}
