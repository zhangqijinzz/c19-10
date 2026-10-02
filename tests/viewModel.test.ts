import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutRepository } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => initial ?? createStarterDocument()),
  save: vi.fn(async (_document) => {}),
});

const deferredRepository = (saved: LayoutDocument) => {
  let resolveLoad: (document: LayoutDocument) => void = () => {};
  const load = vi.fn(() => new Promise<LayoutDocument>((resolve) => { resolveLoad = resolve; }));
  const save = vi.fn(async (_document: LayoutDocument) => {});
  const repository: LayoutRepository = { load, save };
  return { repository, resolve: () => resolveLoad(saved) };
};

const deferredFailingRepository = () => {
  let rejectLoad: (error: Error) => void = () => {};
  const load = vi.fn(() => new Promise<LayoutDocument>((_resolve, reject) => { rejectLoad = reject; }));
  const save = vi.fn(async (_document: LayoutDocument) => {});
  const repository: LayoutRepository = { load, save };
  return { repository, reject: () => rejectLoad(new Error('bad storage')) };
};

describe('ExpoSketchViewModel', () => {
  it('initializes and updates the selected layout', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('ready');
    const count = vm.state.document.elements.length;
    vm.addElement('booth');
    expect(vm.state.document.elements).toHaveLength(count + 1);
    expect(vm.state.selectedId).toContain('booth-');
  });

  it('updates analysis immediately after moving an element into an overlap', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('does not let a late load replace an edit made during loading', async () => {
    const saved = createStarterDocument();
    const { repository, resolve } = deferredRepository(saved);
    const vm = new ExpoSketchViewModel(repository);
    const initialization = vm.initialize();

    vm.moveElement('stage-1', 12.3, 4.5);
    resolve();
    await initialization;

    const moved = vm.state.document.elements.find((element) => element.id === 'stage-1');
    expect(moved).toMatchObject({ x: 12.3, y: 4.5 });
    expect(vm.state.phase).toBe('ready');
    expect(vm.state.notice.tone).toBe('warning');
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith(vm.state.document);
  });

  it('enters degraded mode but keeps an edit made before a failed load', async () => {
    const { repository, reject } = deferredFailingRepository();
    const vm = new ExpoSketchViewModel(repository);
    const initialization = vm.initialize();

    vm.moveElement('stage-1', 15, 6);
    reject();
    await initialization;

    const moved = vm.state.document.elements.find((element) => element.id === 'stage-1');
    expect(moved).toMatchObject({ x: 15, y: 6 });
    expect(vm.state.phase).toBe('error');
    expect(vm.state.notice.message).toContain('编辑仍保留');
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith(vm.state.document);
  });

  it('recovers the example if repository loading fails', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => { throw new Error('bad storage'); }), save: vi.fn(async () => {}) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    expect(vm.state.document.title).toContain('春日创意市集');
  });

  it('shows a save error without dropping the working document', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => createStarterDocument()), save: vi.fn(async () => { throw new Error('quota'); }) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.addElement('stage');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vm.state.document.elements.some((element) => element.kind === 'stage' && element.id.startsWith('stage-'))).toBe(true);
    expect(vm.state.notice.tone).toBe('error');
  });

  it('ignores invalid dimensions instead of corrupting the working selection', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    const before = vm.state.document.elements[0].width;
    vm.resizeSelected(0, 0);
    expect(vm.state.document.elements[0].width).toBe(before);
  });
});
