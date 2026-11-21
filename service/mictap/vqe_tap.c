/*
 * vqe_tap.so — копия обработанного микрофона Станции для MidiPult.
 *
 * Грузится в `maind --platformd` через LD_PRELOAD. Перехватывает
 * YandexVqeC_GetOutputChannelData (выход штатного шумодава Yandex VQE),
 * вызывает оригинал и отдаёт копию кадров в unixgram-сокет MidiPult.
 *
 * Правила, которые нельзя нарушать:
 *   - оригинальный результат, буфер и errno не меняются;
 *   - отправка неблокирующая: если приёмника нет, Алиса этого не замечает;
 *   - при любой ошибке tap просто выключается, процесс `maind` не трогаем.
 *
 * Отличия от vqe_tap.c из YaJavis:
 *   - нет `_exit(2)` при неудачном dlsym: не наша библиотека — не наше право
 *     ронять чужой процесс;
 *   - по умолчанию отдаются ВСЕ каналы с ненулевым числом кадров, а не один
 *     зашитый `6:0`: на Миди и на Станции 2 раскладка VQE разная, канал
 *     выбирает приёмник (см. service/micd.py);
 *   - в каждом датаграме 4-байтовый заголовок (kind, index, frames LE), поэтому
 *     приёмник видит, откуда пришёл звук;
 *   - файл `<сокет>.seen` перечисляет каналы, которые реально приходят на этой
 *     прошивке, — это и есть диагностика для незнакомых моделей;
 *   - опциональный дамп в сырой s16le для разбора «а что там вообще»;
 *   - счётчик потерянных датаграм отражается в `.seen` (строка `drop`).
 *
 * Сборка (см. build.sh):
 *   zig cc -target arm-linux-gnueabihf.2.28 -shared -fPIC -O2 -o vqe_tap-armhf.so vqe_tap.c -ldl -lpthread
 *   zig cc -target aarch64-linux-gnu.2.28  -shared -fPIC -O2 -o vqe_tap-aarch64.so vqe_tap.c -ldl -lpthread
 *
 * Переменные окружения (задаются в launch.json, см. deploy/mic-tap.sh):
 *   MYPULT_MIC_SOCKET  — путь к unixgram-сокету приёмника (обязателен);
 *   ALICE_CAPTURE_SOCKET — совместимость с уже настроенным tap от YaJavis;
 *   MYPULT_MIC_CHANNEL — «6:0» чтобы отдавать только один канал (по умолчанию все);
 *   MYPULT_MIC_GAIN    — множитель 0.05…20 (по умолчанию 1.0);
 *   MYPULT_MIC_DUMP    — путь к файлу, куда писать сырой s16le выбранного канала.
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#define TAP_MAX_FRAMES 4096
#define TAP_MAX_KIND 16
#define TAP_MAX_INDEX 8
#define TAP_SEEN_MAX 64

typedef void *(*vqe_output_fn)(void *, unsigned int, unsigned int,
                               const float **, size_t *);

static vqe_output_fn real_output;
static pthread_once_t tap_once = PTHREAD_ONCE_INIT;
static int tap_sock = -1;
static struct sockaddr_un tap_dest;
static socklen_t tap_dest_len;
static float tap_gain = 1.0f;
static int tap_kind = -1;             /* -1 — все каналы */
static int tap_index = -1;
static int tap_dump_fd = -1;
static char tap_seen_path[sizeof(((struct sockaddr_un *)0)->sun_path) + 8];
static unsigned char tap_seen[TAP_MAX_KIND][TAP_MAX_INDEX];
static int tap_seen_count;
static unsigned long tap_dropped;
static unsigned long tap_frames_sent;

static unsigned long tap_now_ms(void)
{
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
        return 0;
    }
    return (unsigned long)ts.tv_sec * 1000UL + (unsigned long)(ts.tv_nsec / 1000000L);
}

static void tap_write_seen(const char *line)
{
    if (!tap_seen_path[0]) {
        return;
    }
    int fd = open(tap_seen_path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
    if (fd < 0) {
        return;
    }
    (void)write(fd, line, strlen(line));
    close(fd);
}

static void tap_note_channel(unsigned int kind, unsigned int index, size_t frames)
{
    if (kind >= TAP_MAX_KIND || index >= TAP_MAX_INDEX) {
        return;
    }
    if (tap_seen[kind][index]) {
        return;
    }
    tap_seen[kind][index] = 1;
    tap_seen_count++;
    char line[96];
    int n = snprintf(line, sizeof line, "channel %u %u %u\n", kind, index,
                     (unsigned int)frames);
    if (n > 0) {
        tap_write_seen(line);
    }
}

static void tap_init(void)
{
    const char *path = getenv("MYPULT_MIC_SOCKET");
    if (!path || !*path) {
        path = getenv("ALICE_CAPTURE_SOCKET");
    }
    if (!path || !*path || strlen(path) >= sizeof tap_dest.sun_path) {
        return;
    }

    const char *channel = getenv("MYPULT_MIC_CHANNEL");
    if (channel && *channel) {
        unsigned int kind = 0, index = 0;
        if (sscanf(channel, "%u:%u", &kind, &index) == 2 &&
            kind < TAP_MAX_KIND && index < TAP_MAX_INDEX) {
            tap_kind = (int)kind;
            tap_index = (int)index;
        }
    }

    const char *gain = getenv("MYPULT_MIC_GAIN");
    if (gain && *gain) {
        float value = strtof(gain, NULL);
        if (value > 0.05f && value < 20.0f) {
            tap_gain = value;
        }
    }

    snprintf(tap_seen_path, sizeof tap_seen_path, "%s.seen", path);
    unlink(tap_seen_path);

    const char *dump = getenv("MYPULT_MIC_DUMP");
    if (dump && *dump) {
        tap_dump_fd = open(dump, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    }

    memset(&tap_dest, 0, sizeof tap_dest);
    tap_dest.sun_family = AF_UNIX;
    strncpy(tap_dest.sun_path, path, sizeof tap_dest.sun_path - 1);
    tap_dest_len = (socklen_t)(offsetof(struct sockaddr_un, sun_path) + strlen(path) + 1);

    tap_sock = socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (tap_sock < 0) {
        return;
    }

    char line[96];
    int n = snprintf(line, sizeof line, "tap pid %ld gain %.2f channel %d:%d\n",
                     (long)getpid(), (double)tap_gain, tap_kind, tap_index);
    if (n > 0) {
        tap_write_seen(line);
    }
}

static short tap_to_s16(float value)
{
    if (value != value) {
        return 0;
    }
    value *= tap_gain;
    if (value >= 1.0f) {
        return 32767;
    }
    if (value <= -1.0f) {
        return -32768;
    }
    return (short)(value * 32768.0f);
}

static void tap_send_packet(unsigned int kind, unsigned int index,
                            const float *src, size_t frames)
{
    unsigned char packet[4 + TAP_MAX_FRAMES * 2];
    short *out = (short *)(void *)(packet + 4);
    packet[0] = (unsigned char)kind;
    packet[1] = (unsigned char)index;
    packet[2] = (unsigned char)(frames & 0xFF);
    packet[3] = (unsigned char)((frames >> 8) & 0xFF);
    for (size_t i = 0; i < frames; i++) {
        out[i] = tap_to_s16(src[i]);
    }
    ssize_t sent = sendto(tap_sock, packet, 4 + frames * 2,
                          MSG_DONTWAIT | MSG_NOSIGNAL,
                          (struct sockaddr *)&tap_dest, tap_dest_len);
    if (sent < 0) {
        tap_dropped++;
        return;
    }
    tap_frames_sent += frames;
    if ((tap_dropped & 0x3FF) == 0x3FF) {
        char line[96];
        int n = snprintf(line, sizeof line, "drop %lu frames %lu\n", tap_dropped,
                         tap_frames_sent);
        if (n > 0) {
            tap_write_seen(line);
        }
    }
}

void *YandexVqeC_GetOutputChannelData(void *engine, unsigned int kind,
                                      unsigned int index, const float **data,
                                      size_t *frames)
{
    int saved_errno = errno;
    if (!real_output) {
        real_output = (vqe_output_fn)dlsym(RTLD_NEXT, "YandexVqeC_GetOutputChannelData");
    }
    if (!real_output) {
        /* Символа нет — перехватывать нечего. Молча отдаём пустой ответ,
         * чтобы не убивать maind (в отличие от vqe_tap.c из YaJavis). */
        errno = ENOSYS;
        return NULL;
    }
    (void)pthread_once(&tap_once, tap_init);
    errno = saved_errno;

    void *result = real_output(engine, kind, index, data, frames);
    saved_errno = errno;

    if (!result && data && *data && frames && *frames > 0 &&
        *frames <= TAP_MAX_FRAMES && tap_sock >= 0) {
        tap_note_channel(kind, index, *frames);
        int wanted = (tap_kind < 0) ||
                     ((int)kind == tap_kind && (int)index == tap_index);
        if (wanted) {
            tap_send_packet(kind, index, *data, *frames);
            if (tap_dump_fd >= 0 &&
                (tap_kind < 0 || (int)kind == tap_kind)) {
                short pcm[TAP_MAX_FRAMES];
                for (size_t i = 0; i < *frames; i++) {
                    pcm[i] = tap_to_s16((*data)[i]);
                }
                ssize_t ignored = write(tap_dump_fd, pcm, *frames * sizeof(short));
                (void)ignored;
            }
        }
    }

    errno = saved_errno;
    return result;
}

/* Небольшая точка входа для проверки, что .so вообще загрузилась. */
__attribute__((constructor)) static void tap_loaded(void)
{
    /* Ничего не делаем: вся инициализация лениво, по первому кадру. */
    (void)tap_now_ms;
}
