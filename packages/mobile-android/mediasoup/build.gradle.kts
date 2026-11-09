import com.vanniktech.maven.publish.SonatypeHost

// Repackaged mediasoup-client-android 3.4.0 (MIT, github.com/haiyangwu/mediasoup-client-android):
// the same Java classes and WebRTC jar, with libmediasoupclient_so.so rebuilt from the same source
// with NDK 28 and 16 KB pages (Google Play requires 16 KB support for apps targeting Android 15+).
// The upstream project stopped at 3.4.0 (4 KB pages). Rebuild script: E:\projects\.tools\build\build-16k.sh
plugins {
    id("com.android.library")
    id("com.vanniktech.maven.publish")
}

android {
    namespace = "org.mediasoup.droid"
    compileSdk = 34

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // Already stripped; keep them as built (16 KB aligned).
        jniLibs.keepDebugSymbols += "**/libmediasoupclient_so.so"
    }
}

dependencies {
    // org.mediasoup.droid classes (unchanged from 3.4.0) and the WebRTC Java API they use.
    api(files("libs/mediasoup-client-classes.jar", "libs/libwebrtc.jar"))
}

mavenPublishing {
    coordinates("com.devsquarelabs", "mediasoup-client-android", "3.4.0.1")
    publishToMavenCentral(SonatypeHost.CENTRAL_PORTAL)
    if (providers.gradleProperty("signingInMemoryKey").isPresent) signAllPublications()

    pom {
        name.set("mediasoup-client-android (16 KB pages)")
        description.set("mediasoup-client-android 3.4.0 by Haiyang Wu (MIT), with the native library rebuilt for 16 KB memory pages (Android 15+, Google Play). Used by the RTCExpress Android, React Native and Flutter SDKs.")
        inceptionYear.set("2026")
        url.set("https://github.com/haiyangwu/mediasoup-client-android")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
            }
            license {
                name.set("ISC License (libmediasoupclient)")
                url.set("https://opensource.org/licenses/ISC")
            }
            license {
                name.set("BSD 3-Clause License (WebRTC)")
                url.set("https://webrtc.googlesource.com/src/+/main/LICENSE")
            }
        }
        developers {
            developer {
                id.set("haiyangwu")
                name.set("Haiyang Wu")
            }
            developer {
                id.set("devsquarelabs")
                name.set("Devsquare Labs")
                email.set("support@devsquarelabs.com")
            }
        }
        scm {
            url.set("https://github.com/haiyangwu/mediasoup-client-android")
        }
    }
}
