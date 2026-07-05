// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDiagramZoom } from '../zoom';

const LABELS = {
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    reset: 'Reset',
    close: 'Close',
};

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('openDiagramZoom — overlay creation', () => {
    it('appends an overlay with an img to document.body', () => {
        openDiagramZoom('https://example.com/diagram.svg', LABELS);

        const overlay = document.querySelector('.mu-diagram-zoom-overlay');
        expect(overlay).not.toBeNull();
        const img = overlay!.querySelector('img.mu-diagram-zoom-img');
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe('https://example.com/diagram.svg');
    });

    it('includes a toolbar with zoom buttons and percent readout', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);

        const toolbar = document.querySelector('.mu-diagram-zoom-toolbar');
        expect(toolbar).not.toBeNull();
        const buttons = toolbar!.querySelectorAll('button.mu-diagram-zoom-btn');
        expect(buttons.length).toBe(4);
        expect(buttons[0].getAttribute('aria-label')).toBe('Zoom Out');
        expect(buttons[1].getAttribute('aria-label')).toBe('Zoom In');
        expect(buttons[2].getAttribute('aria-label')).toBe('Reset');
        expect(buttons[3].getAttribute('aria-label')).toBe('Close');

        const percent = toolbar!.querySelector('.mu-diagram-zoom-percent');
        expect(percent).not.toBeNull();
        expect(percent!.textContent).toContain('%');
    });

    it('replaces any existing overlay when opened again', () => {
        openDiagramZoom('https://example.com/a.svg', LABELS);
        openDiagramZoom('https://example.com/b.svg', LABELS);

        const overlays = document.querySelectorAll('.mu-diagram-zoom-overlay');
        expect(overlays.length).toBe(1);
        const img = overlays[0].querySelector('img');
        expect(img!.getAttribute('src')).toBe('https://example.com/b.svg');
    });
});

describe('openDiagramZoom — close behavior', () => {
    it('closes on Escape key', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        expect(document.querySelector('.mu-diagram-zoom-overlay')).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('.mu-diagram-zoom-overlay')).toBeNull();
    });

    it('closes when close button is clicked', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const closeBtn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
        expect(closeBtn).not.toBeNull();

        closeBtn.click();
        expect(document.querySelector('.mu-diagram-zoom-overlay')).toBeNull();
    });

    it('closes on backdrop click without drag', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const overlay = document.querySelector('.mu-diagram-zoom-overlay') as HTMLElement;

        overlay.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 10, clientY: 10, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(document.querySelector('.mu-diagram-zoom-overlay')).toBeNull();
    });
});

describe('openDiagramZoom — keyboard zoom', () => {
    it('zooms in with + key (updates percent display)', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const percent = document.querySelector('.mu-diagram-zoom-percent')!;
        const initialText = percent.textContent;

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
        expect(percent.textContent).not.toBe(initialText);
        expect(Number.parseInt(percent.textContent!)).toBeGreaterThan(100);
    });

    it('zooms out with - key', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const percent = document.querySelector('.mu-diagram-zoom-percent')!;

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
        expect(Number.parseInt(percent.textContent!)).toBeLessThan(100);
    });

    it('resets with 0 key (calls fit, which resets the transform)', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const img = document.querySelector('.mu-diagram-zoom-img') as HTMLElement;

        // Zoom in twice so the transform is non-default.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
        const zoomedTransform = img.style.transform;

        // Press 0 to fit — the transform should change (even in happy-dom where
        // getBoundingClientRect returns zeros, fit() still recalculates offset).
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
        expect(img.style.transform).not.toBe(zoomedTransform);
    });
});

describe('openDiagramZoom — toolbar buttons', () => {
    it('zoom-in button increases the scale', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const percent = document.querySelector('.mu-diagram-zoom-percent')!;
        const before = Number.parseInt(percent.textContent!);

        const zoomInBtn = document.querySelector('button[aria-label="Zoom In"]') as HTMLButtonElement;
        zoomInBtn.click();

        expect(Number.parseInt(percent.textContent!)).toBeGreaterThan(before);
    });

    it('zoom-out button decreases the scale', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const percent = document.querySelector('.mu-diagram-zoom-percent')!;
        const before = Number.parseInt(percent.textContent!);

        const zoomOutBtn = document.querySelector('button[aria-label="Zoom Out"]') as HTMLButtonElement;
        zoomOutBtn.click();

        expect(Number.parseInt(percent.textContent!)).toBeLessThan(before);
    });
});

describe('openDiagramZoom — panning', () => {
    it('adds panning class on mousedown and removes on mouseup', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const overlay = document.querySelector('.mu-diagram-zoom-overlay') as HTMLElement;

        overlay.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 50, bubbles: true }));
        expect(overlay.classList.contains('mu-diagram-zoom-panning')).toBe(true);

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        expect(overlay.classList.contains('mu-diagram-zoom-panning')).toBe(false);
    });

    it('does not close if mouse moved beyond slop threshold during pan', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const overlay = document.querySelector('.mu-diagram-zoom-overlay') as HTMLElement;

        // Start on backdrop
        overlay.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 50, bubbles: true }));
        // Move more than CLICK_SLOP (3px)
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        // Should still be open — it was a pan, not a click-to-close
        expect(document.querySelector('.mu-diagram-zoom-overlay')).not.toBeNull();
    });
});

describe('openDiagramZoom — img draggable', () => {
    it('sets img.draggable = false to prevent native drag', () => {
        openDiagramZoom('https://example.com/d.svg', LABELS);
        const img = document.querySelector('.mu-diagram-zoom-img') as HTMLImageElement;
        expect(img.draggable).toBe(false);
    });
});
