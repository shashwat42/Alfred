plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.alfred.assistant"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

kotlin { compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8 } }

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
}

// Copy only production assets. A dev server is never a trusted assistant document.
val frontendDist = rootProject.projectDir.resolve("../../../dist")
val syncAssistantAssets by tasks.registering(Sync::class) {
    val requiredIndex = frontendDist.resolve("index.html")
    from(frontendDist)
    into(layout.projectDirectory.dir("src/main/assets/assistant"))
    doFirst {
        check(requiredIndex.isFile) { "Run npm run build before packaging the Android assistant." }
    }
}
tasks.named("preBuild") { dependsOn(syncAssistantAssets) }
