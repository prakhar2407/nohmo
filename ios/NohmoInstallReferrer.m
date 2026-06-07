#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

// Reads a Nohmo click token from the system pasteboard.
// The token is written by the Nohmo click-link interstitial page when the user
// taps "Open App Store", using navigator.clipboard.writeText('nohmo_click:<uuid>').
// iOS 14+ shows a brief "App pasted from Safari" banner — this is expected and
// only happens once on the very first launch after installation.
@interface NohmoInstallReferrer : NSObject <RCTBridgeModule>
@end

@implementation NohmoInstallReferrer

RCT_EXPORT_MODULE()

RCT_EXPORT_METHOD(getReferrer:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    // hasStrings does NOT trigger the iOS 14+ "App pasted from Safari" privacy
    // banner — only reading the actual string value does. Bail out early when
    // the pasteboard is empty so the banner is never shown to users who never
    // tapped the Nohmo click-link interstitial (i.e. organic installs).
    if (![UIPasteboard generalPasteboard].hasStrings) {
      resolve(@"");
      return;
    }

    NSString *value = [UIPasteboard generalPasteboard].string;
    NSString *prefix = @"nohmo_click:";
    if (value && [value hasPrefix:prefix]) {
      NSString *clickId = [value substringFromIndex:[prefix length]];
      // items = @[] fully empties the pasteboard. Setting .string = @"" leaves
      // an empty-string item that hasStrings would still report as true on the
      // next launch, causing a spurious banner read.
      [UIPasteboard generalPasteboard].items = @[];
      // Return in the same query-string format the Android module uses
      // so setInstallReferrer / the backend can parse it identically.
      NSString *referrer = [@"nohmo_click=" stringByAppendingString:clickId];
      resolve(referrer);
    } else {
      resolve(@"");
    }
  });
}

@end
