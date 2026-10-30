import ExpoModulesCore

public final class ExpoNativeMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoNativeMenu")

    View(ExpoNativeMenuView.self) {
      Events("onSelectOption")

      Prop("options") { (view: ExpoNativeMenuView, options: [NativeMenuOption]) in
        view.options = options
      }

      Prop("selectedId") { (view: ExpoNativeMenuView, selectedId: String?) in
        view.selectedId = selectedId
      }

      Prop("label") { (view: ExpoNativeMenuView, label: String?) in
        view.button.accessibilityLabel = label
      }

      Prop("disabled") { (view: ExpoNativeMenuView, disabled: Bool?) in
        view.button.isEnabled = !(disabled ?? false)
      }

      OnViewDidUpdateProps { (view: ExpoNativeMenuView) in
        view.updateMenu()
      }
    }
  }
}
