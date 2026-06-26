// A self-contained fullscreen lightbox for inspecting a rendered diagram
// image (currently PlantUML, which renders as an `<img>` of a server-side
// SVG capped at `max-width: 100%` in the editor column — too small to read
// when the diagram is dense). The overlay lives directly on `document.body`,
// outside muya's snabbdom tree, so it uses plain DOM and tears its own
// listeners down on close. SVG sources stay crisp at any zoom level.

interface IZoomLabels {
    zoomIn: string;
    zoomOut: string;
    reset: string;
    close: string;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.2;
// Drag distance (px) under which a backdrop press counts as a click-to-close
// rather than a pan, so a tiny jitter while clicking empty space still closes.
const CLICK_SLOP = 3;

const ICONS = {
    zoomIn:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M7 5v4M5 7h4"/></svg>',
    zoomOut:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4"/></svg>',
    reset:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>',
    close:
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

// Only one lightbox is meaningful at a time; opening a new one closes the old.
let activeClose: (() => void) | null = null;

interface IToolbar {
    el: HTMLDivElement;
    setPercent: (value: number) => void;
}

function makeButton(svg: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mu-diagram-zoom-btn';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = svg;
    // Keep presses off the backdrop so they neither pan nor close the overlay.
    button.addEventListener('mousedown', e => e.stopPropagation());
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

function buildToolbar(
    labels: IZoomLabels,
    actions: { zoomIn: () => void; zoomOut: () => void; reset: () => void; close: () => void },
): IToolbar {
    const el = document.createElement('div');
    el.className = 'mu-diagram-zoom-toolbar';

    const percent = document.createElement('span');
    percent.className = 'mu-diagram-zoom-percent';

    el.appendChild(makeButton(ICONS.zoomOut, labels.zoomOut, actions.zoomOut));
    el.appendChild(percent);
    el.appendChild(makeButton(ICONS.zoomIn, labels.zoomIn, actions.zoomIn));
    el.appendChild(makeButton(ICONS.reset, labels.reset, actions.reset));
    el.appendChild(makeButton(ICONS.close, labels.close, actions.close));

    return {
        el,
        setPercent: (value: number) => {
            percent.textContent = `${value}%`;
        },
    };
}

export function openDiagramZoom(src: string, labels: IZoomLabels): void {
    // Replace any overlay already on screen.
    activeClose?.();

    const overlay = document.createElement('div');
    overlay.className = 'mu-diagram-zoom-overlay';

    const img = document.createElement('img');
    img.className = 'mu-diagram-zoom-img';
    img.alt = '';
    img.draggable = false;
    overlay.appendChild(img);

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    // Wired to the toolbar's percent readout once it's built (below); a noop
    // until then so the early render() calls don't depend on declaration order.
    let setPercent: (percent: number) => void = () => {};

    const render = () => {
        img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        setPercent(Math.round(scale * 100));
    };

    const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

    // Zoom toward a focal point (relative to the overlay) so the content under
    // the cursor / screen-center stays put as the scale changes.
    const zoomTo = (nextScale: number, focalX: number, focalY: number) => {
        const next = clamp(nextScale);
        const imgX = (focalX - offsetX) / scale;
        const imgY = (focalY - offsetY) / scale;
        offsetX = focalX - imgX * next;
        offsetY = focalY - imgY * next;
        scale = next;
        render();
    };

    const fit = () => {
        const rect = overlay.getBoundingClientRect();
        const natW = img.naturalWidth || img.width || rect.width;
        const natH = img.naturalHeight || img.height || rect.height;
        // Leave a small margin so the diagram doesn't touch the viewport edges.
        const margin = 0.92;
        scale = clamp(Math.min((rect.width * margin) / natW, (rect.height * margin) / natH));
        offsetX = (rect.width - natW * scale) / 2;
        offsetY = (rect.height - natH * scale) / 2;
        render();
    };

    const zoomByStep = (factor: number) => {
        const rect = overlay.getBoundingClientRect();
        zoomTo(scale * factor, rect.width / 2, rect.height / 2);
    };

    const disposers: Array<() => void> = [];
    const on = <K extends keyof HTMLElementEventMap>(
        target: HTMLElement | Document,
        type: K,
        handler: (event: HTMLElementEventMap[K]) => void,
        options?: AddEventListenerOptions,
    ) => {
        target.addEventListener(type, handler as EventListener, options);
        disposers.push(() => target.removeEventListener(type, handler as EventListener, options));
    };

    const close = () => {
        disposers.forEach(dispose => dispose());
        overlay.remove();
        if (activeClose === close)
            activeClose = null;
    };

    const toolbar = buildToolbar(labels, {
        zoomIn: () => zoomByStep(ZOOM_STEP),
        zoomOut: () => zoomByStep(1 / ZOOM_STEP),
        reset: fit,
        close,
    });
    setPercent = toolbar.setPercent;
    overlay.appendChild(toolbar.el);

    // Wheel zooms toward the cursor.
    on(overlay, 'wheel', (event) => {
        event.preventDefault();
        const rect = overlay.getBoundingClientRect();
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        zoomTo(scale * factor, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    // Press-drag pans; a press on empty backdrop with no real drag closes.
    let panning = false;
    let moved = false;
    let downOnBackdrop = false;
    let startX = 0;
    let startY = 0;
    let startOffsetX = 0;
    let startOffsetY = 0;

    on(overlay, 'mousedown', (event) => {
        if (event.button !== 0)
            return;
        panning = true;
        moved = false;
        downOnBackdrop = event.target === overlay;
        startX = event.clientX;
        startY = event.clientY;
        startOffsetX = offsetX;
        startOffsetY = offsetY;
        overlay.classList.add('mu-diagram-zoom-panning');
        event.preventDefault();
    });

    on(document, 'mousemove', (event) => {
        if (!panning)
            return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > CLICK_SLOP)
            moved = true;
        offsetX = startOffsetX + dx;
        offsetY = startOffsetY + dy;
        render();
    });

    on(document, 'mouseup', () => {
        if (!panning)
            return;
        panning = false;
        overlay.classList.remove('mu-diagram-zoom-panning');
        if (!moved && downOnBackdrop)
            close();
    });

    on(document, 'keydown', (event) => {
        switch (event.key) {
            case 'Escape':
                close();
                break;
            case '+':
            case '=':
                zoomByStep(ZOOM_STEP);
                break;
            case '-':
            case '_':
                zoomByStep(1 / ZOOM_STEP);
                break;
            case '0':
                fit();
                break;
            default:
                break;
        }
    });

    // Fit once the natural dimensions are known.
    on(img, 'load', fit);
    document.body.appendChild(overlay);
    activeClose = close;
    img.src = src;
    if (img.complete && img.naturalWidth)
        fit();
    else
        render();
}
