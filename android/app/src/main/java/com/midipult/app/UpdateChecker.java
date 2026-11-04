package com.midipult.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Проверка и установка обновлений самого APK из GitHub Releases. */
public final class UpdateChecker {
    public interface Callback {
        void onResult(UpdateInfo info, String error);
    }

    public interface DownloadCallback {
        void onResult(File file, String error);
    }

    public static final class UpdateInfo {
        public final String version;
        public final String name;
        public final String body;
        public final String apkUrl;
        public final String shaUrl;

        UpdateInfo(String version, String name, String body, String apkUrl, String shaUrl) {
            this.version = version;
            this.name = name;
            this.body = body;
            this.apkUrl = apkUrl;
            this.shaUrl = shaUrl;
        }
    }

    private static final String API = "https://api.github.com/repos/RoBiN19666/midipult/releases?per_page=20";
    private static final String PREFIX = "android-v";

    private static final ExecutorService IO = Executors.newCachedThreadPool();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private UpdateChecker() {
    }

    public static void autoCheck(Context context, Callback callback) {
        long last = StationStore.lastApkCheck(context);
        if (System.currentTimeMillis() - last < 24L * 60L * 60L * 1000L) {
            callback.onResult(null, null);
            return;
        }
        check(context, false, callback);
    }

    public static void check(Context context, boolean force, Callback callback) {
        final Context app = context.getApplicationContext();
        IO.execute(() -> {
            String error = null;
            UpdateInfo found = null;
            try {
                HttpURLConnection connection = open(API);
                int code = connection.getResponseCode();
                if (code != 200) throw new RuntimeException("GitHub HTTP " + code);
                String text = read(connection);
                JSONArray releases = new JSONArray(text);
                for (int i = 0; i < releases.length(); i++) {
                    JSONObject release = releases.optJSONObject(i);
                    if (release == null) continue;
                    String tag = release.optString("tag_name", "");
                    if (!tag.startsWith(PREFIX)) continue;
                    String version = tag.substring(PREFIX.length());
                    if (!isNewer(version, BuildConfig.VERSION_NAME)) continue;
                    JSONObject asset = findApk(release.optJSONArray("assets"), version);
                    if (asset == null) continue;
                    JSONObject sha = findSha(release.optJSONArray("assets"), version);
                    found = new UpdateInfo(
                            version,
                            release.optString("name", tag),
                            release.optString("body", ""),
                            asset.optString("browser_download_url", ""),
                            sha == null ? "" : sha.optString("browser_download_url", "")
                    );
                    break;
                }
                StationStore.setLastApkCheck(app, System.currentTimeMillis());
            } catch (Exception exc) {
                error = exc.getMessage() == null ? exc.toString() : exc.getMessage();
            }
            final UpdateInfo result = found;
            final String message = force ? error : (found == null ? null : error);
            MAIN.post(() -> callback.onResult(result, message));
        });
    }

    public static void downloadAndInstall(Context context, UpdateInfo info, DownloadCallback callback) {
        final Context app = context.getApplicationContext();
        IO.execute(() -> {
            File target = null;
            String error = null;
            try {
                if (info.apkUrl == null || info.apkUrl.trim().isEmpty()) {
                    throw new RuntimeException("В релизе нет APK");
                }
                File dir = app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = app.getCacheDir();
                if (!dir.exists() && !dir.mkdirs()) throw new RuntimeException("Не могу создать папку загрузки");
                target = new File(dir, "midipult-android-" + info.version + ".apk");
                download(info.apkUrl, target);
                if (info.shaUrl != null && !info.shaUrl.trim().isEmpty()) {
                    String expected = downloadText(info.shaUrl);
                    if (!sha256(target).equalsIgnoreCase(expected)) {
                        target.delete();
                        throw new RuntimeException("SHA-256 APK не совпал");
                    }
                }
            } catch (Exception exc) {
                error = exc.getMessage() == null ? exc.toString() : exc.getMessage();
                if (target != null) target.delete();
                target = null;
            }
            final File file = target;
            final String message = error;
            MAIN.post(() -> callback.onResult(file, message));
        });
    }

    public static boolean install(Context context, File file) {
        try {
            Uri uri = Uri.parse("content://" + context.getPackageName() + ".files/updates/"
                    + Uri.encode(file.getName()));
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception exc) {
            Toast.makeText(context, "Не удалось открыть установщик: " + exc.getMessage(), Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private static JSONObject findApk(JSONArray assets, String version) {
        if (assets == null) return null;
        String expected = "midipult-android-" + version + ".apk";
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset != null && expected.equals(asset.optString("name", ""))) return asset;
        }
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            String name = asset == null ? "" : asset.optString("name", "");
            if (name.startsWith("midipult-android-") && name.endsWith(".apk")) return asset;
        }
        return null;
    }

    private static JSONObject findSha(JSONArray assets, String version) {
        if (assets == null) return null;
        String apk = "midipult-android-" + version + ".apk";
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            String name = asset == null ? "" : asset.optString("name", "");
            if (name.equals(apk + ".sha256")) return asset;
        }
        return null;
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "MidiPult-Android/" + BuildConfig.VERSION_NAME);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        return connection;
    }

    private static String read(HttpURLConnection connection) throws Exception {
        try (InputStream input = connection.getInputStream();
             BufferedReader reader = new BufferedReader(new InputStreamReader(input, "UTF-8"))) {
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line).append('\n');
            return text.toString();
        } finally {
            connection.disconnect();
        }
    }

    private static void download(String url, File target) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "MidiPult-Android/" + BuildConfig.VERSION_NAME);
        int code = connection.getResponseCode();
        if (code != 200) throw new RuntimeException("HTTP " + code);
        try (InputStream input = connection.getInputStream();
             FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
        } finally {
            connection.disconnect();
        }
    }

    private static String downloadText(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "MidiPult-Android/" + BuildConfig.VERSION_NAME);
        String text = read(connection);
        int index = text.indexOf('\n');
        if (index >= 0) text = text.substring(0, index);
        return text.trim().split("\\s+")[0].toLowerCase(Locale.US);
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) > 0) digest.update(buffer, 0, count);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) result.append(String.format("%02x", value));
        return result.toString();
    }

    private static boolean isNewer(String candidate, String current) {
        String[] left = candidate.replaceAll("[^0-9.]", "").split("\\.");
        String[] right = current.replaceAll("[^0-9.]", "").split("\\.");
        int size = Math.max(left.length, right.length);
        for (int i = 0; i < size; i++) {
            int a = i < left.length && !left[i].isEmpty() ? Integer.parseInt(left[i]) : 0;
            int b = i < right.length && !right[i].isEmpty() ? Integer.parseInt(right[i]) : 0;
            if (a != b) return a > b;
        }
        return false;
    }
}
