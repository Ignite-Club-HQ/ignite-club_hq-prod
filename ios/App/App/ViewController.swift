import UIKit
import Capacitor

/// Custom view controller that disables WKWebView bounce to allow
/// JavaScript-driven pull-to-refresh gestures to work correctly.
class ViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        // Set white background at EVERY level to prevent black flash
        // This covers the gap between launch screen dismissal and web content rendering
        view.window?.backgroundColor = .white
        view.backgroundColor = .white
        webView?.backgroundColor = .white
        webView?.isOpaque = false
        webView?.scrollView.backgroundColor = .white

        // Disable the native rubber-band bounce so our JS pull-to-refresh
        // can intercept touch events at the top of scrollable containers.
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.alwaysBounceHorizontal = false
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Window is guaranteed to be set by viewDidAppear
        view.window?.backgroundColor = .white
    }
}
