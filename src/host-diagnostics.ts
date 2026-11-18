/** Stable host-probe codes shared by the live adapter, doctor and client. */
export const IDLE_RELEASE_REFUSALS = {
  'lifecycle-symbols': 'The Cordis lifecycle effect symbol could not be resolved.',
  'agent-registry': 'The host agent registry is unavailable or incompatible.',
  'agent-loop': 'The host agent loop service is unavailable.',
  'session-flush': 'The session flush capability is unavailable.',
  'factory-unavailable': 'The agent registry could not resolve its owning factory.',
  'factory-identity': 'The agent loop and factory do not share a verifiable runtime.',
  'lifecycle-registry': 'The runtime context has no iterable lifecycle registry.',
  'runtime-fibers': 'A runtime does not expose an iterable fiber collection.',
  'runtime-enumeration': 'The runtime fiber collection could not be inspected.',
  'agent-inventory': 'The agent registry returned an unrecognized live-agent list.',
  'agent-state': 'A loaded session has no verifiable agent phase or inbox.',
  'lifecycle-disposables': 'A runtime fiber does not expose iterable owner effects.',
  'lifecycle-owner-missing': 'No unique lifecycle owner effect matches a loaded session.',
} as const;

export type IdleReleaseRefusal = keyof typeof IDLE_RELEASE_REFUSALS;
export interface IdleReleaseCounts { fibers: number; effects: number; labelPrefixes: number; loadedSessions: number }
export interface IdleReleaseDiagnostics {
  status: 'available' | 'unavailable' | 'unverified';
  reasonCode?: IdleReleaseRefusal;
  checks: Array<{ code: IdleReleaseRefusal; status: 'pass' | 'fail' | 'untested' }>;
  counts: IdleReleaseCounts;
}

const ZH_REASONS: Record<IdleReleaseRefusal, string> = {
  'lifecycle-symbols': '无法解析 Cordis 生命周期标记。',
  'agent-registry': '宿主代理注册表不可用或结构不兼容。',
  'agent-loop': '宿主代理循环服务不可用。',
  'session-flush': '宿主缺少会话写入完成接口。',
  'factory-unavailable': '代理注册表无法解析所属工厂。',
  'factory-identity': '代理循环与工厂的运行时身份不一致。',
  'lifecycle-registry': '运行时缺少可枚举的生命周期注册表。',
  'runtime-fibers': '运行时缺少可枚举的 fiber 集合。',
  'runtime-enumeration': '无法检查运行时的 fiber 集合。',
  'agent-inventory': '代理注册表返回的列表格式无法识别。',
  'agent-state': '已加载会话缺少可验证的代理阶段或收件箱。',
  'lifecycle-disposables': '运行时 fiber 缺少可枚举的生命周期清理函数。',
  'lifecycle-owner-missing': '无法为已加载会话找到唯一的生命周期所有者。',
};

export function idleReleaseReasons(language: 'en' | 'zh'): Readonly<Record<IdleReleaseRefusal, string>> {
  return language === 'zh' ? ZH_REASONS : IDLE_RELEASE_REFUSALS;
}

const CHECK_LABELS: Record<'en' | 'zh', Record<IdleReleaseRefusal, string>> = {
  en: {
    'lifecycle-symbols': 'Lifecycle effect symbol',
    'agent-registry': 'Agent registry',
    'agent-loop': 'Agent loop service',
    'session-flush': 'Session flush interface',
    'factory-unavailable': 'Owning factory resolution',
    'factory-identity': 'Factory and runtime identity',
    'lifecycle-registry': 'Lifecycle registry',
    'runtime-fibers': 'Runtime fiber collections',
    'runtime-enumeration': 'Runtime fiber enumeration',
    'agent-inventory': 'Live-agent inventory',
    'agent-state': 'Loaded-session agent state',
    'lifecycle-disposables': 'Lifecycle owner effects',
    'lifecycle-owner-missing': 'Unique loaded-session owner',
  },
  zh: {
    'lifecycle-symbols': '生命周期标记',
    'agent-registry': '代理注册表',
    'agent-loop': '代理循环服务',
    'session-flush': '会话写入完成接口',
    'factory-unavailable': '所属工厂解析',
    'factory-identity': '工厂与运行时身份',
    'lifecycle-registry': '生命周期注册表',
    'runtime-fibers': '运行时 fiber 集合',
    'runtime-enumeration': '运行时 fiber 枚举',
    'agent-inventory': '已加载代理列表',
    'agent-state': '已加载会话的代理状态',
    'lifecycle-disposables': '生命周期清理函数',
    'lifecycle-owner-missing': '已加载会话的唯一所有者',
  },
};

export function idleReleaseChecks(language: 'en' | 'zh'): Readonly<Record<IdleReleaseRefusal, string>> {
  return CHECK_LABELS[language];
}

/** Session-specific evidence stays untested in an empty isolated runtime. */
export function idleReleaseStructurePassed(report: IdleReleaseDiagnostics): boolean {
  if (report.status === 'unavailable' || report.checks.some(check => check.status === 'fail')) return false;
  return (Object.keys(IDLE_RELEASE_REFUSALS) as IdleReleaseRefusal[])
    .filter(code => code !== 'agent-state' && code !== 'lifecycle-owner-missing')
    .every(code => report.checks.find(check => check.code === code)?.status === 'pass');
}

export function emptyIdleReleaseDiagnostics(): IdleReleaseDiagnostics {
  return {
    status: 'unverified',
    checks: (Object.keys(IDLE_RELEASE_REFUSALS) as IdleReleaseRefusal[]).map(code => ({ code, status: 'untested' })),
    counts: { fibers: 0, effects: 0, labelPrefixes: 0, loadedSessions: 0 },
  };
}
