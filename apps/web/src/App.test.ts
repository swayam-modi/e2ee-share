import { describe, it, expect } from 'vitest';
import { App } from './App';

describe('web app', () => {
  it('should export App component', () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe('function');
  });
});
