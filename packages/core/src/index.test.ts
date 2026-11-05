import { describe, it, expect } from 'vitest';
import { CORE_VERSION, initCore } from './index';

describe('core package', () => {
  it('should export CORE_VERSION matching protocol version', () => {
    expect(CORE_VERSION).toBe(1);
  });

  it('should initialize core with version info', () => {
    const core = initCore();
    expect(core.version).toBe(1);
  });
});
