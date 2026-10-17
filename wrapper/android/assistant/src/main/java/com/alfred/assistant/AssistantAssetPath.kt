package com.alfred.assistant

/** Called with Uri.path (already decoded), never with an arbitrary filesystem path. */
object AssistantAssetPath {
    fun fromDecodedPath(path: String?): String? {
        if (path == null || !path.startsWith("/") || path.contains("..") || path.contains('\\') || path.contains('\u0000')) return null
        return path.removePrefix("/").takeIf { it.isNotEmpty() }
    }
}
