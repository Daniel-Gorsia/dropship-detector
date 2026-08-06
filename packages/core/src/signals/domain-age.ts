import { fetchJson, extractDomain } from "../fetch.js";

export interface DomainAgeResult {
  domain: string;
  registrationDate: string | null;
  registrar: string | null;
  ageInDays: number | null;
  isNewDomain: boolean;
  rdapServer: string | null;
}

interface RdapResponse {
  events?: Array<{ eventAction: string; eventDate: string }>;
  entities?: Array<{
    roles?: string[];
    vcardArray?: unknown[];
  }>;
}

interface RdapBootstrap {
  services: Array<[string[], string[]]>;
}

// In-process cache — refreshed every 24 h
let bootstrapCache: RdapBootstrap | null = null;
let bootstrapCachedAt = 0;

async function getRdapUrl(domain: string): Promise<string> {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";

  // Refresh bootstrap at most once per day
  if (!bootstrapCache || Date.now() - bootstrapCachedAt > 86_400_000) {
    try {
      bootstrapCache = await fetchJson<RdapBootstrap>(
        "https://data.iana.org/rdap/dns.json"
      );
      bootstrapCachedAt = Date.now();
    } catch {
      // If bootstrap fetch fails, fall through to rdap.org
    }
  }

  if (bootstrapCache) {
    for (const [tlds, servers] of bootstrapCache.services) {
      if (tlds.includes(tld) && servers[0]) {
        return `${servers[0].replace(/\/$/, "")}/domain/${domain}`;
      }
    }
  }

  // Universal fallback proxy
  return `https://rdap.org/domain/${domain}`;
}

export async function getDomainAge(url: string): Promise<DomainAgeResult> {
  const domain = extractDomain(url);
  let rdapServer: string | null = null;

  let data: RdapResponse | null = null;

  try {
    rdapServer = await getRdapUrl(domain);
    data = await fetchJson<RdapResponse>(rdapServer);
  } catch {
    // Try rdap.org as final fallback if bootstrap-derived server failed
    if (rdapServer && !rdapServer.includes("rdap.org")) {
      try {
        const fallback = `https://rdap.org/domain/${domain}`;
        data = await fetchJson<RdapResponse>(fallback);
        rdapServer = fallback;
      } catch {
        // give up
      }
    }
  }

  if (!data) {
    return { domain, registrationDate: null, registrar: null, ageInDays: null, isNewDomain: false, rdapServer };
  }

  const registrationEvent = data.events?.find(
    (e) => e.eventAction === "registration"
  );
  const registrationDate = registrationEvent?.eventDate ?? null;

  let ageInDays: number | null = null;
  if (registrationDate) {
    ageInDays = Math.floor(
      (Date.now() - new Date(registrationDate).getTime()) / 86_400_000
    );
  }

  const registrarEntity = data.entities?.find((e) => e.roles?.includes("registrar"));
  const registrar = extractVcardFn(registrarEntity?.vcardArray);

  return {
    domain,
    registrationDate,
    registrar,
    ageInDays,
    isNewDomain: ageInDays !== null && ageInDays < 180,
    rdapServer,
  };
}

function extractVcardFn(vcardArray: unknown): string | null {
  if (!Array.isArray(vcardArray)) return null;
  const cards = vcardArray[1];
  if (!Array.isArray(cards)) return null;
  const fnEntry = (cards as unknown[]).find(
    (c) => Array.isArray(c) && c[0] === "fn"
  );
  if (!Array.isArray(fnEntry)) return null;
  return String(fnEntry[3] ?? "");
}
