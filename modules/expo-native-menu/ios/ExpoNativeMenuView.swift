import ExpoModulesCore
import UIKit

struct NativeMenuOption: Record {
  @Field var id: String = ""
  @Field var label: String = ""
  @Field var sublabel: String? = nil
}

final class ExpoNativeMenuView: ExpoView {
  let onSelectOption = EventDispatcher()
  let button = UIButton(type: .custom)

  var options: [NativeMenuOption] = []
  var selectedId: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    button.showsMenuAsPrimaryAction = true
    button.frame = bounds
    button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(button)
  }

  func updateMenu() {
    button.menu = UIMenu(children: options.map { option in
      UIAction(
        title: option.label,
        subtitle: option.sublabel,
        state: option.id == selectedId ? .on : .off
      ) { [weak self] _ in
        self?.onSelectOption(["id": option.id])
      }
    })
  }
}
