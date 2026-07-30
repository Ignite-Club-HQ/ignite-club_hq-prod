/**
 * Appium / WebdriverIO configuration for the iOS OS resume regression test.
 *
 * Deliberately minimal: XCUITest driver, Simulator only, no signing, no
 * provisioning profile, no App Store Connect. The `.app` is a debug
 * simulator build of the disposable fixture (`app.igniteclubhq.iososresumetest`).
 *
 * `run-simulator-test.mjs` fills in `appPath`, `deviceName`, `platformVersion`
 * and `udid` from the actual booted simulator, then hands the result to
 * `resume.e2e.mjs`.
 */
export const BUNDLE_ID = "app.igniteclubhq.iososresumetest";

export function buildCapabilities({ appPath, deviceName, platformVersion, udid }) {
  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:deviceName": deviceName,
    "appium:platformVersion": platformVersion,
    "appium:udid": udid,
    "appium:app": appPath,
    "appium:bundleId": BUNDLE_ID,
    "appium:noReset": true,
    "appium:fullReset": false,
    "appium:autoAcceptAlerts": true,
    "appium:newCommandTimeout": 240,
    "appium:wdaLaunchTimeout": 240000,
    "appium:wdaConnectionTimeout": 240000,
    "appium:webviewConnectTimeout": 20000,
    "appium:includeSafariInWebviews": false,
    "appium:showXcodeLog": false,
    "appium:usePrebuiltWDA": false,
  };
}

export const APPIUM_SERVER = {
  hostname: "127.0.0.1",
  port: Number(process.env.IOS_OS_APPIUM_PORT ?? 4723),
  path: "/",
  connectionRetryTimeout: 240000,
  connectionRetryCount: 2,
  logLevel: "warn",
};
