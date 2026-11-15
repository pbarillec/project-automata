import { Label, UITransform } from 'cc';
import { fitLabelText, TEXT_MIN_BODY_FONT_SIZE } from './TextFit.ts';

/**
 * AUT-070 presentation shim over the engine-free `fitLabelText` (TextFit.ts): the string a Label should show, judged against the Label's own
 * rect (UITransform width), nominal font size and line capacity (wrap enabled: floor(rect height / line height) lines, otherwise one line).
 * Call it AFTER the node size, font size and line height are set. Text that fits at its nominal font (every shipped English string) comes back
 * unchanged, so wording and device-proven geometry do not change; only a translation that cannot fit even at the minimum font is shortened
 * with an ellipsis instead of overflowing its rect. Non-authoritative presentation only.
 */
export function fitLabel(label: Label, text: string, minFontSize: number = TEXT_MIN_BODY_FONT_SIZE): string {
    const transform = label.node.getComponent(UITransform);
    if (!transform || text.length === 0) return text;
    const width = transform.contentSize.width;
    const height = transform.contentSize.height;
    if (!(width > 0) || !(label.fontSize > 0)) return text;
    const lineHeight = label.lineHeight > 0 ? label.lineHeight : label.fontSize;
    const maxLines = label.enableWrapText ? Math.max(1, Math.floor(height / lineHeight + 1e-6)) : 1;
    return fitLabelText(text, { width, fontSize: label.fontSize, minFontSize: Math.min(minFontSize, label.fontSize), maxLines });
}
