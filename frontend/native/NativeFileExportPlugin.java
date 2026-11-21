package app.ignite.documents;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;

@CapacitorPlugin(name = "NativeFileExport")
public class NativeFileExportPlugin extends Plugin {
    @PluginMethod public void save(PluginCall call) {
        String path = call.getString("filePath");
        if (path == null || !path.startsWith("file://")) { call.reject("Invalid local file"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("fileName", "document"));
        startActivityForResult(call, intent, "saveResult");
    }
    @ActivityCallback private void saveResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject reply = new JSObject(); reply.put("saved", false); call.resolve(reply); return;
        }
        Uri destination = result.getData().getData();
        if (destination == null) { call.reject("No save destination"); return; }
        getBridge().execute(() -> {
            try (InputStream source = new FileInputStream(new File(Uri.parse(call.getString("filePath")).getPath()));
                 OutputStream target = getContext().getContentResolver().openOutputStream(destination)) {
                if (target == null) throw new IOException("Cannot write destination");
                byte[] buffer = new byte[65536]; int n;
                while ((n = source.read(buffer)) != -1) target.write(buffer, 0, n);
                target.flush();
            } catch (Exception error) { call.reject("Could not save document"); return; }
            JSObject reply = new JSObject(); reply.put("saved", true); call.resolve(reply);
        });
    }
}