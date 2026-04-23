const BAD = [
  // 性的
  'えろ','エロ','えっち','エッチ','せっくす','セックス','sex','ちんちん','まんこ','おっぱい','ちくび',
  'hentai','ヘンタイ','ヌード','nude','porn','ポルノ','naked','ちんぽ','チンポ','まんこ','オナニー',
  // 恋愛（過激なもの）
  '付き合って','つきあって','愛してる','あいしてる','結婚して','けっこんして',
  'キスして','きすして','ハグして','はぐして','彼女になって','彼氏になって',
  'えっちしよ','エッチしよ',
]

export function moderate(text: string): string {
  let r = text
  for (const w of BAD) {
    r = r.replace(new RegExp(w, 'gi'), '#'.repeat(w.length))
  }
  return r
}

export function isClean(text: string): boolean {
  return moderate(text) === text
}
