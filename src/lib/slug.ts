/**
 * Convierte un texto en un slug seguro para URLs (sin acentos, en minúsculas,
 * separado por guiones). Compartido entre el script de datos y las páginas
 * para garantizar que los enlaces coinciden con las rutas generadas.
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
