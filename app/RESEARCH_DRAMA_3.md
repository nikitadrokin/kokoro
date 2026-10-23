# Fish Audio Drama 3 research note

Research date: 2026-10-14. Sources are limited to first-party model cards, repositories, documentation, and the authors' technical report. No direct Drama 3 vs. Kokoro benchmark was found.

## What it is

Drama 3 is Fish Audio's newly released open-weight TTS model. The technical report was submitted on 2026-10-13. It is a 35B-parameter mixture-of-experts model with about 3B parameters active per token, initialized from Qwen3.5-35B-A3B. Its 40-layer backbone mixes linear and full attention, and its audio decoder produces ten causal codec codebooks at 44.1 kHz. It supports natural-language direction, voice cloning from one or more references, up to 16 speakers in one request, long-form generation, streaming, multi-turn revisions, and audio infilling/editing. Sources: [technical report](https://arxiv.org/html/2610.18010v1), [official model card](https://huggingface.co/fishaudio/drama-3).

The model card lists 83 languages. The report describes training coverage as approximately 80 languages and dialects. A speaker can change languages while preserving voice identity. Sources: [official model card](https://huggingface.co/fishaudio/drama-3), [Fish Speech documentation](https://speech.fish.audio/).

## Size and deployment

| | Kokoro | Drama 3 |
|---|---:|---:|
| Parameters | 82M | 35B total, ~3B active/token |
| Official model repository size | 363 MB | 41.5 GB including codec and metadata |
| Runtime weights | ~327 MB primary checkpoint | 37.0 GB FP8/BF16 engine weights; 20.8 GB unofficial/linked int4 checkpoint |
| Output sample rate | 24 kHz | 44.1 kHz |
| Typical deployment | CPU, Apple Silicon, or modest GPU | CUDA GPU server; official performance work uses H200 |
| License | Apache 2.0 | Fish Audio Community License v1.0 |

Kokoro is roughly **427x smaller by total parameter count** (35B / 82M) and roughly **113x smaller by primary runtime weight size** (37.0 GB / 327 MB). Even Drama 3's int4 engine weights are about 64x Kokoro's checkpoint size. Sources: [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M), [Drama 3 model card](https://huggingface.co/fishaudio/drama-3), [SGLang-Omni Drama 3 cookbook](https://sgl-project.github.io/sglang-omni/cookbook/fishaudio_drama3.html).

Official self-hosting uses SGLang-Omni and exposes `/v1/audio/speech`, with plain, cloned, streaming, and non-streaming responses. Dependencies include the SGLang-Omni `fishaudio` extra, Hugging Face checkpoint download, CUDA, and Triton; Drama 3 currently accepts only the Triton attention backend. The full checkpoint needs 37 GB for engine weights before KV cache, preprocessing, and vocoder budgets; the linked int4 checkpoint needs 20.8 GB and CUDA compute capability 8.0+. Optimized sampling and fused decoder kernels are validated only on Hopper (compute capability 9.0). These constraints make it a server-class deployment rather than an embedded/local desktop substitute for Kokoro. Source: [SGLang-Omni Drama 3 cookbook](https://sgl-project.github.io/sglang-omni/cookbook/fishaudio_drama3.html).

Fish Audio also exposes it through the same hosted `/v1/tts` endpoint as S2.1 Pro by setting the `model: drama-3` request header. That path accepts text, a hosted `reference_id`, and an output format. Editing APIs are not generally available yet. Source: [official launch article](https://fish.audio/zh-CN/blog/fish-audio-drama-3/).

## Speed

The authors report 271 acoustic frames/s for one stream on one H200 versus 177 frames/s for Fish Audio S2, despite Drama 3 having more than seven times as many parameters. That is not a comparison with Kokoro. Source: [technical report](https://arxiv.org/abs/2610.18010).

SGLang's production benchmark on one H200 reports 88.9 ms p50 time-to-first-audio and mean real-time factor 0.131 at concurrency 1; at concurrency 16 it reports 210.1 ms p50 and 0.373 RTF. An H200 test of non-streaming concurrency 8 reports 1.235 s mean latency and 0.281 RTF for the main checkpoint. Source: [SGLang-Omni Drama 3 cookbook](https://sgl-project.github.io/sglang-omni/cookbook/fishaudio_drama3.html).

There is no defensible apples-to-apples official speed result against Kokoro. Operationally, Drama 3 is much heavier: Kokoro's official package explicitly supports CPU and Apple Silicon and is 82M parameters, whereas Drama 3's published serving numbers require an H200 and tens of GB of GPU memory. Drama 3 can be very fast on high-end server hardware, but it should be expected to be slower, costlier, or simply unavailable on the local hardware where Kokoro comfortably runs.

## Quality and capabilities

Drama 3's advantage is not merely base narration quality. It adds capabilities Kokoro does not natively provide:

- zero-shot voice cloning from multiple references;
- inline free-form direction, scoped delivery tags, breaths/laughs/whispers, and multilingual direction;
- as many as 16 speakers in a scene;
- long-form and streamed generation;
- iterative director notes and local audio infilling/editing (the hosted editing API is still forthcoming).

On Fish Audio's benchmarks, Drama 3 reached English WER 1.13% on the 24-language MiniMax multilingual cloning test, versus Fish Audio S2 at 1.62%, and had the lowest error among all systems in Chinese, Dutch, English, German, and Turkish. Streaming and non-streaming quality were nearly identical (WER 1.86 vs. 1.83; both SIM 0.640). Fish Audio also reports 93.2% on Artificial Analysis's English pronunciation-robustness test versus S2.1 Pro's 88.1%. Sources: [technical report evaluation](https://arxiv.org/html/2610.18010v1), [official launch article](https://fish.audio/zh-CN/blog/fish-audio-drama-3/).

These results do **not** establish that Drama 3 is generally better than Kokoro: Kokoro is absent from the report's comparisons, the evaluated tasks emphasize voice cloning, multilingual cloning, editing, and revision, and the launch pronunciation comparison is against S2.1 Pro. The right conclusion is that Drama 3 has much broader expressive and production capabilities, while raw naturalness/intelligibility versus Kokoro remains unproven without a controlled local listening and latency test.

## License implications

Kokoro's Apache-2.0 weights permit broad commercial use. Drama 3 is open-weight but not permissively open source. The Fish Audio Community License allows research and non-commercial use, plus commercial use for entities under US$500,000 annual revenue. Above that threshold, or when offering Drama 3 itself as TTS, cloning, inference, or an API service to others, a commercial license is required. It also prohibits cloning a real person's voice without consent. Source: [official launch/licensing description](https://fish.audio/zh-CN/blog/fish-audio-drama-3/) and [weight license](https://huggingface.co/fishaudio/drama-3/blob/main/LICENSE).

This is a material product risk: whether integrating it into Kokoro is permitted depends on revenue and whether the app's distribution/use constitutes providing a TTS or inference service. Legal review or written permission from Fish Audio would be prudent before shipping.

## Bottom line

Drama 3 is not a drop-in local replacement for Kokoro. It is dramatically larger, tied to a CUDA/Triton serving stack, and much less permissively licensed. It is worth considering only as an **optional remote/server-grade expressive mode** for users who specifically need directed acting, cloned voices, multiple characters, multilingual output, or long-form production. For ordinary fast local narration, Kokoro remains the more appropriate default.

Before implementation, validate three things: (1) Fish Audio confirms the intended distribution under its license; (2) a small bake-off using this app's actual scripts demonstrates a meaningful audible win over Kokoro; and (3) the product is willing to support either a hosted third-party API/key flow or a separate GPU server. Without all three, the implementation and support burden is not justified.
