import SwiftUI
import WebKit
import PopupBridge

// Change to your Mac's LAN IP (e.g. http://192.168.1.10:3099) when running on a physical device.
let checkoutURL = URL(string: "http://localhost:3099/")!

struct ContentView: View {
    var body: some View {
        CheckoutWebView(url: checkoutURL).ignoresSafeArea(edges: .bottom)
    }
}

struct CheckoutWebView: UIViewRepresentable {
    let url: URL

    final class Coordinator {
        var popupBridge: POPPopupBridge?
    }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        // Injects window.popupBridge and opens popups in ASWebAuthenticationSession.
        context.coordinator.popupBridge = POPPopupBridge(webView: webView, returnURLScheme: "popupbridgepoc")
        webView.load(URLRequest(url: url))
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
