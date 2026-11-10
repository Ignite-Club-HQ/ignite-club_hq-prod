package com.igniteclubhq.app;

import android.os.Bundle;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.RemoteMessage;
import java.util.LinkedHashSet;

/** ICP-only adapter into the existing system push presenter, not a new sender. */
@CapacitorPlugin(name = "IcpForegroundPush")
public class IcpForegroundPushPlugin extends Plugin {
    private final LinkedHashSet<String> presented = new LinkedHashSet<>();

    @PluginMethod
    public void present(PluginCall call) {
        String backend = call.getString("backend");
        String recipient = call.getString("recipient");
        String account = call.getString("account");
        String id = call.getString("id");
        if (!"icp-dev".equals(backend) || account == null || !account.equals(recipient) ||
            id == null || id.isEmpty() || id.length() > 256) {
            call.reject("Invalid ICP notification");
            return;
        }
        getActivity().runOnUiThread(() -> {
            // Background FCM already presents the original notification.
            if (!getActivity().hasWindowFocus()) { call.resolve(); return; }
            String key = account + ":" + id;
            if (presented.contains(key)) { call.resolve(); return; }
            PushNotificationsPlugin presenter = PushNotificationsPlugin.getPushNotificationsInstance();
            if (presenter == null) { call.reject("System push presenter unavailable"); return; }
            Bundle payload = new Bundle();
            payload.putString("google.message_id", id);
            payload.putString("gcm.n.e", "1");
            payload.putString("gcm.n.title", "Ignite Club HQ");
            payload.putString("gcm.n.body", "You have a new update.");
            payload.putString("gcm.n.android_channel_id", "default");
            payload.putString("gcm.n.tag", id);
            payload.putString("ignite_backend", backend);
            payload.putString("recipient", recipient);
            payload.putString("notification_id", id);
            payload.putString("url", call.getString("url", "/notifications"));
            presented.add(key);
            if (presented.size() > 100) presented.remove(presented.iterator().next());
            presenter.fireNotification(new RemoteMessage(payload));
            call.resolve();
        });
    }
}