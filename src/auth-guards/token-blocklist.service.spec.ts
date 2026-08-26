import { TokenBlocklistService } from './token-blocklist.service';

describe('TokenBlocklistService', () => {
  let service: TokenBlocklistService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new TokenBlocklistService();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reports a jti as not revoked before it is revoked', () => {
    expect(service.isRevoked('jti-1')).toBe(false);
  });

  it('reports a jti as revoked after revoke() is called', () => {
    service.revoke('jti-1');

    expect(service.isRevoked('jti-1')).toBe(true);
  });

  it('tracks multiple jtis independently', () => {
    service.revoke('jti-1');

    expect(service.isRevoked('jti-1')).toBe(true);
    expect(service.isRevoked('jti-2')).toBe(false);
  });
});
