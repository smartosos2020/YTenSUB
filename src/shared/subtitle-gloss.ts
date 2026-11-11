/** Keep the first two Chinese meanings without cutting a phrase mid-word. */
export function formatSubtitleGloss(translation: string): string {
  return translation
    .split(/[、，,；;。\r\n]+/)
    .map((meaning) => meaning.trim().replace(/^(?:(?:n|v|vt|vi|adj|adv|prep|pron|conj|interj|num|art|aux|abbr)\.\s*)+/i, ''))
    .filter((meaning) => /\p{Script=Han}/u.test(meaning))
    .slice(0, 2)
    .join('、')
}
