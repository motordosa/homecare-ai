import SwiftUI
import UIKit

@MainActor final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Register persisted HealthKit observers on cold/background launch too.
        ConnectorModel.shared.bootstrap()
        return true
    }
}
@main @MainActor struct HomeCareConnectorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    var body: some Scene { WindowGroup { ContentView() } }
}
