module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        packageImportPath: 'import com.rtcexpress.reactnative.RTCExpressPackage;',
        packageInstance: 'new RTCExpressPackage()',
      },
      ios: {},
    },
  },
};
