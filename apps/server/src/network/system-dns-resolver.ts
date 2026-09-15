import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ProviderDnsResolver, ResolvedProviderAddress } from '../security/provider-url.js';

export class SystemProviderDnsResolver implements ProviderDnsResolver {
  async resolve(hostname: string): Promise<readonly ResolvedProviderAddress[]> {
    const literalFamily = isIP(hostname);
    if (literalFamily === 4 || literalFamily === 6) {
      return [Object.freeze({ address: hostname, family: literalFamily })];
    }

    const results = await lookup(hostname, { all: true, order: 'verbatim' });
    return results
      .filter((result): result is Readonly<{ address: string; family: 4 | 6 }> =>
        result.family === 4 || result.family === 6,
      )
      .map((result) => Object.freeze({ address: result.address, family: result.family }));
  }
}
