// 职责：绘制无声提醒，持续显示未确认数量并响应触摸。
#include <assert.h>
#include <string.h>
#include "bsp/esp-bsp.h"
#include "lvgl.h"
#include "esp_timer.h"
#include "alert_app.h"
LV_FONT_DECLARE(alert_font);
/** 界面元素和动画状态，仅在 LVGL 锁内使用。 */
static lv_obj_t *screen;
static lv_obj_t *connection_label;
/** 授权切换后供新电脑输入的连接码。 */
static lv_obj_t *code_label;
static lv_obj_t *heading_label;
static lv_obj_t *count_label;
static lv_obj_t *title_label;
static lv_obj_t *footer_label;
static bool has_pending = false;

/** 触摸通过应用队列确认全部提醒。 */
static void on_touch(lv_event_t *event)
{
    (void)event;
    const char *message = "{\"v\":1,\"type\":\"clear\"}";
    alert_submit_json(message, strlen(message));
}
/** 长按后重新授权，新电脑可使用屏幕上的新连接码。 */
static void on_reauthorize(lv_event_t *event)
{
    (void)event;
    const char *message = "{\"v\":1,\"type\":\"reauthorize\"}";
    alert_submit_json(message, strlen(message));
}
/** 缓慢变换提示底色，避免快速闪烁。 */
static void pulse_background(lv_timer_t *timer)
{
    (void)timer;
    if (!has_pending) { return; }
    bool is_alternate = (esp_timer_get_time() / 1500000) % 2 == 0;
    lv_obj_set_style_bg_color(screen, lv_color_hex(is_alternate ? 0x5a260e : 0x39121c), 0);
}
/** 在圆形可见区域内创建居中文本。 */
static lv_obj_t *create_label(const lv_font_t *font, int y, int width)
{
    lv_obj_t *label = lv_label_create(screen);
    lv_obj_set_width(label, width);
    lv_obj_set_style_text_font(label, font, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(0xf8fafc), 0);
    lv_obj_set_style_text_align(label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(label, LV_ALIGN_TOP_MID, 0, y);
    lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
    return label;
}
/** 使用官方板级初始化和触摸镜像配置。 */
void alert_ui_start(void)
{
    assert(bsp_display_start() != NULL);
    bsp_display_lock(-1);
    screen = lv_screen_active();
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(screen, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_CLICKED, NULL);
    connection_label = create_label(&lv_font_source_han_sans_sc_16_cjk, 64, 300);
    code_label = create_label(&lv_font_source_han_sans_sc_16_cjk, 88, 300);
    heading_label = create_label(&alert_font, 118, 340);
    count_label = create_label(&lv_font_montserrat_48, 186, 320);
    title_label = create_label(&lv_font_source_han_sans_sc_16_cjk, 274, 320);
    lv_obj_set_height(title_label, 62);
    footer_label = create_label(&lv_font_source_han_sans_sc_16_cjk, 354, 300);
    // 独立按钮不向屏幕冒泡，切换授权时保留未确认提醒。
    lv_obj_t *reauthorize_button = lv_button_create(screen);
    lv_obj_set_size(reauthorize_button, 190, 42);
    lv_obj_align(reauthorize_button, LV_ALIGN_TOP_MID, 0, 386);
    lv_obj_remove_flag(reauthorize_button, LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_add_event_cb(reauthorize_button, on_reauthorize, LV_EVENT_LONG_PRESSED, NULL);
    lv_obj_t *button_label = lv_label_create(reauthorize_button);
    lv_obj_set_style_text_font(button_label, &lv_font_source_han_sans_sc_16_cjk, 0);
    lv_label_set_text(button_label, "长按重新授权");
    lv_obj_center(button_label);
    lv_indev_set_long_press_time(bsp_display_get_input_dev(), 1200);
    lv_timer_create(pulse_background, 1500, NULL);
    bsp_display_unlock();
}
/** 用状态快照刷新屏幕，不将任务名作为格式字符串。 */
void alert_ui_render(uint32_t count, const char *title, bool connected, uint32_t connection_code)
{
    bsp_display_lock(-1);
    has_pending = count > 0;
    lv_obj_set_style_bg_color(screen, lv_color_hex(has_pending ? 0x5a260e : 0x0b2029), 0);
    lv_label_set_text(connection_label, connected ? "蓝牙已连接" : "蓝牙未连接");
    if (connection_code != 0) { lv_label_set_text_fmt(code_label, "连接码 %06lu", (unsigned long)connection_code); }
    else { lv_label_set_text(code_label, "首次连接可不填连接码"); }
    lv_label_set_text(heading_label, has_pending ? "本轮结束" : "等待任务");
    if (has_pending) {
        lv_label_set_text_fmt(count_label, "%lu", (unsigned long)count);
        lv_label_set_text(title_label, title);
        lv_label_set_text(footer_label, "触摸屏幕确认全部提醒");
    } else {
        lv_label_set_text(count_label, "Codex");
        lv_label_set_text(title_label, "本轮结束后将在这里提示");
        lv_label_set_text(footer_label, "请连接电脑端提醒器");
    }
    bsp_display_brightness_set(has_pending ? 100 : 45);
    bsp_display_unlock();
}
