package com.midipult.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class StationStore {
    private static final String PREFS = "midipult";
    private static final String KEY_STATIONS = "stations";
    private static final String KEY_ACTIVE = "active";

    private StationStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static List<Station> load(Context context) {
        List<Station> stations = new ArrayList<>();
        try {
            String raw = prefs(context).getString(KEY_STATIONS, "[]");
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                Station station = Station.fromJson(array.optJSONObject(i));
                if (station != null) stations.add(station);
            }
        } catch (Exception ignored) {
        }
        return stations;
    }

    public static void save(Context context, List<Station> stations) {
        JSONArray array = new JSONArray();
        for (Station station : stations) array.put(station.toJson());
        prefs(context).edit().putString(KEY_STATIONS, array.toString()).apply();
    }

    public static Station active(Context context) {
        String url = prefs(context).getString(KEY_ACTIVE, "");
        if (url == null || url.isEmpty()) return null;
        for (Station station : load(context)) {
            if (station.url.equals(url)) return station;
        }
        return null;
    }

    public static void setActive(Context context, Station station) {
        if (station == null) return;
        List<Station> stations = load(context);
        boolean found = false;
        for (int i = 0; i < stations.size(); i++) {
            Station existing = stations.get(i);
            if (existing.url.equals(station.url)) {
                String name = existing.name == null || existing.name.trim().isEmpty()
                        ? station.name : existing.name;
                stations.set(i, new Station(name, station.url, station.ip,
                        station.model, station.version));
                found = true;
                break;
            }
        }
        if (!found) stations.add(station);
        save(context, stations);
        prefs(context).edit().putString(KEY_ACTIVE, station.url).apply();
    }

    public static void rename(Context context, Station station, String name) {
        if (station == null) return;
        String clean = name == null ? "" : name.trim();
        List<Station> stations = load(context);
        for (int i = 0; i < stations.size(); i++) {
            Station item = stations.get(i);
            if (item.url.equals(station.url)) {
                stations.set(i, new Station(clean, item.url, item.ip, item.model, item.version));
                break;
            }
        }
        save(context, stations);
    }

    public static void remove(Context context, Station station) {
        List<Station> stations = load(context);
        for (int i = 0; i < stations.size(); i++) {
            if (stations.get(i).url.equals(station.url)) {
                stations.remove(i);
                break;
            }
        }
        save(context, stations);
        if (station.url.equals(prefs(context).getString(KEY_ACTIVE, ""))) {
            prefs(context).edit().remove(KEY_ACTIVE).apply();
        }
    }

    public static long lastApkCheck(Context context) {
        return prefs(context).getLong("last_apk_check", 0L);
    }

    public static void setLastApkCheck(Context context, long value) {
        prefs(context).edit().putLong("last_apk_check", value).apply();
    }
}
