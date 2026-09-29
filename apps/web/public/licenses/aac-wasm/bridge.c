/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Bridge between JavaScript and the FFmpeg AAC-LC encoder (libavcodec).
 *
 * Origin: packages/aac-encoder/src/bridge.c of Mediabunny 1.60.0
 * (https://github.com/Vanilagy/mediabunny/blob/v1.60.0/packages/aac-encoder/src/bridge.c).
 *
 * Changes by Hank's Hits (2026), under the same license:
 * - The caller writes planar float samples directly into the frame planes
 *   (aac_input), so the bridge does not interleave or copy.
 * - aac_send pads a short last frame with silence to one full frame.
 * - aac_initial_padding gives the encoder delay, so the caller can check it.
 * - aac_bridge_abi gives the interface version, so the caller can refuse a
 *   module that does not match.
 * - The bridge does not reset the encoder after a flush. A flushed encoder
 *   is closed, never used again.
 *
 * Every function is single-threaded. The caller owns one EncoderContext per
 * stream and closes it with aac_close.
 */

#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "libavcodec/avcodec.h"
#include "libavutil/channel_layout.h"
#include "libavutil/frame.h"
#include "libavutil/log.h"

/* Increase this when a function signature or a return rule changes. */
#define AAC_BRIDGE_ABI 1

typedef struct {
	AVCodecContext *codec_ctx;
	AVPacket *packet;
	AVFrame *frame;
	int64_t next_pts;
} EncoderContext;

EMSCRIPTEN_KEEPALIVE
int aac_bridge_abi(void) {
	return AAC_BRIDGE_ABI;
}

static void free_parts(AVCodecContext **codec_ctx, AVPacket **packet, AVFrame **frame) {
	av_frame_free(frame);
	av_packet_free(packet);
	avcodec_free_context(codec_ctx);
}

/* Opens an AAC-LC encoder. Returns NULL when FFmpeg refuses the settings. */
EMSCRIPTEN_KEEPALIVE
EncoderContext *aac_open(int channels, int sample_rate, int bitrate) {
	av_log_set_level(AV_LOG_ERROR);

	const AVCodec *codec = avcodec_find_encoder(AV_CODEC_ID_AAC);
	if (!codec) return NULL;

	AVCodecContext *codec_ctx = avcodec_alloc_context3(codec);
	AVPacket *packet = av_packet_alloc();
	AVFrame *frame = av_frame_alloc();
	EncoderContext *ctx = malloc(sizeof(EncoderContext));
	if (!codec_ctx || !packet || !frame || !ctx) {
		free(ctx);
		free_parts(&codec_ctx, &packet, &frame);
		return NULL;
	}

	codec_ctx->sample_fmt = AV_SAMPLE_FMT_FLTP;
	codec_ctx->sample_rate = sample_rate;
	codec_ctx->bit_rate = bitrate;
	codec_ctx->time_base = (AVRational){1, sample_rate};
	av_channel_layout_default(&codec_ctx->ch_layout, channels);

	if (avcodec_open2(codec_ctx, codec, NULL) < 0) {
		free(ctx);
		free_parts(&codec_ctx, &packet, &frame);
		return NULL;
	}

	frame->format = AV_SAMPLE_FMT_FLTP;
	frame->sample_rate = sample_rate;
	frame->nb_samples = codec_ctx->frame_size;
	if (av_channel_layout_copy(&frame->ch_layout, &codec_ctx->ch_layout) < 0 ||
		av_frame_get_buffer(frame, 0) < 0) {
		free(ctx);
		free_parts(&codec_ctx, &packet, &frame);
		return NULL;
	}

	ctx->codec_ctx = codec_ctx;
	ctx->packet = packet;
	ctx->frame = frame;
	ctx->next_pts = 0;
	return ctx;
}

/* Samples per channel in one frame (1024 for AAC-LC). */
EMSCRIPTEN_KEEPALIVE
int aac_frame_size(EncoderContext *ctx) {
	return ctx->codec_ctx->frame_size;
}

/* Encoder delay in samples: the priming at the start of the decoded stream. */
EMSCRIPTEN_KEEPALIVE
int aac_initial_padding(EncoderContext *ctx) {
	return ctx->codec_ctx->initial_padding;
}

/*
 * Returns the plane of one channel for the next frame, or NULL on failure.
 * Write aac_frame_size floats (or fewer) into it, then call aac_send.
 * Get the plane again for each frame: the address can change.
 */
EMSCRIPTEN_KEEPALIVE
float *aac_input(EncoderContext *ctx, int channel) {
	if (channel < 0 || channel >= ctx->codec_ctx->ch_layout.nb_channels) return NULL;
	if (av_frame_make_writable(ctx->frame) < 0) return NULL;
	return (float *)ctx->frame->data[channel];
}

/*
 * Sends the frame in the planes. The first `samples` samples of each plane
 * are real audio. The rest of the frame becomes silence.
 * Returns 0, or a negative FFmpeg error code.
 */
EMSCRIPTEN_KEEPALIVE
int aac_send(EncoderContext *ctx, int samples) {
	int frame_size = ctx->frame->nb_samples;
	if (samples < 0 || samples > frame_size) return AVERROR(EINVAL);
	if (av_frame_make_writable(ctx->frame) < 0) return AVERROR(ENOMEM);
	if (samples < frame_size) {
		for (int ch = 0; ch < ctx->codec_ctx->ch_layout.nb_channels; ch++) {
			float *plane = (float *)ctx->frame->data[ch];
			memset(plane + samples, 0, (size_t)(frame_size - samples) * sizeof(float));
		}
	}
	ctx->frame->pts = ctx->next_pts;
	ctx->next_pts += frame_size;
	return avcodec_send_frame(ctx->codec_ctx, ctx->frame);
}

/*
 * Takes the next packet from the encoder.
 * Returns its size in bytes, 0 when no packet is ready (or the stream is at
 * its end), or a negative FFmpeg error code.
 */
EMSCRIPTEN_KEEPALIVE
int aac_receive(EncoderContext *ctx) {
	av_packet_unref(ctx->packet);
	int ret = avcodec_receive_packet(ctx->codec_ctx, ctx->packet);
	if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) return 0;
	if (ret < 0) return ret;
	return ctx->packet->size;
}

/* The bytes of the packet from the last aac_receive. */
EMSCRIPTEN_KEEPALIVE
uint8_t *aac_packet(EncoderContext *ctx) {
	return ctx->packet->data;
}

/*
 * Starts the end of the stream. After this call, aac_receive gives the
 * packets that the encoder still holds, then 0. Do not send more frames.
 */
EMSCRIPTEN_KEEPALIVE
int aac_flush(EncoderContext *ctx) {
	return avcodec_send_frame(ctx->codec_ctx, NULL);
}

EMSCRIPTEN_KEEPALIVE
void aac_close(EncoderContext *ctx) {
	if (!ctx) return;
	free_parts(&ctx->codec_ctx, &ctx->packet, &ctx->frame);
	free(ctx);
}
