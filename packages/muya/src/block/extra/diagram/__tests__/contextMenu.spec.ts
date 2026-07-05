// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDiagramContextMenu } from '../contextMenu';

afterEach(() => {
    document.body.innerHTML = '';
});

describe('openDiagramContextMenu — basic rendering', () => {
    it('creates a menu element on document.body with the given items', () => {
        const onClick = vi.fn();
        openDiagramContextMenu(100, 200, [
            { label: 'Copy source code', onClick },
        ]);

        const menu = document.querySelector('.mu-diagram-context-menu');
        expect(menu).not.toBeNull();
        const items = menu!.querySelectorAll('.mu-diagram-context-menu-item');
        expect(items.length).toBe(1);
        expect(items[0].textContent).toBe('Copy source code');
    });

    it('positions the menu at the given coordinates', () => {
        openDiagramContextMenu(50, 75, [{ label: 'Test', onClick: vi.fn() }]);

        const menu = document.querySelector('.mu-diagram-context-menu') as HTMLElement;
        expect(menu.style.left).toBe('50px');
        expect(menu.style.top).toBe('75px');
    });

    it('adds the visible class after positioning', () => {
        openDiagramContextMenu(10, 10, [{ label: 'Test', onClick: vi.fn() }]);

        const menu = document.querySelector('.mu-diagram-context-menu');
        expect(menu!.classList.contains('mu-diagram-context-menu-visible')).toBe(true);
    });

    it('renders multiple menu items', () => {
        openDiagramContextMenu(0, 0, [
            { label: 'Copy Code', onClick: vi.fn() },
            { label: 'Copy Image', onClick: vi.fn() },
        ]);

        const items = document.querySelectorAll('.mu-diagram-context-menu-item');
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe('Copy Code');
        expect(items[1].textContent).toBe('Copy Image');
    });
});

describe('openDiagramContextMenu — item click behavior', () => {
    it('invokes onClick and closes the menu when an item is clicked', () => {
        const onClick = vi.fn();
        openDiagramContextMenu(0, 0, [{ label: 'Copy', onClick }]);

        const item = document.querySelector('.mu-diagram-context-menu-item') as HTMLElement;
        item.click();

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.mu-diagram-context-menu')).toBeNull();
    });

    it('stops propagation and prevents default on item click', () => {
        openDiagramContextMenu(0, 0, [{ label: 'Copy', onClick: vi.fn() }]);

        const item = document.querySelector('.mu-diagram-context-menu-item') as HTMLElement;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventSpy = vi.spyOn(event, 'preventDefault');
        const stopSpy = vi.spyOn(event, 'stopPropagation');
        item.dispatchEvent(event);

        expect(preventSpy).toHaveBeenCalledTimes(1);
        expect(stopSpy).toHaveBeenCalledTimes(1);
    });
});

describe('openDiagramContextMenu — close triggers', () => {
    it('closes on Escape key', async () => {
        openDiagramContextMenu(0, 0, [{ label: 'Test', onClick: vi.fn() }]);
        expect(document.querySelector('.mu-diagram-context-menu')).not.toBeNull();

        // The close listeners are attached on next tick
        await new Promise(resolve => setTimeout(resolve, 10));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(document.querySelector('.mu-diagram-context-menu')).toBeNull();
    });

    it('closes on mousedown outside the menu', async () => {
        openDiagramContextMenu(0, 0, [{ label: 'Test', onClick: vi.fn() }]);

        await new Promise(resolve => setTimeout(resolve, 10));
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(document.querySelector('.mu-diagram-context-menu')).toBeNull();
    });

    it('does NOT close on mousedown inside the menu', async () => {
        openDiagramContextMenu(0, 0, [{ label: 'Test', onClick: vi.fn() }]);
        const menu = document.querySelector('.mu-diagram-context-menu') as HTMLElement;

        await new Promise(resolve => setTimeout(resolve, 10));
        const event = new MouseEvent('mousedown', { bubbles: true });
        Object.defineProperty(event, 'target', { value: menu.firstChild });
        document.dispatchEvent(event);

        expect(document.querySelector('.mu-diagram-context-menu')).not.toBeNull();
    });

    it('closes on scroll', async () => {
        openDiagramContextMenu(0, 0, [{ label: 'Test', onClick: vi.fn() }]);

        await new Promise(resolve => setTimeout(resolve, 10));
        document.dispatchEvent(new Event('scroll', { bubbles: true }));

        expect(document.querySelector('.mu-diagram-context-menu')).toBeNull();
    });
});

describe('openDiagramContextMenu — singleton behavior', () => {
    it('closes the previous menu when a new one is opened', () => {
        openDiagramContextMenu(10, 10, [{ label: 'First', onClick: vi.fn() }]);
        openDiagramContextMenu(20, 20, [{ label: 'Second', onClick: vi.fn() }]);

        const menus = document.querySelectorAll('.mu-diagram-context-menu');
        expect(menus.length).toBe(1);
        expect(menus[0].querySelector('.mu-diagram-context-menu-item')!.textContent).toBe('Second');
    });
});

describe('openDiagramContextMenu — viewport clamping', () => {
    it('clamps the menu position to stay within viewport bounds', () => {
        // happy-dom's window.innerWidth/innerHeight default to 1024x768
        // Place the menu far right/bottom — it should be clamped.
        openDiagramContextMenu(9999, 9999, [{ label: 'Test', onClick: vi.fn() }]);

        const menu = document.querySelector('.mu-diagram-context-menu') as HTMLElement;
        const left = Number.parseInt(menu.style.left);
        const top = Number.parseInt(menu.style.top);
        expect(left).toBeLessThan(9999);
        expect(top).toBeLessThan(9999);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
    });
});
