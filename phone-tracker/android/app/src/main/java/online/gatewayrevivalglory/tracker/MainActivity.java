package online.gatewayrevivalglory.tracker;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.ConsoleMessage;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Thin native shell around the hosted Phone Tracker web app.
 *
 * The heavy lifting (tracking UI, Supabase, maps) lives at
 * https://gatewayrevivalglory.online/phone-tracker/ so the app is
 * always up to date. This activity only provides the native bits a
 * WebView needs for the tracker to behave like a real app:
 *
 *  • runtime location permission + WebView geolocation prompts
 *  • DOM storage (keeps you signed in)
 *  • vibration / wake-lock (manifest + JS bridge)
 *  • background-free audio so the remote siren can sound
 *  • CSV/GPX export saved into Downloads (JS bridge)
 */
public class MainActivity extends Activity {

    private static final String HOME_URL = "https://gatewayrevivalglory.online/phone-tracker/";
    private static final int REQ_LOCATION = 101;

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // Supabase session lives here
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // remote siren without a tap
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient());

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                // Chromium WebView asks here; the OS permission is requested below.
                callback.invoke(origin, true, false);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                return super.onConsoleMessage(message);
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                handleDownload(url, contentDisposition, mimeType);
            }
        });

        webView.addJavascriptInterface(new NativeBridge(), "TrackerNative");

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
            if (webView.getUrl() == null) webView.loadUrl(HOME_URL);
        } else {
            webView.loadUrl(HOME_URL);
        }

        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            }, REQ_LOCATION);
        }
    }

    /** Exposed to JavaScript as window.TrackerNative */
    public class NativeBridge {

        /** Keep the screen awake while protection / stolen mode runs. */
        @JavascriptInterface
        public void setKeepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    webView.setKeepScreenOn(on);
                }
            });
        }

        /** Save an export (CSV/GPX) produced by the web app into Downloads. */
        @JavascriptInterface
        public void saveBase64File(String filename, String base64Data) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                saveBytes(sanitize(filename), bytes);
            } catch (final Exception e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, "Export failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                });
            }
        }
    }

    private static String sanitize(String name) {
        if (name == null || name.trim().isEmpty()) return "export.txt";
        return name.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private void handleDownload(String url, String contentDisposition, String mimeType) {
        try {
            // data: URLs (our CSV/GPX exports) — decode and save directly.
            if (url != null && url.startsWith("data:")) {
                int comma = url.indexOf(',');
                if (comma < 0) return;
                String meta = url.substring("data:".length(), comma);
                String data = url.substring(comma + 1);
                byte[] bytes = meta.endsWith(";base64")
                        ? Base64.decode(data, Base64.DEFAULT)
                        : URLDecoder.decode(data, "UTF-8").getBytes(StandardCharsets.UTF_8);
                String mime = meta.split(";")[0];
                String ext = "txt";
                if (mime != null && mime.contains("/")) {
                    String sub = mime.substring(mime.indexOf('/') + 1);
                    if (sub.contains("xml")) ext = "gpx";
                    else if (sub.contains("csv")) ext = "csv";
                    else ext = sub.replaceAll("[^a-z0-9]", "");
                }
                saveBytes("tracker-export-" + System.currentTimeMillis() + "." + ext, bytes);
                return;
            }

            // Regular http(s) downloads via the system DownloadManager.
            android.app.DownloadManager dm =
                    (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            android.app.DownloadManager.Request req =
                    new android.app.DownloadManager.Request(Uri.parse(url));
            req.setMimeType(mimeType);
            req.addRequestHeader("User-Agent", webView.getSettings().getUserAgentString());
            if (contentDisposition != null) {
                req.addRequestHeader("Content-Disposition", contentDisposition);
            }
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            req.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, sanitize(fileName));
            dm.enqueue(req);
        } catch (Exception e) {
            Toast.makeText(this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** Write bytes into the shared Downloads folder (API 29+) or app storage. */
    private void saveBytes(String name, byte[] bytes) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, guessMime(name));
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("Could not create file");
            try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                if (os == null) throw new IllegalStateException("Could not open stream");
                os.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(uri, values, null, null);
            toast("Saved to Downloads: " + name);
        } else {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = getFilesDir();
            File out = new File(dir, name);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(bytes);
            }
            toast("Saved: " + out.getAbsolutePath());
        }
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    private static String guessMime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".gpx")) return "application/gpx+xml";
        if (n.endsWith(".xml")) return "text/xml";
        return "text/plain";
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
