#import <React/RCTBridgeModule.h>
#import <Foundation/Foundation.h>
#import <signal.h>
#import <execinfo.h>
#import <string.h>
#import <unistd.h>
#import <fcntl.h>

// Captures native iOS crashes that the JS-side ErrorUtils handler can't see:
//   - Objective-C NSExceptions (NSSetUncaughtExceptionHandler)
//   - Signals (SIGABRT/SIGSEGV/SIGBUS/SIGFPE/SIGILL/SIGTRAP) — these are how
//     Swift fatalError, force-unwraps, and memory crashes surface.
//
// A crashing process can't touch the JS bridge or do network I/O, so each
// handler only persists a small record to disk. On the next launch the JS SDK
// calls getStoredCrashes() and emits an APP_CRASH event. The previous handlers
// are always chained so the app still terminates normally and other crash
// reporters still fire.
//
// Signal-handler code must be async-signal-safe: everything it needs (the file
// path, session id, screen) is pre-formatted into C buffers at install time, and
// it only uses open()/write()/backtrace_symbols_fd()/strlen() in the handler.

static volatile sig_atomic_t nohmoInstalled = 0;
// Set when our NSException handler runs, so the SIGABRT it triggers (NSException
// → abort()) is not also recorded as a separate signal crash.
static volatile sig_atomic_t nohmoExceptionWritten = 0;
static char nohmoSignalPath[1024];
static char nohmoSessionId[256];
static char nohmoScreen[256];
static NSUncaughtExceptionHandler *nohmoPrevExceptionHandler = NULL;

static const int kNohmoSignals[] = { SIGABRT, SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGTRAP };
static const int kNohmoSignalCount = 6;
static struct sigaction nohmoPrevActions[6];

// Alternate stack so a stack-overflow crash (SIGSEGV with an exhausted stack)
// can still run the handler. 64 KB is plenty for our minimal handler.
static char nohmoAltStack[65536];

static NSString *NohmoCrashDir(void) {
  NSString *caches = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
  return [caches stringByAppendingPathComponent:@"nohmo_crashes"];
}

static const char *NohmoSignalName(int sig) {
  switch (sig) {
    case SIGABRT: return "SIGABRT";
    case SIGSEGV: return "SIGSEGV";
    case SIGBUS:  return "SIGBUS";
    case SIGFPE:  return "SIGFPE";
    case SIGILL:  return "SIGILL";
    case SIGTRAP: return "SIGTRAP";
    default:      return "UNKNOWN";
  }
}

// async-signal-safe write of a C string
static void NohmoWrite(int fd, const char *s) {
  if (fd < 0 || s == NULL) return;
  size_t len = strlen(s);
  if (len > 0) { (void)write(fd, s, len); }
}

static void NohmoSignalHandler(int sig) {
  // An uncaught NSException aborts the process (→ SIGABRT). We already wrote a
  // richer record in the exception handler, so skip the duplicate here.
  int alreadyRecorded = (sig == SIGABRT && nohmoExceptionWritten);
  int fd = alreadyRecorded ? -1 : open(nohmoSignalPath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) {
    NohmoWrite(fd, "NOHMO_SIGNAL\n");
    NohmoWrite(fd, "signal=");
    NohmoWrite(fd, NohmoSignalName(sig));
    NohmoWrite(fd, "\n");
    NohmoWrite(fd, "sessionId=");
    NohmoWrite(fd, nohmoSessionId);
    NohmoWrite(fd, "\n");
    NohmoWrite(fd, "screen=");
    NohmoWrite(fd, nohmoScreen);
    NohmoWrite(fd, "\n");
    NohmoWrite(fd, "STACK:\n");
    void *frames[128];
    int count = backtrace(frames, 128);
    backtrace_symbols_fd(frames, count, fd);   // writes directly to fd, no malloc
    close(fd);
  }

  // Restore the previous handler for this signal and re-raise so the OS (and any
  // other crash reporter) still records the crash.
  for (int i = 0; i < kNohmoSignalCount; i++) {
    if (kNohmoSignals[i] == sig) {
      sigaction(sig, &nohmoPrevActions[i], NULL);
      break;
    }
  }
  raise(sig);
}

static void NohmoExceptionHandler(NSException *exception) {
  // Mark before doing anything so the subsequent SIGABRT (from abort()) is
  // de-duplicated even if writing the record below fails.
  nohmoExceptionWritten = 1;
  @try {
    NSString *dir = NohmoCrashDir();
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSDictionary *record = @{
      @"type": @"nsexception",
      @"message": [NSString stringWithFormat:@"%@: %@", exception.name ?: @"NSException", exception.reason ?: @""],
      @"stack": [[exception callStackSymbols] componentsJoinedByString:@"\n"] ?: @"",
      @"thread": @"main",
      @"sessionId": [NSString stringWithUTF8String:nohmoSessionId] ?: @"",
      @"screen": [NSString stringWithUTF8String:nohmoScreen] ?: @"",
      @"ts": @((long long)([[NSDate date] timeIntervalSince1970] * 1000.0)),
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
    if (data) {
      NSString *path = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@.json", [[NSUUID UUID] UUIDString]]];
      [data writeToFile:path atomically:YES];
    }
  } @catch (__unused NSException *e) {}

  if (nohmoPrevExceptionHandler) { nohmoPrevExceptionHandler(exception); }
}

static void NohmoInstall(void) {
  if (nohmoInstalled) return;
  nohmoInstalled = 1;

  NSString *dir = NohmoCrashDir();
  [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];

  // One signal-crash file per process launch — bake its full path into a C
  // buffer now so the signal handler does no allocation.
  NSString *signalPath = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"signal_%@.txt", [[NSUUID UUID] UUIDString]]];
  strlcpy(nohmoSignalPath, [signalPath fileSystemRepresentation], sizeof(nohmoSignalPath));

  nohmoPrevExceptionHandler = NSGetUncaughtExceptionHandler();
  NSSetUncaughtExceptionHandler(&NohmoExceptionHandler);

  // Run signal handlers on a dedicated stack so a stack-overflow crash can still
  // be captured (the normal stack is exhausted at that point).
  stack_t ss;
  ss.ss_sp = nohmoAltStack;
  ss.ss_size = sizeof(nohmoAltStack);
  ss.ss_flags = 0;
  sigaltstack(&ss, NULL);

  struct sigaction action;
  memset(&action, 0, sizeof(action));
  // Block the other crash signals while our handler runs so a fault inside the
  // handler doesn't re-enter and corrupt the record.
  sigemptyset(&action.sa_mask);
  for (int i = 0; i < kNohmoSignalCount; i++) {
    sigaddset(&action.sa_mask, kNohmoSignals[i]);
  }
  action.sa_handler = NohmoSignalHandler;
  action.sa_flags = SA_ONSTACK;
  for (int i = 0; i < kNohmoSignalCount; i++) {
    sigaction(kNohmoSignals[i], &action, &nohmoPrevActions[i]);
  }
}

@interface NohmoCrash : NSObject <RCTBridgeModule>
@end

@implementation NohmoCrash

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_EXPORT_METHOD(installCrashHandler) {
  NohmoInstall();
}

RCT_EXPORT_METHOD(setSessionContext:(NSString *)sessionId screen:(NSString *)screen) {
  strlcpy(nohmoSessionId, sessionId.length ? sessionId.UTF8String : "", sizeof(nohmoSessionId));
  strlcpy(nohmoScreen, screen.length ? screen.UTF8String : "", sizeof(nohmoScreen));
}

RCT_EXPORT_METHOD(getStoredCrashes:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableArray *out = [NSMutableArray array];
  @try {
    NSString *dir = NohmoCrashDir();
    NSFileManager *fm = [NSFileManager defaultManager];
    NSArray<NSString *> *files = [fm contentsOfDirectoryAtPath:dir error:nil] ?: @[];

    // Oldest first, so crashes emit in the order they happened.
    NSArray *sorted = [files sortedArrayUsingComparator:^NSComparisonResult(NSString *a, NSString *b) {
      NSDictionary *aa = [fm attributesOfItemAtPath:[dir stringByAppendingPathComponent:a] error:nil];
      NSDictionary *bb = [fm attributesOfItemAtPath:[dir stringByAppendingPathComponent:b] error:nil];
      NSDate *da = aa[NSFileModificationDate] ?: [NSDate distantPast];
      NSDate *db = bb[NSFileModificationDate] ?: [NSDate distantPast];
      return [da compare:db];
    }];

    for (NSString *name in sorted) {
      NSString *path = [dir stringByAppendingPathComponent:name];
      @try {
        NSMutableDictionary *rec = [NSMutableDictionary dictionary];
        rec[@"platform"] = @"ios";

        if ([name hasSuffix:@".json"]) {
          NSData *data = [NSData dataWithContentsOfFile:path];
          NSDictionary *j = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
          if ([j isKindOfClass:[NSDictionary class]]) {
            rec[@"type"] = j[@"type"] ?: @"nsexception";
            rec[@"message"] = j[@"message"] ?: @"";
            rec[@"stack"] = j[@"stack"] ?: @"";
            rec[@"thread"] = j[@"thread"] ?: @"";
            rec[@"sessionId"] = j[@"sessionId"] ?: @"";
            rec[@"screen"] = j[@"screen"] ?: @"";
            rec[@"ts"] = j[@"ts"] ?: @(0);
            [out addObject:rec];
          }
        } else if ([name hasSuffix:@".txt"]) {
          NSString *content = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] ?: @"";
          NSString *header = content, *stack = @"", *signal = @"", *sessionId = @"", *screen = @"";
          NSRange stackRange = [content rangeOfString:@"STACK:\n"];
          if (stackRange.location != NSNotFound) {
            header = [content substringToIndex:stackRange.location];
            stack = [content substringFromIndex:stackRange.location + stackRange.length];
          }
          for (NSString *line in [header componentsSeparatedByString:@"\n"]) {
            NSRange eq = [line rangeOfString:@"="];
            if (eq.location == NSNotFound) continue;
            NSString *k = [line substringToIndex:eq.location];
            NSString *v = [line substringFromIndex:eq.location + 1];
            if ([k isEqualToString:@"signal"]) signal = v;
            else if ([k isEqualToString:@"sessionId"]) sessionId = v;
            else if ([k isEqualToString:@"screen"]) screen = v;
          }
          NSDictionary *attrs = [fm attributesOfItemAtPath:path error:nil];
          double ts = [(NSDate *)(attrs[NSFileModificationDate] ?: [NSDate date]) timeIntervalSince1970] * 1000.0;
          rec[@"type"] = @"signal";
          rec[@"signal"] = signal;
          rec[@"message"] = [NSString stringWithFormat:@"Fatal signal %@", signal];
          rec[@"stack"] = stack;
          rec[@"thread"] = @"";
          rec[@"sessionId"] = sessionId;
          rec[@"screen"] = screen;
          rec[@"ts"] = @(ts);
          [out addObject:rec];
        }
      } @catch (__unused NSException *e) {}
      [fm removeItemAtPath:path error:nil];
    }
  } @catch (__unused NSException *e) {}

  resolve(out);
}

@end
