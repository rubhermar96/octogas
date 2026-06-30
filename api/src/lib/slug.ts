/**
 * Mismo slugify que la web (src/lib/slug.ts). Duplicado aquí para que el backend
 * sea autónomo y los scopeId de los agregados coincidan con las rutas de la web.
 */
export function slugify(text: string): string {
    return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
}
