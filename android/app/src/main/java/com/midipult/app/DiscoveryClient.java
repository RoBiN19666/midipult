package com.midipult.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** UDP-broadcast поиск панелей MidiPult в локальной сети. */
public final class DiscoveryClient {
    public interface Callback {
        void onDone(List<Station> stations, String error);
    }

    private static final int PORT = 8056;
    private static final byte[] REQUEST = "MYPULT_DISCOVER".getBytes();

    private DiscoveryClient() {
    }

    public static void discover(Context context, Callback callback) {
        final Context app = context.getApplicationContext();
        final Handler main = new Handler(Looper.getMainLooper());
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.execute(() -> {
            List<Station> found = new ArrayList<>();
            String error = null;
            WifiManager.MulticastLock lock = null;
            try {
                WifiManager wifi = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    lock = wifi.createMulticastLock("midipult-discovery");
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
                DatagramSocket socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.setSoTimeout(700);
                try {
                    for (InetAddress address : broadcastAddresses()) {
                        try {
                            socket.send(new DatagramPacket(REQUEST, REQUEST.length, address, PORT));
                        } catch (Exception ignored) {
                        }
                    }
                    Set<String> seen = new HashSet<>();
                    long deadline = System.currentTimeMillis() + 6000;
                    byte[] buffer = new byte[2048];
                    while (System.currentTimeMillis() < deadline) {
                        try {
                            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                            socket.receive(packet);
                            String text = new String(packet.getData(), 0, packet.getLength(), "UTF-8");
                            Station station = parse(text, packet.getAddress().getHostAddress());
                            if (station != null && seen.add(station.url)) found.add(station);
                        } catch (SocketTimeoutException ignored) {
                            // Продолжаем слушать до общего дедлайна.
                        }
                    }
                } finally {
                    socket.close();
                }
            } catch (Exception exc) {
                error = exc.getMessage() == null ? exc.toString() : exc.getMessage();
            } finally {
                if (lock != null) {
                    try {
                        lock.release();
                    } catch (Exception ignored) {
                    }
                }
            }
            final List<Station> result = found;
            final String message = error;
            main.post(() -> callback.onDone(result, message));
        });
        executor.shutdown();
    }

    private static List<InetAddress> broadcastAddresses() {
        List<InetAddress> result = new ArrayList<>();
        try {
            result.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp()) continue;
                for (InterfaceAddress address : nif.getInterfaceAddresses()) {
                    InetAddress broadcast = address.getBroadcast();
                    if (broadcast != null && !result.contains(broadcast)) result.add(broadcast);
                }
            }
        } catch (Exception ignored) {
        }
        return result;
    }

    private static Station parse(String text, String senderIp) {
        try {
            JSONObject object = new JSONObject(text);
            if (!"midipult".equals(object.optString("service"))) return null;
            String ip = object.optString("ip", "").trim();
            if (ip.isEmpty()) ip = senderIp;
            int port = object.optInt("port", 8055);
            if (port < 1 || port > 65535) port = 8055;
            String name = object.optString("name", "MidiPult");
            return new Station(
                    name,
                    "http://" + ip + ":" + port,
                    ip,
                    object.optString("model", ""),
                    object.optString("version", "")
            );
        } catch (Exception ignored) {
            return null;
        }
    }
}
