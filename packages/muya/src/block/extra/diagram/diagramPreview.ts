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

// Module-level render cache: avoids re-rendering unchanged diagrams when the
// block tree is rebuilt (e.g. forceRender, undo/redo). Keyed by `type:code`.
const _renderCache = new Map<string, string>();
const RENDER_CACHE_MAX = 50;

function cacheKey(type: string, code: string): string {
    return `${type}:${code}`;
}

function getCachedHtml(type: string, code: string): string | undefined {
    return _renderCache.get(cacheKey(type, code));
}

function setCachedHtml(type: string, code: string, html: string): void {
    const key = cacheKey(type, code);
    if (_renderCache.size >= RENDER_CACHE_MAX) {
        const first = _renderCache.keys().next().value!;
        _renderCache.delete(first);
    }
    _renderCache.set(key, html);
}

// A magnifier shown on the rendered PlantUML image; clicking it opens the
// fullscreen zoom lightbox.
const ZOOM_TRIGGER_ICON
    = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10 14 14M6.5 4.5v4M4.5 6.5h4"/></svg>';

// Diagrams rendered at `max-width: 100%` can become unreadable when dense.
// Append a zoom trigger that opens a pannable/zoomable fullscreen lightbox.
function attachZoomButton(target: HTMLElement, i18n: I18n): void {
    const img = target.querySelector('img');
    const svg = target.querySelector('svg');
    if (!img && !svg)
        return;

    const getSrc = (): string => {
        if (img)
            return img.src;
        // Clone the SVG so we can set explicit width/height for the <img> to
        // report correct naturalWidth/naturalHeight in the lightbox.
        const clone = svg!.cloneNode(true) as SVGSVGElement;
        const vb = clone.viewBox.baseVal;
        if (vb && vb.width > 0 && vb.height > 0) {
            clone.setAttribute('width', String(vb.width));
            clone.setAttribute('height', String(vb.height));
        }
        else if (!clone.hasAttribute('width') || !clone.hasAttribute('height')) {
            const rect = svg!.getBoundingClientRect();
            clone.setAttribute('width', String(rect.width));
            clone.setAttribute('height', String(rect.height));
        }
        const serialized = new XMLSerializer().serializeToString(clone);
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    };

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
        openDiagramZoom(getSrc(), {
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

// PlantUML's SVG output typically uses `preserveAspectRatio="none"` which
// causes the image to stretch when the container constrains the width via
// `max-width: 100%`. Fix: ensure a viewBox exists and override the attribute
// to `xMidYMid meet` so the diagram scales uniformly.
function fixPlantUmlSvg(target: HTMLElement): void {
    const svg = target.querySelector('svg');
    if (!svg)
        return;

    const width = Number.parseFloat(svg.getAttribute('width') ?? '');
    const height = Number.parseFloat(svg.getAttribute('height') ?? '');

    if (!svg.getAttribute('viewBox') && width > 0 && height > 0)
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '';
    svg.style.height = '';
    svg.style.maxWidth = '100%';
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
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
            fixPlantUmlSvg(target);
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
    private _rendered = false;
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
        clickObservable.subscribe((event: Event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        const dblClickObservable = fromEvent(this.domNode!, 'dblclick');
        dblClickObservable.subscribe(this.clickHandler.bind(this));

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
        event.stopPropagation();

        // In Electron, the host handles the context menu natively via
        // webContents 'context-menu'. Suppressing preventDefault lets Chromium
        // forward the event to the main process.
        if (this.muya.options.disableDiagramContextMenu)
            return;

        event.preventDefault();

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

        if (code === this._code && this._rendered) {
            return;
        }

        this._code = code;
        this._rendered = false;

        if (code) {
            const { mermaidTheme, vegaTheme, plantumlRenderer, plantumlServer, plantumlLocalRender, sequenceTheme } = this.muya.options;
            const { _type: type } = this;

            const cached = getCachedHtml(type, code);
            if (cached) {
                this.domNode!.innerHTML = cached;
                attachZoomButton(this.domNode!, i18n);
                this._rendered = true;
                return;
            }

            this.domNode!.innerHTML = i18n.t('Loading...');

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
                setCachedHtml(type, code, this.domNode!.innerHTML);
                attachZoomButton(this.domNode!, i18n);
                this._rendered = true;
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
