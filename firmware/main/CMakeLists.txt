# 职责：注册提醒应用、蓝牙协议和屏幕界面源码。
idf_component_register(SRCS "main.c" "alert_state.c" "alert_identity.c" "alert_ui.c" "alert_ble.c" "alert_font.c" INCLUDE_DIRS "." REQUIRES bt nvs_flash esp_driver_usb_serial_jtag)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-error=cpp)
target_compile_definitions(${COMPONENT_LIB} PRIVATE LV_LVGL_H_INCLUDE_SIMPLE)
