#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(RTCExpress, RCTEventEmitter)

RCT_EXTERN_METHOD(fetchToken:(NSString *)serverUrl
                  request:(NSDictionary *)request
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(init:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(joinRoom:(NSString *)roomId)
RCT_EXTERN_METHOD(sendMessage:(NSString *)text)
RCT_EXTERN_METHOD(callUser:(NSString *)peerUserId video:(BOOL)video)
RCT_EXTERN_METHOD(acceptCall)
RCT_EXTERN_METHOD(rejectCall)
RCT_EXTERN_METHOD(endCall)
RCT_EXTERN_METHOD(muteMicrophone:(BOOL)muted)
RCT_EXTERN_METHOD(muteCamera:(BOOL)muted)
RCT_EXTERN_METHOD(switchCamera)
RCT_EXTERN_METHOD(destroy)

+ (BOOL)requiresMainQueueSetup { return YES; }

@end
