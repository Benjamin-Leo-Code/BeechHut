export type Level = 'alert' | 'warning' | 'info';
export type Page = 'overview' | 'containers' | 'server' | 'home' | 'network' | 'plan' | 'photos' | 'notes';

export interface Meta {
  title: string;
  subtitle: string;
  demo: boolean;
  addon: boolean;
  integrations: { unraid: boolean; homeassistant: boolean; unifi: boolean };
  webUrls: { unraid: string | null; unifi: string | null };
  haVmName: string;
  housePlanUrl: string;
  /** Set when Photo uploader is set up; aspect is the frame's width ÷ height. */
  photoFrame: { aspect: number } | null;
}

export interface Container {
  id: string; name: string; image: string; state: string; status: string; created: number;
  ports: { private: number; public: number; type: string }[];
  network: string; icon: string | null; url: string | null; favourite: boolean; autoStart: boolean | null;
}

export interface Disk {
  name: string; size: number | null; temp: number | null; status: string;
  fsSize: number | null; fsUsed: number | null; fsFree: number | null; errors: number; spinning: boolean | null;
}
export interface ArrayInfo {
  state: string; capacity: { total: number | null; used: number | null; free: number | null };
  parities: Disk[]; disks: Disk[]; caches: Disk[];
}
export interface SystemInfo {
  hostname: string; version: string | null; cpu: string | null; bootedAt: number | null;
  cpuPercent: number | null; memory: { total: number | null; used: number | null; percent: number | null } | null;
}
export interface Vm { id: string; name: string; state: string }

export interface Entity {
  id: string; domain: string; name: string; state: string; unit: string | null; deviceClass: string | null;
  changed: string; attrs: Record<string, any>;
}

export interface UnifiDevice {
  id: string; name: string; model: string; mac: string; ip: string; state: string; features: string[];
  uptime: number | null; cpu: number | null; memory: number | null; tx: number | null; rx: number | null;
  firmware: string | null; firmwareUpdatable: boolean | null;
}
export interface UnifiClient {
  id: string; name: string; type: string; ip: string | null; mac: string; connectedAt: number | null; uplink: string | null; guest: boolean;
}
export interface Unifi { version: string | null; devices: UnifiDevice[]; clients: UnifiClient[] }

export interface Health { up: boolean; status: number; ms: number | null; error?: string }
export interface Link { name: string; url: string; description: string; icon: string | null; pinned: boolean; health?: Health | null; running?: boolean }
export interface LinkGroup { name: string; items: Link[] }

export interface PlanPart {
  id: string; name: string; level: string | null; format: 'usdz' | 'glb'; url: string;
  position: [number, number, number]; rotation: number; unitScale: number | null;
}
export interface HousePlan { name: string; parts: PlanPart[] }

export interface Note { id: string; title: string; body: string; pinned: boolean; created: number; updated: number }

export type AttentionGroup = 'battery' | 'update' | 'unavailable';
export interface AttentionItem { level: Level; source: string; title: string; detail: string | null; page: Page | null; group: AttentionGroup | null; device?: string | null }
type Tile<T> = T | { error?: string; off?: boolean };
export interface Overview {
  attention: AttentionItem[];
  tiles: {
    server: Tile<SystemInfo & { array: { state: string; total: number | null; used: number | null; free: number | null } | null }>;
    containers: Tile<{ running: number; total: number }>;
    vms: Vm[] | null;
    home: Tile<{ version?: string; lightsOn: number; lights: number; updates: number; climate: { name: string; current: number; target?: number; action?: string }[] }>;
    network: Tile<{ devicesOnline: number; devices: number; clients: number; wireless: number; gateway: UnifiDevice | null }>;
  };
}
