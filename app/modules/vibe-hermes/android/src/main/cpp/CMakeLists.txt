cmake_minimum_required(VERSION 3.13)
project(vibehermes)

add_library(vibehermes SHARED VibeHermes.cpp)

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

find_library(LOG_LIB log)

target_link_libraries(vibehermes
  ReactAndroid::jsi
  fbjni::fbjni
  ${LOG_LIB}
)
