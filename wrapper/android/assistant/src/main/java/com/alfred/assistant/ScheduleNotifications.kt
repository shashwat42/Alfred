package com.alfred.assistant

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import android.provider.Settings
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import com.google.firebase.messaging.FirebaseMessaging

/** Native scheduling owns Android delivery; neither React surface shows OS alerts. */
object ScheduleNotifications {
    private const val CHANNEL = "alfred_schedule_events"
    private const val JOB_ID = 73102
    private const val PREFS = "alfred_schedule_notifications"
    private const val GRACE = 120000L
    private val executor = Executors.newSingleThreadExecutor()
    private var mainView = WeakReference<WebView>(null)
    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    fun granted(c: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        val manager = c.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }
    private fun exactAlarms(c: Context) = Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun install(activity: Activity, view: WebView) {
        ensureChannel(activity)
        mainView = WeakReference(view)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(view, "AlfredScheduleNotifications", setOf(AssistantBridge.ORIGIN)) { _, message, source, mainFrame, reply ->
            if (!mainFrame || !AssistantBridge.trusted(source)) return@addWebMessageListener
            val text = message.data ?: return@addWebMessageListener
            if (text.length > 8192) return@addWebMessageListener
            try {
                val request = JSONObject(text)
                val id = request.optString("id")
                if (!id.matches(Regex("[a-zA-Z0-9-]{1,64}"))) return@addWebMessageListener
                val complete: (JSONObject) -> Unit = { value -> view.post { reply.postMessage(value.put("id", id).toString()) } }
                when (request.optString("type")) {
                    "status" -> complete(JSONObject().put("granted", granted(activity)).put("exactAlarms", exactAlarms(activity)).put("pushRegistered", pushRegistered(activity)))
                    "timing" -> {
                        if (Build.VERSION.SDK_INT >= 31) activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${activity.packageName}")))
                        complete(JSONObject().put("exactAlarms", exactAlarms(activity)))
                    }
                    "permission" -> {
                        val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
                            override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
                                complete(JSONObject().put("granted", granted(activity)))
                            }
                        }
                        activity.startActivity(Intent(activity, ScheduleNotificationPermissionActivity::class.java).putExtra("result", receiver))
                    }
                    "settings" -> {
                        val intent = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
                            else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
                        activity.startActivity(intent)
                        complete(JSONObject().put("opened", true))
                    }
                    "configure", "clear", "sync", "openTarget" -> {
                      // Revoke delivery synchronously, before a queued network sync finishes.
                      if (request.optString("type") == "clear") revoke(activity)
                      executor.execute {
                        try {
                            val result = when (request.optString("type")) {
                                "configure" -> { configure(activity, request); JSONObject().put("configured", true) }
                                "clear" -> { clear(activity); JSONObject().put("cleared", true) }
                                "sync" -> { sync(activity); JSONObject().put("synced", true).put("configured", prefs(activity).contains("token")) }
                                else -> takeTarget(activity)
                            }
                            complete(result)
                        } catch (_: Exception) { complete(JSONObject().put("error", "Android schedule notifications are temporarily unavailable.")) }
                      }
                    }
                    else -> complete(JSONObject().put("error", "Unsupported schedule notification action."))
                }
            } catch (_: Exception) { /* No credentials or invalid payloads are logged. */ }
        }
    }

    private fun configure(c: Context, request: JSONObject) {
        val base = request.getString("baseUrl").trimEnd('/')
        val uri = URI(base)
        require(uri.userInfo == null && uri.query == null && uri.fragment == null && uri.path.orEmpty().isEmpty())
        require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in listOf("localhost", "127.0.0.1", "10.0.2.2")))
        val token = request.getString("token")
        val secret = request.getString("secret")
        val accountId = request.getString("accountId") // Navigation scope only; backend identity is always JWT-derived.
        require(token.length in 1..4096 && secret.matches(Regex("[a-f0-9]{64}")) && accountId.matches(Regex("[a-f0-9]{24}")))
        val previous = prefs(c).getString("token", "")
        if (previous != token) { cancelAlarms(c); prefs(c).edit().remove("pushSession").remove("delivered").commit() }
        prefs(c).edit().putString("base", base).putString("token", token).putString("secret", secret).putString("account", accountId).commit()
        val job = JobInfo.Builder(JOB_ID, ComponentName(c, ScheduleNotificationJob::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).build()
        check(c.getSystemService(JobScheduler::class.java).schedule(job) == JobScheduler.RESULT_SUCCESS)
        refreshPush(c)
    }

    private fun refreshPush(c: Context) {
        try { FirebaseMessaging.getInstance().token.addOnSuccessListener { registerPush(c, it) } }
        catch (_: Exception) { /* Existing alarms remain available; sync retries registration. */ }
    }
    fun registerPush(c: Context, pushToken: String) {
        executor.execute {
            try {
                val p = prefs(c)
                val secret = p.getString("secret", null) ?: return@execute
                val activeToken = p.getString("token", null) ?: return@execute
                if (!granted(c) || !p.contains("token")) return@execute
                val registered = request(c, "/devices", JSONObject().put("secret", secret).put("platform", "mobile").put("pushToken", pushToken), true)
                if (registered != null && p.getString("token", null) == activeToken) p.edit().putString("pushSession", digest(activeToken)).commit()
            } catch (_: Exception) { /* Retry on next native sync or app configure. */ }
        }
    }
    private fun pushRegistered(c: Context): Boolean {
        val p = prefs(c)
        val token = p.getString("token", null) ?: return false
        return p.getString("pushSession", null) == digest(token)
    }
    fun receivePush(c: Context, data: Map<String, String>) {
        try {
            val p = prefs(c)
            val token = p.getString("token", null) ?: return
            val claims = JSONObject(String(android.util.Base64.decode(token.split('.')[1], android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP), Charsets.UTF_8))
            val now = System.currentTimeMillis()
            if (!SchedulePushPolicy.accepts(data, p.getString("account", "")!!, digest(token), claims.optLong("exp") * 1000, now)) return
            if (p.getString("token", null) == token) post(c, data.getValue("key"), JSONObject(data), token)
        } catch (_: Exception) { /* Malformed/revoked pushes never crash delivery. */ }
    }

    private fun request(c: Context, path: String, body: JSONObject, acceptEmpty: Boolean = false): JSONObject? {
        val p = prefs(c)
        val base = p.getString("base", null) ?: return null
        val token = p.getString("token", null) ?: return null
        val connection = URL("$base/api/schedule-notifications$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"; connection.instanceFollowRedirects = false
            connection.connectTimeout = 4000; connection.readTimeout = 4000; connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("ngrok-skip-browser-warning", "true")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            if (status == 401 || status == 403) { clear(c); return null }
            if (status == 204) return if (acceptEmpty) JSONObject() else null
            check(status == 200) { "Notification request failed" }
            // Bound network input, including a malformed or compromised upstream.
            val bytes = connection.inputStream.use { it.readBytesBounded(1024 * 1024) }
            return JSONObject(String(bytes, Charsets.UTF_8))
        } finally { connection.disconnect() }
    }
    private fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) { val count = read(buffer); if (count < 0) break; check(out.size() + count <= limit); out.write(buffer, 0, count) }
        return out.toByteArray()
    }

    private fun alarm(c: Context, key: String): PendingIntent = PendingIntent.getBroadcast(c, 0,
        Intent(c, ScheduleNotificationAlarm::class.java).setData(Uri.parse("alfred-reminder://${digest(key)}")).putExtra("key", key),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun cancelAlarms(c: Context) {
        val manager = c.getSystemService(AlarmManager::class.java)
        val keys = JSONArray(prefs(c).getString("keys", "[]"))
        for (i in 0 until keys.length()) {
            val key = keys.getString(i)
            manager.cancel(alarm(c, key))
            c.getSystemService(JobScheduler::class.java).cancel(deliveryJobId(key))
        }
        prefs(c).edit().remove("keys").commit()
    }
    @Synchronized private fun revoke(c: Context) {
        prefs(c).edit().remove("token").remove("secret").commit()
        c.getSystemService(NotificationManager::class.java).cancelAll()
    }
    @Synchronized private fun clear(c: Context) {
        cancelAlarms(c)
        c.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
        c.getSystemService(NotificationManager::class.java).cancelAll()
        prefs(c).edit().clear().commit()
    }

    private fun sync(c: Context) {
        val secret = prefs(c).getString("secret", null) ?: return
        val activeToken = prefs(c).getString("token", null) ?: return
        if (!granted(c)) { cancelAlarms(c); return }
        refreshPush(c)
        val reminders = mutableListOf<JSONObject>()
        var cursor: String? = null
        var pages = 0
        do {
            check(++pages <= 50) // Bound a single background execution.
            val body = JSONObject().put("secret", secret)
            if (cursor != null) body.put("cursor", cursor)
            val page = request(c, "/sync", body) ?: return
            if (prefs(c).getString("token", null) != activeToken) return
            val list = page.getJSONArray("reminders")
            for (i in 0 until list.length()) reminders.add(list.getJSONObject(i))
            cursor = if (page.isNull("next")) null else page.getString("next")
        } while (cursor != null)
        cancelAlarms(c)
        val manager = c.getSystemService(AlarmManager::class.java)
        val keys = JSONArray()
        for (reminder in reminders) {
            val key = reminder.getString("key")
            val dueAt = reminder.getLong("dueAt")
            if (dueAt < System.currentTimeMillis() - GRACE) continue
            keys.put(key)
            if (dueAt <= System.currentTimeMillis()) deliver(c, key)
            else if (exactAlarms(c)) {
                try { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueAt, alarm(c, key)) }
                catch (_: SecurityException) { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueAt, alarm(c, key)) }
            } else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, dueAt, alarm(c, key))
        }
        prefs(c).edit().putString("keys", keys.toString()).commit()
    }

    private fun deliver(c: Context, key: String) {
        if (!granted(c) || !key.matches(Regex("[a-f0-9]{24}:[0-9]{10,16}:(lead|start)"))) return
        val p = prefs(c)
        val secret = p.getString("secret", null) ?: return
        val activeToken = p.getString("token", null) ?: return
        val reminder = request(c, "/claim", JSONObject().put("secret", secret).put("key", key)) ?: return
        if (p.getString("token", null) != activeToken) return
        post(c, key, reminder, activeToken)
    }

    @Synchronized private fun post(c: Context, key: String, reminder: JSONObject, activeToken: String) {
        val p = prefs(c)
        val delivered = JSONObject(p.getString("delivered", "{}")!!)
        if (delivered.has(key)) return
        val manager = c.getSystemService(NotificationManager::class.java)
        val chime = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audio = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        ensureChannel(c)
        val launch = c.packageManager.getLaunchIntentForPackage(c.packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        launch.data = Uri.parse("alfred://schedule/${reminder.getString("scheduleId")}")
        launch.putExtra("alfred_schedule_id", reminder.getString("scheduleId"))
        launch.putExtra("alfred_schedule_date", reminder.getString("date"))
        launch.putExtra("alfred_schedule_session", digest(activeToken))
        val tap = PendingIntent.getActivity(c, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, CHANNEL) else Notification.Builder(c)
        if (Build.VERSION.SDK_INT < 26) builder.setSound(chime, audio)
        val notification = builder.setSmallIcon(R.drawable.ic_alfred_notification)
            .setContentTitle(reminder.getString("title")).setContentText(reminder.getString("body"))
            .setContentIntent(tap).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_EVENT).build()
        // Permission can be revoked during the request; never crash the receiver.
        if (granted(c) && p.getString("token", null) == activeToken) {
            // Bound receipt history to the retry window. Both alarm and FCM use it.
            val cutoff = System.currentTimeMillis() - GRACE
            delivered.keys().asSequence().toList().filter { delivered.optLong(it) < cutoff }.forEach { delivered.remove(it) }
            delivered.put(key, System.currentTimeMillis())
            p.edit().putString("delivered", delivered.toString()).commit()
            manager.notify(digest(key), 1, notification)
        }
    }

    fun enqueueSync(c: Context, complete: () -> Unit = {}) {
        executor.execute { try { sync(c.applicationContext) } catch (_: Exception) { /* Next job retries safely. */ } finally { complete() } }
    }
    private fun ensureChannel(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val channel = NotificationChannel(CHANNEL, "Schedule events", NotificationManager.IMPORTANCE_DEFAULT)
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        // Reusing the channel preserves the user's sound and mute choices.
        c.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    fun enqueueAlarm(c: Context, key: String, complete: () -> Unit) {
        executor.execute { try { deliver(c.applicationContext, key) } catch (_: Exception) { /* No stale catch-up or ambiguous delivery retries. */ } finally { complete() } }
    }
    private fun deliveryJobId(key: String) = 100000 + ((key.hashCode() and Int.MAX_VALUE) % (Int.MAX_VALUE - 100000))
    fun scheduleDeliveryJob(c: Context, key: String) {
        if (!key.matches(Regex("[a-f0-9]{24}:[0-9]{10,16}:(lead|start)"))) return
        val extras = PersistableBundle().apply { putString("key", key) }
        val builder = JobInfo.Builder(deliveryJobId(key), ComponentName(c, ScheduleNotificationJob::class.java))
            .setExtras(extras).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        // An alarm is time-sensitive; expedited execution is still subject to OS quota.
        if (Build.VERSION.SDK_INT >= 31) builder.setExpedited(true) else builder.setMinimumLatency(0)
        val jobs = c.getSystemService(JobScheduler::class.java)
        if (jobs.schedule(builder.build()) != JobScheduler.RESULT_SUCCESS && Build.VERSION.SDK_INT >= 31) jobs.schedule(builder.setExpedited(false).setMinimumLatency(0).build())
    }
    fun openIntent(c: Context, intent: Intent?) {
        val id = intent?.getStringExtra("alfred_schedule_id") ?: return
        val date = intent.getStringExtra("alfred_schedule_date") ?: return
        val session = intent.getStringExtra("alfred_schedule_session") ?: return
        if (!id.matches(Regex("[a-f0-9]{24}")) || !date.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}"))) return
        prefs(c).edit().putString("target", JSONObject().put("scheduleId", id).put("date", date).put("session", session).toString()).apply()
        mainView.get()?.let { view -> view.post {
            if (view.parent != null && view.url?.let { AssistantBridge.trusted(Uri.parse(it)) } == true) {
                // The document consumes the persisted target only when its account/UI is ready.
                view.evaluateJavascript("window.dispatchEvent(new Event('alfred:schedule-notification-tap'))", null)
            }
        } }
    }
    private fun takeTarget(c: Context): JSONObject {
        val p = prefs(c)
        val raw = p.getString("target", null) ?: return JSONObject()
        p.edit().remove("target").commit()
        val target = JSONObject(raw)
        if (target.optString("session") != digest(p.getString("token", "")!!)) return JSONObject()
        target.remove("session")
        return target.put("accountId", p.getString("account", ""))
    }
}

class ScheduleNotificationAlarm : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val key = intent.getStringExtra("key") ?: return
        // Never hold a BroadcastReceiver open while waiting for network or queued syncs.
        ScheduleNotifications.scheduleDeliveryJob(context, key)
    }
}
class ScheduleNotificationJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        val key = params.extras.getString("key")
        if (key == null) ScheduleNotifications.enqueueSync(this) { jobFinished(params, false) }
        else ScheduleNotifications.enqueueAlarm(this, key) { jobFinished(params, false) }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean = true
}
class ScheduleNotificationPermissionActivity : Activity() {
    private fun complete() {
        @Suppress("DEPRECATION")
        val receiver = intent.getParcelableExtra<ResultReceiver>("result")
        receiver?.send(Activity.RESULT_OK, Bundle())
        ScheduleNotifications.enqueueSync(this)
        finish()
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 901)
        else complete()
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        complete()
    }
}
