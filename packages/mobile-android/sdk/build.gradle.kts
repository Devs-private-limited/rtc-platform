import com.vanniktech.maven.publish.SonatypeHost

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.vanniktech.maven.publish")
}

android {
    namespace = "com.rtcexpress.sdk"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Exposed as api: the public API uses OkHttpClient and org.webrtc types (VideoTrack, SurfaceViewRenderer).
dependencies {
    api("com.squareup.okhttp3:okhttp:4.12.0")
    api("io.github.haiyangwu:mediasoup-client:3.4.0")
}

// Publishes com.devsquarelabs:rtcexpress-android to Maven Central (Central Portal).
// Credentials and the signing key come from ~/.gradle/gradle.properties, never from this repo.
mavenPublishing {
    coordinates("com.devsquarelabs", "rtcexpress-android", "0.1.0")
    publishToMavenCentral(SonatypeHost.CENTRAL_PORTAL)
    // Local test builds skip signing; Maven Central uploads need the key configured.
    if (providers.gradleProperty("signingInMemoryKey").isPresent) signAllPublications()

    pom {
        name.set("RTCExpress Android SDK")
        description.set("Kotlin SDK for RTCExpress: in-app chat, voice and video calls, and SFU group rooms.")
        inceptionYear.set("2026")
        url.set("https://rtc.devsquarelabs.com/sdk/android")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("devsquarelabs")
                name.set("Devsquare Labs")
                email.set("support@devsquarelabs.com")
            }
        }
        scm {
            url.set("https://github.com/Devs-private-limited/rtcexpress-guides")
        }
    }
}
