package com.nohmo

import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class NohmoInstallReferrerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "NohmoInstallReferrer"

    @ReactMethod
    fun getReferrer(promise: Promise) {
        // AtomicBoolean ensures only one thread can win the compareAndSet race
        // between the Install Referrer binder-thread callback and the main-thread timeout.
        val settled = AtomicBoolean(false)

        fun settle(value: String) {
            if (settled.compareAndSet(false, true)) {
                promise.resolve(value)
            }
        }

        val handler = Handler(Looper.getMainLooper())

        // Safety timeout: settle with empty string after 5 s so init() is never
        // blocked permanently on emulators, sideloaded APKs, or devices that lack
        // Google Play Services and therefore never fire the referrer callbacks.
        val timeoutRunnable = Runnable { settle("") }
        handler.postDelayed(timeoutRunnable, 5_000)

        try {
            val client = InstallReferrerClient.newBuilder(reactContext).build()
            client.startConnection(object : InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(responseCode: Int) {
                    handler.removeCallbacks(timeoutRunnable)
                    if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                        try {
                            val ref = client.installReferrer?.installReferrer ?: ""
                            try { client.endConnection() } catch (_: Exception) {}
                            settle(ref)
                        } catch (e: Exception) {
                            try { client.endConnection() } catch (_: Exception) {}
                            settle("")
                        }
                    } else {
                        try { client.endConnection() } catch (_: Exception) {}
                        settle("")
                    }
                }

                override fun onInstallReferrerServiceDisconnected() {
                    handler.removeCallbacks(timeoutRunnable)
                    settle("")
                }
            })
        } catch (e: Exception) {
            handler.removeCallbacks(timeoutRunnable)
            settle("")
        }
    }
}
