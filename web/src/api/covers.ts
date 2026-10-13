/** Cover and avatar images: public, so `<img src>` works without a token. */
export type CoverSize = 64 | 300 | 600;

export function coverUrl(id: string, size: CoverSize): string {
  return `/api/v1/covers/${id}?size=${size}`;
}
