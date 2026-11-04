package com.midipult.app;

import org.json.JSONException;
import org.json.JSONObject;

public final class Station {
    public final String name;
    public final String url;
    public final String ip;
    public final String model;
    public final String version;

    public Station(String name, String url, String ip, String model, String version) {
        this.name = name == null ? "" : name;
        this.url = url == null ? "" : url;
        this.ip = ip == null ? "" : ip;
        this.model = model == null ? "" : model;
        this.version = version == null ? "" : version;
    }

    public String label() {
        String title = name.trim();
        if (title.isEmpty()) title = ip.trim().isEmpty() ? url : ip;
        if (!version.trim().isEmpty()) title += " · v" + version;
        return title;
    }

    public JSONObject toJson() {
        JSONObject object = new JSONObject();
        try {
            object.put("name", name);
            object.put("url", url);
            object.put("ip", ip);
            object.put("model", model);
            object.put("version", version);
        } catch (JSONException ignored) {
            // Все поля — строки, ошибка практически невозможна.
        }
        return object;
    }

    public static Station fromJson(JSONObject object) {
        if (object == null) return null;
        String url = object.optString("url", "");
        if (url.trim().isEmpty()) return null;
        String ip = object.optString("ip", "");
        if (ip.isEmpty()) {
            try {
                ip = java.net.URI.create(url).getHost();
            } catch (Exception ignored) {
                ip = "";
            }
        }
        return new Station(
                object.optString("name", ""),
                url,
                ip,
                object.optString("model", ""),
                object.optString("version", "")
        );
    }
}
