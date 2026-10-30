import type { NativeSyntheticEvent, ViewProps } from "react-native"

export type NativeMenuOption = {
    id: string
    label: string
    sublabel?: string
}

export type ExpoNativeMenuViewProps = ViewProps & {
    options: NativeMenuOption[]
    selectedId?: string
    label?: string
    disabled?: boolean
    onSelectOption: (event: NativeSyntheticEvent<{ id: string }>) => void
}
