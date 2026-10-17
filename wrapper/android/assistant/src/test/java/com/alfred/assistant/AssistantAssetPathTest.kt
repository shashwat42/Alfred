package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class AssistantAssetPathTest {
    @Test fun packagedPathsAreResolvedWithoutRootAccess() {
        assertEquals("index.html", AssistantAssetPath.fromDecodedPath("/index.html"))
        assertEquals("assets/speech.worker-123.js", AssistantAssetPath.fromDecodedPath("/assets/speech.worker-123.js"))
    }
    @Test fun traversalEmptyAndMalformedPathsAreRejected() {
        for (path in listOf(null, "", "/", "index.html", "/../secret", "/assets/../../session", "/assets\\secret", "/assets/\u0000secret")) {
            assertNull("Rejected path: $path", AssistantAssetPath.fromDecodedPath(path))
        }
    }
}
