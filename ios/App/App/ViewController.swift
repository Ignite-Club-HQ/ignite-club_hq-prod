import UIKit
import Capacitor

/// Custom view controller that disables WKWebView bounce to allow
/// JavaScript-driven pull-to-refresh gestures to work correctly.
class ViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        // Disable the native rubber-band bounce so our JS pull-to-refresh
        // can intercept touch events at the top of scrollable containers.
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.alwaysBounceHorizontal = false
    }
}
