/**
 * Provider + model registry for the Smyth setup wizard.
 * Drives the left-hand provider list, endpoint auto-fill, key names, and test URLs.
 */

export interface ModelInfo {
  id: string;
  name: string;
  defaultEndpoint?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  category: 'auto' | 'gateway' | 'search' | 'media' | 'productivity' | 'local';
  description: string;
  keyName?: string;
  keyHelp?: string;
  defaultEndpoint?: string;
  models?: ModelInfo[];
  testUrl?: string;
  requiresKey?: boolean;
  hidden?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'omniroute',
    name: 'OmniRoute Auto',
    category: 'auto',
    description: 'Free auto-routing across cloud + local models. No key required.',
    requiresKey: false,
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    models: [{ id: 'auto', name: 'Auto-route (recommended)', defaultEndpoint: 'https://openrouter.ai/api/v1' }],
    testUrl: '/v1/models',
  },
  {
    id: 'ollama-local',
    name: 'Local Ollama',
    category: 'local',
    description: 'Offline fallback running on your Mac.',
    requiresKey: false,
    defaultEndpoint: 'http://127.0.0.1:11434/v1',
    models: [
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B', defaultEndpoint: 'http://127.0.0.1:11434/v1' },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', defaultEndpoint: 'http://127.0.0.1:11434/v1' },
      { id: 'gemma2:9b', name: 'Gemma 2 9B', defaultEndpoint: 'http://127.0.0.1:11434/v1' },
    ],
    testUrl: '/api/tags',
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama',
    category: 'gateway',
    description: 'Ollama hosted gateway for remote endpoints.',
    keyName: 'OLLAMA_API_KEY',
    keyHelp: 'Create an API key at ollama.com/settings/keys.',
    defaultEndpoint: 'https://api.ollama.ai/v1',
    models: [
      { id: 'llama3.1:70b', name: 'Llama 3.1 70B', defaultEndpoint: 'https://api.ollama.ai/v1' },
      { id: 'mistral-large', name: 'Mistral Large', defaultEndpoint: 'https://api.ollama.ai/v1' },
    ],
    testUrl: '/v1/models',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw Gateway',
    category: 'gateway',
    description: 'For Smyth fleet agents and agent-to-agent routing.',
    keyName: 'OPENCLAW_API_KEY',
    keyHelp: 'Set in ~/.openclaw/config.json or generate a local key.',
    defaultEndpoint: 'http://127.0.0.1:7373/v1',
    models: [{ id: 'auto', name: 'Fleet auto-route', defaultEndpoint: 'http://127.0.0.1:7373/v1' }],
    testUrl: '/v1/models',
  },
  {
    id: 'parallel-web',
    name: 'Parallel Web / AI Search',
    category: 'search',
    description: 'Multi-engine web + AI search results.',
    keyName: 'PARALLEL_WEB_API_KEY',
    keyHelp: 'From your Parallel Web dashboard.',
    defaultEndpoint: 'https://api.parallel-web.ai/v1',
    models: [{ id: 'search', name: 'Parallel Search', defaultEndpoint: 'https://api.parallel-web.ai/v1' }],
    testUrl: '/v1/status',
  },
  {
    id: 'brave',
    name: 'Brave Search (MCP)',
    category: 'search',
    description: 'Brave web search via Model Context Protocol.',
    keyName: 'BRAVE_API_KEY',
    keyHelp: 'Get a free key at brave.com/search/api.',
    defaultEndpoint: 'https://api.search.brave.com/res/v1',
    models: [{ id: 'web', name: 'Brave Web Search', defaultEndpoint: 'https://api.search.brave.com/res/v1' }],
    testUrl: '/web/search?q=health',
  },
  {
    id: 'replicate-flux',
    name: 'Replicate Flux Image Gen',
    category: 'media',
    description: 'Fast image generation via Replicate Flux Schnell.',
    keyName: 'REPLICATE_API_TOKEN',
    keyHelp: 'Required. Get from replicate.com/account/api-tokens',
    defaultEndpoint: 'https://api.replicate.com/v1',
    models: [{ id: 'flux-schnell', name: 'Flux Schnell', defaultEndpoint: 'https://api.replicate.com/v1' }],
  },
  {
    id: 'replicate',
    name: 'Replicate Image/Video',
    category: 'media',
    description: 'Cloud image + video generation models.',
    keyName: 'REPLICATE_API_TOKEN',
    keyHelp: 'Create a token at replicate.com/account/api-tokens.',
    defaultEndpoint: 'https://api.replicate.com/v1',
    models: [
      { id: 'flux-schnell', name: 'FLUX Schnell (image)', defaultEndpoint: 'https://api.replicate.com/v1' },
      { id: 'wan-2.1', name: 'Wan 2.1 (video)', defaultEndpoint: 'https://api.replicate.com/v1' },
    ],
    testUrl: '/models',
  },
  {
    id: 'agenticmail',
    name: 'AgenticMail',
    category: 'productivity',
    description: 'Autonomous email handling and drafting.',
    keyName: 'AGENTICMAIL_API_KEY',
    keyHelp: 'Generate from the AgenticMail console.',
    defaultEndpoint: 'https://api.agenticmail.com/v1',
    models: [{ id: 'email', name: 'AgenticMail Auto', defaultEndpoint: 'https://api.agenticmail.com/v1' }],
    testUrl: '/v1/health',
  },
  {
    id: 'zernio',
    name: 'Zernio Social',
    category: 'productivity',
    description: 'Social media scheduling and publishing.',
    keyName: 'ZERNIO_API_KEY',
    keyHelp: 'Get your key from Zernio → Settings → API.',
    defaultEndpoint: 'https://api.zernio.com/v1',
    models: [{ id: 'social', name: 'Zernio Auto', defaultEndpoint: 'https://api.zernio.com/v1' }],
    testUrl: '/v1/health',
  },
  {
    id: 'twenty',
    name: 'Twenty CRM',
    category: 'productivity',
    description: 'Open-source CRM integration for contacts and deals.',
    keyName: 'TWENTY_API_KEY',
    keyHelp: 'Create an API key in Twenty → Settings → API Keys.',
    defaultEndpoint: 'https://api.twenty.com/rest',
    models: [{ id: 'crm', name: 'Twenty CRM', defaultEndpoint: 'https://api.twenty.com/rest' }],
    testUrl: '/metadata',
  },
];

export function getProviderById(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function getModelById(providerId: string, modelId: string): ModelInfo | undefined {
  const provider = getProviderById(providerId);
  return provider?.models?.find((m) => m.id === modelId);
}

export function getDefaultModel(providerId: string): ModelInfo | undefined {
  const provider = getProviderById(providerId);
  return provider?.models?.[0];
}

export function getCategoryLabel(category: ProviderInfo['category']): string {
  switch (category) {
    case 'auto':
      return 'Auto & Local';
    case 'gateway':
      return 'AI Gateways';
    case 'search':
      return 'Search & Web';
    case 'media':
      return 'Media';
    case 'productivity':
      return 'Productivity';
    case 'local':
      return 'Auto & Local';
    default:
      return category;
  }
}

export function getEndpointForSelection(providerId: string, modelId?: string): string {
  const provider = getProviderById(providerId);
  const model = modelId ? getModelById(providerId, modelId) : undefined;
  return model?.defaultEndpoint ?? provider?.defaultEndpoint ?? '';
}

export function getKeyNameForProvider(providerId: string): string {
  return getProviderById(providerId)?.keyName ?? `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}
