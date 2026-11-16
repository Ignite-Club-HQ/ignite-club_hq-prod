import UIKit
import Capacitor

@objc(NativeFileExportPlugin)
public class NativeFileExportPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "NativeFileExportPlugin"
    public let jsName = "NativeFileExport"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)]
    private var pending: CAPPluginCall?
    @objc func save(_ call: CAPPluginCall) {
        guard pending == nil else { call.reject("Save already in progress"); return }
        guard let path = call.getString("filePath"), let url = URL(string: path), url.isFileURL,
              FileManager.default.fileExists(atPath: url.path) else { call.reject("Local file missing"); return }
        DispatchQueue.main.async {
            guard let viewController = self.bridge?.viewController else { call.reject("Save unavailable"); return }
            self.pending = call
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            viewController.present(picker, animated: true)
        }
    }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        pending?.resolve(["saved": !urls.isEmpty]); pending = nil
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["saved": false]); pending = nil
    }
}

@objc(DocumentBridgeViewController)
class DocumentBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeFileExportPlugin())
    }
}