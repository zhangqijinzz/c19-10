import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutRepository } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => initial ?? createStarterDocument()),
  save: vi.fn(async (_document) => {}),
});

const controllableRepository = () => {
  const saves: LayoutDocument[] = [];
  let loadImpl: () => Promise<LayoutDocument> = async () => createStarterDocument();
  const repository: LayoutRepository = {
    load: vi.fn(() => loadImpl()),
    save: vi.fn(async (document) => { saves.push(document); }),
  };
  return {
    repository,
    saves,
    failLoadOnce(error = new Error('bad storage')) {
      loadImpl = async () => { loadImpl = async () => createStarterDocument(); throw error; };
    },
  };
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

  it('keeps edits made while loading even when the loaded document arrives later', async () => {
    let resolveLoad: (document: LayoutDocument) => void = () => {};
    const repository: LayoutRepository = {
      load: vi.fn(() => new Promise<LayoutDocument>((resolve) => { resolveLoad = resolve; })),
      save: vi.fn(async () => {}),
    };
    const vm = new ExpoSketchViewModel(repository);
    const loading = vm.initialize();

    // 加载尚未返回，用户已经在画布上拖动了元素
    vm.moveElement('stage-1', 3.3, 4.4);
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 3.3, y: 4.4 });

    resolveLoad(createStarterDocument());
    await loading;

    // 晚到的加载结果不能把用户的改动抹掉
    expect(vm.state.phase).toBe('ready');
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 3.3, y: 4.4 });
  });

  it('drops a stale load result when a newer load (e.g. StrictMode double run) wins', async () => {
    const stored: LayoutDocument = { ...createStarterDocument(), title: '磁盘上的布局' };
    const stale: LayoutDocument = { ...createStarterDocument(), title: '过期的加载结果' };
    let resolveFirst: (document: LayoutDocument) => void = () => {};
    let secondStarted = false;
    const repository: LayoutRepository = {
      load: vi.fn(() => new Promise<LayoutDocument>((resolve) => {
        if (!secondStarted) { resolveFirst = resolve; return; }
        resolve(stored);
      })),
      save: vi.fn(async () => {}),
    };
    const vm = new ExpoSketchViewModel(repository);
    const first = vm.initialize();
    secondStarted = true;
    const second = vm.initialize();
    resolveFirst(stale);
    await first;
    await second;
    expect(vm.state.document.title).toBe('磁盘上的布局');
  });

  it('stays in degraded mode after a load failure and keeps edits through a successful retry', async () => {
    const setup = controllableRepository();
    setup.failLoadOnce();
    const degraded = new ExpoSketchViewModel(setup.repository);
    await degraded.initialize();
    expect(degraded.state.phase).toBe('error');

    // 降级态下的编辑必须保留
    degraded.moveElement('stage-1', 7.7, 8.8);
    expect(degraded.state.document.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 7.7, y: 8.8 });

    await degraded.retryLoad();
    expect(degraded.state.phase).toBe('ready');
    // 重试成功也不能用磁盘版本覆盖编辑，而应把用户版本回写
    expect(degraded.state.document.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 7.7, y: 8.8 });
    expect(setup.saves[setup.saves.length - 1]?.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 7.7, y: 8.8 });
  });

  it('applies the loaded document on retry when no edits happened during degradation', async () => {
    const setup = controllableRepository();
    setup.failLoadOnce();
    const vm = new ExpoSketchViewModel(setup.repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    await vm.retryLoad();
    expect(vm.state.phase).toBe('ready');
    expect(vm.state.document).toEqual(createStarterDocument());
  });
});
