// @vitest-environment happy-dom
import type { Muya } from '../../../../muya';
import type { IDiagramMeta, IDiagramState } from '../../../../state/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyType } from '../../../../clipboard/types';
import { CLASS_NAMES } from '../../../../config';
import I18n from '../../../../i18n';
import { en } from '../../../../locales/en';
import { zhCN } from '../../../../locales/zh-CN';
import DiagramPreview from '../diagramPreview';

// The diagram renderer (`utils/diagram` default export) dynamically imports
// heavy renderer packages (mermaid / vega / flowchart) that don't load under
// happy-dom. We mock it so:
//   - the "valid" path never runs (we only characterize empty + error states),
//   - the "invalid" path can throw a controlled message we assert is sanitized.
const loadRendererMock = vi.fn();
vi.mock('../../../../utils/diagram', () => ({
    default: (...args: unknown[]) => loadRendererMock(...args),
}));

// Mock the context-menu module so we can assert the handler's wiring (which
// menu items it opens with) without exercising the floating-DOM behavior,
// which is the module's own concern.
const openDiagramContextMenuMock = vi.fn();
vi.mock('../contextMenu', () => ({
    openDiagramContextMenu: (...args: unknown[]) => openDiagramContextMenuMock(...args),
}));

const bootedHosts: HTMLElement[] = [];

afterEach(() => {
    while (bootedHosts.length) bootedHosts.pop()!.remove();
    loadRendererMock.mockReset();
    openDiagramContextMenuMock.mockReset();
});

// Build a structurally-typed fake `Muya` carrying only what DiagramPreview
// touches: an `i18n` with `.t(key)`, `options` with the diagram themes, and an
// `editor.clipboard.copy` spy for the right-click "copy source code" path.
function makeFakeMuya(locale = en): { muya: Muya; i18n: I18n; copySpy: ReturnType<typeof vi.fn> } {
    const copySpy = vi.fn();
    const muya = {
        options: {
            mermaidTheme: 'default',
            vegaTheme: 'default',
            sequenceTheme: 'hand',
        },
        editor: {
            clipboard: { copy: copySpy },
        },
    } as unknown as Muya;
    const i18n = new I18n(muya, locale);
    (muya as unknown as { i18n: I18n }).i18n = i18n;
    return { muya, i18n, copySpy };
}

function makeState(text: string, type: IDiagramMeta['type'] = 'mermaid'): IDiagramState {
    return {
        name: 'diagram',
        text,
        meta: { lang: 'yaml', type },
    };
}

// DiagramPreview's constructor fires `update()` unawaited. To get a
// deterministic DOM, construct it, then await our own `update()` call.
function makePreview(text: string, type: IDiagramMeta['type'] = 'mermaid', locale = en) {
    const { muya, i18n, copySpy } = makeFakeMuya(locale);
    const preview = new DiagramPreview(muya, makeState(text, type));
    bootedHosts.push(preview.domNode!);
    return { preview, muya, i18n, copySpy };
}

describe('diagramPreview — empty state', () => {
    it('renders the empty-state class + localized "Empty Diagram" for empty code', async () => {
        const { preview } = makePreview('');
        await preview.update('');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain(`class="${CLASS_NAMES.MU_EMPTY}"`);
        expect(CLASS_NAMES.MU_EMPTY).toBe('mu-empty');
        expect(html).toContain('Empty Diagram');
    });

    it('localizes the empty-state label via i18n (zh-CN)', async () => {
        const { preview } = makePreview('', 'mermaid', zhCN);
        await preview.update('');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain(`class="${CLASS_NAMES.MU_EMPTY}"`);
        expect(html).toContain('空图表');
    });
});

describe('diagramPreview — invalid / error state', () => {
    it('renders the error class + localized "Invalid Diagram Code" when the renderer throws', async () => {
        loadRendererMock.mockRejectedValue(new Error('Unknown diagram name mermaid'));
        const { preview } = makePreview('graph TD; A-->B');
        await preview.update('graph TD; A-->B');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain('class="mu-diagram-error"');
        expect(html).toContain('Invalid Diagram Code');
        expect(html).toContain('class="mu-diagram-error-detail"');
        expect(html).toContain('Unknown diagram name mermaid');
    });

    it('sanitizes the error detail (escapes embedded HTML so no raw tag survives)', async () => {
        loadRendererMock.mockRejectedValue(new Error('boom <img src=x onerror=alert(1)>'));
        const { preview } = makePreview('graph TD; A-->B');
        await preview.update('graph TD; A-->B');

        const detail = preview.domNode!.querySelector('.mu-diagram-error-detail')!;
        expect(detail).not.toBeNull();
        // No live <img> element should be parsed into the DOM — the tag was escaped.
        expect(detail.querySelector('img')).toBeNull();
        expect(preview.domNode!.querySelector('img')).toBeNull();
        // The escaped text is still present as text content.
        expect(detail.textContent).toContain('boom');
    });

    it('localizes the error label via i18n (zh-CN)', async () => {
        loadRendererMock.mockRejectedValue(new Error('nope'));
        const { preview } = makePreview('graph TD; A-->B', 'mermaid', zhCN);
        await preview.update('graph TD; A-->B');

        const html = preview.domNode!.innerHTML;
        expect(html).toContain('class="mu-diagram-error"');
        expect(html).toContain('图表渲染失败');
    });
});

describe('diagramPreview — clickHandler routing', () => {
    it('preventDefault + stopPropagation + setCursor(0,0) on the parent first content', () => {
        const { preview } = makePreview('');
        const setCursor = vi.fn();
        const cursorBlock = { setCursor };
        const parent = {
            firstContentInDescendant: vi.fn(() => cursorBlock),
        };
        // parent is typed as Parent | null; the fake only implements what
        // clickHandler calls.
        preview.parent = parent as unknown as DiagramPreview['parent'];

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        preview.clickHandler(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(parent.firstContentInDescendant).toHaveBeenCalledTimes(1);
        expect(setCursor).toHaveBeenCalledWith(0, 0);
    });

    it('still preventDefault/stopPropagation but does not throw when parent is null', () => {
        const { preview } = makePreview('');
        preview.parent = null;

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        expect(() => preview.clickHandler(event)).not.toThrow();
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('does not throw when parent has no content (firstContentInDescendant returns null)', () => {
        const { preview } = makePreview('');
        const parent = {
            firstContentInDescendant: vi.fn(() => null),
        };
        preview.parent = parent as unknown as DiagramPreview['parent'];

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as Event;

        expect(() => preview.clickHandler(event)).not.toThrow();
        expect(parent.firstContentInDescendant).toHaveBeenCalledTimes(1);
    });
});

// Pins that the diagram-theme options flow from muya.options through
// renderDiagram into the underlying renderer call (not just that the
// default options carry the right value — diagramFlowchartSequence.spec
// only asserts MUYA_DEFAULT_OPTIONS.sequenceTheme === 'hand').
describe('diagramPreview — renderer theme pass-through', () => {
    // The constructor fires update() unawaited, so assert on lastCall — our
    // explicit update() (after mutating the option) is always the latest.
    it('passes sequenceTheme into the sequence renderer drawSVG options (simple)', async () => {
        const drawSVG = vi.fn();
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG }) });

        const { preview, muya } = makePreview('Alice->Bob: Hi', 'sequence');
        muya.options.sequenceTheme = 'simple';
        await preview.update('Alice->Bob: Hi');

        expect(drawSVG).toHaveBeenCalled();
        expect(drawSVG.mock.lastCall![1]).toMatchObject({ theme: 'simple' });
    });

    it('defaults sequenceTheme to the muya option value (hand) when unchanged', async () => {
        const drawSVG = vi.fn();
        loadRendererMock.mockResolvedValue({ parse: () => ({ drawSVG }) });

        const { preview } = makePreview('Alice->Bob: Hi', 'sequence');
        await preview.update('Alice->Bob: Hi');

        expect(drawSVG).toHaveBeenCalled();
        expect(drawSVG.mock.lastCall![1]).toMatchObject({ theme: 'hand' });
    });

    it('passes vegaTheme + ast:true into the vega-lite renderer options', async () => {
        const render = vi.fn();
        loadRendererMock.mockResolvedValue(render);

        const { preview, muya } = makePreview('{}', 'vega-lite');
        muya.options.vegaTheme = 'dark';
        await preview.update('{"mark":"bar"}');

        expect(render).toHaveBeenCalled();
        expect(render.mock.lastCall![2]).toMatchObject({
            theme: 'dark',
            ast: true,
            actions: false,
            tooltip: false,
            renderer: 'svg',
        });
    });
});

describe('diagramPreview — contextMenuHandler (copy source code)', () => {
    it('preventDefault + stopPropagation and opens a menu at the cursor with a "Copy source code" item', () => {
        const { preview, copySpy } = makePreview('@startuml\nA->B\n@enduml', 'plantuml');

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clientX: 42,
            clientY: 99,
        } as unknown as Event;

        preview.contextMenuHandler(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(openDiagramContextMenuMock).toHaveBeenCalledTimes(1);

        const [x, y, items] = openDiagramContextMenuMock.mock.lastCall!;
        expect(x).toBe(42);
        expect(y).toBe(99);
        expect(items).toHaveLength(1);
        expect(items[0].label).toBe('Copy source code');

        // Invoking the item copies the raw fenced source via the same clipboard
        // mechanism the code block uses.
        expect(copySpy).not.toHaveBeenCalled();
        items[0].onClick();
        expect(copySpy).toHaveBeenCalledWith(CopyType.COPY_CODE_CONTENT, '@startuml\nA->B\n@enduml');
    });

    it('localizes the menu label via i18n (zh-CN)', () => {
        const { preview } = makePreview('graph TD; A-->B', 'mermaid', zhCN);

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clientX: 0,
            clientY: 0,
        } as unknown as Event;

        preview.contextMenuHandler(event);

        const [, , items] = openDiagramContextMenuMock.mock.lastCall!;
        expect(items[0].label).toBe('复制源代码');
    });

    it('does not open a menu when the diagram source is empty', () => {
        const { preview } = makePreview('');

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clientX: 0,
            clientY: 0,
        } as unknown as Event;

        preview.contextMenuHandler(event);

        // Still swallow the native menu, but nothing to copy → no menu.
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(openDiagramContextMenuMock).not.toHaveBeenCalled();
    });

    it('skips preventDefault and openDiagramContextMenu when disableDiagramContextMenu is true', () => {
        const { preview, muya } = makePreview('@startuml\nA->B\n@enduml', 'plantuml');
        (muya.options as { disableDiagramContextMenu?: boolean }).disableDiagramContextMenu = true;

        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clientX: 10,
            clientY: 20,
        } as unknown as Event;

        preview.contextMenuHandler(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(openDiagramContextMenuMock).not.toHaveBeenCalled();
    });
});
