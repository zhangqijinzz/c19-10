import { describe, expect, it } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { DocumentStorageService } from '../src/storageService';
import { LocalLayoutRepository } from '../src/repository';
import { BrowserStorageService } from '../src/storageService';

describe('LocalLayoutRepository', () => {
  it('falls back to the starter document when persisted JSON is damaged', async () => {
    window.localStorage.setItem('exposketch.document.v1', '{broken-json');
    const repository = new LocalLayoutRepository(new BrowserStorageService());
    expect(await repository.load()).toEqual(createStarterDocument());
    window.localStorage.clear();
  });

  it('keeps storage read failures visible so the app can enter degraded mode', async () => {
    const failingStorage: DocumentStorageService = {
      read: async () => { throw new Error('storage unavailable'); },
      write: async () => {},
    };
    const repository = new LocalLayoutRepository(failingStorage);
    await expect(repository.load()).rejects.toThrow('storage unavailable');
  });
});
