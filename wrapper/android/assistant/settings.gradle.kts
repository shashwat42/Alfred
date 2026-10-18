// Used only when an IDE imports this module on its own. The Tauri parent build
// supplies its own buildscript classpath when including :alfred-assistant.
pluginManagement {
    resolutionStrategy {
        eachPlugin {
            // Resolve implementation modules directly, matching the Tauri parent.
            when (requested.id.id) {
                "com.android.library" -> useModule("com.android.tools.build:gradle:9.3.1")
                "org.jetbrains.kotlin.android" -> useModule("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
            }
        }
    }
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "alfred-assistant"
