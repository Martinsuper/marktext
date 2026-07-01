// A minimal right-click context menu for diagram previews. Like `zoom.ts`,
// the menu lives directly on `document.body` (outside muya's snabbdom tree),
// so it uses plain DOM and tears its own listeners down on close. It is
// deliberately tiny — a single "Copy source code" entry today — rather than
// reusing the heavier BaseFloat machinery, which is built for editor-anchored
// popups rather than a cursor-positioned context menu.

export interface IContextMenuItem {
    label: string;
    onClick: () => void;
}

// Only one context menu is meaningful at a time; opening a new one closes the old.
let activeClose: (() => void) | null = null;

export function openDiagramContextMenu(
    x: number,
    y: number,
    items: IContextMenuItem[],
): void {
    activeClose?.();

    const menu = document.createElement('ul');
    menu.className = 'mu-diagram-context-menu';

    const disposers: Array<() => void> = [];
    const on = <K extends keyof DocumentEventMap>(
        target: Document | HTMLElement,
        type: K,
        handler: (event: DocumentEventMap[K]) => void,
        options?: AddEventListenerOptions,
    ) => {
        target.addEventListener(type, handler as EventListener, options);
        disposers.push(() => target.removeEventListener(type, handler as EventListener, options));
    };

    const close = () => {
        disposers.forEach(dispose => dispose());
        menu.remove();
        if (activeClose === close)
            activeClose = null;
    };

    for (const item of items) {
        const li = document.createElement('li');
        li.className = 'mu-diagram-context-menu-item';
        li.textContent = item.label;
        li.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
            item.onClick();
        });
        menu.appendChild(li);
    }

    // Append first (hidden via CSS opacity) so we can measure it and keep the
    // menu fully inside the viewport when the click is near an edge.
    document.body.appendChild(menu);
    const { offsetWidth, offsetHeight } = menu;
    const left = Math.min(x, window.innerWidth - offsetWidth - 4);
    const top = Math.min(y, window.innerHeight - offsetHeight - 4);
    menu.style.left = `${Math.max(0, left)}px`;
    menu.style.top = `${Math.max(0, top)}px`;
    menu.classList.add('mu-diagram-context-menu-visible');

    activeClose = close;

    // Close on any interaction outside the menu, on Escape, or on scroll. The
    // listeners are attached on the next tick so the originating contextmenu
    // event (which is still propagating) doesn't immediately close the menu.
    setTimeout(() => {
        on(document, 'mousedown', (event) => {
            if (!menu.contains(event.target as Node))
                close();
        });
        on(document, 'contextmenu', (event) => {
            if (!menu.contains(event.target as Node))
                close();
        });
        on(document, 'keydown', (event) => {
            if (event.key === 'Escape')
                close();
        });
        on(document, 'scroll', close, { capture: true });
    }, 0);
}
