package com.nohmo

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.util.UUID
import org.json.JSONObject
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray

/**
 * Captures uncaught native (Java/Kotlin) crashes that the JS-side ErrorUtils
 * handler can't see. A crashing process can't do async work or touch the JS
 * bridge, so the handler only writes a small JSON record to disk; on the next
 * launch the JS SDK calls getStoredCrashes() and emits an APP_CRASH event.
 *
 * The previous default handler is always chained, so the app still crashes
 * normally and other reporters (Play Console, Crashlytics) still fire.
 */
class NohmoCrashModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    @Volatile private var sessionId: String = ""
    @Volatile private var screen: String = ""

    override fun getName() = "NohmoCrash"

    override fun initialize() {
        super.initialize()
        install()
    }

    @ReactMethod
    fun installCrashHandler() {
        install()
    }

    @Synchronized
    private fun install() {
        if (installed) return
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                writeCrashFile(thread, throwable)
            } catch (_: Throwable) {
                // A crash handler must never throw — swallow everything.
            }
            // Chain so the app still crashes and other reporters still see it.
            previous?.uncaughtException(thread, throwable)
        }
        installed = true
    }

    @ReactMethod
    fun setSessionContext(sessionId: String?, screen: String?) {
        this.sessionId = sessionId ?: ""
        this.screen = screen ?: ""
    }

    @ReactMethod
    fun getStoredCrashes(promise: Promise) {
        val out: WritableArray = Arguments.createArray()
        try {
            val dir = crashDir()
            val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".json") } ?: emptyArray()
            // Oldest first so crashes are emitted in the order they happened.
            files.sortedBy { it.lastModified() }.forEach { file ->
                try {
                    val json = JSONObject(file.readText())
                    val map = Arguments.createMap()
                    map.putString("platform", "android")
                    map.putString("type", json.optString("type", "native"))
                    map.putString("message", json.optString("message", ""))
                    map.putString("stack", json.optString("stack", ""))
                    map.putString("thread", json.optString("thread", ""))
                    map.putString("sessionId", json.optString("sessionId", ""))
                    map.putString("screen", json.optString("screen", ""))
                    map.putDouble("ts", json.optLong("ts", 0L).toDouble())
                    out.pushMap(map)
                } catch (_: Throwable) {
                    // Skip a corrupt record.
                } finally {
                    try { file.delete() } catch (_: Throwable) {}
                }
            }
        } catch (_: Throwable) {
            // Never reject — an empty array is a fine result.
        }
        promise.resolve(out)
    }

    private fun writeCrashFile(thread: Thread, throwable: Throwable) {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))

        val json = JSONObject()
        json.put("type", "uncaught_exception")
        json.put("message", throwable.toString())
        json.put("stack", sw.toString())
        json.put("thread", thread.name ?: "")
        json.put("sessionId", sessionId)
        json.put("screen", screen)
        json.put("ts", System.currentTimeMillis())

        val dir = crashDir()
        if (!dir.exists()) dir.mkdirs()
        File(dir, "${UUID.randomUUID()}.json").writeText(json.toString())
    }

    private fun crashDir(): File {
        val base = reactContext.applicationContext?.filesDir
            ?: reactContext.filesDir
            ?: File(reactContext.cacheDir, "files")
        return File(base, "nohmo_crashes")
    }

    companion object {
        @Volatile private var installed = false
    }
}
