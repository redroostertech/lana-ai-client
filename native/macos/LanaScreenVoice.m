#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CommonCrypto/CommonDigest.h>

static void Emit(NSDictionary *payload, int status) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  [[NSFileHandle fileHandleWithStandardOutput] writeData:data];
  [[NSFileHandle fileHandleWithStandardOutput] writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
  exit(status);
}

static id AXGet(AXUIElementRef element, CFStringRef name) {
  if (!element) return nil;
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return nil;
  return CFBridgingRelease(value);
}

static NSString *AXString(AXUIElementRef element, CFStringRef name) {
  id value = AXGet(element, name);
  return [value isKindOfClass:NSString.class] ? value : @"";
}

static AXUIElementRef AXElement(id value) {
  return value ? (__bridge AXUIElementRef)value : NULL;
}

static NSDictionary *AXBounds(AXUIElementRef element) {
  id position = AXGet(element, kAXPositionAttribute);
  id size = AXGet(element, kAXSizeAttribute);
  if (!position || !size || CFGetTypeID((__bridge CFTypeRef)position) != AXValueGetTypeID()
      || CFGetTypeID((__bridge CFTypeRef)size) != AXValueGetTypeID()) return nil;
  CGPoint point = CGPointZero;
  CGSize dimensions = CGSizeZero;
  if (!AXValueGetValue((__bridge AXValueRef)position, kAXValueCGPointType, &point)
      || !AXValueGetValue((__bridge AXValueRef)size, kAXValueCGSizeType, &dimensions)) return nil;
  return @{ @"x": @(point.x), @"y": @(point.y), @"width": @(dimensions.width), @"height": @(dimensions.height) };
}

static BOOL AXSettable(AXUIElementRef element, CFStringRef name) {
  Boolean settable = false;
  return element && AXUIElementIsAttributeSettable(element, name, &settable) == kAXErrorSuccess && settable;
}

static NSString *Digest(NSString *value) {
  if (!value.length) return nil;
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, hash);
  NSMutableString *out = [NSMutableString string];
  for (NSUInteger index = 0; index < 12; index++) [out appendFormat:@"%02x", hash[index]];
  return out;
}

static NSString *Bounded(NSString *value, NSUInteger maximum) {
  if (value.length <= maximum) return value;
  NSUInteger head = (NSUInteger)(maximum * 0.7);
  return [NSString stringWithFormat:@"%@\n…[context truncated]…\n%@",
          [value substringToIndex:head], [value substringFromIndex:value.length - (maximum - head)]];
}

static NSDictionary *CurrentContext(NSString **errorCode, BOOL includeContent) {
  if (!AXIsProcessTrusted()) { *errorCode = @"accessibility_permission_denied"; return nil; }
  NSRunningApplication *running = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!running) { *errorCode = @"active_application_unavailable"; return nil; }
  AXUIElementRef app = AXUIElementCreateApplication(running.processIdentifier);
  id windowObj = AXGet(app, kAXFocusedWindowAttribute);
  id focusedObj = AXGet(app, kAXFocusedUIElementAttribute);
  AXUIElementRef window = AXElement(windowObj);
  AXUIElementRef focused = AXElement(focusedObj);
  NSString *role = AXString(focused, kAXRoleAttribute);
  NSString *subrole = AXString(focused, kAXSubroleAttribute);
  NSString *name = AXString(focused, kAXTitleAttribute);
  if (!name.length) name = AXString(focused, kAXDescriptionAttribute);
  NSString *selectedRaw = includeContent ? AXString(focused, kAXSelectedTextAttribute) : @"";
  NSString *valueRaw = includeContent ? AXString(focused, kAXValueAttribute) : @"";
  NSString *sensitiveName = [NSString stringWithFormat:@"%@ %@ %@", role, subrole, name];
  BOOL secure = [sensitiveName rangeOfString:@"password|passcode|secure|security code|cvv"
                                     options:NSRegularExpressionSearch | NSCaseInsensitiveSearch].location != NSNotFound;
  NSSet *editableRoles = [NSSet setWithArray:@[@"AXTextField", @"AXTextArea", @"AXComboBox", @"AXDocument"]];
  BOOL editable = !secure && ([editableRoles containsObject:role]
                    || AXSettable(focused, kAXSelectedTextAttribute) || AXSettable(focused, kAXValueAttribute));
  NSString *selected = secure ? @"" : Bounded(selectedRaw, 4000);
  NSString *value = secure ? @"" : Bounded(valueRaw, 8000);
  NSString *processName = running.localizedName ?: @"";
  NSString *windowTitle = AXString(window, kAXTitleAttribute);
  NSDictionary *bounds = AXBounds(focused);
  NSDictionary *fingerprint = @{
    @"platform": @"darwin", @"processId": @(running.processIdentifier),
    @"bundleId": running.bundleIdentifier ?: @"", @"processName": processName,
    @"windowTitle": windowTitle, @"role": role, @"name": name,
    @"bounds": bounds ?: NSNull.null, @"selectionHash": Digest(selected) ?: NSNull.null
  };
  NSUInteger original = selectedRaw.length + valueRaw.length;
  CFRelease(app);
  return @{
    @"platform": @"darwin", @"processId": @(running.processIdentifier),
    @"bundleId": running.bundleIdentifier ?: @"", @"activeApplication": processName,
    @"processName": processName, @"windowTitle": windowTitle,
    @"browserUrlOrDomainWhenSafelyAvailable": NSNull.null,
    @"focusedElement": @{ @"role": role, @"name": name, @"value": value,
      @"isEditable": @(editable), @"isPassword": @(secure), @"bounds": bounds ?: NSNull.null },
    @"selectedText": selected, @"surroundingText": value, @"accessibleDocumentText": value,
    @"spreadsheetContext": NSNull.null, @"nearbyControls": @[], @"screenshotReference": NSNull.null,
    @"collectionMethod": @"accessibility",
    @"truncationMetadata": @{ @"truncated": @(original > selected.length + value.length),
      @"originalCharacters": @(original), @"retainedCharacters": @(selected.length + value.length) },
    @"targetFingerprint": fingerprint
  };
}

static NSDictionary *ReadInput(void) {
  NSData *data = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
  if (!data.length) return @{};
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [value isKindOfClass:NSDictionary.class] ? value : @{};
}

static NSString *Comparable(id value) {
  return !value || value == NSNull.null ? @"" : [value description];
}

static BOOL FingerprintsMatch(NSDictionary *expected, NSDictionary *actual, BOOL selection) {
  for (NSString *key in @[@"processId", @"bundleId", @"processName", @"windowTitle", @"role", @"name"]) {
    NSString *left = Comparable(expected[key]), *right = Comparable(actual[key]);
    if (left.length && right.length && ![left isEqualToString:right]) return NO;
  }
  return !selection || [Comparable(expected[@"selectionHash"]) isEqualToString:Comparable(actual[@"selectionHash"])] ;
}

static BOOL KeyStroke(CGKeyCode code) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  CGEventRef down = CGEventCreateKeyboardEvent(source, code, true);
  CGEventRef up = CGEventCreateKeyboardEvent(source, code, false);
  if (!source || !down || !up) return NO;
  CGEventSetFlags(down, kCGEventFlagMaskCommand); CGEventSetFlags(up, kCGEventFlagMaskCommand);
  CGEventPost(kCGHIDEventTap, down); CGEventPost(kCGHIDEventTap, up);
  CFRelease(down); CFRelease(up); CFRelease(source);
  return YES;
}

static NSDictionary *Mutate(NSString *command, NSString **errorCode) {
  NSDictionary *input = ReadInput(), *expected = input[@"targetFingerprint"] ?: @{};
  NSDictionary *context = CurrentContext(errorCode, YES);
  if (!context) return nil;
  if (!FingerprintsMatch(expected, context[@"targetFingerprint"], [command isEqualToString:@"replace"])) {
    *errorCode = @"target_changed"; return nil;
  }
  NSDictionary *info = context[@"focusedElement"];
  if ([info[@"isPassword"] boolValue]) { *errorCode = @"secure_field"; return nil; }
  if (![info[@"isEditable"] boolValue]) { *errorCode = @"target_not_editable"; return nil; }
  NSString *text = [input[@"text"] isKindOfClass:NSString.class] ? input[@"text"] : @"";
  if ([text lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 96000) { *errorCode = @"text_too_large"; return nil; }
  pid_t pid = [context[@"targetFingerprint"][@"processId"] intValue];
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  id focusedObj = AXGet(app, kAXFocusedUIElementAttribute);
  AXUIElementRef focused = AXElement(focusedObj);
  if (AXSettable(focused, kAXSelectedTextAttribute)
      && AXUIElementSetAttributeValue(focused, kAXSelectedTextAttribute, (__bridge CFTypeRef)text) == kAXErrorSuccess) {
    CFRelease(app); return @{ @"ok": @YES, @"method": @"accessibility", @"characters": @(text.length) };
  }
  CFRelease(app);
  return @{ @"ok": @NO, @"fallback": @"clipboard_paste", @"reason": @"accessibility_set_unavailable" };
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *command = argc > 1 ? [NSString stringWithUTF8String:argv[1]] : @"";
    if ([command isEqualToString:@"permission-status"]) Emit(@{ @"trusted": @(AXIsProcessTrusted()), @"platform": @"darwin" }, 0);
    if ([command isEqualToString:@"request-permission"]) {
      NSDictionary *options = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES };
      Emit(@{ @"trusted": @(AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options)), @"platform": @"darwin" }, 0);
    }
    NSString *errorCode = nil;
    if ([command isEqualToString:@"context"] || [command isEqualToString:@"target"]) {
      NSDictionary *context = CurrentContext(&errorCode, [command isEqualToString:@"context"]);
      if (!context) Emit(@{ @"ok": @NO, @"error": errorCode ?: @"native_bridge_failure" }, 1);
      Emit(@{ @"ok": @YES, @"context": context }, 0);
    }
    if ([command isEqualToString:@"activate"]) {
      NSDictionary *fingerprint = ReadInput()[@"targetFingerprint"] ?: @{};
      NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:[fingerprint[@"processId"] intValue]];
      if (!app || ![app activateWithOptions:0]) Emit(@{ @"ok": @NO, @"error": @"target_activation_failed" }, 1);
      usleep(120000); Emit(@{ @"ok": @YES }, 0);
    }
    if ([command isEqualToString:@"insert"] || [command isEqualToString:@"replace"]) {
      NSDictionary *result = Mutate(command, &errorCode);
      if (!result) Emit(@{ @"ok": @NO, @"error": errorCode ?: @"native_bridge_failure" }, 1);
      Emit(result, 0);
    }
    if ([command isEqualToString:@"paste"]) Emit(@{ @"ok": @(KeyStroke(9)), @"method": @"clipboard_paste" }, 0);
    if ([command isEqualToString:@"undo"]) {
      NSDictionary *expected = ReadInput()[@"targetFingerprint"] ?: @{};
      NSDictionary *context = CurrentContext(&errorCode, YES);
      if (!context || !FingerprintsMatch(expected, context[@"targetFingerprint"], NO)) Emit(@{ @"ok": @NO, @"error": @"target_changed" }, 1);
      Emit(@{ @"ok": @(KeyStroke(6)), @"method": @"command_z" }, 0);
    }
    if ([command isEqualToString:@"self-test"]) Emit(@{ @"ok": @(Digest(@"Résumé 你好") != nil), @"unicode": @"Résumé 你好" }, 0);
    Emit(@{ @"ok": @NO, @"error": @"unknown_command" }, 2);
  }
}
