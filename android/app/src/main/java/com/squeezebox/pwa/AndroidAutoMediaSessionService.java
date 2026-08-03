package com.squeezebox.pwa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.browse.MediaBrowser;
import android.os.Build;
import android.os.Bundle;
import android.service.media.MediaBrowserService;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.Collections;
import java.util.List;

public class AndroidAutoMediaSessionService extends MediaBrowserService {
    private static final String TAG = "AndroidAutoMediaSession";
    private static final int NOTIFICATION_ID = 1;
    private static final String CHANNEL_ID = "squeezebox_pwa_media";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Squeezebox PWA")
            .setContentText("Media controls ready for Android Auto")
            .setOngoing(true)
            .build();

        startForeground(NOTIFICATION_ID, notification);
        Log.d(TAG, "Android Auto media browser service created");
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        return new BrowserRoot("squeezebox_pwa_root", null);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowser.MediaItem>> result) {
        result.sendResult(Collections.emptyList());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "Android Auto media browser service started");
        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Squeezebox PWA media playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Background media playback controls");

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }
}
