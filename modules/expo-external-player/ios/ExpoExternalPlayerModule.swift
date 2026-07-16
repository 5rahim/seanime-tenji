import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

public final class ExpoExternalPlayerModule: Module {
  private var documentController: UIDocumentInteractionController?

  public func definition() -> ModuleDefinition {
    Name("ExpoExternalPlayer")

    AsyncFunction("openFile") { (urlString: String) -> Bool in
      guard
        let url = URL(string: urlString),
        url.isFileURL,
        FileManager.default.fileExists(atPath: url.path),
        let viewController = self.appContext?.utilities?.currentViewController()
      else {
        return false
      }

      // The Open In menu handles the file handoff to apps that support this video type
      let controller = UIDocumentInteractionController(url: url)
      controller.uti = UTType.movie.identifier
      self.documentController = controller

      let bounds = viewController.view.bounds
      let sourceRect = CGRect(x: bounds.midX, y: bounds.midY, width: 1, height: 1)
      return controller.presentOpenInMenu(from: sourceRect, in: viewController.view, animated: true)
    }.runOnQueue(.main)
  }
}
