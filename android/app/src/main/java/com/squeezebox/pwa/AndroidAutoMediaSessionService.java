package com.squeezebox.pwa;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

public class AndroidAutoMediaSessionService extends Service {
    private static final String TAG = "AndroidAutoMediaSession";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Android Auto media session service created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "Android Auto media session service started");
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
