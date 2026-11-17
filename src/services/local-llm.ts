import type { ExecutiveBrief, SummaryEngineMode, TranscriptSegment } from '../types/meeting';
import {
  buildLlmBriefPrompt,
  extractExecutiveBrief,
  parseLlmBriefJson,
} from '../core/brief-extractor';

const WEBLLM_CDNS = [
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.88/+esm',
  'https://esm.sh/@mlc-ai/web-llm@0.2.88',
];
const OLLAMA_ENDPOINT = 'http://localhost:11434';

async function loadWebLlm() {
  let lastErr: unknown;
  for (const url of WEBLLM_CDNS) {
    try {
      return await import(/* @vite-ignore */ url);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Unable to load WebGPU LLM runtime.');
}

export interface OllamaStatus {
  available: boolean;
  models: string[];
  error?: string;
}

export interface DesktopBridge {
  platform: string;
  arch: string;
  gpuLabel?: string;
  ollamaProbe?: () => Promise<OllamaStatus>;
  ollamaChat?: (payload: { model: string; prompt: string }) => Promise<string>;
}

declare global {
  interface Window {
    quietbriefDesktop?: DesktopBridge;
  }
}

export async function probeOllama(): Promise<OllamaStatus> {
  if (window.quietbriefDesktop?.ollamaProbe) {
    return window.quietbriefDesktop.ollamaProbe();
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return { available: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models || []).map((m) => m.name).filter(Boolean);
    return { available: true, models };
  } catch (err) {
    return {
      available: false,
      models: [],
      error:
        err instanceof Error
          ? err.message
          : 'Ollama unreachable (start Ollama or set OLLAMA_ORIGINS=*)',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

let cachedWebLlmEngine: {
  modelId: string;
  chat: {
    completions: {
      create: (opts: unknown) => Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
} | null = null;

export async function generateExecutiveBrief(options: {
  mode: SummaryEngineMode;
  segments: TranscriptSegment[];
  meetingTitle: string;
  ollamaModel?: string;
  webGpuModelPreference?: string;
  onStatus?: (msg: string) => void;
}): Promise<ExecutiveBrief> {
  const {
    mode,
    segments,
    meetingTitle,
    ollamaModel,
    webGpuModelPreference = 'SmolLM2',
    onStatus,
  } = options;

  if (mode === 'instant-local' || segments.length === 0) {
    onStatus?.('Extracting decisions, tasks & open questions locally...');
    return extractExecutiveBrief(segments, meetingTitle);
  }

  const prompt = buildLlmBriefPrompt(segments, meetingTitle);

  if (mode === 'ollama') {
    const targetModel = ollamaModel || 'qwen2.5:3b';
    onStatus?.(`Running local Ollama model (${targetModel})...`);

    if (window.quietbriefDesktop?.ollamaChat) {
      const content = await window.quietbriefDesktop.ollamaChat({
        model: targetModel,
        prompt,
      });
      return parseLlmBriefJson(content, segments, `Local Ollama (${targetModel})`);
    }

    const res = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        format: 'json',
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned HTTP ${res.status}. Ensure model "${targetModel}" is pulled.`);
    }
    const payload = (await res.json()) as { message?: { content?: string } };
    return parseLlmBriefJson(
      payload.message?.content || '',
      segments,
      `Local Ollama (${targetModel})`
    );
  }

  // Tier 2: In-browser WebGPU Quantized LLM via @mlc-ai/web-llm
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU is not enabled in this browser. Switch to Chrome/Edge or Instant Local mode.');
  }

  onStatus?.('Loading WebGPU quantized LLM engine...');
  const webllm = (await loadWebLlm()) as {
    prebuiltAppConfig?: { model_list?: Array<{ model_id: string }> };
    CreateMLCEngine: (
      modelId: string,
      opts: { initProgressCallback?: (report: { text: string; progress: number }) => void }
    ) => Promise<NonNullable<typeof cachedWebLlmEngine>>;
  };

  const availableModels = (webllm.prebuiltAppConfig?.model_list || []).map((m) => m.model_id);
  const chosenModel =
    availableModels.find((id) =>
      id.toLowerCase().includes(webGpuModelPreference.toLowerCase())
    ) ||
    availableModels.find((id) => id.includes('Qwen2.5-1.5B-Instruct')) ||
    availableModels.find((id) => id.includes('Llama-3.2-1B-Instruct')) ||
    availableModels[0];

  if (!chosenModel) {
    throw new Error('No compatible WebGPU MLC model found in catalog.');
  }

  if (!cachedWebLlmEngine || cachedWebLlmEngine.modelId !== chosenModel) {
    cachedWebLlmEngine = await webllm.CreateMLCEngine(chosenModel, {
      initProgressCallback: (report) => {
        onStatus?.(report.text || `Loading ${chosenModel} (${Math.round(report.progress * 100)}%)`);
      },
    });
    cachedWebLlmEngine.modelId = chosenModel;
  }

  onStatus?.(`Synthesizing Executive Brief via ${chosenModel}...`);
  const completion = await cachedWebLlmEngine.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.15,
    max_tokens: 900,
  });

  const text = completion.choices?.[0]?.message?.content || '';
  return parseLlmBriefJson(text, segments, `WebGPU LLM (${chosenModel})`);
}
