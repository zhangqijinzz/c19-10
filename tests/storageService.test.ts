import { describe, expect, it } from 'vitest';
import { BrowserStorageService } from '../src/storageService';

describe('BrowserStorageService', () => {
  it('treats damaged persisted JSON as missing data', async () => {
    window.localStorage.setItem('exposketch.document.v1', '{broken-json');
    const storage = new BrowserStorageService();
    expect(await storage.read()).toBeNull();
    window.localStorage.clear();
  });
});
