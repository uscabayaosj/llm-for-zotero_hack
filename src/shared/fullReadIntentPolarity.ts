const CLAUSE_BOUNDARIES = [
  ",",
  "，",
  ";",
  ".",
  "!",
  "?",
  "。",
  "！",
  "？",
  "；",
];

export function fullReadClausePrefixAt(
  source: string,
  commandIndex: number,
): string {
  let boundary = -1;
  for (const marker of CLAUSE_BOUNDARIES) {
    boundary = Math.max(boundary, source.lastIndexOf(marker, commandIndex - 1));
  }
  return source.slice(boundary + 1, commandIndex);
}

export function isAffirmativeFullReadCommandAt(
  source: string,
  commandIndex: number,
): boolean {
  const prefix = fullReadClausePrefixAt(source, commandIndex);
  const polarityPrefix = /\b(?:anything|everything|nothing)\s+but\s*$/i.test(
    prefix,
  )
    ? prefix
    : prefix
        .split(
          /\b(?:but|however)\b|(?:但是|但|然而|而是|しかし|ただし|하지만|그러나)/iu,
        )
        .pop() || "";
  return !(
    /\b(?:avoid|cannot|can't|could\s+not|couldn't|did\s+not|didn't|do\s+not|don't|does\s+not|doesn't|anything\s+but|instead\s+of|must\s+not|mustn't|need\s+not|needn't|never|no\s+need|not\s+need|rather\s+than|refrain\s+from|should\s+not|shouldn't|skip|without|would\s+not|wouldn't)\b/i.test(
      polarityPrefix,
    ) ||
    /(?:不要|无需|無需|无须|無須|不需要|没有必要|沒有必要|没必要|沒必要|不想|不愿|不願|不能|不可以|不应该|不應該|不必|不用|不应|不應|不可|禁止|请勿|請勿|勿|别|別|避免)/u.test(
      polarityPrefix,
    )
  );
}

export function excludesEnglishFullRead(value: string): boolean {
  return /\b(?:(?:anything|everything|nothing)\s+(?:but|except)|(?:except|excluding|other\s+than)\s+(?:the\s+)?(?:complete|entire|full|whole))\b/i.test(
    value,
  );
}

export function hasKoreanFullReadNegation(value: string): boolean {
  return /(?:읽지\s*(?:말|마|않)|읽으면\s*안|읽어(?:서는?|선)\s*안|읽을\s*필요(?:가|는)?[^.!?。！？；\n]{0,16}없|읽는\s*(?:것은|것을|건)\s*피|읽고\s*싶지\s*않|읽기\s*싫)/u.test(
    value,
  );
}

export function hasJapaneseFullReadNegation(value: string): boolean {
  return /(?:読(?:むな|んでは(?:いけない|いけません|ならない|なりません)|んで(?:ほしくない|欲しくない)|む(?:必要|べき)(?:では|は|が)?(?:ありません|ない)|むの(?:は|を)避け|むこと(?:は|が)?(?:不要|ない)|ま(?:ない|ず|なく)|みたくない)|全文[^。！？；\n]{0,16}避け)/u.test(
    value,
  );
}
