// wink-lemmatizer 无自带类型声明，按实际 API 补齐
declare module 'wink-lemmatizer' {
  export function verb(word: string): string
  export function noun(word: string): string
  export function adjective(word: string): string
}
