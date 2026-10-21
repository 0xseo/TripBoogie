package com.tripboogie.app

import android.Manifest
import android.content.ContentValues
import android.graphics.BitmapFactory
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.util.UUID

@CapacitorPlugin(name = "TripBoogieImages", permissions = [Permission(strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "legacyPhotos")])
class TripBoogieImagesPlugin : Plugin() {
    @PluginMethod fun saveImage(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("legacyPhotos") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyPhotos", call, "photosPermission")
            return
        }
        writeImage(call)
    }
    @PermissionCallback private fun photosPermission(call: PluginCall) {
        if (getPermissionState("legacyPhotos") != PermissionState.GRANTED) call.reject("Photo permission denied", "PERMISSION_DENIED")
        else writeImage(call)
    }
    private fun writeImage(call: PluginCall) {
        var pending: android.net.Uri? = null
        var legacy: File? = null
        val resolver = context.contentResolver
        try {
            val encoded = call.getString("data") ?: ""
            require(encoded.length in 1..33554432)
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            require(bytes.take(8).toByteArray().contentEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)))
            val dimensions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, dimensions)
            require(dimensions.outWidth in 1..10000 && dimensions.outHeight in 1..10000)
            val name = (call.getString("name") ?: "tripboogie.png").replace(Regex("[\\\\/\\p{Cntrl}]"), "_").take(150).removeSuffix(".png") + ".png"
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/TripBoogie")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: error("Insert failed")
                pending = uri
                resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("Write failed")
                require(resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null) == 1)
                pending = null
                call.resolve()
            } else {
                val directory = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "TripBoogie")
                require(directory.isDirectory || directory.mkdirs())
                val file = File(directory, "${UUID.randomUUID()}_$name")
                legacy = file
                file.outputStream().use { it.write(bytes) }
                MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf("image/png"), null)
                legacy = null
                call.resolve()
            }
        } catch (_: Exception) {
            pending?.let { try { resolver.delete(it, null, null) } catch (_: Exception) { } }
            legacy?.delete()
            call.reject("Could not save image", "SAVE_FAILED")
        }
    }
}
