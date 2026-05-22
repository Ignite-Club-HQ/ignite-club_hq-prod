import UIKit
import Capacitor
import FirebaseCore
import FirebaseCrashlytics
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize Firebase before any other Firebase services are used
        FirebaseApp.configure()
        
        // Initialize Crashlytics
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(true)
        
        // Set Firebase Messaging delegate
        Messaging.messaging().delegate = self
        
        // Set UNUserNotificationCenter delegate for foreground notification display
        UNUserNotificationCenter.current().delegate = self
        
        // Register for remote notifications - required for APNs token delivery
        application.registerForRemoteNotifications()
        
        return true
    }
    
    // MARK: - APNs Token Forwarding
    
    // Forward the APNs token to Firebase so FCM can send notifications
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        // Also forward to Capacitor
        ApplicationDelegateProxy.shared.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
    }
    
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[AppDelegate] Failed to register for remote notifications: \(error.localizedDescription)")
        ApplicationDelegateProxy.shared.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
    }
    
    // MARK: - Background Notification Handling
    
    // Handle silent/background push notifications
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        // Forward to Capacitor
        ApplicationDelegateProxy.shared.application(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completionHandler)
    }
    
    // MARK: - Firebase MessagingDelegate
    
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        if let token = fcmToken {
            print("[AppDelegate] FCM token refreshed: \(token.prefix(20))...")
            // Token is picked up by Capacitor Firebase Messaging plugin automatically
        }
    }
    
    // MARK: - UNUserNotificationCenterDelegate
    //
    // We set AppDelegate as the UNUserNotificationCenter delegate so we receive
    // cold-start notification taps (the Capacitor PushNotifications plugin's
    // own `load()` runs later and would otherwise miss them). We then forward
    // the calls to the plugin so its JS `pushNotificationActionPerformed`
    // listener fires and the app navigates to the tapped message.

    private func capacitorPushDelegate() -> UNUserNotificationCenterDelegate? {
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let plugin = bridgeVC.bridge?.plugin(withName: "PushNotifications") as? UNUserNotificationCenterDelegate else {
            return nil
        }
        return plugin
    }

    // Show notifications even when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if let pushDelegate = capacitorPushDelegate(),
           pushDelegate.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler) != nil {
            return
        }
        completionHandler([.banner, .badge, .sound])
    }

    // Handle notification tap - forward to Capacitor so pushNotificationActionPerformed fires
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let pushDelegate = capacitorPushDelegate(),
           pushDelegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler) != nil {
            return
        }
        // Plugin not ready yet (cold start) - buffer the userInfo and replay it
        // once the plugin has loaded.
        let userInfo = response.notification.request.content.userInfo
        PendingNotificationTap.shared.store(userInfo: userInfo)
        completionHandler()
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
