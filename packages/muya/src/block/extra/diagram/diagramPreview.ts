import type I18n from '../../../i18n';
import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import { fromEvent } from 'rxjs';
import { CopyType } from '../../../clipboard/types';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import loadRenderer from '../../../utils/diagram';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';
import { openDiagramContextMenu } from './contextMenu';
import { openDiagramZoom } from './zoom';

const debug = logger('diagramPreview:');

// A magnifier shown on the rendered PlantUML image; clicking it opens the
// fullscreen zoom lightbox.
const ZOOM_TRIGGER_ICON
    = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10 14 14M6.5 4.5v4M4.5 6.5h4"/></svg>';

// PlantUML uniquely renders as an `<img>` of a server-side SVG that CSS caps at
// the editor column width, so dense diagrams become unreadable. Append a zoom
// trigger that opens a pannable/zoomable fullscreen view of that same image.
function attachZoomButton(target: HTMLElement, i18n: I18n): void {
    const img = target.querySelector('img');
    if (!img)
        return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mu-diagram-zoom-trigger';
    const label = i18n.t('Zoom diagram');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = ZOOM_TRIGGER_ICON;
    // Keep the press off the preview so it neither enters edit mode nor starts
    // a block selection — only the lightbox should open.
    button.addEventListener('mousedown', event => event.stopPropagation());
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDiagramZoom(img.src, {
            zoomIn: i18n.t('Zoom in'),
            zoomOut: i18n.t('Zoom out'),
            reset: i18n.t('Reset zoom'),
            close: i18n.t('Close'),
        });
    });
    target.appendChild(button);
}

// Give a fixed-size `<svg>` (one with `width`/`height` px attributes but no
// `viewBox`) a viewBox derived from those dimensions, so `max-width: 100%`
// scales it down to fit instead of clipping it. Returns true once applied.
function addViewBox(target: HTMLElement): boolean {
    const svg = target.querySelector('svg');
    if (!svg || svg.getAttribute('viewBox'))
        return !!svg;
    const width = Number.parseFloat(svg.getAttribute('width') ?? '');
    const height = Number.parseFloat(svg.getAttribute('height') ?? '');
    if (width > 0 && height > 0) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        return true;
    }
    return false;
}

// `drawSVG` (js-sequence-diagrams / flowchart.js) renders the `<svg>`
// asynchronously — it's drawn from a theme callback after its font loads — so
// the element and its `width`/`height` attributes aren't there synchronously.
// Try once, then observe `target` until the sized `<svg>` appears.
function ensureViewBox(target: HTMLElement): void {
    if (addViewBox(target))
        return;
    const observer = new MutationObserver(() => {
        if (addViewBox(target))
            observer.disconnect();
    });
    observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['width', 'height'],
    });
    // Safety net so the observer can't leak if the svg never renders.
    setTimeout(() => observer.disconnect(), 5000);
}

interface IRenderOptions {
    type: string;
    code: string;
    target: HTMLElement;
    vegaTheme: string;
    mermaidTheme: string;
    plantumlRenderer: 'remote' | 'local';
    plantumlServer: string;
    plantumlLocalRender?: (code: string) => Promise<string>;
    sequenceTheme: 'hand' | 'simple';
}

async function renderDiagram({
    type,
    code,
    target,
    vegaTheme,
    mermaidTheme,
    plantumlRenderer,
    plantumlServer,
    plantumlLocalRender,
    sequenceTheme,
}: IRenderOptions) {
    const render = await loadRenderer(type);
    const options = {};
    if (type === 'vega-lite') {
        Object.assign(options, {
            actions: false,
            tooltip: false,
            renderer: 'svg',
            theme: vegaTheme,
            ast: true,
        });
    }
    else if (type === 'sequence') {
        Object.assign(options, { theme: sequenceTheme });
    }

    if (type === 'plantuml') {
        if (plantumlRenderer === 'local' && plantumlLocalRender) {
            await render.renderLocal(code, target, plantumlLocalRender);
        }
        else {
            const diagram = render.parse(code, plantumlServer);
            target.innerHTML = '';
            diagram.insertImgElement(target);
        }
    }
    else if (type === 'vega-lite') {
        await render(target, JSON.parse(code), options);
    }
    else if (type === 'flowchart' || type === 'sequence') {
        const diagram = render.parse(code);
        target.innerHTML = '';
        diagram.drawSVG(target, options);
        // js-sequence-diagrams / flowchart.js emit an <svg> with a fixed pixel
        // width/height but NO viewBox, so the `max-width: 100%` style can only
        // clip a wide diagram, not scale it. Derive a viewBox from those pixel
        // dimensions (once the async draw completes) so it scales to fit.
        ensureViewBox(target);
    }
    else if (type === 'mermaid') {
        render.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: mermaidTheme,
        });
        await render.parse(code);
        target.innerHTML = sanitize(code, PREVIEW_DOMPURIFY_CONFIG, true) as string;
        target.removeAttribute('data-processed');
        await render.run({
            nodes: [target],
        });
    }
}

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        clickObservable.subscribe(this.clickHandler.bind(this));

        const contextMenuObservable = fromEvent(this.domNode!, 'contextmenu');
        contextMenuObservable.subscribe(this.contextMenuHandler.bind(this));
    }

    clickHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.parent == null)
            return;

        const cursorBlock = this.parent.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    // Right-click any rendered diagram (img for plantuml, svg for the rest) to
    // copy its raw fenced source — `this._code` is the source for every type.
    contextMenuHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        if (!this._code)
            return;

        const { i18n, editor } = this.muya;
        const { clientX, clientY } = event as MouseEvent;
        openDiagramContextMenu(clientX, clientY, [
            {
                label: i18n.t('Copy source code'),
                onClick: () => {
                    editor.clipboard.copy(CopyType.COPY_CODE_CONTENT, this._code);
                },
            },
        ]);
    }

    async update(code = this._code) {
        const { i18n } = this.muya;
        if (this._code !== code)
            this._code = code;

        if (code) {
            this.domNode!.innerHTML = i18n.t('Loading...');
            const { mermaidTheme, vegaTheme, plantumlRenderer, plantumlServer, plantumlLocalRender, sequenceTheme } = this.muya.options;
            const { _type: type } = this;

            try {
                await renderDiagram({
                    target: this.domNode!,
                    code,
                    type,
                    mermaidTheme,
                    vegaTheme,
                    plantumlRenderer,
                    plantumlServer,
                    plantumlLocalRender,
                    sequenceTheme,
                });
                if (type === 'plantuml')
                    attachZoomButton(this.domNode!, i18n);
            }
            catch (error) {
                const detail
                    = error instanceof Error ? error.message : String(error);
                debug.error(`render ${type} diagram failed: ${detail}`);
                this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; ${i18n.t(
                    'Invalid Diagram Code',
                )} &gt;<div class="mu-diagram-error-detail">${sanitize(
                    detail,
                    PREVIEW_DOMPURIFY_CONFIG,
                    true,
                )}</div></div>`;
            }
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Diagram',
            )} &gt;</div>`;
        }
    }
}

export default DiagramPreview;
