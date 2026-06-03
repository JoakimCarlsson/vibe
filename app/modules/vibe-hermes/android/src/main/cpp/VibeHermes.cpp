#include <jni.h>
#include <jsi/jsi.h>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using namespace facebook::jsi;

namespace {

// A jsi::Buffer backed by an owned byte vector, so Hermes can read either
// source text or an .hbc bundle from it.
class VectorBuffer : public Buffer {
 public:
  explicit VectorBuffer(std::vector<uint8_t> data) : data_(std::move(data)) {}
  size_t size() const override { return data_.size(); }
  const uint8_t *data() const override { return data_.data(); }

 private:
  std::vector<uint8_t> data_;
};

std::vector<uint8_t> decodeBase64(const std::string &in) {
  static const std::string chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::vector<int> lut(256, -1);
  for (int i = 0; i < 64; i++) lut[static_cast<uint8_t>(chars[i])] = i;

  std::vector<uint8_t> out;
  int val = 0, bits = -8;
  for (uint8_t c : in) {
    if (lut[c] == -1) continue;
    val = (val << 6) + lut[c];
    bits += 6;
    if (bits >= 0) {
      out.push_back(static_cast<uint8_t>((val >> bits) & 0xFF));
      bits -= 8;
    }
  }
  return out;
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_vibehermes_VibeHermesModule_nativeInstall(
    JNIEnv *env, jobject /*thiz*/, jlong runtimePtr) {
  auto *runtime = reinterpret_cast<Runtime *>(runtimePtr);
  if (runtime == nullptr) return;

  auto evalBytecode = Function::createFromHostFunction(
      *runtime,
      PropNameID::forAscii(*runtime, "__vibeEvalBytecode"),
      1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) {
          throw JSError(rt, "__vibeEvalBytecode expects a base64 string");
        }
        std::string b64 = args[0].getString(rt).utf8(rt);
        auto bytes = decodeBase64(b64);

        static const uint8_t kHermesMagic[8] = {
            0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F};
        if (bytes.size() < 8 ||
            std::memcmp(bytes.data(), kHermesMagic, 8) != 0) {
          throw JSError(rt, "refusing to execute: buffer is not Hermes bytecode");
        }

        auto buffer = std::make_shared<VectorBuffer>(std::move(bytes));
        return rt.evaluateJavaScript(buffer, "vibe-app.hbc");
      });

  runtime->global().setProperty(
      *runtime, "__vibeEvalBytecode", evalBytecode);
}
