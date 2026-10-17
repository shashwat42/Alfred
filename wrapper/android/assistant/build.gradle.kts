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
    val runtimeDist = rootProject.projectDir.resolve("../../../node_modules/@huggingface/transformers/dist")
    val runtimeNames = listOf("ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm")
    val requiredRuntime = runtimeNames.map { runtimeDist.resolve(it) }
    from(frontendDist)
    from(runtimeDist) {
        include(runtimeNames)
        into("speech-runtime")
    }
    into(layout.projectDirectory.dir("src/main/assets/assistant"))
    doFirst {
        check(requiredIndex.isFile) { "Run npm run build before packaging the Android assistant." }
        check(requiredRuntime.all { it.isFile }) { "Install the locked frontend dependencies before packaging the assistant speech runtime." }
    }
}
tasks.named("preBuild") { dependsOn(syncAssistantAssets) }
