const UNITS = ['', 'K', 'M', 'B', 'T'] as const;

/** Formats a finite presentation value without changing the source number. */
export function formatCompactNumber(value: number): string {
    if (!Number.isFinite(value)) return '—';

    const sign = value < 0 ? '-' : '';
    const absolute = Math.abs(value);
    if (absolute < 1000) return `${sign}${formatSmall(absolute)}`;

    let unitIndex = Math.min(UNITS.length - 1, Math.floor(Math.log10(absolute) / 3));
    let scaled = absolute / (10 ** (unitIndex * 3));
    let decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
    let rounded = Number(scaled.toFixed(decimals));
    if (rounded >= 1000 && unitIndex < UNITS.length - 1) {
        unitIndex += 1;
        scaled = absolute / (10 ** (unitIndex * 3));
        decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
        rounded = Number(scaled.toFixed(decimals));
    }

    return `${sign}${formatScaled(rounded, decimals)}${UNITS[unitIndex]}`;
}

function formatSmall(value: number): string {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(value < 10 ? 2 : 1).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatScaled(value: number, decimals: number): string {
    return value.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
