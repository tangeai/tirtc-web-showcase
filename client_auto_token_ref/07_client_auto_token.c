/** \file 07_client_auto_token.c
 * 客户端自动取 Token 参考示例
 *
 * 目标：把 tests/call-v1-user-token.sh + tests/call-v1-token-via-user-token.sh
 * 的两段式流程，改成可移植的 C 版参考实现。
 *
 * 示例流程：
 *   1. POST /v1/user_token：使用 access_id + secret_key + uid 签发 user_token
 *   2. POST /v1/token：使用 Bearer user_token + device_id(peer_id) 签发 client token
 *   3. TiRtcStart(NULL, &cbs)
 *   4. 首轮 TiRtcConnect(peer_id, token, ...)
 *   5. 后续轮次优先走 SDK 连接参数缓存；若返回 TIRTC_E_CACHE_EXPIRED，再在线重取 token
 *
 * 这个例子与 tests/device.c 的流约定对齐：
 *   stream 1 -> JPEG 子视频
 *   stream 2 -> PCM 主音频
 *
 * 编译：
 *   make 07_client_auto_token ARCH=x64
 *
 * 运行：
 *   ./07_client_auto_token \
 *       -s http://ep-test-tirtc.tange365.com \
 *       -a http://openapi-test.tange365.com \
 *       -A <access_id> \
 *       -K <secret_key> \
 *       -u <uid> \
 *       -p <peer_id>
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <stdint.h>
#include <time.h>

#include "tiRTC.h"
#include "platforms.h"
#include "httpclt.h"
#include "my_base64.h"
#include "crypto_wrapper.h"
#include "cjson/tgJSON.h"

#define AUTH_TIMEOUT_MS              10000
#define AUTH_RESP_BUF_SIZE           4096
#define AUTH_TOKEN_BUF_SIZE          1536
#define AUTH_URL_BUF_SIZE            256
#define AUTH_HEADER_BUF_SIZE         512
#define AUTH_TIMESTAMP_BUF_SIZE      32
#define AUTH_STRING_TO_SIGN_BUF_SIZE 768

typedef struct {
    char service_endpoint[160];
    char openapi_endpoint[160];
    char access_id[96];
    char secret_key[160];
    char uid[96];
    char peer_id[96];
    int  user_ttl;
    int  channel_ttl;
    int  loop_count;
    int  run_secs;
} demo_config_t;

static volatile int      g_quit            = 0;
static volatile int      g_connected       = 0;
static volatile int      g_connect_done    = 0;
static volatile int      g_connect_error   = 0;
static volatile int      g_need_disconnect = 0;
static volatile uint32_t g_video_cnt       = 0;
static volatile uint32_t g_audio_cnt       = 0;
static tirtc_conn_t      g_hconn           = NULL;

static void sig_handler(int sig)
{
    (void)sig;
    g_quit = 1;
}

static void demo_copy_text(char *dst, size_t dst_size, const char *src)
{
    if (dst == NULL || dst_size == 0U) {
        return;
    }

    if (src == NULL) {
        dst[0] = '\0';
        return;
    }

    snprintf(dst, dst_size, "%s", src);
}

static void demo_hex_encode(const unsigned char *data, size_t data_len, char *hex, size_t hex_size)
{
    static const char kHex[] = "0123456789abcdef";
    size_t i;

    if (hex == NULL || hex_size == 0U) {
        return;
    }

    if (data == NULL || hex_size < (data_len * 2U + 1U)) {
        hex[0] = '\0';
        return;
    }

    for (i = 0; i < data_len; ++i) {
        hex[i * 2U] = kHex[(data[i] >> 4) & 0x0F];
        hex[i * 2U + 1U] = kHex[data[i] & 0x0F];
    }
    hex[data_len * 2U] = '\0';
}

static int demo_base64url_encode(const unsigned char *data, size_t data_len, char *out, size_t out_size)
{
    char base64[96];
    int encoded_len;
    size_t ri;
    size_t wi = 0U;

    if (data == NULL || out == NULL || out_size == 0U) {
        return -1;
    }

    encoded_len = lutil_b64_ntop(data, data_len, base64, sizeof(base64));
    if (encoded_len <= 0) {
        return -1;
    }

    for (ri = 0; ri < (size_t)encoded_len; ++ri) {
        char current = base64[ri];

        if (current == '=') {
            continue;
        }
        if (current == '+') {
            current = '-';
        } else if (current == '/') {
            current = '_';
        }
        if (wi + 1U >= out_size) {
            return -1;
        }
        out[wi++] = current;
    }

    out[wi] = '\0';
    return 0;
}

static int demo_format_utc_timestamp(char *timestamp, size_t timestamp_size)
{
    time_t now;
    struct tm utc_tm;

    if (timestamp == NULL || timestamp_size == 0U) {
        return -1;
    }

    time(&now);
    if (now <= 0 || gmtime_r(&now, &utc_tm) == NULL) {
        return -1;
    }

    if (strftime(timestamp, timestamp_size, "%Y-%m-%dT%H:%M:%SZ", &utc_tm) == 0U) {
        return -1;
    }

    return 0;
}

static int demo_build_tgserver_authorization(const char *path,
                                             const char *timestamp,
                                             const char *body,
                                             const char *access_id,
                                             const char *secret_key,
                                             char *authorization,
                                             size_t authorization_size)
{
    unsigned char body_digest[32];
    unsigned char sign_digest[32];
    char body_hash_hex[65];
    char string_to_sign[AUTH_STRING_TO_SIGN_BUF_SIZE];
    char signature[96];
    int n;

    if (path == NULL || timestamp == NULL || body == NULL || access_id == NULL || secret_key == NULL ||
        authorization == NULL || authorization_size == 0U) {
        return -1;
    }

    sha256_md((const unsigned char *)body, (int)strlen(body), body_digest);
    demo_hex_encode(body_digest, sizeof(body_digest), body_hash_hex, sizeof(body_hash_hex));

    n = snprintf(string_to_sign,
                 sizeof(string_to_sign),
                 "POST\n%s\n\n%s\n%s",
                 path,
                 timestamp,
                 body_hash_hex);
    if (n < 0 || (size_t)n >= sizeof(string_to_sign)) {
        return -1;
    }

    sha256_hmac((const unsigned char *)secret_key,
                (int)strlen(secret_key),
                (const unsigned char *)string_to_sign,
                n,
                sign_digest);
    if (demo_base64url_encode(sign_digest, sizeof(sign_digest), signature, sizeof(signature)) != 0) {
        return -1;
    }

    n = snprintf(authorization, authorization_size, "TGServer %s:%s", access_id, signature);
    if (n < 0 || (size_t)n >= authorization_size) {
        return -1;
    }

    return 0;
}

static char *demo_build_user_token_body(const demo_config_t *cfg)
{
    tgJSON *root;
    char *body;

    if (cfg == NULL) {
        return NULL;
    }

    root = tgJSON_CreateObject();
    if (root == NULL) {
        return NULL;
    }

    tgJSON_AddStringToObject(root, "access_id", cfg->access_id);
    tgJSON_AddStringToObject(root, "uid", cfg->uid);
    tgJSON_AddNumberToObject(root, "ttl", cfg->user_ttl);
    body = tgJSON_PrintUnformatted(root);
    tgJSON_Delete(root);
    return body;
}

static char *demo_build_channel_token_body(const char *peer_id, int ttl)
{
    tgJSON *root;
    char *body;

    if (peer_id == NULL) {
        return NULL;
    }

    root = tgJSON_CreateObject();
    if (root == NULL) {
        return NULL;
    }

    tgJSON_AddStringToObject(root, "device_id", peer_id);
    tgJSON_AddNumberToObject(root, "ttl", ttl);
    body = tgJSON_PrintUnformatted(root);
    tgJSON_Delete(root);
    return body;
}

static int demo_http_post_json(const char *url,
                               const char *headers,
                               const char *body,
                               char *resp_buf,
                               size_t resp_buf_size,
                               int *http_status)
{
    HTTPCONN conn;
    HTTPREQOPTIONS options;
    HTTPRESP resp;
    int ret;

    if (url == NULL || body == NULL || resp_buf == NULL || resp_buf_size == 0U) {
        return -1;
    }

    memset(&options, 0, sizeof(options));
    memset(&resp, 0, sizeof(resp));
    resp_buf[0] = '\0';
    if (http_status) {
        *http_status = 0;
    }

    options.extra_headers = headers;
    HttpConnInit(&conn);
    ret = http_post(&conn,
                    url,
                    &options,
                    body,
                    (unsigned int)strlen(body),
                    AUTH_TIMEOUT_MS,
                    &resp);
    if (ret == 0) {
        if (resp.content != NULL) {
            demo_copy_text(resp_buf, resp_buf_size, resp.content);
        }
        if (http_status) {
            *http_status = resp.status;
        }
        HttpCleanResponse(&resp);
    }
    HttpConnClose(&conn);
    return ret;
}

static int demo_extract_api_data_string(const char *resp_json,
                                        const char *field_name,
                                        char *out,
                                        size_t out_size)
{
    tgJSON *root = NULL;
    tgJSON *code = NULL;
    tgJSON *message = NULL;
    tgJSON *data = NULL;
    tgJSON *field = NULL;
    int ret = -1;

    if (resp_json == NULL || field_name == NULL || out == NULL || out_size == 0U) {
        return -1;
    }

    out[0] = '\0';
    root = tgJSON_Parse(resp_json);
    if (root == NULL || !tgJSON_IsObject(root)) {
        goto cleanup;
    }

    code = tgJSON_GetObjectItemCaseSensitive(root, "code");
    if (code != NULL && tgJSON_IsNumber(code) && code->valueint != 200 && code->valueint != 0) {
        message = tgJSON_GetObjectItemCaseSensitive(root, "message");
        fprintf(stderr,
                "[auth] API 返回失败 code=%d message=%s\n",
                code->valueint,
                message != NULL && tgJSON_IsString(message) ? message->valuestring : "<none>");
        goto cleanup;
    }

    data = tgJSON_GetObjectItemCaseSensitive(root, "data");
    if (data == NULL || !tgJSON_IsObject(data)) {
        goto cleanup;
    }

    field = tgJSON_GetObjectItemCaseSensitive(data, field_name);
    if (field == NULL || !tgJSON_IsString(field) || field->valuestring == NULL) {
        goto cleanup;
    }

    demo_copy_text(out, out_size, field->valuestring);
    ret = out[0] != '\0' ? 0 : -1;

cleanup:
    if (root != NULL) {
        tgJSON_Delete(root);
    }
    return ret;
}

static int demo_request_user_token(const demo_config_t *cfg, char *user_token, size_t user_token_size)
{
    char url[AUTH_URL_BUF_SIZE];
    char timestamp[AUTH_TIMESTAMP_BUF_SIZE];
    char authorization[AUTH_HEADER_BUF_SIZE];
    char headers[AUTH_HEADER_BUF_SIZE];
    char response[AUTH_RESP_BUF_SIZE];
    char *body;
    int http_status;
    int ret;

    if (cfg == NULL || user_token == NULL || user_token_size == 0U) {
        return -1;
    }

    body = demo_build_user_token_body(cfg);
    if (body == NULL) {
        return -1;
    }

    ret = demo_format_utc_timestamp(timestamp, sizeof(timestamp));
    if (ret != 0) {
        My_free(body);
        return ret;
    }

    ret = demo_build_tgserver_authorization("/v1/user_token",
                                            timestamp,
                                            body,
                                            cfg->access_id,
                                            cfg->secret_key,
                                            authorization,
                                            sizeof(authorization));
    if (ret != 0) {
        My_free(body);
        return ret;
    }

    ret = snprintf(url, sizeof(url), "%s/v1/user_token", cfg->openapi_endpoint);
    if (ret < 0 || (size_t)ret >= sizeof(url)) {
        My_free(body);
        return -1;
    }

    ret = snprintf(headers,
                   sizeof(headers),
                   "Content-Type:application/json;charset=UTF-8\r\n"
                   "Authorization: %s\r\n"
                   "X-TG-Timestamp: %s\r\n",
                   authorization,
                   timestamp);
    if (ret < 0 || (size_t)ret >= sizeof(headers)) {
        My_free(body);
        return -1;
    }

    ret = demo_http_post_json(url, headers, body, response, sizeof(response), &http_status);
    My_free(body);
    if (ret != 0) {
        fprintf(stderr, "[auth] POST /v1/user_token 失败: ret=%d\n", ret);
        return ret;
    }
    if (http_status != 200) {
        fprintf(stderr, "[auth] POST /v1/user_token HTTP %d: %s\n", http_status, response);
        return -1;
    }
    if (demo_extract_api_data_string(response, "user_token", user_token, user_token_size) != 0) {
        fprintf(stderr, "[auth] user_token 解析失败: %s\n", response);
        return -1;
    }

    return 0;
}

static int demo_request_channel_token(const demo_config_t *cfg,
                                      const char *peer_id,
                                      const char *user_token,
                                      char *client_token,
                                      size_t client_token_size)
{
    char url[AUTH_URL_BUF_SIZE];
    char headers[AUTH_HEADER_BUF_SIZE + AUTH_TOKEN_BUF_SIZE];
    char response[AUTH_RESP_BUF_SIZE];
    char *body;
    int http_status;
    int ret;

    if (cfg == NULL || peer_id == NULL || user_token == NULL || client_token == NULL || client_token_size == 0U) {
        return -1;
    }

    body = demo_build_channel_token_body(peer_id, cfg->channel_ttl);
    if (body == NULL) {
        return -1;
    }

    ret = snprintf(url, sizeof(url), "%s/v1/token", cfg->openapi_endpoint);
    if (ret < 0 || (size_t)ret >= sizeof(url)) {
        My_free(body);
        return -1;
    }

    ret = snprintf(headers,
                   sizeof(headers),
                   "Content-Type:application/json;charset=UTF-8\r\n"
                   "Authorization: Bearer %s\r\n",
                   user_token);
    if (ret < 0 || (size_t)ret >= sizeof(headers)) {
        My_free(body);
        return -1;
    }

    ret = demo_http_post_json(url, headers, body, response, sizeof(response), &http_status);
    My_free(body);
    if (ret != 0) {
        fprintf(stderr, "[auth] POST /v1/token 失败: ret=%d\n", ret);
        return ret;
    }
    if (http_status != 200) {
        fprintf(stderr, "[auth] POST /v1/token HTTP %d: %s\n", http_status, response);
        return -1;
    }
    if (demo_extract_api_data_string(response, "token", client_token, client_token_size) != 0) {
        fprintf(stderr, "[auth] client token 解析失败: %s\n", response);
        return -1;
    }

    return 0;
}

static int demo_fetch_client_token(const demo_config_t *cfg,
                                   const char *peer_id,
                                   char *client_token,
                                   size_t client_token_size)
{
    char user_token[AUTH_TOKEN_BUF_SIZE];
    int ret;

    if (cfg == NULL || peer_id == NULL || client_token == NULL || client_token_size == 0U) {
        return -1;
    }

    printf("[auth] 开始在线申请 token: uid=%s peer=%s\n", cfg->uid, peer_id);
    ret = demo_request_user_token(cfg, user_token, sizeof(user_token));
    if (ret != 0) {
        return ret;
    }

    ret = demo_request_channel_token(cfg, peer_id, user_token, client_token, client_token_size);
    if (ret == 0) {
        printf("[auth] client token 申请成功\n");
    }
    return ret;
}

static void on_event(int event, const void *data, int len)
{
    (void)data;
    (void)len;

    if (event == TiEVENT_SYS_STARTED) {
        printf("[client] SDK 已启动\n");
    } else if (event == TiEVENT_ACCESS_HIJACKING) {
        printf("[client] 警告：HTTP 请求被重定向\n");
    }
}

static void connect_cb(int error, tirtc_conn_t hconn, void *user_data)
{
    (void)user_data;

    g_connect_done = 1;
    g_connect_error = error;

    if (error != 0) {
        fprintf(stderr, "[client] 连接失败: %s\n", TiRtcGetErrorStr(error));
        return;
    }

    printf("[client] 连接成功 hconn=%p\n", (void *)hconn);
    g_hconn = hconn;
    g_connected = 1;
    g_video_cnt = 0;
    g_audio_cnt = 0;

    TiRtcSubscribeVideo(hconn, 1);
    TiRtcSubscribeAudio(hconn, 2);
    printf("[client] → 已订阅视频(stream=1 JPEG) 音频(stream=2 PCM)\n");
}

static void on_video(tirtc_conn_t hconn, const TIRTCFRAMEINFO *fi, void *data)
{
    (void)hconn;
    (void)data;

    g_video_cnt++;
    if (TIRTC_IS_KEY_FRAME(fi->flags)) {
        printf("[client] ← 视频关键帧 stream=%u media=%u len=%u（累计%u帧）\n",
               fi->stream_id,
               fi->media,
               fi->length,
               g_video_cnt);
    }
}

static void on_audio(tirtc_conn_t hconn, const TIRTCFRAMEINFO *fi, void *data)
{
    (void)hconn;
    (void)fi;
    (void)data;
    g_audio_cnt++;
}

static void on_conn_error(tirtc_conn_t hconn, int error)
{
    (void)hconn;
    printf("[client] 连接异常: %s\n", TiRtcGetErrorStr(error));
    g_connected = 0;
    g_need_disconnect = 1;
}

static void on_disconnected(tirtc_conn_t hconn)
{
    (void)hconn;
    printf("[client] 对端主动断开\n");
    g_connected = 0;
    g_hconn = NULL;
}

static int wait_connected(int timeout_s)
{
    int loops = timeout_s * 10;

    while (loops-- > 0 && !g_quit) {
        if (g_connect_done) {
            return g_connect_error == 0;
        }
        usleep(100000);
    }

    return 0;
}

static void usage(const char *prog)
{
    fprintf(stderr,
            "用法:\n"
            "  %s -s <service_endpoint> -a <openapi_endpoint> -A <access_id>\\n"
            "     -K <secret_key> -u <uid> -p <peer_id> [-U <user_ttl>]\\n"
            "     [-C <channel_ttl>] [-n <轮数>] [-t <每轮秒数>]\n"
            "\n"
            "示例:\n"
            "  %s -s http://ep-test-tirtc.tange365.com \\\n"
            "     -a http://openapi-test.tange365.com \\\n"
            "     -A demo_access -K demo_secret -u uid1 -p 1801057CIF4I\n",
            prog,
            prog);
}

int main(int argc, char *argv[])
{
    demo_config_t cfg;
    char client_token[AUTH_TOKEN_BUF_SIZE];
    const char *connect_token;
    int ret;
    int round;

    memset(&cfg, 0, sizeof(cfg));
    cfg.user_ttl = 86400;
    cfg.channel_ttl = 300;
    cfg.loop_count = 2;
    cfg.run_secs = 10;

    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "-s") && i + 1 < argc) demo_copy_text(cfg.service_endpoint, sizeof(cfg.service_endpoint), argv[++i]);
        else if (!strcmp(argv[i], "-a") && i + 1 < argc) demo_copy_text(cfg.openapi_endpoint, sizeof(cfg.openapi_endpoint), argv[++i]);
        else if (!strcmp(argv[i], "-A") && i + 1 < argc) demo_copy_text(cfg.access_id, sizeof(cfg.access_id), argv[++i]);
        else if (!strcmp(argv[i], "-K") && i + 1 < argc) demo_copy_text(cfg.secret_key, sizeof(cfg.secret_key), argv[++i]);
        else if (!strcmp(argv[i], "-u") && i + 1 < argc) demo_copy_text(cfg.uid, sizeof(cfg.uid), argv[++i]);
        else if (!strcmp(argv[i], "-p") && i + 1 < argc) demo_copy_text(cfg.peer_id, sizeof(cfg.peer_id), argv[++i]);
        else if (!strcmp(argv[i], "-U") && i + 1 < argc) cfg.user_ttl = atoi(argv[++i]);
        else if (!strcmp(argv[i], "-C") && i + 1 < argc) cfg.channel_ttl = atoi(argv[++i]);
        else if (!strcmp(argv[i], "-n") && i + 1 < argc) cfg.loop_count = atoi(argv[++i]);
        else if (!strcmp(argv[i], "-t") && i + 1 < argc) cfg.run_secs = atoi(argv[++i]);
        else {
            usage(argv[0]);
            return 1;
        }
    }

    if (cfg.service_endpoint[0] == '\0' ||
        cfg.openapi_endpoint[0] == '\0' ||
        cfg.access_id[0] == '\0' ||
        cfg.secret_key[0] == '\0' ||
        cfg.uid[0] == '\0' ||
        cfg.peer_id[0] == '\0') {
        usage(argv[0]);
        return 1;
    }

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    static const TIRTCCALLBACKS cbs = {
        .on_event = on_event,
        .on_conn_error = on_conn_error,
        .on_disconnected = on_disconnected,
        .on_video = on_video,
        .on_audio = on_audio,
    };

    printf("[client] TiRTC %s\n", TiRtcGetVersion());
    printf("[client] service_endpoint=%s\n", cfg.service_endpoint);
    printf("[client] openapi_endpoint=%s\n", cfg.openapi_endpoint);

    TiRtcInit();
    TiRtcLogConfig(1, NULL, 0);
    TiRtcLogSetLevel(1);
    TiRtcSetOption(TIRTC_OPT_SERVICE_ENDPOINT,
                   cfg.service_endpoint,
                   (uint32_t)strlen(cfg.service_endpoint));

    ret = TiRtcStart(NULL, &cbs);
    if (ret < 0) {
        fprintf(stderr, "[client] TiRtcStart 失败: %s\n", TiRtcGetErrorStr(ret));
        TiRtcUninit();
        return 1;
    }

    for (round = 1; round <= cfg.loop_count && !g_quit; ++round) {
        printf("\n[client] ======== 第 %d 轮 ========\n", round);

        g_connect_done = 0;
        g_connect_error = 0;
        g_connected = 0;
        g_need_disconnect = 0;
        g_video_cnt = 0;
        g_audio_cnt = 0;

        if (round == 1) {
            ret = demo_fetch_client_token(&cfg, cfg.peer_id, client_token, sizeof(client_token));
            if (ret != 0) {
                fprintf(stderr, "[client] 首轮取 token 失败\n");
                break;
            }
            connect_token = client_token;
        } else {
            connect_token = NULL;
            printf("[client] 本轮优先走 SDK 连接参数缓存\n");
        }

        ret = TiRtcConnect(cfg.peer_id, connect_token, connect_cb, NULL);
        if (ret == TIRTC_E_CACHE_EXPIRED) {
            printf("[client] SDK 缓存已过期，重新在线申请 token\n");
            ret = demo_fetch_client_token(&cfg, cfg.peer_id, client_token, sizeof(client_token));
            if (ret != 0) {
                fprintf(stderr, "[client] 缓存过期后重取 token 失败\n");
                break;
            }
            ret = TiRtcConnect(cfg.peer_id, client_token, connect_cb, NULL);
        }
        if (ret < 0) {
            fprintf(stderr, "[client] TiRtcConnect 失败: %s\n", TiRtcGetErrorStr(ret));
            break;
        }

        if (!wait_connected(10)) {
            fprintf(stderr,
                    "[client] 连接等待失败/超时，error=%d (%s)\n",
                    g_connect_error,
                    TiRtcGetErrorStr(g_connect_error));
            if (g_hconn != NULL) {
                TiRtcDisconnect(g_hconn);
                g_hconn = NULL;
            }
            break;
        }

        for (int elapsed = 0; elapsed < cfg.run_secs && !g_quit && g_connected; ++elapsed) {
            sleep(1);
            printf("[client] 运行 %ds/%ds | 视频 %u 帧 | 音频 %u 包\n",
                   elapsed + 1,
                   cfg.run_secs,
                   g_video_cnt,
                   g_audio_cnt);
        }

        if (g_need_disconnect && g_hconn != NULL) {
            printf("[client] 执行异常断连清理\n");
            TiRtcDisconnect(g_hconn);
            g_hconn = NULL;
        }

        if (g_hconn != NULL) {
            printf("[client] 主动断开\n");
            TiRtcDisconnect(g_hconn);
            g_hconn = NULL;
        }

        usleep(300000);
    }

    TiRtcStop();
    TiRtcUninit();
    printf("[client] 退出\n");
    return 0;
}