import JDownloader from 'myjdownloader';
import logger from '../utils/logger';

export type Jd2Package = {
  uuid: string;
  name: string;
  status: string;
  bytesLoaded: number;
  bytesTotal: number;
  enabled: boolean;
  running: boolean;
  speed: number;
  eta: number;
  finished: boolean;
};

export type Jd2Link = Jd2Package & {
  url: string;
  packageUUID: string;
};

type Device = { id?: string; deviceId?: string; name?: string };

function configuredDeviceId(devices: Device[]): string {
  const requestedId = (process.env.JD2_DEVICE_ID || '').trim();
  const requestedName = (process.env.JD2_DEVICE_NAME || '').trim().toLowerCase();
  const selected = devices.find(device => requestedId && String(device.id || device.deviceId) === requestedId)
    || devices.find(device => requestedName && String(device.name || '').toLowerCase() === requestedName)
    || devices[0];
  return String(selected?.id || selected?.deviceId || '');
}

function unwrapList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as { data?: unknown; list?: unknown };
    if (Array.isArray(record.data)) return record.data as T[];
    if (Array.isArray(record.list)) return record.list as T[];
  }
  return [];
}

export function isJd2StatusConfigured(): boolean {
  const directUrl = (process.env.JD2_API_URL || '').trim();
  const email = (process.env.MYJD_EMAIL || process.env.JD2_MYJD_EMAIL || '').trim();
  const password = (process.env.MYJD_PASSWORD || process.env.JD2_MYJD_PASSWORD || '').trim();
  return Boolean(directUrl || (email && password));
}

type ConnectedClient = { client: JDownloader; deviceId: string; label: string };

async function connectClient(client: JDownloader, label: string): Promise<ConnectedClient> {
  const connectedDeviceId = String(await client.connect() || '');
  const rawDevices = await client.listDevices();
  const deviceId = configuredDeviceId(unwrapList<Device>(rawDevices)) || connectedDeviceId;
  if (!deviceId) throw new Error(`No online JDownloader device was found via ${label}.`);
  return { client, deviceId, label };
}

async function getConnectedClient(): Promise<ConnectedClient> {
  const directUrl = (process.env.JD2_API_URL || '').trim().replace(/\/+$/, '');
  const email = (process.env.MYJD_EMAIL || process.env.JD2_MYJD_EMAIL || '').trim();
  const password = (process.env.MYJD_PASSWORD || process.env.JD2_MYJD_PASSWORD || '').trim();
  const candidates: Array<{ client: JDownloader; label: string }> = [];

  if (email && password) {
    candidates.push({ client: new JDownloader(email, password), label: 'MyJDownloader' });
  }
  if (directUrl) {
    candidates.push({ client: new JDownloader(undefined, undefined, directUrl), label: 'the local JD2 API' });
  }
  if (!candidates.length) {
    throw new Error('Configure MYJD_EMAIL and MYJD_PASSWORD, or JD2_API_URL as a fallback.');
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await connectClient(candidate.client, candidate.label);
    } catch (error) {
      lastError = error;
      await candidate.client.disconnect().catch(() => {});
      if (candidate.label === 'MyJDownloader' && directUrl) {
        logger.warn('MyJDownloader connection failed; trying the local JD2 API fallback.');
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not connect to JDownloader.');
}

async function withClient<T>(operation: (client: JDownloader, deviceId: string) => Promise<T>): Promise<T> {
  const { client, deviceId } = await getConnectedClient();
  try {
    return await operation(client, deviceId);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

export async function queryJd2Downloads(): Promise<{ packages: Jd2Package[]; links: Jd2Link[] }> {
  return withClient(async (client, deviceId) => {
    const [rawPackages, rawLinks] = await Promise.all([
      client.downloadsV2.queryPackages(deviceId, undefined, {
        name: true,
        status: true,
        bytesLoaded: true,
        bytesTotal: true,
        enabled: true,
        running: true,
        speed: true,
        eta: true,
        finished: true,
      }),
      client.downloadsV2.queryLinks(deviceId, {
        url: true,
        name: true,
        status: true,
        bytesLoaded: true,
        bytesTotal: true,
        enabled: true,
        running: true,
        speed: true,
        eta: true,
        finished: true,
        packageUUID: true,
      }),
    ]);
    return {
      packages: unwrapList<Jd2Package>(rawPackages).map(item => ({ ...item, uuid: String(item.uuid) })),
      links: unwrapList<Jd2Link>(rawLinks).map(item => ({
        ...item,
        uuid: String(item.uuid),
        packageUUID: String(item.packageUUID),
      })),
    };
  });
}

export async function removeJd2Links(linkIds: string[]): Promise<void> {
  if (!linkIds.length) return;
  await withClient((client, deviceId) => client.downloadsV2.removeLinks(deviceId, linkIds));
}

export async function addJd2Links(params: {
  links: string[];
  packageName: string;
  destinationFolder?: string;
  autostart?: boolean;
  overwritePackagizerRules?: boolean;
}): Promise<void> {
  if (!params.links.length) return;
  await withClient((client, deviceId) => client.linkgrabberV2.addLinks(deviceId, params.links, {
    packageName: params.packageName,
    destinationFolder: params.destinationFolder,
    autostart: params.autostart,
    overwritePackagizerRules: params.overwritePackagizerRules,
    deepDecrypt: true,
  }));
}
