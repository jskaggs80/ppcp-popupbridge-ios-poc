# PayPal Orders v2 + PopupBridge iOS POC (AS2 flow)

A proof of concept that runs a **PayPal Orders v2 (PPCP)** checkout inside an iOS `WKWebView`, using Braintree's
[PopupBridge for iOS](https://github.com/braintree/popup-bridge-ios) so the PayPal approval popup opens in a secure
`ASWebAuthenticationSession`.

**Built with:** VS Code, Node.js (zero npm dependencies), the PayPal JS SDK, and Xcode (SwiftUI) for the iOS shell.
**Flow demonstrated:** the AS2 flow on PPCP Orders v2 — create (AUTHORIZE, save explicitly) → approve → **save** → **authorize** → capture.

> POC only. The server has no auth, the amount is client-supplied, and nothing here is production-hardened.

## How it works

```
iOS app (SwiftUI)
 └─ WKWebView + PopupBridge  ──loads──▶  Node server (localhost:3099)
                                           ├─ GET  /                 checkout page + PayPal JS SDK button
                                           ├─ POST /api/orders       create order (Orders v2)
                                           ├─ POST /api/orders/:id/save        save order
                                           ├─ POST /api/orders/:id/authorize   authorize order
                                           └─ POST /api/authorizations/:id/capture   capture authorization
```

PopupBridge injects `window.popupBridge` into the page. The PayPal JS SDK sees it and opens the approval popup in an
`ASWebAuthenticationSession` (with the HTTPS lock icon) instead of a blind popup, then returns the result to the page.

### Order lifecycle

| Step | API call | Notes |
|------|----------|-------|
| 1. Create | `POST /v2/checkout/orders` | `intent: AUTHORIZE`, `processing_instruction: ORDER_SAVED_EXPLICITLY` |
| 2. Approve | PayPal JS SDK popup (via PopupBridge) | Buyer logs in and approves |
| 3. Save | `POST /v2/checkout/orders/{id}/save` | No request body; order status becomes `SAVED` |
| 4. Authorize | `POST /v2/checkout/orders/{id}/authorize` | Triggered by the "Authorize saved order" button |
| 5. Capture | `POST /v2/payments/authorizations/{id}/capture` | Triggered by the "Capture authorization" button, `final_capture: true` |

The full JSON response for every step prints in the terminal running the server.

## Prerequisites

- macOS with **Xcode 16.2+** (iOS 16+ deployment target)
- **Node.js 18+** (uses built-in `fetch`; no `npm install` needed)
- A PayPal REST app with a **client ID and secret** (sandbox by default) and a sandbox buyer account
- VS Code (or any editor)

## 1. Run the server

```bash
cd server
cp .env.example .env      # then edit .env
node server.js
```

> **Enter your own credentials.** Open `server/.env` and replace `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET` with the
> client ID and secret from your PayPal **sandbox** REST app (developer.paypal.com > Apps & Credentials). The sandbox
> hosts in `.env.example` are already correct. Never commit `.env`.

| Variable | Description |
|----------|-------------|
| `PAYPAL_CLIENT_ID` | REST app client ID |
| `PAYPAL_CLIENT_SECRET` | REST app secret (stays on the server) |
| `PAYPAL_API_BASE` | API host, default `https://api-m.sandbox.paypal.com` |
| `PAYPAL_JS_SDK_BASE` | JS SDK host, default `https://www.sandbox.paypal.com` |
| `CURRENCY` | Default `USD` |
| `PORT` | Default `3099` |

Open `http://localhost:3099` in a browser to confirm the page loads. A red "popupBridge NOT found" banner is expected
outside the app. **Keep this terminal open:** it prints the JSON for every PayPal call.

## 2. Create the iOS app in Xcode

1. File > New > Project > iOS > App. Name it `PopupBridgePOC`, Interface **SwiftUI**, Language **Swift**.
   (If Next is disabled, fill in the Organization Identifier, e.g. `com.example`.)
2. Delete the generated `PopupBridgePOCApp.swift` and `ContentView.swift`, then drag in the two files from
   `ios/PopupBridgePOC/` (tick "Copy items if needed" and the app target).
3. File > Add Package Dependencies, enter `https://github.com/braintree/popup-bridge-ios`, rule "Up to Next Major"
   from `3.0.0`, and add the `PopupBridge` product to the app target.
4. Target > **Info** tab:
   - Add `App Transport Security Settings` > `Allows Local Networking` = `YES` (lets the app load `http://localhost`).
   - Under **URL Types**, add a URL scheme `popupbridgepoc` (must match `returnURLScheme` in `ContentView.swift`).
5. Choose an iPhone simulator and press **Cmd+R**.

You should see the checkout page with a green **"window.popupBridge detected"** banner.

Optional: `ios/project.yml` is an [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec that generates the same project
(`brew install xcodegen && cd ios && xcodegen generate`).

### Physical device

Change `checkoutURL` in `ContentView.swift` to `http://<your-Mac-LAN-IP>:3099/` and keep the phone and Mac on the same network.

## 3. Run a test

1. Tap the PayPal button and log in with a **sandbox buyer** account.
2. After approval the page saves the order. **Scroll down** and tap **Authorize saved order**.
3. Tap **Capture authorization**.
4. Watch the server terminal for `=== [CREATE ORDER] ===`, `[SAVE]`, `[AUTHORIZE]`, `[CAPTURE]` blocks you can copy.
5. Tap **Start over** (appears once a test has run) to reset to a clean slate without restarting the app.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE :::3099` | Server already running. `kill $(lsof -ti :3099)` then restart. |
| Server changes have no effect | Restart the server. `index.html` is static and only needs an app reload. |
| "Failed to load PayPal JS SDK" | Wrong or unreachable `PAYPAL_JS_SDK_BASE`; open the SDK URL in a browser to test. |
| OAuth failed | Credentials don't match the environment in `PAYPAL_API_BASE`. |
| Red banner inside the app | The WebView isn't getting `window.popupBridge`; check the package is linked. |
| Authorize seems to do nothing | The button is below the PayPal button; scroll down and tap it. |
| `com.apple.WebKit.GPU quit unexpectedly` on passkey prompt | Simulator limitation. Choose "use password", erase the simulator, or test on a device. |
| `npm install` fails on internal registry | Not needed; the server has no dependencies. |

## Project layout

```
server/
  server.js          zero-dependency Node server (OAuth, Orders v2, logging)
  public/index.html  checkout page (PayPal JS SDK, save/authorize/capture, Start over)
  .env.example
ios/
  PopupBridgePOC/    SwiftUI app + WKWebView + PopupBridge
  project.yml        optional XcodeGen spec
```

## Notes

- Keep `.env` out of version control (already in `.gitignore`).
- The capture step uses the standard Payments v2 authorization-capture endpoint.
- PopupBridge supports PayPal; this POC does not cover Venmo or Braintree device data collection.
