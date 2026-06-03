package expo.modules.vibehermes

import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VibeHermesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VibeHermes")

    OnCreate {
      System.loadLibrary("vibehermes")
    }

    Function("install") {
      val ctx = appContext.reactContext as? ReactContext
        ?: throw IllegalStateException("no react context")
      val ptr = ctx.javaScriptContextHolder?.get() ?: 0L
      if (ptr == 0L) throw IllegalStateException("JSI runtime pointer unavailable")
      nativeInstall(ptr)
    }
  }

  private external fun nativeInstall(jsiRuntimePtr: Long)
}
